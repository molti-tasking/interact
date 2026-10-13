"use client";

import {
  reviseWidgetAction,
  suggestDashboardAction,
} from "@/app/actions/dashboard-actions";
import { commitPortfolioChange } from "@/lib/engine/commit";
import {
  describeDashboardChanges,
  mergeDashboard,
} from "@/lib/engine/dashboard";
import type { DashboardSpec, DashboardWidget, Portfolio } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyCommitToCache } from "./portfolios";

/**
 * Suggest a dashboard from the intent and save it — once: if a dashboard
 * was saved meanwhile (another tab, the creator), that one is kept.
 * Resolves to null when nothing was saved.
 */
export function useSuggestDashboard(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      portfolio,
      responseCount,
    }: {
      portfolio: Portfolio;
      responseCount: number;
    }) =>
      trackActivity(portfolioId, "Suggesting a dashboard", async () => {
        const response = await suggestDashboardAction({
          intent: portfolio.intent,
          schema: portfolio.schema,
          responseCount,
        });
        if (!response.success || !response.widgets?.length) {
          throw new Error(response.error ?? "No dashboard was suggested");
        }
        const widgets = response.widgets;
        return commitPortfolioChange(portfolioId, (current) =>
          current.schema.dashboard
            ? null
            : {
                schema: {
                  ...current.schema,
                  dashboard: { widgets, suggestedAt: new Date().toISOString() },
                },
                provenance: {
                  layer: "configuration",
                  action: "dashboard_suggested",
                  actor: "system",
                  rationale: `Suggested a response dashboard: ${widgets.map((w) => `"${w.title}"`).join(", ")}`,
                },
              },
        );
      }),
    onSuccess: (commit) => applyCommitToCache(queryClient, commit),
  });
}

/**
 * Save an edited dashboard. The edit started from `base`; it's merged by
 * widget onto whatever is saved now, so a concurrent edit isn't lost.
 */
export function useSaveDashboard(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      base,
      next,
      actor,
    }: {
      base: DashboardSpec | undefined;
      next: DashboardSpec;
      actor: string;
    }) =>
      commitPortfolioChange(portfolioId, (current) => {
        const saved = current.schema.dashboard;
        const merged = mergeDashboard(base, next, saved);
        return {
          schema: {
            ...current.schema,
            dashboard: { ...merged, updatedAt: new Date().toISOString() },
          },
          provenance: {
            layer: "configuration",
            action: "dashboard_updated",
            actor,
            rationale: describeDashboardChanges(saved, merged),
          },
        };
      }),
    onSuccess: (commit) => applyCommitToCache(queryClient, commit),
  });
}

/** Ask the AI to change a widget (or describe a new one). Nothing is saved. */
export function useReviseWidget(portfolioId: string) {
  return useMutation({
    mutationFn: async ({
      portfolio,
      widget,
      instruction,
    }: {
      portfolio: Portfolio;
      widget?: DashboardWidget;
      instruction: string;
    }): Promise<DashboardWidget> =>
      trackActivity(
        portfolioId,
        widget ? "Changing a chart" : "Adding a chart",
        async () => {
          const response = await reviseWidgetAction({
            intent: portfolio.intent,
            schema: portfolio.schema,
            widget,
            instruction,
          });
          if (!response.success || !response.widget) {
            throw new Error(response.error ?? "Couldn't make that chart");
          }
          return response.widget;
        },
      ),
  });
}
