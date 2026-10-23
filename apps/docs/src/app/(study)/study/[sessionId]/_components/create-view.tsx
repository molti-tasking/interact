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
import { Loader2 } from "lucide-react";
import { useState } from "react";
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
    <PortfolioWorkspace
      portfolio={portfolio}
      autoGenerate={autoGenerate}
      onAutoGenerateStarted={() => setAutoGenerate(false)}
    />
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
        <h1 className="text-3xl tracking-tight text-primary">Your hobby form</h1>
        <p className="text-muted-foreground">
          Start with a few sentences. The tool drafts a first form and then
          asks you design questions to refine it.
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
              Which hobby, and what would you like to find out from others?
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
              placeholder="e.g. I go bouldering every week and would like to know how others got into climbing, where they train and what keeps them motivated…"
              className="min-h-32 bg-background text-base"
              disabled={commit.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Who fills it in, what it&apos;s for, anything you don&apos;t want
              to ask. Rough is fine.
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
              placeholder={derivedTitle || "e.g. Bouldering habits"}
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
    </div>
  );
}
