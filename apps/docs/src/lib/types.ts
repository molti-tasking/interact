/**
 * The app's types: the core form types from the `interact` package, plus the
 * ones tied to the database rows.
 */
import type {
  DerivationSpec,
  Move,
  PortfolioSchema,
  ProvenanceLayer,
  SchemaBacktalk,
  SchemaDiff,
  StructuredIntent,
} from "interact/forms/types";
import type { IntentSyncFlag } from "interact/forms/intent-sync";
import type { Tables, TablesInsert } from "./supabase/database.types";

export * from "interact/forms/types";

// ---------------------------------------------------------------------------
// Portfolio (maps to `portfolios` table row)
// ---------------------------------------------------------------------------

export interface PortfolioInsert extends Omit<
  TablesInsert<"portfolios">,
  "schema" | "intent"
> {
  schema: PortfolioSchema;
  intent: StructuredIntent;
}

export interface Portfolio extends Omit<
  Tables<"portfolios">,
  "schema" | "projection" | "intent" | "intent_sync"
> {
  intent: StructuredIntent;
  schema: PortfolioSchema;
  projection: DerivationSpec | null;
  /** The intent is behind the form (migration 016); null when in step */
  intent_sync: IntentSyncFlag | null;
}

// ---------------------------------------------------------------------------
// Provenance Log Entry (maps to `provenance_log` table row)
// ---------------------------------------------------------------------------

export interface ProvenanceEntry extends Omit<
  Tables<"provenance_log">,
  "diff" | "prev_schema" | "prev_intent"
> {
  diff: SchemaDiff;
  prev_intent: StructuredIntent | null;
  prev_schema: PortfolioSchema | null;
}

// ---------------------------------------------------------------------------
// Elicitation State (workspace UI state, not persisted)
// ---------------------------------------------------------------------------

export interface ElicitationState {
  portfolio: Portfolio;
  interactionTrajectory: Move[];
  currentLayer: ProvenanceLayer;
  pendingBacktalk: SchemaBacktalk[];
}

