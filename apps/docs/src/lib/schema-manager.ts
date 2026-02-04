import { z } from "zod";

const SCHEMA_STORAGE_KEY = "malleable-form-schema-list";
const DATA_STORAGE_KEY = "malleable-form-data";
const SUBMISSIONS_STORAGE_KEY = "malleable-form-submissions";

// TODO: Refactor this by using the zod native type definitions
export interface SchemaField {
  key: string;
  type: "string" | "number" | "boolean" | "date" | "email" | "select";
  label: string;
  description?: string;
  required: boolean;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    options?: string[];
  };
}

// TODO: Refactor this by using the zod native type definitions

export interface SchemaMetadata {
  name: string;
  description: string;
  fields: Record<string, Omit<SchemaField, "key">>;
}

// TODO: Refactor this by using the zod native type definitions

export interface SerializedSchema {
  fields: SchemaField[];
  metadata: SchemaMetadata;
  version: number;
  updatedAt: string;
}

export interface SerializedSchemaEntry {
  slug: string;
  title: string;
  schema: SerializedSchema;
}

/**
 * Saves or updates a serialized schema in localStorage
 */
export function saveSchema(schema: SerializedSchemaEntry): void {
  if (typeof window === "undefined") return;

  const existing = loadSchemas() ?? [];
  const index = existing.findIndex((s) => s.slug === schema.slug);

  if (index >= 0) {
    // Update existing schema
    existing[index] = schema;
  } else {
    // Add new schema
    existing.push(schema);
  }

  localStorage.setItem(SCHEMA_STORAGE_KEY, JSON.stringify(existing));
}
/**
 * Loads the serialized schema from localStorage
 */
export function loadSchemas(): SerializedSchemaEntry[] | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(SCHEMA_STORAGE_KEY);
  if (!stored) return null;
  return JSON.parse(stored) as SerializedSchemaEntry[];
}

/**
 * Loads the serialized schema from localStorage
 */
export function loadSchema(schemaSlug?: string): SerializedSchemaEntry | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(SCHEMA_STORAGE_KEY);
  if (!stored) return null;
  const schema = (JSON.parse(stored) as SerializedSchemaEntry[]).find(
    (schema) => schema.slug === schemaSlug,
  );
  if (schema) {
    return schema;
  }
  return null;
}

/**
 * Saves form data to localStorage
 */
export function saveFormData(data: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(data));
}

/**
 * Loads form data from localStorage
 */
export function loadFormData(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(DATA_STORAGE_KEY);
  if (!stored) return null;
  return JSON.parse(stored) as Record<string, unknown>;
}

/**
 * Converts a SerializedSchema to a Zod schema
 */
