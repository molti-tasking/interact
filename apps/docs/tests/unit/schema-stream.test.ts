import { beforeEach, describe, expect, it, vi } from "vitest";

const streamText = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText,
}));

vi.mock("@/lib/telemetry", () => ({
  withTracing: (_opts: unknown, fn: () => unknown) => fn(),
  telemetry: (functionId: string) => ({ isEnabled: false, functionId }),
}));

import { POST } from "@/app/api/llm-stream/generate-schema/route";
import { requireDesigner, UnauthorizedError } from "@/lib/auth";
import {
  buildSchemaGenerationRequest,
  finalizeGeneratedSchema,
  type GeneratedSchemaOutput,
} from "@/lib/schema-generation";
import {
  applyDraftEvent,
  draftSchema,
  encodeEvent,
  finishedDraftFields,
  readSchemaStream,
  toDraftField,
  type DraftField,
  type SchemaStreamEvent,
} from "@/lib/schema-stream";
import { getStandardById } from "@/lib/standards";
import { emptyStructuredIntent } from "@/lib/types";
import type { NextRequest } from "next/server";

process.env.LLM_RATE_LIMIT_PER_MIN = "0";

type OutputField = GeneratedSchemaOutput["artifactFormSchema"]["fields"][number];

function outField(key: string, label: string, extra: Partial<OutputField> = {}): OutputField {
  return { key, label, type: "string", validation: null, scale: null, required: false, ...extra };
}

function output(fields: OutputField[], extra: object = {}): GeneratedSchemaOutput {
  return { artifactFormSchema: { name: "Form", description: "", fields, ...extra } };
}

// ---------------------------------------------------------------------------
// Shared post-processing
// ---------------------------------------------------------------------------

describe("finalizeGeneratedSchema", () => {
  it("normalizes keys, drops duplicates and converts types", () => {
    const schema = finalizeGeneratedSchema(
      output([
        outField("Full Name", "Full name", { required: true }),
        outField("fullName", "Name again"),
        outField("tshirt", "T-shirt size", {
          type: "select",
          validation: { options: [{ label: "S", value: "s" }, { label: "L", value: "l" }] },
        }),
        outField("ease", "Easy to use", {
          type: "scale",
          scale: { points: ["No", "Maybe", "Yes"], min: 1, max: 3, lowLabel: "", highLabel: "" },
        }),
      ]),
      [],
    );
    expect(schema.fields.map((f) => f.name)).toEqual(["fullName", "tshirt", "ease"]);
    expect(schema.fields[0]).toMatchObject({ required: true, origin: "system", type: { kind: "text" } });
    expect(schema.fields[1].type).toEqual({
      kind: "select",
      multiple: false,
      options: [{ label: "S", value: "s" }, { label: "L", value: "l" }],
    });
    expect(schema.fields[2].type).toMatchObject({ kind: "scale", min: 1, max: 3 });
    expect(schema.version).toBe(1);
    expect(new Set(schema.fields.map((f) => f.id)).size).toBe(3);
  });

  it("places fields in the sections the model named", () => {
    const schema = finalizeGeneratedSchema(
      output(
        [
          outField("name", "Name", { section: "About you" }),
          outField("feedback", "Feedback", { section: "Feedback" }),
        ],
        { sections: [{ title: "About you", description: "Who you are" }, { title: "Feedback", description: "" }] },
      ),
      [],
    );
    expect(schema.groups.map((g) => g.label)).toEqual(["About you", "Feedback"]);
    expect(schema.groups[0].fieldIds).toEqual([schema.fields[0].id]);
    expect(schema.groups[0].description).toBe("Who you are");
  });

  it("gives standard fields their canonical keys", () => {
    const standard = getStandardById("fhir-patient-intake")!;
    const { acceptedStandards, prompt } = buildSchemaGenerationRequest("Patient intake", [
      { standard, confidence: 1, relevantConstraints: standard.fieldConstraints },
    ] as never);
    const constraint = acceptedStandards[0].relevantConstraints[0];
    expect(prompt).toContain("DOMAIN STANDARD COMPLIANCE");
    expect(prompt).toContain("<form_description>\nPatient intake\n</form_description>");

    const schema = finalizeGeneratedSchema(
      output([
        outField("somethingElse", constraint.label, { standardReference: constraint.standardReference }),
      ]),
      acceptedStandards,
    );
    expect(schema.fields[0].name).toBe(constraint.fieldKey);
  });
});

