"use client";

import {
  countThemes,
  themeFinding,
  type Finding,
  type ThemeCandidate,
} from "interact/forms/findings";
import { callLlm } from "@/lib/llm-client";
import { useMutation } from "@tanstack/react-query";

export interface ThemeSearchResult {
  findings: Finding[];
  /** Questions looked at, and those whose request failed */
  searched: number;
  failed: number;
}

/**
 * Look for themes in the answers to the given questions — one request per
 * question, each sending only that question's answers. Runs on demand only:
 * it costs a model call and sends respondents' answers to the model.
 */
export function useFindAnswerThemes() {
  return useMutation({
    mutationFn: async (candidates: readonly ThemeCandidate[]): Promise<ThemeSearchResult> => {
      const results = await Promise.all(
        candidates.map(async (candidate) => {
          const { field } = candidate;
          const response = await callLlm(
            "find-answer-themes",
            {
              name: field.name,
              label: field.label,
              description: field.description,
              type: field.type,
            },
            candidate.answers,
          );
          if (!response.success || !response.assignments) return null;
          // Counts come from the assignment, weighted by how often each
          // answer was given — never from the model
          const themes = countThemes(response.assignments, candidate.weights);
          return { finding: themeFinding(candidate, themes) };
        }),
      );
      const failed = results.filter((r) => r === null).length;
      if (candidates.length > 0 && failed === candidates.length) {
        throw new Error("Couldn't look for themes — please try again.");
      }
      return {
        findings: results.flatMap((r) => (r?.finding ? [r.finding] : [])),
        searched: candidates.length,
        failed,
      };
    },
  });
}
