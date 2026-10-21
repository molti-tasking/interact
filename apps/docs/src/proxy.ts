import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard (Next 16 "proxy", formerly middleware).
 *
 * Everything requires a signed-in session except the respondent-facing
 * pages: published forms (`/forms/*`), the login page and the workshop join
 * page (`/join`). It also refreshes the Supabase session cookie on every
 * request.
 *
 * Workshop participants are anonymous users (migration 011). They are kept
 * to the study pages; everything else sends them back to `/join`.
 *
 * This is a UX layer: data access is enforced by RLS in the database
 * (migrations 010, 011) and server actions/API routes call
 * `requireDesigner()` / `requireOwner()`.
 */

const PUBLIC_PREFIXES = ["/forms/", "/login", "/join"];

/** Where anonymous workshop participants may go (API routes check auth). */
const PARTICIPANT_PREFIXES = ["/join", "/study/", "/forms/", "/api/"];

function isUnder(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix),
  );
}

/** Redirect, keeping any session cookies refreshed on `response`. */
function redirectTo(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
  next?: string,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (next) url.searchParams.set("next", next);
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Validates the session with the auth server (and refreshes it if needed).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (user?.is_anonymous) {
    if (isUnder(pathname, PARTICIPANT_PREFIXES)) return response;
    return redirectTo(request, response, "/join");
  }
  if (user || isUnder(pathname, PUBLIC_PREFIXES)) return response;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (pathname.startsWith("/study/")) return redirectTo(request, response, "/join");

  return redirectTo(
    request,
    response,
    "/login",
    pathname !== "/" ? pathname + search : undefined,
  );
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)",
  ],
};
