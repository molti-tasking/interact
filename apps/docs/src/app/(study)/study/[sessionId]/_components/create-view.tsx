"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PortfolioWorkspace } from "@/components/workspace/PortfolioWorkspace";
import { useStudy } from "@/context/study-context";
import { useCurrentUser } from "@/context/user-context";
import { useCommitPortfolio } from "@/hooks/query/portfolios";
import { formatActor } from "@/lib/mock-users";
import { deriveTitleFromIntent } from "@/lib/new-portfolio";
import type { Portfolio } from "@/lib/types";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ExampleCarousel } from "./example-carousel";
import { toast } from "sonner";
import { useCoachTour } from "./use-coach-tour";

/** A form counts as started once it has an intent or fields. */
function hasStarted(portfolio: Portfolio): boolean {
  return (
    !!portfolio.intent.purpose.content.trim() ||
    portfolio.schema.fields.length > 0
  );
}

/**
 * The participant's own form in the design workspace. Before there is an
 * intent, a start card asks for one; the workspace then drafts the form
 * from it right away.
 */
export function DesignView({
  portfolio,
  withTour = false,
  replayTour = 0,
}: {
  portfolio: Portfolio;
  /** Offer the create tour once the workspace is on screen */
  withTour?: boolean;
  replayTour?: number;
}) {
  const { state } = useStudy()!;
  const [autoGenerate, setAutoGenerate] = useState(false);
  const started = hasStarted(portfolio);

  useCoachTour({
    tour: "create",
    participantId: state.participant.id,
    ready: withTour && started,
    replay: replayTour,
  });

  if (!started) {
    return <StartCard portfolio={portfolio} onStarted={() => setAutoGenerate(true)} />;
  }
  return (
    <div className="space-y-4">
      <ReadyBar />
      <PortfolioWorkspace
        portfolio={portfolio}
        autoGenerate={autoGenerate}
        onAutoGenerateStarted={() => setAutoGenerate(false)}
      />
    </div>
  );
}

/**
 * When am I done? Participants don't have to answer every design probe; they
 * can mark the form as ready (logged, so time to "ready" can be analysed)
 * and keep improving it until the facilitator moves on.
 */
function ReadyBar() {
  const { state, log } = useStudy()!;
  const phase = state.session.phase;
  const storageKey = `mf-study-ready:${state.participant.id}:${phase}`;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setReady(sessionStorage.getItem(storageKey) === "1");
    } catch {
      // storage unavailable: start unmarked
    }
  }, [storageKey]);

  const mark = (next: boolean) => {
    setReady(next);
    log(next ? "form_marked_ready" : "form_ready_undone", { phase });
    try {
      if (next) sessionStorage.setItem(storageKey, "1");
      else sessionStorage.removeItem(storageKey);
    } catch {
      // not persisted; the log has it
    }
  };

  return (
    <div
      data-testid="ready-bar"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
    >
      {ready ? (
        <p className="flex items-center gap-2 text-sm" role="status">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
          Marked as ready. You can keep improving it until the time is up.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">When are you done?</span>{" "}
          When the form asks what you want to know. You don&apos;t have to answer
          every design question; skip what doesn&apos;t matter.
        </p>
      )}
      {ready ? (
        <Button variant="ghost" size="sm" onClick={() => mark(false)}>
          Undo
        </Button>
      ) : (
        <Button size="sm" onClick={() => mark(true)} data-testid="mark-ready">
          My form is ready
        </Button>
      )}
    </div>
  );
}

function StartCard({
  portfolio,
  onStarted,
}: {
  portfolio: Portfolio;
  onStarted: () => void;
}) {
  const { log } = useStudy()!;
  const { currentUser } = useCurrentUser();
  const commit = useCommitPortfolio(portfolio.id);
  const [intent, setIntent] = useState("");
  const [title, setTitle] = useState("");
  const intentText = intent.trim();
  const derivedTitle = intentText ? deriveTitleFromIntent(intentText) : "";

  const handleStart = async () => {
    if (!intentText || commit.isPending) return;
    const now = new Date().toISOString();
    try {
      await commit.mutateAsync((current) => ({
        intent: {
          ...current.intent,
          purpose: { content: intentText, updatedAt: now },
        },
        title: title.trim() || derivedTitle || current.title,
        provenance: {
          layer: "intent",
          action: "intent_updated",
          actor: formatActor(currentUser),
          rationale: "Described the form to create",
        },
      }));
      log("intent_started", { length: intentText.length, titled: !!title.trim() });
      onStarted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">Create a form</h1>
        <p className="text-muted-foreground">
          Say what you want to find out. The tool drafts a form and helps you
          improve it.
        </p>
      </div>
      <Card className="p-4 sm:p-6">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void handleStart();
          }}
          aria-busy={commit.isPending || undefined}
        >
          <div className="space-y-2">
            <Label htmlFor="study-intent" className="text-base">
              What would you like to find out?
            </Label>
            <Textarea
              id="study-intent"
              autoFocus
              rows={5}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleStart();
                }
              }}
              placeholder="A sentence or two is enough."
              className="min-h-32 bg-background text-base"
              disabled={commit.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Rough is fine. Stuck? See the examples below.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="study-title">
              Title{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="study-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={derivedTitle || "Made from your description if left empty"}
              disabled={commit.isPending}
            />
          </div>
          <Button type="submit" disabled={!intentText || commit.isPending}>
            {commit.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            Create my form
          </Button>
        </form>
      </Card>
      <ExampleCarousel />
    </div>
  );
}