export function serializeSchemaToZod(
  serialized: SerializedSchema,
): z.ZodObject {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of serialized.fields) {
    let fieldSchema: z.ZodTypeAny;

    switch (field.type) {
      case "string":
      case "email":
        fieldSchema = z.string();
        if (field.validation?.min) {
          fieldSchema = (fieldSchema as z.ZodString).min(
            field.validation.min,
            `${field.label} must be at least ${field.validation.min} characters`,
          );
        }
        if (field.type === "email") {
          fieldSchema = (fieldSchema as z.ZodString).email(
            "Invalid email address",
          );
        }
        if (field.validation?.pattern) {
          fieldSchema = (fieldSchema as z.ZodString).regex(
            new RegExp(field.validation.pattern),
          );
        }
        break;

      case "number":
        fieldSchema = z.coerce.number();
        if (field.validation?.min !== undefined) {
          fieldSchema = (fieldSchema as z.ZodNumber).min(
            field.validation.min,
            `${field.label} must be at least ${field.validation.min}`,
          );
        }
        if (field.validation?.max !== undefined) {
          fieldSchema = (fieldSchema as z.ZodNumber).max(
            field.validation.max,
            `${field.label} must be at most ${field.validation.max}`,
          );
        }
        break;

      case "boolean":
        fieldSchema = z.boolean();
        break;

      case "date":
        fieldSchema = z.string().min(1, `${field.label} is required`);
        break;

      case "select":
        if (field.validation?.options && field.validation.options.length > 0) {
          fieldSchema = z.enum(
            field.validation.options as [string, ...string[]],
          );
        } else {
          fieldSchema = z.string();
        }
        break;

      default:
        fieldSchema = z.string();
    }

    if (!field.required) {
      fieldSchema = fieldSchema.optional();
    }

    shape[field.key] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Compares two schemas and returns the differences
 */
export interface SchemaDiff {
  added: SchemaField[];
  removed: SchemaField[];
  modified: Array<{
    field: string;
    oldField: SchemaField;
    newField: SchemaField;
  }>;
}

export function diffSchemas(
  oldSchema: SerializedSchema,
  newSchema: SerializedSchema,
): SchemaDiff {
  const oldFields = new Map(oldSchema.fields.map((f) => [f.key, f]));
  const newFields = new Map(newSchema.fields.map((f) => [f.key, f]));

  const added: SchemaField[] = [];
  const removed: SchemaField[] = [];
  const modified: Array<{
    field: string;
    oldField: SchemaField;
    newField: SchemaField;
  }> = [];

  // Find added and modified fields
  for (const [key, newField] of newFields) {
    const oldField = oldFields.get(key);
    if (!oldField) {
      added.push(newField);
    } else if (JSON.stringify(oldField) !== JSON.stringify(newField)) {
      modified.push({ field: key, oldField, newField });
    }
  }

  // Find removed fields
  for (const [key, oldField] of oldFields) {
    if (!newFields.has(key)) {
      removed.push(oldField);
    }
  }

  return { added, removed, modified };
}

/**
 * Validates existing form data against a new schema
 */
export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateDataAgainstSchema(
  data: Record<string, unknown>,
  schema: SerializedSchema,
): ValidationResult {
  const zodSchema = serializeSchemaToZod(schema);
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

/**
 * Converts a string to a slug format
 */
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Converts initial schema and metadata to SerializedSchema format
 */
export function initializeSerializedSchema(
  metadata: SchemaMetadata,
): SerializedSchemaEntry {
  const fields: SchemaField[] = [];

  for (const [key, fieldMeta] of Object.entries(metadata.fields)) {
    fields.push({
      key,
      ...fieldMeta,
    });
  }

  return {
    title: metadata.name,
    slug: toSlug(metadata.name),
    schema: {
      fields,
      metadata,
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Submission entry with timestamp and ID
 */
export interface SubmissionEntry {
  id: string;
  data: Record<string, unknown>;
  submittedAt: string;
  schemaVersion: number;
  schemaSlug: string;
}

/**
 * Saves a submission to the submissions array in localStorage
 */
export function saveSubmission(
  data: Record<string, unknown>,
  schemaVersion: number,
  schemaSlug: string,
): SubmissionEntry {
  if (typeof window === "undefined") {
    return {
      id: "",
      data,
      submittedAt: new Date().toISOString(),
      schemaVersion,
      schemaSlug,
    };
  }

  const submission: SubmissionEntry = {
    id: crypto.randomUUID(),
    data,
    submittedAt: new Date().toISOString(),
    schemaVersion,
    schemaSlug,
  };

  const existing = loadSubmissions();
  const updated = [...existing, submission];
  localStorage.setItem(SUBMISSIONS_STORAGE_KEY, JSON.stringify(updated));

  return submission;
}

/**
 * Loads all submissions from localStorage
 */
export function loadSubmissions(schemaSlug?: string): SubmissionEntry[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(SUBMISSIONS_STORAGE_KEY);
  if (!stored) return [];
  const entries = JSON.parse(stored) as SubmissionEntry[];
  if (schemaSlug) {
    return entries.filter((entry) => entry.schemaSlug === schemaSlug);
  }
  return entries;
}

/**
 * Deletes a submission by ID
 */
export function deleteSubmission(id: string): void {
  if (typeof window === "undefined") return;
  const existing = loadSubmissions();
  const filtered = existing.filter((s) => s.id !== id);
  localStorage.setItem(SUBMISSIONS_STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Clears all submissions
 */
export function clearAllSubmissions(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SUBMISSIONS_STORAGE_KEY);
}

type SubmissionValidationResult = {
  validation: z.ZodSafeParseResult<Record<string, unknown>>;
  submission: SubmissionEntry;
};
export function validateNewSchemaWithPreviousSubmissions(
  newSchema: SerializedSchemaEntry,
) {
  const previousSubmissions = loadSubmissions(newSchema.slug);
  const schema = serializeSchemaToZod(newSchema.schema);
  const results: SubmissionValidationResult[] = [];

  for (
    let submissionIndex = 0;
    submissionIndex < previousSubmissions.length;
    submissionIndex++
  ) {
    const submission = previousSubmissions[submissionIndex];
    const validation = schema.safeParse(submission.data);
    results.push({ validation, submission: submission });
  }

  return results;
}
