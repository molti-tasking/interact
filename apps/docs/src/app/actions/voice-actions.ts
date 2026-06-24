"use server";

import type { DetectedStandard } from "@/lib/domain-standards";
import { model } from "@/lib/model";
import { withTracing } from "@/lib/telemetry";
import type { Field, PortfolioSchema } from "@/lib/types";
import { generateText, Output, type GenerateTextResult } from "ai";
import { z } from "zod";
import type { DesignProbeRaw } from "./design-probe-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscribeAudioResponse {
  success: boolean;
  transcript?: string;
  error?: string;
}

export interface VoiceSchemaPatch {
  addFields?: Array<{
    key: string;
    label: string;
    description?: string;
    tooltip?: string;
    type: "string" | "number" | "boolean" | "date" | "email" | "select";
    required: boolean;
    validation?: { options?: Array<{ label: string; value: string }> };
  }>;
  updateFields?: Array<{
    key: string;
    label: string;
    description?: string;
    tooltip?: string;
    type: "string" | "number" | "boolean" | "date" | "email" | "select";
    required: boolean;
    validation?: { options?: Array<{ label: string; value: string }> };
  }>;
  removeFieldKeys?: string[];
  fieldValues?: Array<{
    fieldKey: string;
    value: unknown;
    transcriptSpan: string;
  }>;
}

export interface MapTranscriptResponse {
  success: boolean;
  result?: {
    schemaPatch: VoiceSchemaPatch;
    clarifications: DesignProbeRaw[];
    llmCompletionId?: string;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Zod schemas for structured LLM output
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  label: z.string().describe("2-5 words max"),
  value: z.string().describe("camelCase identifier"),
});

const patchFieldSchema = z.object({
  key: z.string().describe("camelCase field key"),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  type: z.enum(["string", "number", "boolean", "date", "email", "select"]),
  required: z.boolean(),
  validation: z.object({ options: z.array(optionSchema).optional() }).optional(),
});

const fieldValueSchema = z.object({
  fieldKey: z.string().describe("camelCase key of the matched field"),
  value: z.unknown().describe("Extracted value from the transcript"),
  transcriptSpan: z.string().describe("Verbatim fragment from the transcript that contains this value"),
});

const clarificationSchema = z.object({
  text: z.string().describe("Very short headline question, max ~8 words"),
  explanation: z.string().optional().describe("One-sentence subheadline adding context"),
  options: z.array(
    z.object({
      value: z.string().describe("camelCase identifier"),
      label: z.string().describe("2-5 words max"),
    }),
  ),
});

const transcriptMappingSchema = z.object({
  schemaPatch: z.object({
    addFields: z.array(patchFieldSchema).optional().describe("New fields implied by the transcript but not yet in the schema"),
    updateFields: z.array(patchFieldSchema).optional().describe("Existing fields whose definition should be updated"),
    removeFieldKeys: z.array(z.string()).optional().describe("camelCase keys of fields to remove"),
    fieldValues: z.array(fieldValueSchema).optional().describe("Explicit values extracted from the transcript for existing fields"),
  }),
  clarifications: z.array(clarificationSchema).optional().describe("Ambiguous or conflicting information that needs creator input"),
});

// ---------------------------------------------------------------------------
// Action 1: Transcribe audio (fixture-guarded)
// ---------------------------------------------------------------------------

/**
 * Transcribes raw audio (base64-encoded) via an OpenAI-compatible Whisper
 * endpoint.  In fixture mode the real HTTP call is skipped and the recorded
 * transcript is returned instead.
 *
 * The `audioBase64` parameter is the raw audio data encoded as a base64 string.
 * The `mimeType` is the audio MIME type (e.g. "audio/webm", "audio/mp4").
 */
export async function transcribeAudioAction(
  audioBase64: string,
  mimeType: string = "audio/webm",
): Promise<TranscribeAudioResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "transcribeAudioAction",
      { mimeType, audioLength: audioBase64.length },
      () => transcribeAudioReal(audioBase64, mimeType),
    );
  }
  return transcribeAudioReal(audioBase64, mimeType);
}

