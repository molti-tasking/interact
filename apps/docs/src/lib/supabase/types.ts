/**
 * Bridge between auto-generated Supabase types and our domain model.
 *
 * Row types come directly from `database.types.ts` via `Tables<>`.
 * Domain-typed insert helpers wrap JSONB columns with proper types;
 * hooks handle serialization via JSON.parse(JSON.stringify(...)).
 * Converters map snake_case rows → camelCase domain objects.
 */

export type { Database } from "./database.types";
import type {
  DerivationSpec,
  DesignProbe,
  FormResponse,
  Portfolio,
  PortfolioSchema,
  ProvenanceEntry,
  SchemaDiff,
  StructuredIntent,
} from "../types";
import type { Tables } from "./database.types";

// ---------------------------------------------------------------------------
// Row types — re-exported from auto-generated types
// ---------------------------------------------------------------------------

export type PortfolioRow = Tables<"portfolios">;
export type ProvenanceRow = Tables<"provenance_log">;
export type ResponseRow = Tables<"responses">;
export type DesignProbeRow = Tables<"design_probes">;

// ---------------------------------------------------------------------------
// Domain-typed insert/update helpers
// Accept domain types for JSONB columns; hooks serialize to Json.
// ---------------------------------------------------------------------------

export interface PortfolioUpdate {
  title?: string;
  intent?: StructuredIntent;
  schema?: PortfolioSchema;
  base_id?: string | null;
  projection?: DerivationSpec | null;
  status?: string;
  creator_role?: string | null;
}

export interface ResponseInsert {
  portfolio_id: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Row → Domain model converters (snake_case → camelCase + JSONB casts)
// ---------------------------------------------------------------------------

export function rowToPortfolio(row: PortfolioRow): Portfolio {
  return {
    ...row,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? new Date().toISOString(),
    intent: row.intent as unknown as StructuredIntent,
    schema: row.schema as unknown as PortfolioSchema,
    projection: row.projection as unknown as DerivationSpec | null,
    status: (row.status ?? "draft") as "draft" | "published",
  };
}

export function rowToProvenance(row: ProvenanceRow): ProvenanceEntry {
  return {
    ...row,
    layer: row.layer as "intent" | "dimensions" | "configuration",
    diff: row.diff as unknown as SchemaDiff,
    prev_intent: row.prev_intent as unknown as StructuredIntent | null,
    prev_schema: row.prev_schema as unknown as PortfolioSchema | null,
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

export function rowToResponse(row: ResponseRow): FormResponse {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    data: row.data as unknown as Record<string, unknown>,
    submittedAt: row.submitted_at ?? new Date().toISOString(),
  };
}

export function rowToDesignProbe(row: DesignProbeRow): DesignProbe {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    text: row.text,
    explanation: row.explanation ?? undefined,
    layer: row.layer as "intent" | "dimensions" | "both",
    source: row.source,
    options: row.options as unknown as { value: string; label: string }[],
    selectedOption: row.selected_option,
    status: row.status as DesignProbe["status"],
    dimensionId: row.dimension_id,
    dimensionName: row.dimension_name,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}
