import { z } from "zod";
import {
  formatBytes,
  isFile,
  isStoredFile,
  matchesAccept,
  maxSizeBytes,
  type StoredFile,
} from "../form-renderer/values";
import type {
  Field,
  FieldPatch,
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

/**
 * Remove a field by ID — top-level or nested inside a group field. Returns a
 * new schema. Group memberships drop the field, conditionals that depended
 * on it are cleared, and groups this removal leaves empty are dropped.
 */
export function removeField(
  schema: PortfolioSchema,
  fieldId: string,
): PortfolioSchema {
  const strip = (fields: Field[]): Field[] =>
    fields
      .filter((f) => f.id !== fieldId)
      .map((f) =>
        f.type.kind === "group" &&
        f.type.fields.some((n) => n.id === fieldId || n.type.kind === "group")
          ? { ...f, type: { ...f.type, fields: strip(f.type.fields) } }
          : f,
      );

  return {
    ...schema,
    fields: strip(schema.fields),
    groups: schema.groups
      .map((g) => {
        const next = {
          ...g,
          fieldIds: g.fieldIds.filter((id) => id !== fieldId),
        };
        if (g.conditional?.fieldId === fieldId) delete next.conditional;
        return next;
      })
      .filter(
        (g, i) =>
          g.fieldIds.length > 0 || !schema.groups[i].fieldIds.includes(fieldId),
      ),
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
//
// Mirrors what the field components produce: text inputs yield "" when
// cleared, number/scale/range inputs yield strings, selects yield "" or an
// option value, file inputs yield a `File` (or a stored-file reference once
// uploaded), groups yield a nested object (`group.child` form paths).
// Blank values are normalised to `undefined` *before* validation so optional
// fields can be cleared and required ones report "X is required".

/** Convert a PortfolioSchema to a Zod validation schema for form data. */
export function schemaToZod(
  schema: PortfolioSchema,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  return z.object(fieldsShape(schema.fields));
}

function fieldsShape(fields: Field[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = fieldToZod(field);
  }
  return shape;
}

function isBlank(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "")
  );
}

/**
 * Wrap the schema for a *present* value: blanks become `undefined`; then
 * optional fields accept `undefined` and required ones fail with
 * `requiredMessage` before `base` runs.
 */
function presence(
  base: z.ZodTypeAny,
  required: boolean,
  requiredMessage: string,
  normalize: (v: unknown) => unknown = (v) => v,
): z.ZodTypeAny {
  const pre = (v: unknown) => (isBlank(v) ? undefined : normalize(v));
  if (!required) return z.preprocess(pre, base.optional());
  const gate = z
    .any()
    .refine((v) => v !== undefined, { message: requiredMessage });
  return z.preprocess(pre, gate.pipe(base));
}

/** Compile a constraint regex; invalid (LLM-authored) patterns are skipped. */
function safeRegExp(rule: string): RegExp | null {
  try {
    return new RegExp(rule);
  } catch {
    return null;
  }
}

function toNumber(v: unknown): unknown {
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isNaN(n) ? v : n;
  }
  return v;
}

