import {
  detectSchemaConflictsAction,
  previewConflictFixesAction,
} from "@/app/actions/conflict-actions";
import {
  curateDesignProbesAction,
  previewDesignProbeOptionsAction,
  resolveDesignProbeAction,
  syncIntentFromFieldEditAction,
} from "@/app/actions/design-probe-actions";
import { llmErrorMessage } from "@/lib/model";
import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/llm/<op> — body: the operation's arguments as a JSON array.
 *
 * The LLM calls the workspace makes on its own (answer previews, conflict
 * checks, curation, intent sync) and probe resolution, as a Route Handler
 * rather than server actions: Next runs a client's server actions one at a
 * time, so in the pilot a participant's click waited behind up to five
 * background calls of 5–90 s each. Requests here run in parallel.
 *
 * Each operation is the server action itself, so auth, rate limits and
 * size caps (`guardLlmRequest`, `capText`/`capJson`) apply unchanged.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const OPERATIONS = {
  "preview-probe-options": previewDesignProbeOptionsAction,
  "resolve-probe": resolveDesignProbeAction,
  "curate-probes": curateDesignProbesAction,
  "sync-intent": syncIntentFromFieldEditAction,
  "detect-conflicts": detectSchemaConflictsAction,
  "preview-conflict-fixes": previewConflictFixesAction,
} as const;

export type LlmOperation = keyof typeof OPERATIONS;
export type LlmOperations = typeof OPERATIONS;

/** Request bodies above this are refused before parsing (actions cap again). */
const MAX_BODY_BYTES = 512 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ op: string }> },
) {
  const { op } = await params;
  const run = OPERATIONS[op as LlmOperation] as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;
  if (!run) {
    return NextResponse.json({ success: false, error: "Unknown operation" }, { status: 404 });
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: "Request too large" }, { status: 413 });
  }

  let args: unknown;
  try {
    args = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Expected JSON" }, { status: 400 });
  }
  if (!Array.isArray(args)) {
    return NextResponse.json(
      { success: false, error: "Expected an argument list" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await run(...args));
  } catch (error) {
    // The actions report their own failures as { success: false }; this is
    // for guard errors and anything unexpected.
    return NextResponse.json(
      { success: false, error: llmErrorMessage(error) },
      { status: 500 },
    );
  }
}
