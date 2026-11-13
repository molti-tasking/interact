import { requireOwner, UnauthorizedError } from "@/lib/auth";
import type { Json } from "@/lib/supabase/database.types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  parseRunSettings,
  parseSettings,
  runSettingsFromEnv,
  type StudyRunSettings,
} from "@/lib/study/types";
import { NextResponse } from "next/server";

/**
 * What a briefs session would run with, read from this server's
 * environment: the model (`LLM_MODEL_NAME`), how questions are chosen
 * (`PROBE_STRATEGY`) and the committee size (`PROBE_COMMITTEE_SIZE`).
 *
 * GET   the settings, or which variables are not set explicitly
 * POST  record them in the session and open it. Refused when one is
 *       missing, or when the session already ran with other settings —
 *       a study reports one configuration.
 *
 * The database refuses to open a briefs session without them (migration
 * 015); this route is the only place that writes them.
 */

async function guard(): Promise<NextResponse | null> {
  try {
    await requireOwner();
    return null;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}

const sameRun = (a: StudyRunSettings, b: StudyRunSettings) =>
  a.model === b.model &&
  a.fastModel === b.fastModel &&
  a.questionStrategy === b.questionStrategy &&
  a.committeeSize === b.committeeSize &&
  a.questionOrder === b.questionOrder;

const describe = (run: StudyRunSettings) =>
  `${run.model}${run.fastModel !== run.model ? ` (and ${run.fastModel})` : ""}, ${run.questionStrategy} questions${run.questionOrder ? " (likely omissions first)" : ""}, committee of ${run.committeeSize}${run.fallback ? `, falling back to ${run.fallback.model} on Anthropic's API` : ""}`;

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return NextResponse.json(runSettingsFromEnv(process.env), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await context.params;

  const current = runSettingsFromEnv(process.env);
  if (!current.run) {
    return NextResponse.json(
      {
        error: `The study can't be opened: ${current.missing.join(", ")} ${current.missing.length === 1 ? "is" : "are"} not set on the server. Set ${current.missing.length === 1 ? "it" : "them"} explicitly, restart, and try again.`,
        missing: current.missing,
      },
      { status: 409 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: row, error } = await supabase
    .from("study_sessions")
    .select("id, settings")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const settings = (row.settings ?? {}) as Record<string, Json | undefined>;
  if (parseSettings(settings).mode !== "briefs") {
    return NextResponse.json({ error: "Not a self-paced study" }, { status: 400 });
  }

  const recorded = parseRunSettings(settings.run);
  if (recorded && !sameRun(recorded, current.run)) {
    return NextResponse.json(
      {
        error: `This study ran with ${describe(recorded)}. The server is now set to ${describe(current.run)}. Restore the settings, or create a new session for the new ones.`,
      },
      { status: 409 },
    );
  }

  // The first opening records them; a reopening keeps the first record
  const run = recorded ?? current.run;
  const { error: writeError } = await supabase
    .from("study_sessions")
    .update({ settings: { ...settings, run } as unknown as Json })
    .eq("id", id);
  if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 });

  const { data: opened, error: openError } = await supabase.rpc("advance_study_phase", {
    p_session_id: id,
    p_phase: "create",
  });
  if (openError) return NextResponse.json({ error: openError.message }, { status: 500 });
  return NextResponse.json({ session: opened, run });
}
