/**
 * The evaluation's portfolios live in the current profile's local stack
 * (eval/stacks.sh current up). Writes to a form go through the app's own
 * commit function; this file only creates forms and reads them back.
 */
import { createClient } from "@/lib/supabase/client";
import { rowToPortfolio } from "@/lib/supabase/types";
import type { Portfolio, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { sql } from "../../apps/docs/tests/db";

/** Sign the app's browser client in as a fresh admin of the local stack. */
export async function signInEvalAdmin(): Promise<string> {
  const supabase = createClient();
  const email = `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@eval.local`;
  const password = "eval-admin-password";
  const signUp = await supabase.auth.signUp({ email, password });
  if (signUp.error) throw signUp.error;
  const id = signUp.data.user!.id;
  // Checks first that the database is this project's (tests/db.ts)
  await sql("INSERT INTO app_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
  if (!signUp.data.session) {
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
  }
  return id;
}

export async function insertPortfolio(row: {
  title: string;
  intent: StructuredIntent;
  schema: PortfolioSchema;
  base_id?: string | null;
  projection?: unknown;
}): Promise<Portfolio> {
  const { data, error } = await createClient()
    .from("portfolios")
    .insert({
      title: row.title,
      intent: row.intent as never,
      schema: row.schema as never,
      base_id: row.base_id ?? null,
      projection: (row.projection ?? null) as never,
      status: "draft",
    })
    .select()
    .single();
  if (error) throw error;
  return rowToPortfolio(data);
}

export async function readPortfolio(id: string): Promise<Portfolio> {
  const { data, error } = await createClient().from("portfolios").select("*").eq("id", id).single();
  if (error) throw error;
  return rowToPortfolio(data);
}
