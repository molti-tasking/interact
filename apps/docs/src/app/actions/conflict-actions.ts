"use server";

import {
  applyConflictChanges,
  conflictChangesSchema,
  type ConflictFixPreview,
} from "@/lib/engine/conflict-changes";
import {
  hashSection,
  mergeIntentText,
  serializeForLLM,
  serializeSchemaForLLM,
} from "@/lib/engine/structured-intent";
import { capJson, capText, checkRateLimit, LIMITS } from "@/lib/llm-guard";
import { fastModel, model } from "@/lib/model";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchemaConflict {
  id: string;
  kind:
    | "duplicate_fields"
    | "type_mismatch"
    | "missing_required"
    | "contradictory_constraints"
    | "orphaned_group"
    | "semantic_overlap"
    | "naming_inconsistency";
  severity: "error" | "warning" | "info";
  description: string;
  fieldIds: string[];
  /** Auto-fix options presented as design probe choices */
  fixes: ConflictFix[];
}

export interface ConflictFix {
  value: string;
  label: string;
  /** Patch to apply — partial schema changes described for the resolver */
  description: string;
}

export interface DetectConflictsResponse {
  success: boolean;
  conflicts?: SchemaConflict[];
  error?: string;
}

export interface PreviewConflictFixesResponse {
  success: boolean;
  /** Fix value → what it would change; fixes the model skipped are missing */
  previews?: Record<string, ConflictFixPreview>;
  error?: string;
}

