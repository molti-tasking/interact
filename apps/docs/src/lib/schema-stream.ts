/**
 * Wire format and helpers for streamed form generation
 * (`POST /api/llm-stream/generate-schema`). Isomorphic: the route writes
 * the events, the client (`useGenerateSchema`) reads them.
 *
 * The response is NDJSON — one JSON event per line:
 *
 *   {"type":"field","index":0,"field":{…}}   a field the model finished writing
 *   {"type":"reset"}                         a retry started: drop the drafts
 *   {"type":"done","schema":{…}}             the final, post-processed schema
 *   {"type":"error","error":"…"}             generation failed; nothing to commit
 *
 * "field" events are drafts for display only. What gets committed is the
 * schema of the "done" event, which went through the same post-processing
 * as the non-streaming action. A stream that ends without "done" failed.
 */

import { convertPatchFieldType, normalizeOptions } from "interact/forms/schema-patch";
import type { ScaleSpec } from "interact/forms/scale";
import type { Field, PortfolioSchema } from "./types";

/** A field as shown while the form is being written. */
export interface DraftField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  description?: string;
  options?: { label: string; value: string }[];
  scale?: ScaleSpec;
}

export type SchemaStreamEvent =
  | { type: "field"; index: number; field: DraftField }
  | { type: "reset" }
  | { type: "done"; schema: PortfolioSchema }
  | { type: "error"; error: string };

export function encodeEvent(event: SchemaStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

// ---------------------------------------------------------------------------
// Server: which fields of a partial output are finished
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * A draft from one field of the partial output, or null when it lacks a
 * key, label or type. Details that haven't arrived are simply absent.
 */
export function toDraftField(partial: unknown): DraftField | null {
  if (!isRecord(partial)) return null;
  const { key, label, type } = partial;
  if (!nonEmpty(key) || !nonEmpty(label) || !nonEmpty(type)) return null;
  const draft: DraftField = {
    key: key.trim(),
    label: label.trim(),
    type,
    required: partial.required === true,
  };
  if (nonEmpty(partial.description)) draft.description = partial.description.trim();
  const validation = partial.validation;
  if (isRecord(validation) && Array.isArray(validation.options)) {
    const options = normalizeOptions(
      validation.options.filter(
        (o) => typeof o === "string" || (isRecord(o) && nonEmpty(o.label)),
      ),
    );
    if (options.length) draft.options = options;
  }
  if (isRecord(partial.scale)) draft.scale = partial.scale as ScaleSpec;
  return draft;
}

/**
 * The fields of a partial output that the model has finished writing, in
 * order. A partial parse can end mid-string ("Ema" for "Email"), so the
 * field still being written — the last one — is held back until the next
 * one starts; pass `complete` once the output has ended. Stops at the first
 * field that isn't usable, so indexes stay aligned with the output.
 */
export function finishedDraftFields(
  partialFields: unknown,
  complete = false,
): DraftField[] {
  if (!Array.isArray(partialFields)) return [];
  const settled = complete ? partialFields : partialFields.slice(0, -1);
  const drafts: DraftField[] = [];
  for (const partial of settled) {
    const draft = toDraftField(partial);
    if (!draft) break;
    drafts.push(draft);
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Client: reading the stream
// ---------------------------------------------------------------------------

function parseEvent(line: string): SchemaStreamEvent | null {
  const text = line.trim();
  if (!text) return null;
  try {
    const event: unknown = JSON.parse(text);
    return isRecord(event) && typeof event.type === "string"
      ? (event as SchemaStreamEvent)
      : null;
  } catch {
    return null; // a damaged line is skipped; a missing "done" fails the run
  }
}

/** The events of an NDJSON body, as they arrive. Lines may span chunks. */
export async function* readSchemaStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SchemaStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const event = parseEvent(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    const last = parseEvent(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

/** Fold an event into the list of drafts shown on the canvas. */
export function applyDraftEvent(
  drafts: readonly DraftField[],
  event: SchemaStreamEvent,
): DraftField[] {
  if (event.type === "reset") return [];
  if (event.type !== "field") return [...drafts];
  const next = [...drafts];
  next[event.index] = event.field;
  return next;
}

/**
 * Drafts as a schema the form renderer can show. Ids are placeholders
 * (`draft-<n>`): nothing here is stored.
 */
export function draftSchema(drafts: readonly DraftField[]): PortfolioSchema {
  const fields: Field[] = [];
  drafts.forEach((draft, index) => {
    if (!draft) return; // a gap from an event that didn't arrive
    fields.push({
      id: `draft-${index}`,
      name: draft.key,
      label: draft.label,
      type: convertPatchFieldType(
        draft.type,
        draft.options ? { options: draft.options } : null,
        draft.scale ?? null,
      ),
      required: draft.required,
      constraints: [],
      description: draft.description,
      origin: "system",
      tags: [],
    });
  });
  return { fields, groups: [], version: 0 };
}
