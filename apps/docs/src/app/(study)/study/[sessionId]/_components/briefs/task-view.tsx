"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PortfolioWorkspace } from "@/components/workspace/PortfolioWorkspace";
import { useCapabilities } from "@/context/capabilities-context";
import { useStudy } from "@/context/study-context";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useAdvanceStudyStep } from "@/hooks/query/study";
import { useNow } from "@/hooks/use-now";
import { taskTourId } from "@/lib/study/tours";
import { secondsLeft, type StudyTask } from "@/lib/study/types";
import { usePortfolioActivity } from "@/lib/workspace-activity";
import { BookOpen, Check, CircleHelp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StartCard } from "../create-view";
import { useCoachTour } from "../use-coach-tour";
import { BriefImage } from "./brief-image";

/** How long leaving a task waits for AI edits still in flight at most. */
const SETTLE_TIMEOUT_MS = 20_000;

const START_COPY = {
  heading: "Describe the form",
  label: "What form do you need?",
  hint: "A few sentences are enough. You can change everything afterwards.",
  examples: false,
};

/**
 * One task of a briefs session: the participant's form for one situation,
 * in the workspace their condition gives them, against the clock.
 */
export function TaskView({ task }: { task: StudyTask }) {
  const { state, log } = useStudy()!;
  const { designProbes, chatEdits, assistantChat } = useCapabilities();
  const step = `task:${task.position}`;
  const portfolioId = task.portfolio_id ?? undefined;
  const portfolio = usePortfolio(portfolioId);
  const busy = usePortfolioActivity(portfolioId).length > 0;
  const advance = useAdvanceStudyStep(state.session.id);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState<"participant" | "timeout" | null>(
    null,
  );
  const briefOpenedAt = useRef(0);
  const [replayTour, setReplayTour] = useState(0);

  const deadline = task.started_at
    ? new Date(
        new Date(task.started_at).getTime() +
          state.session.settings.taskSeconds * 1000,
      ).toISOString()
    : null;
  const now = useNow(1_000);
  const left = secondsLeft(deadline, state.clockOffsetMs, now);
  const timeUp = left !== null && left <= 0;
  if (timeUp && !leaving) setLeaving("timeout"); // adjusting state while rendering

  // Leave once AI edits in flight have landed (or after a short wait), so
  // the snapshot the server takes is the form the participant saw
  const { mutate: advanceStep } = advance;
  useEffect(() => {
    if (!leaving) return;
    const go = () =>
      advanceStep(
        { from: step, reason: leaving === "timeout" ? "timeout" : undefined },
        {
          onError: (err) => {
            toast.error(err.message);
            if (leaving === "participant") setLeaving(null);
          },
        },
      );
    if (!busy) {
      go();
      return;
    }
    const timer = setTimeout(go, SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [leaving, busy, advanceStep, step]);

  // The arm's tour: once, as soon as what it points at is on screen (the
  // first form, in practice — it is seen by then), and again from "How it
  // works". The clock keeps running; every step is logged.
  const fieldCount = portfolio.data?.schema.fields.length ?? 0;
  const workspaceReady = !!portfolio.data && (assistantChat || fieldCount > 0);
  useCoachTour({
    tour: taskTourId({ assistantChat, chatEdits, designProbes }),
    participantId: state.participant.id,
    ready: workspaceReady && !leaving,
    replay: replayTour,
  });

  const toggleBrief = (open: boolean) => {
    setBriefOpen(open);
    if (open) {
      briefOpenedAt.current = Date.now();
      log("brief_opened", { brief: task.brief });
    } else {
      log("brief_closed", {
        brief: task.brief,
        ms: Date.now() - briefOpenedAt.current,
      });
    }
  };

  if (portfolio.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader2
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-label="Loading"
        />
      </div>
    );
  }
  if (!portfolio.data) {
    return (
      <p role="alert" className="py-12 text-center text-sm text-destructive">
        Couldn&apos;t load your form
        {portfolio.isError ? `: ${portfolio.error.message}` : "."}
      </p>
    );
  }

  const form = portfolio.data;
  // The assistant arm has no "describe the form" card: its first message is
  // the description
  const started =
    assistantChat ||
    !!form.intent.purpose.content.trim() ||
    form.schema.fields.length > 0;
  const hasFields = form.schema.fields.length > 0;

  return (
    <div className="space-y-4">
      <div
        data-testid="task-bar"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
      >
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {task.start_kind
              ? "Bring this form up to date for the situation. Somebody else built it."
              : "Build the form the people in the situation need."}
          </span>{" "}
          {started &&
            (assistantChat
              ? "Write to the assistant, or click a field to edit it."
              : chatEdits
                ? "Write to the tool to change the form, or click a field to edit it."
                : designProbes
                  ? "Answer the tool's questions that matter, or click a field to edit it."
                  : "Edit the description, or click a field to edit it.")}
        </p>
        <div className="flex items-center gap-2">
          {workspaceReady && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReplayTour((n) => n + 1)}
              data-testid="show-tour"
            >
              <CircleHelp className="h-3.5 w-3.5" aria-hidden />
              How it works
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleBrief(true)}
            data-testid="show-brief"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            Show the situation
          </Button>
          <Button
            size="sm"
            disabled={!hasFields || !!leaving}
            onClick={() => setConfirming(true)}
            data-testid="finish-task"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            My form is ready
          </Button>
        </div>
      </div>

      {started ? (
        <PortfolioWorkspace
          portfolio={form}
          autoGenerate={autoGenerate}
          onAutoGenerateStarted={() => setAutoGenerate(false)}
        />
      ) : (
        <StartCard
          portfolio={form}
          onStarted={() => setAutoGenerate(true)}
          copy={START_COPY}
        />
      )}

      <Dialog open={briefOpen} onOpenChange={toggleBrief}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>The situation</DialogTitle>
          </DialogHeader>
          <BriefImage briefKey={task.brief} />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Finish this form?"
        description="You can't come back to it afterwards."
        confirmLabel="Yes, it's ready"
        cancelLabel="Keep working"
        onConfirm={() => {
          log("form_marked_ready", {
            position: task.position,
            secondsLeft: left,
          });
          setLeaving("participant");
        }}
      />

      {leaving && (
        <div
          role="status"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
        >
          <p className="flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {leaving === "timeout"
              ? "Time is up — saving your form…"
              : "Saving your form…"}
          </p>
        </div>
      )}
    </div>
  );
}