export interface ResolveConflictResponse {
  success: boolean;
  result?: {
    updatedSchema: PortfolioSchema;
    updatedIntent: StructuredIntent;
    rationale: string;
    /** Changes that referenced unknown ids or would collide (not applied) */
    skipped?: string[];
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Zod schema for structured output
// ---------------------------------------------------------------------------

const detectConflictsSchema = z.object({
  conflicts: z.array(z.object({
    kind: z.enum(["semantic_overlap", "type_mismatch", "contradictory_constraints", "naming_inconsistency", "missing_required"]),
    severity: z.enum(["error", "warning", "info"]),
    description: z
      .string()
      .describe("One short sentence naming fields by their label, never by id"),
    fieldIds: z.array(z.string()),
    fixes: z.array(z.object({
      value: z.string(),
      label: z.string().describe("SHORT label, 2-6 words"),
      description: z.string(),
    })),
  })),
});

const resolveConflictSchema = z.object({
  updatedIntent: z
    .string()
    .describe("Updated intent text if changed, otherwise same as current"),
  changes: conflictChangesSchema,
  rationale: z
    .string()
    .describe("Brief explanation of what was changed and why"),
});

const previewFixesSchema = z.object({
  outcomes: z.array(
    z.object({
      value: z.string().describe("The fix's value, exactly as listed"),
      summary: z
        .string()
        .describe(
          "What applying this fix changes, max ~8 words, e.g. 'Merges the two email fields'",
        ),
      changes: conflictChangesSchema,
    }),
  ),
});

/** Deterministic conflict id, so a dismissed conflict stays dismissed on re-detection. */
function llmConflictId(kind: string, fieldIds: string[], taken: Set<string>): string {
  const base = `conflict-llm-${kind}-${hashSection([...fieldIds].sort().join(","))}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// Detect conflicts
// ---------------------------------------------------------------------------

export async function detectSchemaConflictsAction(
  schema: PortfolioSchema,
  intent: StructuredIntent,
): Promise<DetectConflictsResponse> {
  const intentText = serializeForLLM(intent);
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "detectSchemaConflicts",
      { schema, intent: intentText },
      () => detectSchemaConflictsReal(schema, intentText),
      { prompt: intentText },
    );
  }
  return detectSchemaConflictsReal(schema, intentText);
}

async function detectSchemaConflictsReal(
  schema: PortfolioSchema,
  intent: string,
): Promise<DetectConflictsResponse> {
  if (schema.fields.length === 0) {
    return { success: true, conflicts: [] };
  }

  try {
    capJson(schema, LIMITS.document, "Schema");
    capText(intent, LIMITS.document, "Intent");
    // A rate-limited check must fail rather than look like "no conflicts",
    // since the client caches results per content.
    await checkRateLimit();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // --- Phase 1: deterministic checks ---
  const deterministicConflicts: SchemaConflict[] = [];

  // Check duplicate field names
  const nameCount = new Map<string, string[]>();
  for (const f of schema.fields) {
    const key = f.name.toLowerCase();
    const ids = nameCount.get(key) ?? [];
    ids.push(f.id);
    nameCount.set(key, ids);
  }
  for (const [name, ids] of nameCount) {
    if (ids.length > 1) {
      deterministicConflicts.push({
        id: `conflict-dup-${name}`,
        kind: "duplicate_fields",
        severity: "error",
        description: `Multiple fields share the name "${name}"`,
        fieldIds: ids,
        fixes: [
          {
            value: "merge",
            label: "Merge into one field",
            description: `Merge duplicate "${name}" fields into a single field, combining constraints`,
          },
          {
            value: "rename",
            label: "Rename duplicates",
            description: `Keep all fields but give unique names based on context`,
          },
          {
            value: "remove",
            label: "Keep first, remove others",
            description: `Keep the first "${name}" field and remove the rest`,
          },
        ],
      });
    }
  }

  // Check orphaned group references
  const fieldIds = new Set(schema.fields.map((f) => f.id));
  for (const group of schema.groups) {
    const orphans = group.fieldIds.filter((id) => !fieldIds.has(id));
    if (orphans.length > 0) {
      deterministicConflicts.push({
        id: `conflict-orphan-${group.id}`,
        kind: "orphaned_group",
        severity: "warning",
        description: `Group "${group.label}" references ${orphans.length} non-existent field(s)`,
        fieldIds: orphans,
        fixes: [
          {
            value: "clean",
            label: "Remove broken references",
            description: "Remove non-existent field IDs from the group",
          },
          {
            value: "removeGroup",
            label: "Remove entire group",
            description: "Delete the group definition entirely",
          },
        ],
      });
    }
  }

  // --- Phase 2: LLM semantic analysis ---
  try {
    // Compact field summary to reduce token count (~50% fewer tokens vs full JSON)
    const fieldLines = schema.fields.map((f) => {
      const req = f.required ? "*" : "";
      const desc = f.description ? ` — ${f.description}` : "";
      return `  ${f.id} | ${f.name}${req} (${f.type.kind}): "${f.label}"${desc}`;
    });

    const system = `You are a form schema quality analyzer. Detect conflicts, inconsistencies, and issues in this form schema.`;

    const prompt = `Form intent: ${intent}

Schema fields (* = required):
${fieldLines.join("\n")}

Look for these issues (only report REAL problems, not minor style preferences):
1. **semantic_overlap**: Fields that capture the same information differently (e.g., "email" and "contactEmail")
2. **type_mismatch**: Field type doesn't match its label/description (e.g., a "date of birth" stored as text)
3. **contradictory_constraints**: Constraints that conflict with each other or the field type
4. **naming_inconsistency**: Mix of naming conventions (e.g., camelCase and snake_case) or unclear labels
5. **missing_required**: Fields that should logically be required but aren't, given the form's purpose

For EACH conflict found, provide 2-3 concrete fix options (not generic advice).
If no conflicts found, return an empty conflicts array.
Rules:
- Only real issues, not nitpicks
- Don't report fields that share the same name — those are already detected
- "description": one short sentence (max ~12 words) that names fields by their label in quotes, never by id or key — e.g. 'Email' and 'Contact email' collect the same thing.
- "fieldIds": the ids of the fields involved, exactly as listed
- Max 5 conflicts
- Fix labels must be SHORT (2-6 words)
- severity: "error" for breaking issues, "warning" for quality issues, "info" for suggestions`;

    const result = await withTracing(
      { tags: ["conflicts", "detect"] },
      () =>
        generateText({
          model: fastModel,
          system,
          prompt,
          temperature: 0.2,
          output: Output.object({ schema: detectConflictsSchema }),
          experimental_telemetry: telemetry("detect-conflicts"),
        }),
    );

    if (!result.output) {
      // Structured output parse failure — just return deterministic results
      return { success: true, conflicts: deterministicConflicts };
    }

    // The model sometimes cites field names instead of ids
    const idByName = new Map(schema.fields.map((f) => [f.name, f.id]));
    const takenIds = new Set(deterministicConflicts.map((c) => c.id));
    const llmConflicts: SchemaConflict[] = (result.output.conflicts ?? [])
      .slice(0, 5)
      .map((c) => {
        const ids = c.fieldIds.map((ref) =>
          fieldIds.has(ref) ? ref : (idByName.get(ref) ?? ref),
        );
        return {
          ...c,
          fieldIds: ids,
          id: llmConflictId(c.kind, ids, takenIds),
        };
      });

    return {
      success: true,
      conflicts: [...deterministicConflicts, ...llmConflicts],
    };
  } catch (error) {
    console.error("Conflict detection LLM error:", error);
    // Return deterministic results even if LLM fails
    return { success: true, conflicts: deterministicConflicts };
  }
}

// ---------------------------------------------------------------------------
// Preview: what each fix would change, computed ahead of time so the deck
// can preview a fix and apply it without an LLM round trip
// ---------------------------------------------------------------------------

export async function previewConflictFixesAction(
  schema: PortfolioSchema,
  intent: StructuredIntent,
  conflict: SchemaConflict,
): Promise<PreviewConflictFixesResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "previewConflictFixes",
      { schema, intent, conflict },
      () => previewConflictFixesReal(schema, intent, conflict),
      { prompt: conflict.description },
    );
  }
  return previewConflictFixesReal(schema, intent, conflict);
}

async function previewConflictFixesReal(
  schema: PortfolioSchema,
  intent: StructuredIntent,
  conflict: SchemaConflict,
): Promise<PreviewConflictFixesResponse> {
  try {
    const intentText = serializeForLLM(intent);
    capText(intentText, LIMITS.document, "Intent");
    capJson(schema, LIMITS.document, "Schema");
    capJson(conflict, LIMITS.prompt, "Conflict");
    await checkRateLimit();

    const system = `You are a form schema repair assistant. Work out how each proposed fix would resolve a schema conflict.`;

    const prompt = `Current intent: ${intentText}

Current schema ([id] key: "Label" (type…)):
${serializeSchemaForLLM(schema, { ids: true, constraints: true, groups: true })}

Conflict: ${conflict.description}
Affected fields: ${conflict.fieldIds.join(", ")}
Conflict type: ${conflict.kind}

Proposed fixes:
${conflict.fixes.map((f) => `- value "${f.value}": "${f.label}" — ${f.description}`).join("\n")}

For EACH fix, return the exact schema changes it needs, so it can be previewed and applied instantly:
- "value": the fix's value, exactly as listed
- "summary": what the fix changes, as a short phrase (max ~8 words)
- "changes": ONLY the changes needed for that fix. Fields and groups you don't mention stay unchanged. Refer to existing fields and groups by their [id] exactly as listed.
Each fix is applied on its own to the current schema — never assume another fix was applied.`;

    const result = await withTracing(
      { tags: ["conflicts", "preview"] },
      () =>
        generateText({
          model,
          system,
          prompt,
          temperature: 0.2,
          output: Output.object({ schema: previewFixesSchema }),
          experimental_telemetry: telemetry("preview-conflict-fixes"),
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    const known = new Set(conflict.fixes.map((f) => f.value));
    const previews: Record<string, ConflictFixPreview> = {};
    for (const outcome of result.output.outcomes) {
      if (!known.has(outcome.value)) continue;
      const before = JSON.stringify(schema.fields);
      const { schema: after, skipped } = applyConflictChanges(
        schema,
        outcome.changes,
      );
      const changed =
        JSON.stringify(after.fields) !== before ||
        after.groups.length !== schema.groups.length;
      previews[outcome.value] = {
        // Don't let the summary claim a change the fix can't make
        summary:
          !changed && skipped.length > 0 ? "No form change" : outcome.summary,
        changes: outcome.changes,
      };
    }

    return { success: true, previews };
  } catch (error) {
    console.error("Conflict fix preview error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Resolve a conflict (apply fix)
// ---------------------------------------------------------------------------

export async function resolveSchemaConflictAction(
  schema: PortfolioSchema,
  intent: StructuredIntent,
  conflict: SchemaConflict,
  selectedFix: ConflictFix,
): Promise<ResolveConflictResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "resolveSchemaConflict",
      { schema, intent, conflict, selectedFix },
      () => resolveSchemaConflictReal(schema, intent, conflict, selectedFix),
      { selectedOptionLabel: selectedFix.value },
    );
  }
  return resolveSchemaConflictReal(schema, intent, conflict, selectedFix);
}

async function resolveSchemaConflictReal(
  schema: PortfolioSchema,
  intent: StructuredIntent,
  conflict: SchemaConflict,
  selectedFix: ConflictFix,
): Promise<ResolveConflictResponse> {
  try {
    const intentText = serializeForLLM(intent);
    capText(intentText, LIMITS.document, "Intent");
    capJson(schema, LIMITS.document, "Schema");
    capJson(conflict, LIMITS.prompt, "Conflict");
    capJson(selectedFix, LIMITS.shortText, "Fix");
    await checkRateLimit();

    const system = `You are a form schema repair assistant. Apply a specific fix to resolve a schema conflict.`;

    const prompt = `Current intent: ${intentText}

Current schema ([id] key: "Label" (type…)):
${serializeSchemaForLLM(schema, { ids: true, constraints: true, groups: true })}

Conflict: ${conflict.description}
Affected fields: ${conflict.fieldIds.join(", ")}
Conflict type: ${conflict.kind}

Selected fix: "${selectedFix.label}" — ${selectedFix.description}

Apply this fix and return ONLY the schema changes it needs, plus the updated intent.
- Only change what's necessary to fix the conflict
- Keep all other fields and settings intact — fields and groups you don't mention stay unchanged
- Refer to existing fields and groups by their [id] exactly as listed
- Update the intent description if the fix changes the form's meaning
- "rationale": brief explanation of what was changed and why`;

    const result = await withTracing(
      { tags: ["conflicts", "resolve"] },
      () =>
        generateText({
          model,
          system,
          prompt,
          temperature: 0.2,
          output: Output.object({ schema: resolveConflictSchema }),
          experimental_telemetry: telemetry("resolve-conflicts"),
        }),
    );

    if (!result.output) {
      return { success: false, error: "Failed to parse conflict resolution" };
    }

    const { updatedIntent: intentUpdate, changes, rationale } = result.output;
    const { schema: updatedSchema, skipped } = applyConflictChanges(
      schema,
      changes,
    );
    if (skipped.length > 0) {
      console.warn("[resolveSchemaConflict] Skipped changes:", skipped);
    }

    // The model echoes all intent sections; map them back section by
    // section instead of storing the whole text in `purpose`.
    const updatedIntent = intentUpdate.trim()
      ? mergeIntentText(intentUpdate, intent)
      : intent;

    return {
      success: true,
      result: {
        updatedSchema,
        updatedIntent,
        rationale: rationale || "Conflict resolved",
        ...(skipped.length > 0 ? { skipped } : {}),
      },
    };
  } catch (error) {
    console.error("Conflict resolution error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
