"use server";

import { serializeForLLM } from "@/lib/engine/structured-intent";
import { withTracing } from "@/lib/telemetry";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { model } from "@/lib/model";
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

    const prompt = `You are a form schema quality analyzer. Detect conflicts, inconsistencies, and issues in this form schema.

Form intent: ${intent}

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
          model,
          prompt,
          temperature: 0.2,
          output: Output.object({ schema: detectConflictsSchema }),
          experimental_telemetry: { isEnabled: true, functionId: "detect-conflicts", recordInputs: true, recordOutputs: true },
        }),
    );

    if (!result.output) {
      // Structured output parse failure — just return deterministic results
      return { success: true, conflicts: deterministicConflicts };
    }

    const llmConflicts: SchemaConflict[] = (result.output.conflicts ?? [])
      .slice(0, 5)
      .map((c, i) => ({
        ...c,
        id: `conflict-llm-${Date.now()}-${i}`,
      }));

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
    const prompt = `You are a form schema repair assistant. Apply a specific fix to resolve a schema conflict.

Current intent: ${intentText}

Current schema:
${JSON.stringify(schema, null, 2)}

Conflict: ${conflict.description}
Affected fields: ${conflict.fieldIds.join(", ")}
Conflict type: ${conflict.kind}

Selected fix: "${selectedFix.label}" — ${selectedFix.description}

Apply this fix and return the COMPLETE updated schema and updated intent.
- Only change what's necessary to fix the conflict
- Keep all other fields and settings intact
- Update the intent description if the fix changes the form's meaning
- Increment the schema version

Return ONLY valid JSON:
{
  "updatedIntent": "Updated intent text if changed, otherwise same as current",
  "updatedSchema": { ...complete schema object... },
  "rationale": "Brief explanation of what was changed and why"
}

Schema format: { "fields": [...], "groups": [...], "version": number, "acceptedStandards": [...] }
Field format: { "id": "string", "name": "string", "label": "string", "type": { "kind": "text"|"number"|"select"|"date"|"boolean"|"file"|"scale", ...}, "required": boolean, "constraints": [], "description": "string", "origin": "creator"|"system", "tags": [] }`;

    const result = await withTracing(
      { tags: ["conflicts", "resolve"] },
      () =>
        generateText({
          model,
          prompt,
          temperature: 0.2,
          experimental_telemetry: { isEnabled: true, functionId: "resolve-conflicts", recordInputs: true, recordOutputs: true },
        }),
    );

    let parsed: {
      updatedIntent: string;
      updatedSchema: PortfolioSchema;
      rationale: string;
    };

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON");
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return { success: false, error: "Failed to parse conflict resolution" };
    }

    if (!parsed.updatedSchema || !parsed.updatedIntent) {
      return { success: false, error: "Invalid resolution: missing fields" };
    }

    // Map the LLM's updated intent text back to StructuredIntent
    // by updating the purpose section (conflict fixes primarily affect purpose)
    const updatedIntent: StructuredIntent = {
      ...intent,
      purpose: {
        content: parsed.updatedIntent,
        updatedAt: new Date().toISOString(),
      },
    };

    return {
      success: true,
      result: {
        updatedSchema: parsed.updatedSchema,
        updatedIntent,
        rationale: parsed.rationale ?? "Conflict resolved",
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
