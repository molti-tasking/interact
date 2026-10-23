"use client";

import { Button } from "@/components/ui/button";
import { StudyProvider, useStudy } from "@/context/study-context";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useMyStudyState } from "@/hooks/query/study";
import type { StudyPhase } from "@/lib/study/types";
import { usePortfolioActivity } from "@/lib/workspace-activity";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AnswerView } from "./_components/answer-view";
import { DesignView } from "./_components/create-view";
import { DoneView } from "./_components/done-view";
import { LobbyView } from "./_components/lobby-view";
import { PhaseBar } from "./_components/phase-bar";
import { QuestionnaireView } from "./_components/questionnaire-view";
import { RefineView } from "./_components/refine-view";

/** How long a phase change waits for in-flight AI edits at most. */
const SETTLE_TIMEOUT_MS = 20_000;

/**
 * A workshop participant's single page. The facilitator drives the phase;
 * this page polls it and shows exactly what the phase needs.
 */
export default function StudySessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const stateQuery = useMyStudyState(sessionId);

  if (stateQuery.isPending) return <Centered><Spinner /></Centered>;

  if (!stateQuery.data) {
    return (
      <Centered>
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold">
            {stateQuery.isError ? "Couldn't reach the workshop" : "You're not in this session"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {stateQuery.isError
              ? stateQuery.error.message
              : "This browser hasn't joined it — or the seat moved to another browser."}
          </p>
          {stateQuery.isError ? (
            <Button variant="outline" size="sm" onClick={() => stateQuery.refetch()}>
              Try again
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/join">Join a session</Link>
            </Button>
          )}
        </div>
      </Centered>
    );
  }

  return (
    <StudyProvider state={stateQuery.data}>
      <StudyShell />
    </StudyProvider>
  );
}

function StudyShell() {
  const { state, log } = useStudy()!;
  const phase = state.session.phase;
  const portfolioId = state.participant.portfolio_id ?? undefined;
  const portfolio = usePortfolio(portfolioId);
  const busy = usePortfolioActivity(portfolioId).length > 0;
  const [replayTour, setReplayTour] = useState(0);

  // The phase on screen. Leaving the workspace waits (briefly) for AI edits
  // still in flight, so they land before the view — and the snapshot
  // the facilitator just took — move on.
  const [shown, setShown] = useState<StudyPhase>(phase);
  const leavingWorkspace = shown === "create" || shown === "review";
  if (shown !== phase && (!leavingWorkspace || !busy)) {
    setShown(phase); // adjusting state while rendering
  }
  const settling = shown !== phase;
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setShown(phase), SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [settling, phase]);

  // Each phase starts from the stored form, never a stale cached copy
  const refetchPortfolio = portfolio.refetch;
  useEffect(() => {
    log("phase_entered", { phase: shown });
    window.scrollTo({ top: 0 });
    void refetchPortfolio();
  }, [shown, log, refetchPortfolio]);

  const hasTour = shown === "create" || shown === "review";

  return (
    <>
      <PhaseBar onHelp={hasTour ? () => setReplayTour((n) => n + 1) : undefined} />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 sm:px-6">
        {shown === "lobby" && <LobbyView />}
        {shown === "answer" && <AnswerView />}
        {shown === "questionnaire" && <QuestionnaireView />}
        {shown === "done" && <DoneView />}
        {(shown === "create" || shown === "review") &&
          (portfolio.data ? (
            shown === "create" ? (
              <DesignView portfolio={portfolio.data} withTour replayTour={replayTour} />
            ) : (
              <RefineView portfolio={portfolio.data} replayTour={replayTour} />
            )
          ) : portfolio.isPending ? (
            <Centered><Spinner /></Centered>
          ) : (
            <p role="alert" className="py-12 text-center text-sm text-destructive">
              Couldn&apos;t load your form
              {portfolio.isError ? `: ${portfolio.error.message}` : "."}
            </p>
          ))}
      </main>
      {settling && (
        <div
          role="status"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
        >
          <p className="flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Saving your last changes…
          </p>
        </div>
      )}
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8">{children}</div>;
}

function Spinner() {
  return <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />;
}
