import { intentToSchemaAction } from "@/app/actions/schema-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { serializeForLLM } from "interact/forms/structured-intent";
import {
  capJson,
  capText,
  guardLlmRequest,
  LIMITS,
  LlmUnauthorizedError,
} from "@/lib/llm-guard";
import { isTransientLlmError, llmErrorMessage, model } from "@/lib/model";
import {
  buildSchemaGenerationRequest,
  finalizeGeneratedSchema,
  schemaResponseSchema,
  type SchemaGenerationRequest,
} from "@/lib/schema-generation";
import {
  encodeEvent,
  finishedDraftFields,
  type SchemaStreamEvent,
} from "@/lib/schema-stream";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { StructuredIntent } from "@/lib/types";
import { APICallError, Output, streamText } from "ai";
import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/llm-stream/generate-schema — body: `{ intent, acceptedStandards? }`.
 *
 * The first generation of a form, streamed: the same call as
 * `intentToSchemaAction` (same prompt, guards, caps and post-processing —
 * `lib/schema-generation.ts`), but fields are sent as the model finishes
 * writing them, so the canvas fills in instead of staying empty for the
 * whole call. The response is NDJSON; see `lib/schema-stream.ts` for the
 * events. The last event carries the final schema — that is what the client
 * commits; the fields before it are drafts for display.
 *
 * Guard failures (not signed in, rate limit, oversized input) are answered
 * as plain JSON `{ success: false, error }` before any stream starts.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

/** Request bodies above this are refused before parsing (caps apply again). */
const MAX_BODY_BYTES = 512 * 1024;
/** Like the action's timeout: this long without a first field fails the attempt */
const FIRST_FIELD_TIMEOUT_MS = 45_000;
/** A stream that is producing fields may take longer, but not forever */
const TOTAL_TIMEOUT_MS = 110_000;

function refuse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

class StreamTimeoutError extends Error {
  constructor() {
    super("The AI took too long to answer. Please try again.");
    this.name = "TimeoutError";
  }
}

/**
 * One streamed attempt. Sends each field once it is finished; resolves to
 * the final schema. `sent` counts the fields the client has been shown.
 */
async function streamAttempt(
  request: SchemaGenerationRequest,
  send: (event: SchemaStreamEvent) => void,
  sent: { count: number },
) {
  const abort = new AbortController();
  const timedOut = () => abort.abort(new StreamTimeoutError());
  let firstField: ReturnType<typeof setTimeout> | null = setTimeout(
    timedOut,
    FIRST_FIELD_TIMEOUT_MS,
  );
  const total = setTimeout(timedOut, TOTAL_TIMEOUT_MS);
  // streamText reports failures through onError instead of throwing
  let failure: unknown;

  try {
    const result = streamText({
      model,
      output: Output.object({ schema: schemaResponseSchema }),
      system: request.system,
      prompt: request.prompt,
      temperature: 0.3,
      abortSignal: abort.signal,
      maxRetries: 0,
      experimental_telemetry: telemetry("schema-action"),
      onError: ({ error }) => {
        failure ??= error;
      },
    });

    for await (const partial of result.partialOutputStream) {
      const drafts = finishedDraftFields(partial?.artifactFormSchema?.fields);
      if (drafts.length > 0 && firstField) {
        clearTimeout(firstField);
        firstField = null;
      }
      for (let index = sent.count; index < drafts.length; index++) {
        send({ type: "field", index, field: drafts[index] });
      }
      sent.count = Math.max(sent.count, drafts.length);
    }
    if (failure) throw failure;
    if (abort.signal.aborted) throw abort.signal.reason;

    // Validated against the schema; rejects when the output is incomplete
    const output = await result.output;
    if (failure) throw failure;
    return finalizeGeneratedSchema(output, request.acceptedStandards);
  } catch (error) {
    // The abort surfaces as a generic AbortError; report our own reason
    throw abort.signal.aborted ? abort.signal.reason : (failure ?? error);
  } finally {
    if (firstField) clearTimeout(firstField);
    clearTimeout(total);
  }
}

/**
 * Generate with the action's retry policy, as far as it fits a stream: one
 * more attempt after a transient failure, but only while the client hasn't
 * been shown a field — a form must not start over under the creator's eyes
 * with different fields. (If it does retry, "reset" clears the canvas.)
 */
async function generate(
  request: SchemaGenerationRequest,
  send: (event: SchemaStreamEvent) => void,
) {
  const sent = { count: 0 };
  try {
    return await streamAttempt(request, send, sent);
  } catch (error) {
    if (sent.count > 0 || !isTransientLlmError(error)) throw error;
    console.warn(
      `[schema-stream] Transient failure (${error instanceof Error ? error.message : error}), retrying once...`,
    );
    const rateLimited = APICallError.isInstance(error) && error.statusCode === 429;
    await new Promise((resolve) => setTimeout(resolve, rateLimited ? 2_000 : 500));
    send({ type: "reset" });
    return streamAttempt(request, send, sent);
  }
}

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return refuse("Request too large", 413);
  }

  let body: { intent?: StructuredIntent; acceptedStandards?: DetectedStandard[] };
  try {
    body = await req.json();
  } catch {
    return refuse("Expected JSON", 400);
  }
  const { intent, acceptedStandards } = body ?? {};
  if (!intent?.purpose) return refuse("Expected an intent", 400);

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  // A client that went away mustn't fail the run (or leave it unhandled)
  const send = (event: SchemaStreamEvent) => {
    writer.write(encoder.encode(encodeEvent(event))).catch(() => {});
  };
  const respond = () =>
    new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        // Proxies (nginx in front of the app) must not hold the lines back
        "X-Accel-Buffering": "no",
      },
    });

  // Fixtures (e2e tests, screenshots): the recorded action result, as the
  // only event — the action does its own guarding and recording.
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    void (async () => {
      try {
        const result = await intentToSchemaAction(
          intent,
          acceptedStandards?.length ? acceptedStandards : undefined,
        );
        send(
          result.success && result.result
            ? { type: "done", schema: result.result.artifactFormSchema }
            : { type: "error", error: result.error ?? "Failed to generate schema" },
        );
      } catch (error) {
        send({ type: "error", error: llmErrorMessage(error) });
      } finally {
        writer.close().catch(() => {});
      }
    })();
    return respond();
  }

  let request: SchemaGenerationRequest;
  try {
    const basePrompt = serializeForLLM(intent);
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(acceptedStandards, LIMITS.document, "Accepted standards");
    await guardLlmRequest();
    request = buildSchemaGenerationRequest(
      basePrompt,
      acceptedStandards?.length ? acceptedStandards : undefined,
    );
  } catch (error) {
    return refuse(
      llmErrorMessage(error),
      error instanceof LlmUnauthorizedError ? 401 : 400,
    );
  }

  // Started here, inside the request scope (tracing reads the session),
  // and left running while the response streams
  void withTracing({ tags: ["schema", "generate", "stream"] }, () =>
    generate(request, send),
  )
    .then(
      (schema) => send({ type: "done", schema }),
      (error) => {
        console.error("Intent to schema (stream) error:", error);
        send({ type: "error", error: llmErrorMessage(error) });
      },
    )
    .finally(() => writer.close().catch(() => {}));

  return respond();
}
