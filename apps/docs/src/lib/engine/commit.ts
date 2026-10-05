import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { rowToPortfolio } from "@/lib/supabase/types";
import type {
  Portfolio,
  PortfolioSchema,
  PortfolioStatus,
  ProvenanceLayer,
  StructuredIntent,
} from "../types";
import { diffSchemas, isDiffEmpty } from "./schema-ops";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvenanceSpec {
  layer: ProvenanceLayer;
  action: string;
  actor: string;
  rationale?: string | null;
  /**
   * Log even when the schema didn't change (intent-only edits, decisions that
   * produced no field changes). Defaults to true; set false to only log when
   * the schema diff is non-empty.
   */
  always?: boolean;
}

export interface PortfolioChange {
  schema?: PortfolioSchema;
  intent?: StructuredIntent;
  title?: string;
  status?: PortfolioStatus;
  provenance?: ProvenanceSpec | null;
}

/**
 * Computes the change from the *current database state*. Called once per
 * attempt — it must be pure and cheap (no LLM calls); do expensive work
 * before committing and apply its result here. Return `null` to abort.
 */
export type ChangeFn = (current: Portfolio) => PortfolioChange | null;

export interface CommitResult {
  portfolio: Portfolio;
  previous: Portfolio;
}

export class PortfolioConflictError extends Error {
  constructor(portfolioId: string) {
    super(
      `Portfolio ${portfolioId} kept changing while saving — please retry.`,
    );
    this.name = "PortfolioConflictError";
  }
}

// ---------------------------------------------------------------------------
// commitPortfolioChange
// ---------------------------------------------------------------------------

/**
 * Optimistic-concurrency write for a portfolio's schema/intent.
 *
 * 1. Read the current row (incl. `revision`).
 * 2. Compute the change from that state.
 * 3. `commit_portfolio_change` RPC: compare-and-swap on `revision`, write,
 *    and append provenance (prev_* taken from the DB) in one transaction.
 * 4. On a revision mismatch, retry from step 1 with the fresh state.
 *
 * Returns `null` when the change function aborted.
 */
export async function commitPortfolioChange(
  portfolioId: string,
  change: ChangeFn,
  opts: { maxAttempts?: number } = {},
): Promise<CommitResult | null> {
  const supabase = createClient();
  const maxAttempts = opts.maxAttempts ?? 4;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: row, error: readError } = await supabase
      .from("portfolios")
      .select("*")
      .eq("id", portfolioId)
      .single();
    if (readError) {
      throw new Error(`Failed to read portfolio: ${readError.message}`);
    }
    const current = rowToPortfolio(row);

    const next = change(current);
    if (!next) return null;

    const diff = next.schema
      ? diffSchemas(current.schema, next.schema)
      : { added: [], removed: [], modified: [] };

    const provenance =
      next.provenance &&
      (next.provenance.always !== false || !isDiffEmpty(diff))
        ? {
            action: next.provenance.action,
            layer: next.provenance.layer,
            actor: next.provenance.actor,
            rationale: next.provenance.rationale ?? null,
            diff,
          }
        : null;

    const { data, error } = await supabase.rpc("commit_portfolio_change", {
      p_portfolio_id: portfolioId,
      p_expected_revision: current.revision,
      p_schema: next.schema ? toJson(next.schema) : undefined,
      p_intent: next.intent ? toJson(next.intent) : undefined,
      p_title: next.title,
      p_status: next.status,
      p_provenance: provenance ? toJson(provenance) : undefined,
    });
    if (error) {
      throw new Error(`Failed to save portfolio: ${error.message}`);
    }

    const committed = Array.isArray(data) ? data[0] : data;
    if (committed) {
      return { portfolio: rowToPortfolio(committed), previous: current };
    }
    // Revision moved underneath us — loop and re-apply on fresh state.
  }

  throw new PortfolioConflictError(portfolioId);
}

/**
 * Undo a committed change by restoring the previous schema/intent — only if
 * nothing else changed the portfolio since (otherwise the restore would wipe
 * someone else's edit). Returns null when it can no longer be undone.
 */
export async function revertCommit(
  result: CommitResult,
  actor: string,
  label: string,
): Promise<CommitResult | null> {
  return commitPortfolioChange(result.portfolio.id, (current) => {
    if (current.revision !== result.portfolio.revision) return null;
    return {
      schema: result.previous.schema,
      intent: result.previous.intent,
      provenance: {
        layer: "configuration",
        action: "change_reverted",
        actor,
        rationale: `Undid: ${label}`,
      },
    };
  });
}

/**
 * Restore a historic snapshot (from a provenance entry's prev_schema /
 * prev_intent). Unlike `revertCommit` this intentionally applies on top of
 * whatever is current — it is an explicit "revert to this point" action.
 */
export async function restoreSnapshot(
  portfolioId: string,
  snapshot: { schema: PortfolioSchema | null; intent: StructuredIntent | null },
  actor: string,
  rationale: string,
): Promise<CommitResult | null> {
  return commitPortfolioChange(portfolioId, (current) => ({
    schema: snapshot.schema
      ? { ...snapshot.schema, version: current.schema.version + 1 }
      : undefined,
    intent: snapshot.intent ?? undefined,
    provenance: {
      layer: "configuration",
      action: "snapshot_restored",
      actor,
      rationale,
    },
  }));
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
