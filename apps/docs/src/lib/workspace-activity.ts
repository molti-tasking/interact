"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/**
 * Workspace-wide registry of in-flight AI operations (probe resolution,
 * schema generation, conflict fixes, voice edits, …) so the UI can show a
 * single "AI is working" state instead of per-widget spinners that leave the
 * rest of the workspace looking idle.
 */

interface Activity {
  id: number;
  portfolioId: string;
  label: string;
}

interface WorkspaceActivityState {
  activities: Activity[];
  start: (portfolioId: string, label: string) => number;
  end: (id: number) => void;
}

let nextId = 1;

export const useWorkspaceActivityStore = create<WorkspaceActivityState>(
  (set) => ({
    activities: [],
    start: (portfolioId, label) => {
      const id = nextId++;
      set((s) => ({ activities: [...s.activities, { id, portfolioId, label }] }));
      return id;
    },
    end: (id) =>
      set((s) => ({ activities: s.activities.filter((a) => a.id !== id) })),
  }),
);

/** Run `work` while it is registered as an AI activity for `portfolioId`. */
export async function trackActivity<T>(
  portfolioId: string,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const { start, end } = useWorkspaceActivityStore.getState();
  const id = start(portfolioId, label);
  try {
    return await work();
  } finally {
    end(id);
  }
}

/** Labels of the AI operations currently running for a portfolio. */
export function usePortfolioActivity(portfolioId: string | undefined): string[] {
  return useWorkspaceActivityStore(
    useShallow((s) =>
      s.activities
        .filter((a) => a.portfolioId === portfolioId)
        .map((a) => a.label),
    ),
  );
}
