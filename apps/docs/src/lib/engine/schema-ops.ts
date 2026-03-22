import { z } from "zod";
import type {
  Field,
  FieldPatch,
  FieldType,
  PortfolioSchema,
  SchemaDiff,
} from "../types";

// ---------------------------------------------------------------------------
// Field CRUD
// ---------------------------------------------------------------------------

/** Add a field to a schema. Returns a new schema (immutable). */
export function addField(
  schema: PortfolioSchema,
  field: Field,
  atIndex?: number,
): PortfolioSchema {
  const fields =
    atIndex !== undefined
      ? [
          ...schema.fields.slice(0, atIndex),
          field,
          ...schema.fields.slice(atIndex),
        ]
      : [...schema.fields, field];

  return { ...schema, fields, version: schema.version + 1 };
}

/** Remove a field by ID. Returns a new schema. */
export function removeField(
  schema: PortfolioSchema,
  fieldId: string,
): PortfolioSchema {
  return {
    ...schema,
    fields: schema.fields.filter((f) => f.id !== fieldId),
    groups: schema.groups.map((g) => ({
      ...g,
      fieldIds: g.fieldIds.filter((id) => id !== fieldId),
    })),
    version: schema.version + 1,
  };
}

/** Update a field by ID with a partial patch. Returns a new schema. */
export function updateField(
  schema: PortfolioSchema,
  fieldId: string,
  patch: Partial<Omit<Field, "id">>,
): PortfolioSchema {
  return {
    ...schema,
    fields: schema.fields.map((f) =>
      f.id === fieldId ? { ...f, ...patch } : f,
    ),
    version: schema.version + 1,
  };
}

/** Reorder fields by providing the full ordered list of field IDs. */
export function reorderFields(
  schema: PortfolioSchema,
  orderedIds: string[],
): PortfolioSchema {
  const fieldMap = new Map(schema.fields.map((f) => [f.id, f]));
  const reordered: Field[] = [];

  for (const id of orderedIds) {
    const field = fieldMap.get(id);
    if (field) reordered.push(field);
  }

  // Append any fields not in orderedIds (safety net)
  for (const field of schema.fields) {
    if (!orderedIds.includes(field.id)) {
      reordered.push(field);
    }
  }

  return { ...schema, fields: reordered, version: schema.version + 1 };
}

// ---------------------------------------------------------------------------
// Schema Diffing
// ---------------------------------------------------------------------------

/** Compare two schemas and return the differences. */
export function diffSchemas(
  oldSchema: PortfolioSchema,
  newSchema: PortfolioSchema,
): SchemaDiff {
  const oldFields = new Map(oldSchema.fields.map((f) => [f.id, f]));
  const newFields = new Map(newSchema.fields.map((f) => [f.id, f]));

  const added: Field[] = [];
  const removed: string[] = [];
  const modified: FieldPatch[] = [];

  // Find added and modified
  for (const [id, newField] of newFields) {
    const oldField = oldFields.get(id);
    if (!oldField) {
      added.push(newField);
    } else if (JSON.stringify(oldField) !== JSON.stringify(newField)) {
      modified.push({
        fieldId: id,
        before: oldField,
        after: newField,
      });
    }
  }

  // Find removed
  for (const id of oldFields.keys()) {
    if (!newFields.has(id)) {
      removed.push(id);
    }
  }

  return { added, removed, modified };
}

/** Check if a diff has any changes. */
export function isDiffEmpty(diff: SchemaDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.modified.length === 0
  );
}

// ---------------------------------------------------------------------------
// Schema Merging
// ---------------------------------------------------------------------------

/** Merge fields from `source` into `target`. Fields with matching IDs in target are overwritten. */
export function mergeSchemas(
  target: PortfolioSchema,
  source: PortfolioSchema,
): PortfolioSchema {
  const targetMap = new Map(target.fields.map((f) => [f.id, f]));

  for (const field of source.fields) {
    targetMap.set(field.id, field);
  }

  // Merge groups
  const groupMap = new Map(target.groups.map((g) => [g.id, g]));
  for (const group of source.groups) {
    groupMap.set(group.id, group);
  }

  return {
    fields: Array.from(targetMap.values()),
    groups: Array.from(groupMap.values()),
    version: Math.max(target.version, source.version) + 1,
  };
}

