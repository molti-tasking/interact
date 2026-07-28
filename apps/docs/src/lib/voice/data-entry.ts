import type { PortfolioSchema, ReferenceValue } from "@/lib/types";
import {
  matchReference,
  type ReferenceCandidate,
} from "@/lib/voice/reference-resolution";

/**
 * Convert LLM-extracted string values into a response `data` object shaped
 * like a FormRenderer submission: keyed by field name, typed per field kind.
 */
export function buildResponseData(
  schema: PortfolioSchema,
  values: { field: string; value: string }[],
): Record<string, unknown> {
  const fieldsByName = new Map(schema.fields.map((f) => [f.name, f]));
  const data: Record<string, unknown> = {};

  for (const { field, value } of values) {
    const def = fieldsByName.get(field);
    if (!def) continue;

    switch (def.type.kind) {
      case "number": {
        const n = Number(value);
        if (Number.isFinite(n)) data[field] = n;
        break;
      }
      case "boolean": {
        const v = value.trim().toLowerCase();
        data[field] = ["true", "yes", "ja", "1"].includes(v);
        break;
      }
      case "select": {
        // Accept an option value directly, or map a label to its value
        const options = def.type.options;
        const match =
          options.find((o) => o.value === value) ??
          options.find(
            (o) => o.label.toLowerCase() === value.trim().toLowerCase(),
          );
        if (match) data[field] = match.value;
        else data[field] = value;
        break;
      }
      default:
        data[field] = value;
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

/**
 * IO needed to resolve reference fields; injected so the resolution logic
 * stays pure and testable. The hook wires these to Supabase.
 */
export interface ReferenceIO {
  /** Candidate rows of the target portfolio, as (responseId, label) pairs */
  candidatesFor(
    targetPortfolioId: string,
    displayFieldName?: string,
  ): Promise<ReferenceCandidate[]>;
  /**
   * Create a new row in the target portfolio for an unmatched spoken label
   * ("relation by usage"). Returns null when the target can't hold it
   * (e.g. its schema has no text field) — the value then stays a plain string.
   */
  createTarget(
    targetPortfolioId: string,
    label: string,
    displayFieldName?: string,
  ): Promise<ReferenceCandidate | null>;
}

export interface CreatedReference {
  field: string;
  targetPortfolioId: string;
  candidate: ReferenceCandidate;
}

/**
 * Replace spoken string values of reference fields with resolved
 * `ReferenceValue` links. Unmatched labels create a new target row and link
 * to it; if creation isn't possible the spoken string is kept as-is.
 */
export async function resolveReferenceFields(
  schema: PortfolioSchema,
  data: Record<string, unknown>,
  io: ReferenceIO,
): Promise<{ data: Record<string, unknown>; created: CreatedReference[] }> {
  const created: CreatedReference[] = [];
  const resolved = { ...data };

  for (const field of schema.fields) {
    if (field.type.kind !== "reference") continue;
    const spoken = resolved[field.name];
    if (typeof spoken !== "string" || !spoken.trim()) continue;

    const targetId = field.type.targetPortfolioId;
    const displayFieldName = field.type.displayFieldName;
    const candidates = await io.candidatesFor(targetId, displayFieldName);
    const match = matchReference(spoken, candidates);

    if (match) {
      resolved[field.name] = {
        responseId: match.responseId,
        label: match.label,
      } satisfies ReferenceValue;
      continue;
    }

    const createdCandidate = await io.createTarget(
      targetId,
      spoken.trim(),
      displayFieldName,
    );
    if (createdCandidate) {
      resolved[field.name] = {
        responseId: createdCandidate.responseId,
        label: createdCandidate.label,
      } satisfies ReferenceValue;
      created.push({
        field: field.name,
        targetPortfolioId: targetId,
        candidate: createdCandidate,
      });
    }
  }

  return { data: resolved, created };
}
