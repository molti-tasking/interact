"use client";

import { useStudyLog } from "@/context/study-context";
import { TOURS, type TourId } from "@/lib/study/tours";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useCallback, useEffect, useRef } from "react";

function seenKey(participantId: string, tour: TourId) {
  return `study-tour:${participantId}:${tour}`;
}

function markSeen(key: string): boolean {
  try {
    if (window.localStorage.getItem(key)) return false;
    window.localStorage.setItem(key, "1");
    return true;
  } catch {
    return true; // storage unavailable: show it (at most once per mount)
  }
}

/**
 * A coach-mark tour: starts once per participant when `ready` (the
 * highlighted parts are on screen), and again whenever `replay` changes
 * (the phase bar's "?" button). Steps whose element is missing are skipped.
 */
export function useCoachTour({
  tour,
  participantId,
  ready,
  replay,
}: {
  tour: TourId;
  participantId: string;
  ready: boolean;
  replay: number;
}) {
  const log = useStudyLog();
  const active = useRef<Driver | null>(null);

  const start = useCallback(() => {
    const steps = TOURS[tour].filter((s) => document.querySelector(s.element));
    if (steps.length === 0) return;
    active.current?.destroy();
    log("tour_started", { tour });
    const tourDriver = driver({
      showProgress: true,
      allowClose: true,
      steps: steps.map((s) => ({
        element: s.element,
        popover: { title: s.title, description: s.description, side: s.side },
      })),
      onHighlighted: (_element, step, { state }) =>
        log("tour_step", {
          tour,
          step: state.activeIndex ?? null,
          title: step.popover?.title ?? null,
        }),
      onDestroyed: (_element, _step, { state }) => {
        log("tour_closed", { tour, lastStep: state.activeIndex ?? null });
        if (active.current === tourDriver) active.current = null;
      },
    });
    active.current = tourDriver;
    tourDriver.drive();
  }, [tour, log]);

  // The overlay lives on <body>: close it when the view goes away (e.g.
  // the facilitator moves the room on mid-tour), or it would block clicks.
  useEffect(() => () => active.current?.destroy(), []);

  // First time this participant sees the phase
  useEffect(() => {
    if (!ready) return;
    if (!markSeen(seenKey(participantId, tour))) return;
    const timer = setTimeout(start, 700);
    return () => clearTimeout(timer);
  }, [ready, participantId, tour, start]);

  // Replays requested from the phase bar
  const lastReplay = useRef(replay);
  useEffect(() => {
    if (replay === lastReplay.current) return;
    lastReplay.current = replay;
    if (ready) start();
  }, [replay, ready, start]);
}
