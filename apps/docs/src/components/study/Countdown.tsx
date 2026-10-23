"use client";

import { useNow } from "@/hooks/use-now";
import { formatCountdown, secondsLeft } from "@/lib/study/types";
import { cn } from "@/lib/utils";

/**
 * Soft-deadline countdown for the current phase. Turns amber in the last
 * two minutes and shows overtime in red (the facilitator moves everyone on).
 */
export function Countdown({
  endsAt,
  clockOffsetMs = 0,
  className,
}: {
  endsAt: string | null;
  /** server time − client time */
  clockOffsetMs?: number;
  className?: string;
}) {
  const now = useNow(1_000);
  const left = secondsLeft(endsAt, clockOffsetMs, now);
  if (left === null) return null;
  const tone =
    left < 0
      ? "text-destructive"
      : left <= 120
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <span
      role="timer"
      aria-label={left < 0 ? "Time is up" : "Time left in this phase"}
      className={cn("font-mono tabular-nums", tone, className)}
    >
      {formatCountdown(left)}
    </span>
  );
}
