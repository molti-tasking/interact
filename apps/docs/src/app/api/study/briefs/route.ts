import { requireOwner, UnauthorizedError } from "@/lib/auth";
import { BRIEF_DEFINITIONS } from "@/lib/study/briefs.server";
import { NextResponse } from "next/server";

/**
 * GET /api/study/briefs — stories and requirement lists, for the
 * researcher's export (coding sheets). Admins only.
 */
export async function GET() {
  try {
    await requireOwner();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
  return NextResponse.json(BRIEF_DEFINITIONS, {
    headers: { "Cache-Control": "no-store" },
  });
}