async function transcribeAudioReal(
  audioBase64: string,
  mimeType: string,
): Promise<TranscribeAudioResponse> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

    if (!apiKey) {
      return { success: false, error: "OPENAI_API_KEY not configured" };
    }

    // Convert base64 → Blob for the multipart upload
    const binary = Buffer.from(audioBase64, "base64");
    const blob = new Blob([binary], { type: mimeType });

    const ext = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
    const formData = new FormData();
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `Whisper API error: ${errText}` };
    }

    const transcript = await response.text();
    return { success: true, transcript: transcript.trim() };
  } catch (error) {
    console.error("[transcribeAudioAction]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Action 2: Map transcript → schema patch + clarifications (fixture-guarded)
// ---------------------------------------------------------------------------

/**
 * Maps a voice transcript to schema changes and/or field values.
 *
 * Mirrors the `resolveDesignProbeAction` pattern:
 * - Reuses the `addFields`/`updateFields`/`removeFieldKeys` patch shape
 * - Extracts explicit field values from the transcript (for form prefill)
 * - Emits `DesignProbeRaw` clarifications (source: "voice") for ambiguous spans
 * - Feeds accepted standards so FHIR / Tax ID fields resolve correctly
 */
export async function mapTranscriptToSchemaAction(
  transcript: string,
  currentSchema: PortfolioSchema,
  voiceSessionId: string,
  userId: string,
  acceptedStandards?: DetectedStandard[],
): Promise<MapTranscriptResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "mapTranscriptToSchemaAction",
      { transcript, voiceSessionId },
      () =>
        mapTranscriptReal(
          transcript,
          currentSchema,
          voiceSessionId,
          userId,
          acceptedStandards,
        ),
      { prompt: transcript },
    );
  }
  return mapTranscriptReal(
    transcript,
    currentSchema,
    voiceSessionId,
    userId,
    acceptedStandards,
  );
}

