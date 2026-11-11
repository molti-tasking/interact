"use client";

import { pretestIssues, type PretestIssue } from "interact/forms/pretest";
import { callLlm } from "@/lib/llm-client";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { useMutation } from "@tanstack/react-query";

export interface PretestResult {
  /** The form the pretest ran on — issues are only valid for this version */
  schemaVersion: number;
  /** Simulated respondents that came back (fewer than asked when a batch failed) */
  respondents: number;
  requested: number;
  /** Who was simulated, one line each */
  personas: string[];
  issues: PretestIssue[];
}

/**
 * Pretest a draft form with simulated respondents. Their answers stay in
 * memory: they are summarized into issues and never stored as responses.
 */
export function useRunPretest(portfolioId: string) {
  return useMutation({
    mutationFn: async ({
      intent,
      schema,
      count = 12,
    }: {
      intent: StructuredIntent;
      schema: PortfolioSchema;
      count?: number;
    }): Promise<PretestResult> =>
      trackActivity(portfolioId, "Pretesting the form", async () => {
        const response = await callLlm("simulate-respondents", intent, schema, count);
        if (!response.success || !response.respondents) {
          throw new Error(response.error ?? "The pretest failed");
        }
        return {
          schemaVersion: schema.version,
          respondents: response.respondents.length,
          requested: response.requested ?? count,
          personas: response.respondents.map((r) => r.persona),
          issues: pretestIssues(schema, response.respondents),
        };
      }),
  });
}
