import { createClient } from "@/lib/supabase/client";
import { rowToPortfolio } from "@/lib/supabase/types";
import { Json } from "../supabase/database.types";
import type {
  Portfolio,
  PortfolioSchema,
  ProvenanceLayer,
  SchemaDiff,
  StructuredIntent,
} from "../types";
import { diffSchemas } from "./schema-ops";

// ---------------------------------------------------------------------------
// Shared insert — single place that writes to provenance_log
// ---------------------------------------------------------------------------

async function insertProvenanceEntry(params: {
  portfolioId: string;
  layer: ProvenanceLayer;
  action: string;
  actor: string;
  diff: SchemaDiff;
  rationale?: string | null;
  prevIntent?: StructuredIntent | null;
  prevSchema?: unknown | null;
}): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from("provenance_log").insert({
    portfolio_id: params.portfolioId,
    action: params.action,
    layer: params.layer,
    actor: params.actor,
    diff: params.diff as unknown as Json,
    rationale: params.rationale ?? null,
    prev_intent: params.prevIntent ? (params.prevIntent as unknown as Json) : null,
    prev_schema: params.prevSchema ? (params.prevSchema as Json) : null,
  });

  if (error) {
    console.error("[provenance] Insert failed:", error.message);
  }
}

// ---------------------------------------------------------------------------
// mutatePortfolio — read-modify-write with automatic provenance
// ---------------------------------------------------------------------------

export async function mutatePortfolio(
  portfolioId: string,
  layer: ProvenanceLayer,
  action: string,
  actor: string,
  mutationFn: (current: Portfolio) => Portfolio,
  options?: {
    rationale?: string;
  },
): Promise<Portfolio> {
  const supabase = createClient();

  // 1. Read current portfolio
  const { data: currentRow, error: readError } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .single();

  if (readError)
    throw new Error(`Failed to read portfolio: ${readError.message}`);
  const current = rowToPortfolio(currentRow);

  // 2. Apply mutation
  const updated = mutationFn(current);

  // 3. Compute diff
  const updatedSchema = updated.schema as unknown as PortfolioSchema;
  const currentSchema = current.schema as unknown as PortfolioSchema;
  const diff: SchemaDiff = diffSchemas(currentSchema, updatedSchema);

  // 4. Write updated portfolio
  const { error: updateError } = await supabase
    .from("portfolios")
    .update({
      title: updated.title,
      intent: JSON.parse(JSON.stringify(updated.intent)),
      schema: JSON.parse(JSON.stringify(updated.schema)),
      status: updated.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", portfolioId);

  if (updateError)
    throw new Error(`Failed to update portfolio: ${updateError.message}`);

  // 5. Log provenance (skip if no changes and not an intent action)
  const hasChanges =
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.modified.length > 0;

  if (hasChanges || action.startsWith("intent_")) {
    await insertProvenanceEntry({
      portfolioId,
      layer,
      action,
      actor,
      diff,
      rationale: options?.rationale,
      prevIntent: current.intent,
      prevSchema: current.schema,
    });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// logProvenance — standalone logging (mutation already done externally)
// ---------------------------------------------------------------------------

export async function logProvenance(
  portfolioId: string,
  layer: ProvenanceLayer,
  action: string,
  actor: string,
  diff: SchemaDiff,
  rationale?: string,
  prev?: { intent: StructuredIntent; schema: unknown },
): Promise<void> {
  await insertProvenanceEntry({
    portfolioId,
    layer,
    action,
    actor,
    diff,
    rationale,
    prevIntent: prev?.intent,
    prevSchema: prev?.schema,
  });
}
