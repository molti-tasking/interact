"use client";

import { Countdown } from "@/components/study/Countdown";
import { PhaseStepper } from "@/components/study/PhaseStepper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  useAdvanceStudyPhase,
  useExtendStudyPhase,
  useStudyRoster,
  useStudySession,
  useUpdateStudySession,
  type RosterEntry,
} from "@/hooks/query/study";
import {
  nextPhase,
  PHASE_COPY,
  previousPhase,
  type PhaseDurations,
  type StudyPhase,
  type StudySession,
  type StudySettings,
} from "@/lib/study/types";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Loader2,
  MonitorPlay,
  Plus,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SessionSettingsFields } from "../_components/session-settings";
import { ExportCard } from "./_components/export-card";
import { RosterTable } from "./_components/roster-table";

/** Facilitator console: join code, phase control, live roster, export. */
export default function StudyConsolePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const session = useStudySession(sessionId);
  const roster = useStudyRoster(sessionId);

  if (session.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  if (!session.data) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-lg font-semibold">
          {session.isError ? "Couldn't load the session" : "Session not found"}
        </h2>
        {session.isError && (
          <p className="text-sm text-muted-foreground">{session.error.message}</p>
        )}
        <Button asChild variant="link">
          <Link href="/studies">Back to workshops</Link>
        </Button>
      </div>
    );
  }

  const entries = roster.data ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <SessionHeader session={session.data} />
      <PhaseControl session={session.data} roster={entries} />
      <section aria-labelledby="roster-heading" className="space-y-2">
        <h2 id="roster-heading" className="text-lg font-medium">
          Participants{" "}
          <span className="text-muted-foreground tabular-nums">({entries.length})</span>
        </h2>
        {roster.isError ? (
          <p role="alert" className="text-sm text-destructive">{roster.error.message}</p>
        ) : (
          <RosterTable sessionId={sessionId} phase={session.data.phase} roster={entries} />
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <SettingsCard session={session.data} />
        <ExportCard session={session.data} />
      </div>
    </div>
  );
}

function SessionHeader({ session }: { session: StudySession }) {
  const joinUrl =
    typeof window === "undefined"
      ? `/join?code=${session.join_code}`
      : `${window.location.origin}/join?code=${session.join_code}`;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">{session.name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Join code
          <span className="rounded-md border bg-card px-2 py-0.5 font-mono text-lg tracking-widest text-foreground">
            {session.join_code}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigator.clipboard
                .writeText(joinUrl)
                .then(() => toast.success("Join link copied"))
                .catch(() => toast.error("Couldn't copy the link"))
            }
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            Copy join link
          </Button>
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={`/studies/${session.id}/screen`} target="_blank" rel="noopener">
          <MonitorPlay className="h-4 w-4" aria-hidden />
          Presenter screen
          <span className="sr-only">(opens in a new tab)</span>
        </Link>
      </Button>
    </div>
  );
}

/** What to double-check before moving the room to `target`. */
function warningsFor(target: StudyPhase, roster: RosterEntry[]): string[] {
  const warnings: string[] = [];
  if (roster.length < 2 && (target === "create" || target === "answer")) {
    warnings.push("Fewer than two participants have joined.");
  }
  if (target === "answer") {
    const empty = roster.filter((r) => r.fieldCount === 0);
    if (empty.length > 0) {
      warnings.push(
        `${empty.map((r) => r.displayName).join(", ")} ${empty.length === 1 ? "has" : "have"} no questions in their form yet.`,
      );
    }
  }
  if (target === "review") {
    const expected = Math.max(0, roster.length - 1);
    const behind = roster.filter((r) => r.responsesGiven < expected);
    if (behind.length > 0) {
      warnings.push(
        `${behind.length} participant${behind.length === 1 ? " hasn't" : "s haven't"} answered every form yet (they have 2 more minutes after you switch).`,
      );
    }
  }
  if (target === "done") {
    const missing = roster.filter((r) => !r.questionnaireDone);
    if (missing.length > 0) {
      warnings.push(`${missing.length} questionnaire${missing.length === 1 ? " is" : "s are"} still missing.`);
    }
  }
  return warnings;
}

const SNAPSHOT_NOTE: Partial<Record<StudyPhase, string>> = {
  create: "Every form is snapshotted as it is now (end of creation).",
  review: "Every form is snapshotted as it is now (end of refinement).",
};

function PhaseControl({
  session,
  roster,
}: {
  session: StudySession;
  roster: RosterEntry[];
}) {
  const advance = useAdvanceStudyPhase();
  const extend = useExtendStudyPhase();
  const [target, setTarget] = useState<StudyPhase | null>(null);
  const next = nextPhase(session.phase);
  const previous = previousPhase(session.phase);
  const warnings = target ? warningsFor(target, roster) : [];

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PhaseStepper phase={session.phase} />
        <div className="flex items-center gap-2">
          <Countdown endsAt={session.phase_ends_at} className="text-2xl" />
          {session.phase_ends_at && (
            <Button
              variant="outline"
              size="sm"
              disabled={extend.isPending}
              onClick={() =>
                extend.mutate(
                  { sessionId: session.id, seconds: 120 },
                  { onError: (err) => toast.error(err.message) },
                )
              }
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />2 min
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm">
        <span className="font-medium">{PHASE_COPY[session.phase].label}</span>
        <span className="text-muted-foreground"> — participants see: “{PHASE_COPY[session.phase].instruction}”</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {previous && (
          <Button variant="ghost" onClick={() => setTarget(previous)}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to {PHASE_COPY[previous].label}
          </Button>
        )}
        {next && (
          <Button onClick={() => setTarget(next)} data-testid="advance-phase">
            {session.phase === "lobby" ? "Start" : "Next"}: {PHASE_COPY[next].label}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target ? `Move everyone to “${PHASE_COPY[target].label}”?` : ""}
        description={
          target
            ? [SNAPSHOT_NOTE[session.phase], "All participant screens switch now."]
                .filter(Boolean)
                .join(" ")
            : undefined
        }
        confirmLabel="Move everyone"
        pendingLabel="Switching…"
        onConfirm={async () => {
          if (!target) return;
          try {
            await advance.mutateAsync({ sessionId: session.id, phase: target });
            setTarget(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't switch the phase");
            throw err;
          }
        }}
      >
        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </Card>
  );
}

function SettingsCard({ session }: { session: StudySession }) {
  const update = useUpdateStudySession();
  const [durations, setDurations] = useState<PhaseDurations>(session.phase_durations);
  const [settings, setSettings] = useState<StudySettings>(session.settings);
  const dirty =
    JSON.stringify(durations) !== JSON.stringify(session.phase_durations) ||
    JSON.stringify(settings) !== JSON.stringify(session.settings);

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <h2 className="text-lg font-medium">Settings</h2>
      <SessionSettingsFields
        durations={durations}
        onDurationsChange={setDurations}
        settings={settings}
        onSettingsChange={setSettings}
        disabled={update.isPending}
      />
      <p className="text-xs text-muted-foreground">
        New durations apply from the next phase. Voice and suggestions update
        on participants&apos; screens within seconds.
      </p>
      <Button
        disabled={!dirty || update.isPending}
        onClick={() =>
          update.mutate(
            { id: session.id, settings, phaseDurations: durations },
            {
              onSuccess: () => toast.success("Settings saved"),
              onError: (err) => toast.error(err.message),
            },
          )
        }
      >
        {update.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Save settings
      </Button>
    </Card>
  );
}
