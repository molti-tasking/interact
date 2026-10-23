import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cache } from "react";

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

/**
 * Who is calling: an app admin, or a participant of a running workshop
 * session (anonymous sign-in, migration 011). Everyone else has no access.
 */
interface Principal {
  userId: string;
  kind: "admin" | "participant";
}

type Access =
  | { signedIn: false }
  | { signedIn: true; principal: Principal | null };

/** Resolved once per request — the guard and telemetry both need it. */
const resolveAccess = cache(async (): Promise<Access> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { signedIn: false };

  // `app_admins` allow-list (migration 010) — being signed in isn't enough.
  const { data: isAdmin } = await supabase.rpc("is_app_admin");
  if (isAdmin === true) {
    return { signedIn: true, principal: { userId: user.id, kind: "admin" } };
  }
  const { data: isParticipant } = await supabase.rpc("is_study_participant");
  if (isParticipant === true) {
    return {
      signedIn: true,
      principal: { userId: user.id, kind: "participant" },
    };
  }
  return { signedIn: true, principal: null };
});

/** The caller if they have access, else null. Never throws. */
export async function getPrincipal(): Promise<Principal | null> {
  try {
    const access = await resolveAccess();
    return access.signedIn ? access.principal : null;
  } catch {
    return null; // outside a request (scripts, tests)
  }
}

/** Throws `UnauthorizedError` unless the request comes from an app admin. */
export async function requireOwner(): Promise<void> {
  const access = await resolveAccess();
  if (!access.signedIn) throw new UnauthorizedError();
  if (access.principal?.kind !== "admin") {
    throw new UnauthorizedError("This account has no access.");
  }
}

/**
 * Throws `UnauthorizedError` unless the caller may design forms: an app
 * admin, or a participant of a workshop session that hasn't ended. Data
 * access is still limited by RLS (participants reach only their own form).
 */
export async function requireDesigner(): Promise<Principal> {
  const access = await resolveAccess();
  if (!access.signedIn) throw new UnauthorizedError();
  if (!access.principal) {
    throw new UnauthorizedError("This account has no access.");
  }
  return access.principal;
}
