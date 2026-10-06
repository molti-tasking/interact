/**
 * The change format for schema conflict fixes, and how to apply it.
 *
 * Unlike design probe patches (`schema-patch.ts`), fixes refer to existing
 * fields by id — they can rename fields, change constraints and drop
 * groups. Pure and isomorphic: the server validates a fix with it, and the
 * client replays a pre-computed fix on the latest schema to preview or
 * apply it.
 */

import { z } from "zod";
import type { Field, PortfolioSchema } from "../types";
import { newFieldId, pruneGroups, resolvePatchFieldType } from "./schema-patch";
import { normalizeFieldKey } from "./structured-intent";

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

export const conflictChangesSchema = z
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
  );

type ConflictChanges = z.infer<typeof conflictChangesSchema>;

/** What a conflict fix would change, computed before it's chosen. */
export interface ConflictFixPreview {
  /** Short changelog line, e.g. "Merges the two email fields" */
  summary: string;
  changes: ConflictChanges;
}

// ---------------------------------------------------------------------------
// Apply a fix's changes (pure)
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
export function applyConflictChanges(
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
