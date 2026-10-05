"use server";

import {
  newFieldId,
  pruneGroups,
  resolvePatchFieldType,
} from "@/lib/engine/schema-patch";
import {
  hashSection,
  mergeIntentText,
  normalizeFieldKey,
  serializeForLLM,
  serializeSchemaForLLM,
} from "@/lib/engine/structured-intent";
import { capJson, capText, checkRateLimit, LIMITS } from "@/lib/llm-guard";
import { fastModel, model } from "@/lib/model";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { Field, PortfolioSchema, StructuredIntent } from "@/lib/types";
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
    description: z.string(),
    fieldIds: z.array(z.string()),
    fixes: z.array(z.object({
      value: z.string(),
      label: z.string().describe("SHORT label, 2-6 words"),
      description: z.string(),
    })),
  })),
});

const optionSchema = z.object({
  label: z.string().describe("2-5 words max"),
  value: z.string(),
});

const fieldKindSchema = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "email",
  "select",
]);

const fieldEditSchema = z.object({
  id: z.string().describe("id of the existing field, exactly as listed"),
  name: z
    .string()
    .optional()
    .describe("New camelCase key — only when renaming the field"),
  label: z.string().optional(),
  description: z.string().optional(),
  type: fieldKindSchema.optional().describe("New type — only when changing it"),
  options: z
    .array(optionSchema)
    .optional()
    .describe("Full option list for a select field — only when changing it"),
  min: z.number().optional().describe("Number/scale fields: new minimum"),
  max: z.number().optional().describe("Number/scale fields: new maximum"),
  required: z.boolean().optional(),
  constraints: z
    .array(
      z.object({
        type: z.enum(["regex", "dependency", "computed", "custom"]),
        rule: z.string(),
        message: z.string(),
      }),
    )
    .optional()
    .describe("Complete replacement constraint list — only when changing constraints"),
});

const resolveConflictSchema = z.object({
  updatedIntent: z
    .string()
    .describe("Updated intent text if changed, otherwise same as current"),
  changes: z
    .object({
      removeFieldIds: z
        .array(z.string())
        .optional()
        .describe("ids of fields to remove"),
      updateFields: z
        .array(fieldEditSchema)
        .optional()
        .describe("Existing fields to change — include only the properties that change"),
      addFields: z
        .array(
          z.object({
            key: z.string().describe("camelCase field key"),
            label: z.string(),
            description: z.string().optional(),
            type: fieldKindSchema,
            required: z.boolean(),
            options: z.array(optionSchema).optional().describe("Required for select fields"),
          }),
        )
        .optional()
        .describe("New fields to add"),
      removeGroupIds: z
        .array(z.string())
        .optional()
        .describe("ids of groups to delete"),
    })
    .describe(
      "Only the changes needed to apply the fix. Fields and groups you don't mention stay unchanged. Omit sections with no changes.",
    ),
  rationale: z
    .string()
    .describe("Brief explanation of what was changed and why"),
});

type ConflictChanges = z.infer<typeof resolveConflictSchema>["changes"];

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

// ---------------------------------------------------------------------------
// Apply the resolver's changes (pure)
// ---------------------------------------------------------------------------

type FieldEdit = NonNullable<ConflictChanges["updateFields"]>[number];

function applyFieldEdit(field: Field, edit: FieldEdit): Field {
  let type = field.type;
  if (edit.type) {
    // Same coarse kind keeps details (min/max, multiple, …); options merge by label
    type = resolvePatchFieldType(
      { type: edit.type, validation: { options: edit.options } },
      new Set(),
      field.type,
    );
  } else if (edit.options && field.type.kind === "select") {
    type = resolvePatchFieldType(
      { type: "select", validation: { options: edit.options } },
      new Set(),
      field.type,
    );
  }
  if (
    (edit.min !== undefined || edit.max !== undefined) &&
    (type.kind === "number" || type.kind === "scale")
  ) {
    type = {
      ...type,
      ...(edit.min !== undefined ? { min: edit.min } : {}),
      ...(edit.max !== undefined ? { max: edit.max } : {}),
    };
  }

  return {
    ...field,
    label: edit.label || field.label,
    description: edit.description ?? field.description,
    required: edit.required ?? field.required,
    constraints: edit.constraints ?? field.constraints,
    type,
  };
}

/**
 * Apply id-keyed changes: remove → update (incl. renames) → add, then drop
 * deleted groups and prune dangling group references. Unknown ids and
 * colliding names are skipped and reported.
 */
function applyConflictChanges(
  schema: PortfolioSchema,
  changes: ConflictChanges,
): { schema: PortfolioSchema; skipped: string[] } {
  const skipped: string[] = [];
  const existingIds = new Set(schema.fields.map((f) => f.id));

  const removeIds = new Set<string>();
  for (const id of changes.removeFieldIds ?? []) {
    if (existingIds.has(id)) removeIds.add(id);
    else skipped.push(`remove ${id}`);
  }

  const edits = new Map<string, FieldEdit>();
  for (const edit of changes.updateFields ?? []) {
    if (!existingIds.has(edit.id) || removeIds.has(edit.id)) {
      skipped.push(`update ${edit.id}`);
      continue;
    }
    edits.set(edit.id, { ...edits.get(edit.id), ...edit });
  }

  let fields = schema.fields
    .filter((f) => !removeIds.has(f.id))
    .map((f) => {
      const edit = edits.get(f.id);
      return edit ? applyFieldEdit(f, edit) : f;
    });

  // Renames: the new key must not be taken by another field
  const taken = new Set(
    fields.filter((f) => !edits.get(f.id)?.name).map((f) => f.name),
  );
  fields = fields.map((f) => {
    const rename = edits.get(f.id)?.name;
    if (!rename) return f;
    const name = normalizeFieldKey(rename, f.name);
    if (name !== f.name && taken.has(name)) {
      skipped.push(`rename ${f.id} → ${name}`);
      taken.add(f.name);
      return f;
    }
    taken.add(name);
    return { ...f, name };
  });

  for (const add of changes.addFields ?? []) {
    const name = normalizeFieldKey(add.key || add.label);
    if (taken.has(name)) {
      skipped.push(`add ${name}`);
      continue;
    }
    taken.add(name);
    fields.push({
      id: newFieldId(),
      name,
      label: add.label,
      type: resolvePatchFieldType(
        { type: add.type, validation: { options: add.options } },
        new Set(),
      ),
      required: add.required,
      constraints: [],
      description: add.description,
      origin: "system",
      tags: [],
    });
  }

  const removeGroupIds = new Set(changes.removeGroupIds ?? []);
  for (const id of removeGroupIds) {
    if (!schema.groups.some((g) => g.id === id)) skipped.push(`remove group ${id}`);
  }
  const groups = pruneGroups(
    schema.groups.filter((g) => !removeGroupIds.has(g.id)),
    new Set(fields.map((f) => f.id)),
  );

  return {
    schema: {
      ...schema, // keeps columnActions + acceptedStandards
      fields,
      groups,
      version: schema.version + 1,
    },
    skipped,
  };
}
