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
    const startedAt = Date.now();
    // A one-step tour that asks for a click into what it highlights: no
    // buttons, no closing; the first click there ends it and goes nowhere
    // else (in the questions deck it could otherwise apply an answer)
    const clickToContinue = steps.length === 1 && !!steps[0].clickToContinue;
    const target = clickToContinue ? document.querySelector(steps[0].element) : null;
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onTargetClick = (e: Event) => {
      swallow(e);
      log("tour_closed", { tour, lastStep: 0, reason: "clicked", ms: Date.now() - startedAt });
      tourDriver.destroy();
    };
    const release = () => {
      target?.removeEventListener("pointerdown", swallow, true);
      target?.removeEventListener("mousedown", swallow, true);
      target?.removeEventListener("click", onTargetClick, true);
    };
    const tourDriver = driver({
      showProgress: !clickToContinue,
      allowClose: !clickToContinue,
      // driver.js shows every button for an empty list; "close" alone,
      // with closing off, shows none. No arrow keys either (→ would end it)
      ...(clickToContinue ? { showButtons: ["close"], allowKeyboardControl: false } : {}),
      steps: steps.map((s) => ({
        element: s.element,
        popover: { title: s.title, description: s.description, side: s.side },
      })),
      // Logged when a step's text appears. (onHighlighted waits for the
      // highlight animation, and a step left within ~0.4 s never got one.)
      onPopoverRender: (_popover, { state }) =>
        log("tour_step", {
          tour,
          step: state.activeIndex ?? null,
          title: steps[state.activeIndex ?? -1]?.title ?? null,
        }),
      // Every way the tour ends — "Done", ✕, Esc, a click outside — also
      // mid-animation, when driver.js skips onDestroyed. Ending it is then
      // up to us (destroy() doesn't call this hook again).
      onDestroyStarted: (_element, _step, { state, reason }) => {
        log("tour_closed", {
          tour,
          lastStep: state.activeIndex ?? null,
          reason: reason ?? null,
          ms: Date.now() - startedAt,
        });
        tourDriver.destroy();
      },
      onDestroyed: () => {
        release();
        if (active.current === tourDriver) active.current = null;
      },
    });
    active.current = tourDriver;
    if (target) {
      target.addEventListener("pointerdown", swallow, true);
      target.addEventListener("mousedown", swallow, true);
      target.addEventListener("click", onTargetClick, true);
    }
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
