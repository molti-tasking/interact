"use client";

import { Countdown } from "@/components/study/Countdown";
import { Card } from "@/components/ui/card";
import { useStudy } from "@/context/study-context";
import { briefSteps, parseBriefStep } from "@/lib/study/types";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { DoneView } from "../done-view";
import {
  BriefView,
  ConsentView,
  DeclinedView,
  FinalQuestionnaireView,
  IntroView,
  QuizView,
} from "./steps";
import { RatingsView, RecallView, WhyView } from "./post-task";
import { TaskView } from "./task-view";

/**
 * Below this the workspace is unusable (phones, narrow tablets). Not higher:
 * a laptop zoomed to 150 % reports about 900 px and must still get in — the
 * workspace then stacks its two panes.
 */
const MIN_WIDTH = 760;

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="max-w-md space-y-2 p-6 text-center">
        <h1 className="text-xl tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </Card>
    </div>
  );
}

/**
 * A participant's page in a self-paced briefs session (migration 014):
 * consent → intro → [situation → build → quiz] per brief → questionnaire →
 * back to the panel. The server holds the step; this shows it.
 */
export function BriefsShell() {
  const { state, log } = useStudy()!;
  const { session, progress } = state;
  const tasks = state.tasks ?? [];

  // Desktop only (also a panel screener): the workspace needs the width
  const [tooNarrow, setTooNarrow] = useState(false);
  useEffect(() => {
    const check = () => setTooNarrow(window.innerWidth < MIN_WIDTH);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  useEffect(() => {
    if (tooNarrow) log("window_too_narrow", { width: window.innerWidth });
  }, [tooNarrow, log]);

  const step = progress?.step;
  useEffect(() => {
    window.scrollTo({ top: 0 });
    // No "Undo" for a form whose task is over
    toast.dismiss();
  }, [step]);

  if (!progress) {
    return (
      <Notice title="Please use your study link">
        This study opens from the link you were given on Prolific.
      </Notice>
    );
  }
  if (progress.outcome === "declined") return <DeclinedView />;
  if (progress.outcome !== "completed" && session.phase === "done") {
    return (
      <Notice title="This study has closed">
        It is no longer accepting submissions. Please return your submission on
        Prolific.
      </Notice>
    );
  }

  const parsed = parseBriefStep(progress.step);
  const steps = briefSteps(tasks.length, session.settings.postTaskMeasures);
  const index = steps.indexOf(progress.step);
  const task =
    parsed && "position" in parsed
      ? tasks.find((t) => t.position === parsed.position)
      : undefined;
  const inTask = parsed?.kind === "task" && !!task;
  const deadline =
    inTask && task.started_at
      ? new Date(
          new Date(task.started_at).getTime() + session.settings.taskSeconds * 1000,
        ).toISOString()
      : null;

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/70">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-2 sm:px-6">
          <span className="text-sm font-medium">Form study</span>
          {index >= 0 && parsed?.kind !== "done" && (
            <span className="text-sm text-muted-foreground" data-testid="study-step">
              Step {index + 1} of {steps.length - 1}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {deadline && (
              <>
                <span className="text-xs text-muted-foreground">Time left</span>
                <Countdown
                  endsAt={deadline}
                  clockOffsetMs={state.clockOffsetMs}
                  className="text-lg"
                />
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-4 sm:px-6">
        {!parsed ? (
          <Notice title="Something went wrong">
            This step is unknown. Please reload the page.
          </Notice>
        ) : parsed.kind === "consent" ? (
          <ConsentView />
        ) : parsed.kind === "intro" ? (
          <IntroView />
        ) : parsed.kind === "questionnaire" ? (
          <FinalQuestionnaireView />
        ) : parsed.kind === "done" ? (
          <DoneView />
        ) : !task ? (
          <Notice title="Something went wrong">
            This task is missing. Please reload the page.
          </Notice>
        ) : parsed.kind === "brief" ? (
          <BriefView key={task.position} task={task} total={tasks.length} />
        ) : parsed.kind === "task" ? (
          <TaskView key={task.position} task={task} />
        ) : parsed.kind === "ratings" ? (
          <RatingsView key={task.position} task={task} />
        ) : parsed.kind === "recall" ? (
          <RecallView key={task.position} task={task} />
        ) : parsed.kind === "why" ? (
          <WhyView key={task.position} task={task} />
        ) : (
          <QuizView key={task.position} task={task} />
        )}
      </main>
      {/* Over the step, not instead of it: what the participant has typed or
          answered so far stays when the window is widened again */}
      {tooNarrow && parsed?.kind !== "done" && (
        <div
          role="alertdialog"
          aria-label="Please use a wider window"
          className="fixed inset-0 z-[70] flex bg-background"
        >
          <Notice title="Please use a wider window">
            This study needs a desktop or laptop computer. Make this window
            wider (or open your study link on another device) to continue where
            you left off.
          </Notice>
        </div>
      )}
    </>
  );
}