/** Apply a SchemaDiff to a schema. */
export function applyDiff(
  schema: PortfolioSchema,
  diff: SchemaDiff,
): PortfolioSchema {
  const result = { ...schema, fields: [...schema.fields] };

  // Remove fields
  result.fields = result.fields.filter((f) => !diff.removed.includes(f.id));

  // Modify fields
  for (const patch of diff.modified) {
    result.fields = result.fields.map((f) =>
      f.id === patch.fieldId ? { ...f, ...patch.after } : f,
    );
  }

  // Add fields
  result.fields = [...result.fields, ...diff.added];

  return {
    ...result,
    version: schema.version + 1,
  };
}

// ---------------------------------------------------------------------------
// Schema → Zod conversion
// ---------------------------------------------------------------------------

/** Convert a PortfolioSchema to a Zod validation schema for form data. */
export function schemaToZod(
  schema: PortfolioSchema,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of schema.fields) {
    shape[field.name] = fieldToZod(field);
  }

  return z.object(shape);
}

function fieldToZod(field: Field): z.ZodTypeAny {
  let fieldSchema: z.ZodTypeAny = fieldTypeToZod(field.type, field.label);

  // Apply regex constraints
  for (const constraint of field.constraints) {
    if (constraint.type === "regex" && fieldSchema instanceof z.ZodString) {
      fieldSchema = fieldSchema.regex(
        new RegExp(constraint.rule),
        constraint.message,
      );
    }
  }

  if (!field.required) {
    fieldSchema = fieldSchema.optional();
  }

  return fieldSchema;
}

function fieldTypeToZod(type: FieldType, label: string): z.ZodTypeAny {
  switch (type.kind) {
    case "text":
      return type.maxLength
        ? z
            .string()
            .max(type.maxLength, `${label} must be at most ${type.maxLength} characters`)
        : z.string();

    case "number": {
      let s = z.coerce.number();
      if (type.min !== undefined)
        s = s.min(type.min, `${label} must be at least ${type.min}`);
      if (type.max !== undefined)
        s = s.max(type.max, `${label} must be at most ${type.max}`);
      return s;
    }

    case "select": {
      const values = type.options.map((o) => o.value);
      if (values.length > 0) {
        if (type.multiple) {
          return z.array(
            z.enum(values as [string, ...string[]]),
          );
        }
        return z.enum(values as [string, ...string[]]);
      }
      return z.string();
    }

    case "date":
      return z.string().min(1, `${label} is required`);

    case "boolean":
      return z.boolean();

    case "file":
      // Files are validated at the UI level, not via Zod
      return z.any();

    case "scale": {
      let s = z.coerce.number();
      s = s.min(type.min, `${label} must be at least ${type.min}`);
      s = s.max(type.max, `${label} must be at most ${type.max}`);
      return s;
    }

    case "group": {
      const groupShape: Record<string, z.ZodTypeAny> = {};
      for (const f of type.fields) {
        groupShape[f.name] = fieldToZod(f);
      }
      return z.object(groupShape);
    }

    default:
      return z.string();
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/** Validate form data against a PortfolioSchema. */
export function validateDataAgainstSchema(
  data: Record<string, unknown>,
  schema: PortfolioSchema,
): ValidationResult {
  const zodSchema = schemaToZod(schema);
  const result = zodSchema.safeParse(data);

  if (result.success) {
    return { valid: true, errors: {} };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    errors[path] = issue.message;
  }

  return { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Generate a URL-safe slug from text. */
export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/** Find a field by ID, including nested group fields. */
export function findField(
  schema: PortfolioSchema,
  fieldId: string,
): Field | undefined {
  for (const field of schema.fields) {
    if (field.id === fieldId) return field;
    if (field.type.kind === "group") {
      const nested = field.type.fields.find((f) => f.id === fieldId);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Get all field IDs from a schema (flat, including nested). */
export function getAllFieldIds(schema: PortfolioSchema): string[] {
  const ids: string[] = [];
  for (const field of schema.fields) {
    ids.push(field.id);
    if (field.type.kind === "group") {
      for (const nested of field.type.fields) {
        ids.push(nested.id);
      }
    }
  }
  return ids;
}
