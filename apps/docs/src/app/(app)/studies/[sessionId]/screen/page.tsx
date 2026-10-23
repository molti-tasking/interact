"use client";

import { Countdown } from "@/components/study/Countdown";
import { PhaseStepper } from "@/components/study/PhaseStepper";
import { Button } from "@/components/ui/button";
import { useStudyRoster, useStudySession, type RosterEntry } from "@/hooks/query/study";
import { PHASE_COPY, type StudySession } from "@/lib/study/types";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

/**
 * Projector view: join code, phase, a big countdown and room progress.
 * Full-screen over the app shell (like record mode).
 */
export default function PresenterScreenPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const session = useStudySession(sessionId);
  const roster = useStudyRoster(sessionId);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="absolute right-4 top-4 text-muted-foreground"
      >
        <Link href={`/studies/${sessionId}`}>
          <X className="h-4 w-4" aria-hidden />
          Close
        </Link>
      </Button>
      {!session.data ? (
        <div className="flex flex-1 items-center justify-center">
          {session.isLoading ? (
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-label="Loading" />
          ) : (
            <p className="text-2xl text-muted-foreground">Session not found</p>
          )}
        </div>
      ) : (
        <Screen session={session.data} roster={roster.data ?? []} />
      )}
    </div>
  );
}

function Screen({ session, roster }: { session: StudySession; roster: RosterEntry[] }) {
  const copy = PHASE_COPY[session.phase];
  const joinHost = typeof window === "undefined" ? "" : window.location.host;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-8 text-center">
      <p className="text-xl text-muted-foreground">{session.name}</p>

      {session.phase === "lobby" ? (
        <div className="space-y-6">
          <p className="text-3xl">Join at</p>
          <p className="font-mono text-5xl">{joinHost}/join</p>
          <p className="text-3xl">with the code</p>
          <p className="font-mono text-8xl font-semibold tracking-[0.2em] text-primary">
            {session.join_code}
          </p>
        </div>
      ) : (
        <>
          <PhaseStepper phase={session.phase} size="lg" />
          <div className="space-y-4">
            <h1 className="text-6xl tracking-tight">{copy.label}</h1>
            <p className="mx-auto max-w-4xl text-3xl text-muted-foreground">
              {copy.instruction}
            </p>
          </div>
          <Countdown endsAt={session.phase_ends_at} className="text-9xl" />
        </>
      )}

      <Progress session={session} roster={roster} />
    </div>
  );
}

function Progress({ session, roster }: { session: StudySession; roster: RosterEntry[] }) {
  const n = roster.length;
  let text: string | null = null;
  let done = 0;
  let total = 0;

  switch (session.phase) {
    case "lobby":
      text = `${n} joined`;
      break;
    case "create":
      done = roster.filter((r) => r.fieldCount > 0).length;
      total = n;
      text = `${done} of ${n} forms have questions`;
      break;
    case "answer":
      done = roster.reduce((sum, r) => sum + r.responsesGiven, 0);
      total = n * Math.max(0, n - 1);
      text = `${done} of ${total} answers given`;
      break;
    case "questionnaire":
      done = roster.filter((r) => r.questionnaireDone).length;
      total = n;
      text = `${done} of ${n} questionnaires done`;
      break;
  }

  return (
    <div className="w-full max-w-3xl space-y-3">
      {total > 0 && (
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700"
            style={{ width: `${Math.min(100, (done / total) * 100)}%` }}
          />
        </div>
      )}
      {text && <p className="text-2xl text-muted-foreground tabular-nums">{text}</p>}
      {session.phase === "lobby" && n > 0 && (
        <ul className="flex flex-wrap justify-center gap-2 pt-2">
          {roster.map((r) => (
            <li key={r.participantId} className="rounded-full border px-4 py-1 text-xl">
              {r.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