async function mapTranscriptReal(
  transcript: string,
  currentSchema: PortfolioSchema,
  voiceSessionId: string,
  userId: string,
  acceptedStandards?: DetectedStandard[],
): Promise<MapTranscriptResponse> {
  try {
    const fieldsSummary = currentSchema.fields.map((f) => ({
      key: f.name,
      label: f.label,
      type: f.type.kind,
    }));

    let standardsSection = "";
    if (acceptedStandards && acceptedStandards.length > 0) {
      const lines = acceptedStandards.flatMap((detected) =>
        detected.relevantConstraints.map(
          (c) =>
            `  - ${c.label} (key: ${c.fieldKey}, type: ${c.type}): ${c.description} [${detected.standard.name}: ${c.standardReference}]`,
        ),
      );
      standardsSection = `\n\nDOMAIN STANDARD CONTEXT:\n${lines.join("\n")}`;
    }

    const prompt = `You are a form data extraction assistant. A user spoke the following transcript while filling in a form. Extract structured data from it.

TRANSCRIPT:
"${transcript}"

CURRENT FORM FIELDS:
${JSON.stringify(fieldsSummary, null, 2)}
${standardsSection}

Your tasks:
1. Map any values the speaker stated to existing fields by their camelCase "key". Include matched values in "fieldValues" with the verbatim "transcriptSpan" that contains the value.
2. If the speaker described information that implies a NEW field not yet in the schema, add it to "schemaPatch.addFields".
3. If the speaker described a change to an existing field definition (e.g. making it optional, adding options), add it to "schemaPatch.updateFields".
4. If the speaker said to remove a field, add its key to "schemaPatch.removeFieldKeys".
5. If any information is AMBIGUOUS or CONTRADICTORY (e.g. two different values for the same field, or an unclear intent), emit a "clarification" with 2-3 resolution options. Do NOT silently pick a value in these cases.

RULES:
- Only include sections that have changes. Omit empty arrays.
- Field keys MUST be camelCase.
- "transcriptSpan" should be the exact words from the transcript, verbatim.
- For standard-referenced fields, use the exact "key" from the domain standard context above.
- Clarification "text" must be ≤ 8 words.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: GenerateTextResult<any, any> = await withTracing(
      {
        sessionId: voiceSessionId,
        tags: ["voice", "transcript-mapping"],
        metadata: { userId, voiceSessionId },
      },
      () =>
        generateText({
          model,
          prompt,
          output: Output.object({ schema: transcriptMappingSchema }),
          temperature: 0.2,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "voice-transcript-mapping",
            recordInputs: true,
            recordOutputs: true,
          },
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    const parsed = result.output as {
      schemaPatch: VoiceSchemaPatch;
      clarifications?: Array<{
        text: string;
        explanation?: string;
        options: Array<{ value: string; label: string }>;
      }>;
    };

    // Build clarification DesignProbeRaw items with source: "voice"
    const clarifications: DesignProbeRaw[] = (parsed.clarifications ?? []).map(
      (c: { text: string; explanation?: string; options: Array<{ value: string; label: string }> }, idx: number) => ({
        id: `voice-probe-${voiceSessionId}-${idx}`,
        text: c.text,
        explanation: c.explanation,
        layer: "dimensions" as const,
        source: "voice",
        options: c.options,
        selectedOption: null,
        status: "pending" as const,
        dimensionId: null,
        dimensionName: null,
      }),
    );

    // Extract LLM completion ID from telemetry if available
    const llmCompletionId =
      (result as { response?: { id?: string } }).response?.id ?? undefined;

    return {
      success: true,
      result: {
        schemaPatch: parsed.schemaPatch as VoiceSchemaPatch,
        clarifications,
        llmCompletionId,
      },
    };
  } catch (error) {
    console.error("[mapTranscriptToSchemaAction]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Action 3: Apply voice schema patch (mirrors applyDesignProbe pattern)
// ---------------------------------------------------------------------------

/**
 * Applies a `VoiceSchemaPatch` to the current schema, returning the updated
 * `PortfolioSchema`.  This is a pure transformation — callers are responsible
 * for persisting the result.
 */
export function applyVoiceSchemaPatch(
  currentSchema: PortfolioSchema,
  patch: VoiceSchemaPatch,
): PortfolioSchema {
  let patchedFields = [...currentSchema.fields];

  if (patch.removeFieldKeys?.length) {
    const removeSet = new Set(patch.removeFieldKeys);
    patchedFields = patchedFields.filter((f) => !removeSet.has(f.name));
  }

  if (patch.updateFields?.length) {
    const updateMap = new Map(patch.updateFields.map((f) => [f.key, f]));
    patchedFields = patchedFields.map((existing) => {
      const update = updateMap.get(existing.name);
      if (!update) return existing;
      return {
        ...existing,
        label: update.label,
        type: voiceFieldTypeConvert(update.type, update.validation),
        required: update.required,
        description: update.description,
        tooltip: update.tooltip,
      };
    });
  }

  if (patch.addFields?.length) {
    const newFields: Field[] = patch.addFields.map((f, idx) => ({
      id: `field-voice-${Date.now()}-${idx}`,
      name: f.key,
      label: f.label,
      type: voiceFieldTypeConvert(f.type, f.validation),
      required: f.required,
      constraints: [],
      description: f.description,
      tooltip: f.tooltip,
      origin: "system" as const,
      tags: [],
    }));
    patchedFields = [...patchedFields, ...newFields];
  }

  return { ...currentSchema, fields: patchedFields, version: currentSchema.version + 1 };
}

function voiceFieldTypeConvert(
  type: string,
  validation?: { options?: Array<{ label: string; value: string }> },
): Field["type"] {
  switch (type) {
    case "select":
      return { kind: "select", options: validation?.options ?? [], multiple: false };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "date":
      return { kind: "date" };
    default:
      return { kind: "text" };
  }
}