// ---------------------------------------------------------------------------
// Partial-field filter
// ---------------------------------------------------------------------------

describe("finishedDraftFields", () => {
  const name = { key: "name", label: "Name", type: "string", required: true };

  it("holds back the field still being written", () => {
    expect(finishedDraftFields([name, { key: "ema" }])).toEqual([
      { key: "name", label: "Name", type: "string", required: true },
    ]);
    // "Ema" may become "Email": the last field isn't shown until the next starts
    expect(finishedDraftFields([name, { key: "email", label: "Ema", type: "email" }])).toHaveLength(1);
    expect(finishedDraftFields([name])).toEqual([]);
  });

  it("includes the last field once the output is complete", () => {
    expect(finishedDraftFields([name, { key: "email", label: "Email", type: "email" }], true)).toEqual([
      { key: "name", label: "Name", type: "string", required: true },
      { key: "email", label: "Email", type: "email", required: false },
    ]);
  });

  it("stops at a field without key, label or type, and tolerates junk", () => {
    expect(finishedDraftFields([name, { key: "x", label: "" }, name, name])).toHaveLength(1);
    expect(finishedDraftFields(undefined)).toEqual([]);
    expect(finishedDraftFields("fields")).toEqual([]);
    expect(toDraftField(null)).toBeNull();
    expect(toDraftField({ key: "a", label: "A" })).toBeNull();
  });

  it("carries the options and description that have arrived", () => {
    expect(
      toDraftField({
        key: "size",
        label: "Size",
        type: "select",
        description: " Pick one ",
        validation: { options: [{ label: "S", value: "s" }, { label: "" }, undefined, "L"] },
      }),
    ).toEqual({
      key: "size",
      label: "Size",
      type: "select",
      required: false,
      description: "Pick one",
      options: [{ label: "S", value: "s" }, { label: "L", value: "L" }],
    });
  });
});

// ---------------------------------------------------------------------------
// Stream parser and client-side folding
// ---------------------------------------------------------------------------

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SchemaStreamEvent[]> {
  const events: SchemaStreamEvent[] = [];
  for await (const event of readSchemaStream(body)) events.push(event);
  return events;
}

const draft = (key: string): DraftField => ({ key, label: key, type: "string", required: false });

describe("readSchemaStream", () => {
  it("parses events whose lines are split across chunks", async () => {
    const text =
      encodeEvent({ type: "field", index: 0, field: { ...draft("name"), label: "Näme ✓" } }) +
      encodeEvent({ type: "reset" }) +
      encodeEvent({ type: "error", error: "boom" });
    // Byte-level split, also through the multi-byte characters
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    });
    const events = await collect(body);
    expect(events.map((e) => e.type)).toEqual(["field", "reset", "error"]);
    expect(events[0]).toMatchObject({ field: { label: "Näme ✓" } });
  });

  it("skips blank and damaged lines and reads a last line without newline", async () => {
    const events = await collect(
      bodyOf(['\n{"type":"reset"}\n', "not json\n", '"a string"\n', '{"type":"error","error":"x"}']),
    );
    expect(events).toEqual([{ type: "reset" }, { type: "error", error: "x" }]);
  });
});

describe("applyDraftEvent / draftSchema", () => {
  it("collects fields by index and clears them on reset", () => {
    let drafts: DraftField[] = [];
    drafts = applyDraftEvent(drafts, { type: "field", index: 0, field: draft("a") });
    drafts = applyDraftEvent(drafts, { type: "field", index: 1, field: draft("b") });
    expect(drafts.map((d) => d.key)).toEqual(["a", "b"]);
    expect(applyDraftEvent(drafts, { type: "reset" })).toEqual([]);
  });

  it("renders drafts as placeholder fields, skipping gaps", () => {
    const drafts = applyDraftEvent([], {
      type: "field",
      index: 1,
      field: { ...draft("size"), type: "select", options: [{ label: "S", value: "s" }] },
    });
    const schema = draftSchema(drafts);
    expect(schema.fields).toHaveLength(1);
    expect(schema.fields[0]).toMatchObject({
      id: "draft-1",
      name: "size",
      type: { kind: "select", options: [{ label: "S", value: "s" }] },
    });
  });
});

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/llm-stream/generate-schema", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function intent(purpose: string) {
  const value = emptyStructuredIntent();
  value.purpose.content = purpose;
  return value;
}

