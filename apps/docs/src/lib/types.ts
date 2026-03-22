import { z } from "zod";
import { Tables, TablesInsert } from "./supabase/database.types";

// ---------------------------------------------------------------------------
// Field Types (discriminated union by `kind`)
// ---------------------------------------------------------------------------

export const textFieldTypeZ = z.object({
  kind: z.literal("text"),
  maxLength: z.number().optional(),
});

export const numberFieldTypeZ = z.object({
  kind: z.literal("number"),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().optional(),
});

export const selectOptionZ = z.object({
  label: z.string(),
  value: z.string(),
});

export type SelectOption = z.infer<typeof selectOptionZ>;

export const selectFieldTypeZ = z.object({
  kind: z.literal("select"),
  options: z.array(selectOptionZ),
  multiple: z.boolean(),
});

export const dateFieldTypeZ = z.object({
  kind: z.literal("date"),
  range: z.object({ min: z.string(), max: z.string() }).optional(),
});

export const booleanFieldTypeZ = z.object({
  kind: z.literal("boolean"),
});

export const fileFieldTypeZ = z.object({
  kind: z.literal("file"),
  accept: z.array(z.string()),
  maxSize: z.number().optional(),
});

export const scaleFieldTypeZ = z.object({
  kind: z.literal("scale"),
  min: z.number(),
  max: z.number(),
  labels: z.object({ low: z.string(), high: z.string() }).optional(),
});

// Group is handled separately since it's recursive (see fieldZ below)

export const fieldTypeZ: z.ZodType<FieldType> = z.discriminatedUnion("kind", [
  textFieldTypeZ,
  numberFieldTypeZ,
  selectFieldTypeZ,
  dateFieldTypeZ,
  booleanFieldTypeZ,
  fileFieldTypeZ,
  scaleFieldTypeZ,
  // Group type added via lazy below
  z.object({
    kind: z.literal("group"),
    fields: z.lazy(() => z.array(fieldZ)),
  }),
]);

export type FieldType =
  | { kind: "text"; maxLength?: number }
  | { kind: "number"; min?: number; max?: number; unit?: string }
  | { kind: "select"; options: SelectOption[]; multiple: boolean }
  | { kind: "date"; range?: { min: string; max: string } }
  | { kind: "boolean" }
  | { kind: "file"; accept: string[]; maxSize?: number }
  | {
      kind: "scale";
      min: number;
      max: number;
      labels?: { low: string; high: string };
    }
  | { kind: "group"; fields: Field[] };

// ---------------------------------------------------------------------------
// Constraint
// ---------------------------------------------------------------------------

export const constraintZ = z.object({
  type: z.enum(["regex", "dependency", "computed", "custom"]),
  rule: z.string(),
  message: z.string(),
});

export type Constraint = z.infer<typeof constraintZ>;

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export const fieldZ: z.ZodType<Field> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    label: z.string(),
    type: fieldTypeZ,
    required: z.boolean(),
    constraints: z.array(constraintZ),
    description: z.string().optional(),
    origin: z.enum(["creator", "system"]),
    tags: z.array(z.string()),
    derivedFrom: z.string().optional(),
  }),
);

export interface Field {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  constraints: Constraint[];
  description?: string;
  origin: "creator" | "system";
  tags: string[];
  derivedFrom?: string;
}

// ---------------------------------------------------------------------------
// Field Group
// ---------------------------------------------------------------------------

export const fieldGroupZ = z.object({
  id: z.string(),
  label: z.string(),
  fieldIds: z.array(z.string()),
  conditional: z
    .object({
      fieldId: z.string(),
      value: z.unknown(),
    })
    .optional(),
});

export interface FieldGroup {
  id: string;
  label: string;
  fieldIds: string[];
  conditional?: { fieldId: string; value: unknown };
}

// ---------------------------------------------------------------------------
// Portfolio Schema (stored in portfolios.schema JSONB)
// ---------------------------------------------------------------------------

