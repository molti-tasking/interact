"use client";

import { Countdown } from "@/components/study/Countdown";
import { PhaseStepper } from "@/components/study/PhaseStepper";
import { Button } from "@/components/ui/button";
import { useStudy } from "@/context/study-context";
import { PHASE_COPY } from "@/lib/study/types";
import { CircleHelp, UserRound } from "lucide-react";

/**
 * The participant's only chrome: where the workshop is, what to do now,
 * and how much time is left. The facilitator moves everyone on.
 */
export function PhaseBar({ onHelp }: { onHelp?: () => void }) {
  const study = useStudy();
  if (!study) return null;
  const { session, participant, clockOffsetMs } = study.state;
  const copy = PHASE_COPY[session.phase];

  return (
    <header
      data-tour="phase-bar"
      className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/70"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <span className="text-sm font-medium">{session.name}</span>
        <PhaseStepper phase={session.phase} className="hidden md:flex" />
        <div className="ml-auto flex items-center gap-3">
          <Countdown
            endsAt={session.phase_ends_at}
            clockOffsetMs={clockOffsetMs}
            className="text-lg"
          />
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" aria-hidden />
            {participant.display_name}
          </span>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 pb-2 text-sm text-muted-foreground sm:px-6">
        <p role="status" aria-live="polite">
          <span className="font-medium text-foreground">{copy.label}:</span>{" "}
          {copy.instruction}
        </p>
        {onHelp && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={onHelp}
            aria-label="Show the guided tour again"
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden />
            Tour
          </Button>
        )}
      </div>
    </header>
  );
}
