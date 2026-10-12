import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Server-side access check for everything that isn't the public form:
 * server actions (LLM calls), API routes.
 *
 * Server actions are reachable by POSTing their id to *any* path (including
 * the public `/forms/*` pages), so the route guard in `src/proxy.ts` alone
 * does not protect them — every entry point must call this.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Please sign in to continue.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Throws `UnauthorizedError` unless the request comes from an app admin. */
export async function requireOwner(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  // `app_admins` allow-list (migration 010) — being signed in isn't enough.
  const { data: isAdmin, error } = await supabase.rpc("is_app_admin");
  if (error || isAdmin !== true) {
    throw new UnauthorizedError("This account has no access.");
  }
}