export const portfolioSchemaZ = z.object({
  fields: z.array(fieldZ),
  groups: z.array(fieldGroupZ),
  version: z.number(),
});

export interface PortfolioSchema {
  fields: Field[];
  groups: FieldGroup[];
  version: number;
}

// ---------------------------------------------------------------------------
// Portfolio (maps to `portfolios` table row)
// ---------------------------------------------------------------------------

export const portfolioStatusZ = z.enum(["draft", "published"]);
export type PortfolioStatus = z.infer<typeof portfolioStatusZ>;

export interface PortfolioInsert extends Omit<
  TablesInsert<"portfolios">,
  "schema"
> {
  schema: PortfolioSchema;
}

export interface Portfolio extends Omit<
  Tables<"portfolios">,
  "schema" | "projection"
> {
  schema: PortfolioSchema;
  projection: DerivationSpec | null;
}

// ---------------------------------------------------------------------------
// Provenance Log Entry (maps to `provenance_log` table row)
// ---------------------------------------------------------------------------

export const provenanceLayerZ = z.enum([
  "intent",
  "dimensions",
  "configuration",
]);
export type ProvenanceLayer = z.infer<typeof provenanceLayerZ>;

export interface ProvenanceEntry extends Omit<
  Tables<"provenance_log">,
  "diff" | "prev_schema"
> {
  diff: SchemaDiff;
  prev_schema: PortfolioSchema | null;
}

// ---------------------------------------------------------------------------
// Response (maps to `responses` table row)
// ---------------------------------------------------------------------------

export interface FormResponse {
  id: string;
  portfolioId: string;
  data: Record<string, unknown>;
  submittedAt: string;
}

// ---------------------------------------------------------------------------
// Schema Diff
// ---------------------------------------------------------------------------

export interface FieldPatch {
  fieldId: string;
  before: Partial<Field>;
  after: Partial<Field>;
}

export interface SchemaDiff {
  added: Field[];
  removed: string[]; // field IDs
  modified: FieldPatch[];
}

// ---------------------------------------------------------------------------
// Schema Proposal (from LLM during elicitation)
// ---------------------------------------------------------------------------

export const schemaProposalStatusZ = z.enum([
  "pending",
  "accepted",
  "rejected",
  "modified",
]);

const fieldPatchZ = z.object({
  fieldId: z.string(),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
});

export const schemaDiffZ = z.object({
  added: z.array(fieldZ),
  removed: z.array(z.string()),
  modified: z.array(fieldPatchZ),
});

export const schemaProposalZ = z.object({
  id: z.string(),
  description: z.string(),
  diff: schemaDiffZ,
  rationale: z.string(),
  status: schemaProposalStatusZ,
});

export interface SchemaProposal {
  id: string;
  description: string;
  diff: SchemaDiff;
  rationale: string;
  status: "pending" | "accepted" | "rejected" | "modified";
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export const derivationTypeZ = z.enum(["sub", "super", "mixed"]);

export const derivationSpecZ = z.object({
  type: derivationTypeZ,
  scenarioIntent: z.string(),
  includedFieldIds: z.array(z.string()),
  additionalFields: z.array(fieldZ),
  fieldMappings: z.record(z.string(), z.string()),
});

export interface DerivationSpec {
  type: "sub" | "super" | "mixed";
  scenarioIntent: string;
  includedFieldIds: string[];
  additionalFields: Field[];
  fieldMappings: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Elicitation State (workspace UI state, not persisted)
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  proposals?: SchemaProposal[];
  timestamp: string;
}

export interface ElicitationState {
  portfolio: Portfolio;
  conversationHistory: Message[];
  currentLayer: ProvenanceLayer;
  pendingProposals: SchemaProposal[];
}

// ---------------------------------------------------------------------------
// Helper: empty schema
// ---------------------------------------------------------------------------

export function emptyPortfolioSchema(): PortfolioSchema {
  return { fields: [], groups: [], version: 1 };
}
