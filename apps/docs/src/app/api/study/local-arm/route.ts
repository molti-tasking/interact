import { forcedArmAllowed } from "@/lib/study/local-arm";
import { NextResponse } from "next/server";

/**
 * GET → `{ allowed }`: whether this server lets a study link pick its arm
 * (`arm=<condition>`). Only on a local machine — never in production — and
 * only with `STUDY_LOCAL=1`. See `lib/study/local-arm.ts`.
 */
export async function GET() {
  return NextResponse.json(
    { allowed: forcedArmAllowed(process.env) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
