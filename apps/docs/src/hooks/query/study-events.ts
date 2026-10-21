"use client";

/**
 * Interaction log for workshop sessions (`study_events`, migration 011):
 * what `provenance_log` doesn't capture — views, hovers, skips, timing.
 *
 * Events are buffered and inserted in small batches about a second after
 * they happen; a heartbeat (every 30 s, with page visibility) gives
 * time-on-task and the facilitator's "last seen" — and retries a failed
 * batch. When the page is hidden or closed, the buffer is sent with a
 * `keepalive` request so the last events survive.
 */

import { createClient } from "@/lib/supabase/client";
import type { Json, TablesInsert } from "@/lib/supabase/database.types";
import { useCallback, useEffect, useRef } from "react";

export type StudyLog = (
  type: string,
  payload?: Record<string, unknown>,
  portfolioId?: string | null,
) => void;

export const noopStudyLog: StudyLog = () => {};

/** Batch window: events within it go out in one insert. */
const FLUSH_DELAY_MS = 1_000;
const HEARTBEAT_MS = 30_000;

interface LoggerTarget {
  sessionId: string;
  participantId: string;
  phase: string;
  /** Default `portfolio_id` for events (the participant's own form) */
  portfolioId: string | null;
}

type Row = TablesInsert<"study_events">;

function toRow(
  t: LoggerTarget,
  type: string,
  payload: Record<string, unknown>,
  portfolioId: string | null | undefined,
): Row {
  return {
    session_id: t.sessionId,
    participant_id: t.participantId,
    phase: t.phase,
    type,
    portfolio_id: portfolioId === undefined ? t.portfolioId : portfolioId,
    payload: payload as Json,
    client_at: new Date().toISOString(),
  };
}

/**
 * A `log(type, payload?, portfolioId?)` function bound to a participant.
 * Returns a no-op while `target` is null.
 */
export function useStudyEventLogger(target: LoggerTarget | null): StudyLog {
  const buffer = useRef<Row[]>([]);
  const targetRef = useRef(target);
  const token = useRef<string | null>(null);
  /** Set while the logger runs: send the buffer shortly */
  const flushSoon = useRef<() => void>(() => {});

  useEffect(() => {
    targetRef.current = target;
  });

  const enabled = !!target;

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let stopped = false;

    const refreshToken = async () => {
      const { data } = await supabase.auth.getSession();
      token.current = data.session?.access_token ?? null;
    };

    const flush = async () => {
      if (buffer.current.length === 0) return;
      const rows = buffer.current;
      buffer.current = [];
      const { error } = await supabase.from("study_events").insert(rows);
      if (error) {
        // Keep them for the next attempt (bounded: drop the oldest)
        buffer.current = [...rows, ...buffer.current].slice(-500);
        console.warn("[study-events] insert failed:", error.message);
      }
    };

    // Page hidden/closed: a supabase-js request may be cancelled, a
    // keepalive fetch isn't.
    const flushOnExit = () => {
      if (buffer.current.length === 0 || !token.current) return;
      const rows = buffer.current;
      buffer.current = [];
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!base || !apiKey) return;
      void fetch(`${base}/rest/v1/study_events`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${token.current}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(rows),
      }).catch(() => {});
    };

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    flushSoon.current = () => {
      if (flushTimer || stopped) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void refreshToken().then(flush);
      }, FLUSH_DELAY_MS);
    };

    const push = (type: string, payload: Record<string, unknown>) => {
      const t = targetRef.current;
      if (!t) return;
      buffer.current.push(toRow(t, type, payload, undefined));
      flushSoon.current();
    };

    void refreshToken();
    const heartbeat = setInterval(() => {
      push("heartbeat", { visible: document.visibilityState === "visible" });
    }, HEARTBEAT_MS);
    const onVisibility = () => {
      if (stopped) return;
      push("visibility", { visible: document.visibilityState === "visible" });
      if (document.visibilityState === "hidden") flushOnExit();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushOnExit);

    return () => {
      stopped = true;
      if (flushTimer) clearTimeout(flushTimer);
      flushSoon.current = () => {};
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushOnExit);
      void flush();
    };
  }, [enabled]);

  return useCallback<StudyLog>((type, payload = {}, portfolioId) => {
    const t = targetRef.current;
    if (!t) return;
    buffer.current.push(toRow(t, type, payload, portfolioId));
    flushSoon.current();
  }, []);
}