/** A `streamText` result that yields `partials`, then resolves or fails. */
function streamResult(
  partials: unknown[],
  end: { output?: GeneratedSchemaOutput; error?: unknown },
) {
  return (options: { onError?: (event: { error: unknown }) => void }) => ({
    partialOutputStream: (async function* () {
      for (const partial of partials) yield partial;
      if (end.error) options.onError?.({ error: end.error });
    })(),
    // Like the SDK's: the promise only exists once it is asked for
    get output() {
      return end.error ? Promise.reject(end.error) : Promise.resolve(end.output);
    },
  });
}

const nameField = outField("name", "Name", { required: true });
const emailField = outField("email", "Email", { type: "email" });
const partialsFor = (fields: object[]) => ({ artifactFormSchema: { fields } });

describe("POST /api/llm-stream/generate-schema", () => {
  beforeEach(() => {
    streamText.mockReset();
    vi.unstubAllEnvs();
  });

  it("streams finished fields, then the post-processed schema", async () => {
    streamText.mockImplementation(
      streamResult(
        [
          partialsFor([{ key: "na" }]),
          partialsFor([nameField, { key: "email", label: "Ema" }]),
          partialsFor([nameField, emailField]),
        ],
        { output: output([nameField, emailField]) },
      ),
    );

    const res = await POST(request({ intent: intent("Newsletter sign-up") }));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await collect(res.body!);

    // The last field is only confirmed by the final schema
    expect(events.map((e) => e.type)).toEqual(["field", "done"]);
    expect(events[0]).toMatchObject({ index: 0, field: { key: "name", required: true } });
    const done = events[1] as Extract<SchemaStreamEvent, { type: "done" }>;
    expect(done.schema.fields.map((f) => f.name)).toEqual(["name", "email"]);
    expect(done.schema.fields[0].id).toMatch(/^field-/);

    const call = streamText.mock.calls[0][0];
    expect(call.system).toContain("HOW FORMS WORK HERE");
    expect(call.prompt).toContain("<form_description>\n## Purpose\nNewsletter sign-up");
    expect(call.maxRetries).toBe(0);
  });

  it("retries once after a transient failure before any field was shown", async () => {
    const transient = Object.assign(new Error("fetch failed"), { name: "Error" });
    streamText
      .mockImplementationOnce(streamResult([], { error: transient }))
      .mockImplementationOnce(streamResult([], { output: output([nameField]) }));

    const events = await collect(
      (await POST(request({ intent: intent("Sign-up") }))).body!,
    );
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual(["reset", "done"]);
  });

  it("doesn't start over once fields were shown", async () => {
    streamText.mockImplementation(
      streamResult([partialsFor([nameField, { key: "e" }])], {
        error: Object.assign(new Error("fetch failed"), { name: "Error" }),
      }),
    );
    const events = await collect(
      (await POST(request({ intent: intent("Sign-up") }))).body!,
    );
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(["field", "error"]);
    expect(events[1]).toMatchObject({ error: "fetch failed" });
  });

  it("refuses with plain JSON before streaming: signed out, oversized, malformed", async () => {
    vi.mocked(requireDesigner).mockRejectedValueOnce(new UnauthorizedError());
    const signedOut = await POST(request({ intent: intent("Sign-up") }));
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({ success: false });

    const tooLong = await POST(request({ intent: intent("x".repeat(70_000)) }));
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toMatch(/too long/);

    expect((await POST(request({}))).status).toBe(400);
    expect(streamText).not.toHaveBeenCalled();
  });
});
