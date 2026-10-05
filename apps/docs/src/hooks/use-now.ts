"use client";

import { useEffect, useState } from "react";

/**
 * Current time in ms, refreshed every `intervalMs` — for relative
 * timestamps ("5 minutes ago") without calling Date.now() during render.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