function fieldToZod(field: Field): z.ZodTypeAny {
  const { type, label, required } = field;
  const requiredMessage = `${label} is required`;

  switch (type.kind) {
    case "text": {
      let s = z.string({ error: `${label} must be text` });
      if (type.maxLength) {
        s = s.max(
          type.maxLength,
          `${label} must be at most ${type.maxLength} characters`,
        );
      }
      for (const constraint of field.constraints) {
        if (constraint.type !== "regex") continue;
        const re = safeRegExp(constraint.rule);
        if (re) s = s.regex(re, constraint.message);
      }
      return presence(s, required, requiredMessage, (v) =>
        typeof v === "string"
          ? v.trim()
          : typeof v === "number"
            ? String(v)
            : v,
      );
    }

    case "number":
    case "scale": {
      let s = z.number({ error: `${label} must be a number` });
      if (type.min !== undefined) {
        s = s.min(type.min, `${label} must be at least ${type.min}`);
      }
      if (type.max !== undefined) {
        s = s.max(type.max, `${label} must be at most ${type.max}`);
      }
      return presence(s, required, requiredMessage, toNumber);
    }

    case "select": {
      const values = type.options.map((o) => o.value);
      if (type.multiple) {
        const item =
          values.length > 0
            ? z.enum(values as [string, ...string[]], {
                error: `Choose from the listed options for ${label}`,
              })
            : z.string();
        const atLeastOne = `Select at least one option for ${label}`;
        const arr = required ? z.array(item).min(1, atLeastOne) : z.array(item);
        return presence(arr, required, atLeastOne, (v) =>
          Array.isArray(v)
            ? v.filter((x) => !isBlank(x))
            : typeof v === "string"
              ? [v]
              : v,
        );
      }
      const single =
        values.length > 0
          ? z.enum(values as [string, ...string[]], {
              error: `Choose one of the options for ${label}`,
            })
          : z.string();
      return presence(single, required, requiredMessage);
    }

    case "date": {
      let s = z
        .string({ error: `${label} must be a date` })
        .refine((v) => !Number.isNaN(Date.parse(v)), {
          message: `${label} must be a valid date`,
        });
      const range = type.range;
      if (range?.min) {
        s = s.refine((v) => Number.isNaN(Date.parse(v)) || v >= range.min, {
          message: `${label} must be on or after ${range.min}`,
        });
      }
      if (range?.max) {
        s = s.refine((v) => Number.isNaN(Date.parse(v)) || v <= range.max, {
          message: `${label} must be on or before ${range.max}`,
        });
      }
      return presence(s, required, requiredMessage, (v) =>
        v instanceof Date && !Number.isNaN(v.getTime())
          ? v.toISOString().slice(0, 10)
          : v,
      );
    }

    case "boolean": {
      // A required checkbox means "must be answered": unticked is a valid
      // "no", so an untouched box counts as false rather than failing.
      const pre = (v: unknown) => {
        if (v === "true") return true;
        if (v === "false") return false;
        if (isBlank(v)) return required ? false : undefined;
        return v;
      };
      const s = z.boolean({ error: `${label} must be yes or no` });
      return z.preprocess(pre, required ? s : s.optional());
    }

    case "file": {
      const limit = maxSizeBytes(type.maxSize);
      let s: z.ZodTypeAny = z
        .custom<File | StoredFile>((v) => isFile(v) || isStoredFile(v), {
          message: `${label} must be a file`,
        })
        .refine((f) => matchesAccept(f, type.accept), {
          message: `${label} must be one of: ${type.accept.join(", ")}`,
        });
      if (limit !== undefined) {
        s = s.refine((f) => (f as { size: number }).size <= limit, {
          message: `${label} must be at most ${formatBytes(limit)}`,
        });
      }
      return presence(s, required, requiredMessage, (v) => {
        if (typeof FileList !== "undefined" && v instanceof FileList) {
          return v.length > 0 ? v[0] : undefined;
        }
        if (Array.isArray(v)) return v.length > 0 ? v[0] : undefined;
        return v;
      });
    }

    case "reference":
      // A resolved link to a row in the target portfolio; dictated values
      // that couldn't be resolved may still be plain strings.
      return presence(
        z.union(
          [
            z.object({ responseId: z.string(), label: z.string() }),
            z.string().min(1),
          ],
          { error: `${label} must link to an entry` },
        ),
        required,
        requiredMessage,
        (v) => (typeof v === "string" ? v.trim() : v),
      );

    case "group": {
      const inner = z.object(fieldsShape(type.fields), {
        error: `${label} is invalid`,
      });
      if (required) {
        // Validate the nested fields individually so their own messages
        // show next to them, even when nothing was entered.
        return z.preprocess((v) => (v == null ? {} : v), inner);
      }
      return z.preprocess(
        (v) => (isEmptyGroupValue(v) ? undefined : v),
        inner.optional(),
      );
    }

    default:
      return presence(z.string(), required, requiredMessage);
  }
}

function isEmptyGroupValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v).every(
    (x) =>
      isBlank(x) ||
      (Array.isArray(x) && x.length === 0) ||
      isEmptyGroupValue(x),
  );
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
    // First issue per path, like the form resolver shows
    errors[path] ??= issue.message;
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
