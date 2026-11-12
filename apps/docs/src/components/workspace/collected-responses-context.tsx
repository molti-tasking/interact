"use client";

import { useCollectedResponses } from "@/hooks/query/responses-new";
import type { FormResponse, PortfolioSchema } from "@/lib/types";
import {
  affectedResponses,
  type ResponseImpact,
} from "interact/forms/response-versions";
import { createContext, useContext, useMemo } from "react";

/**
 * The form's collected responses, so that every preview of a change can say
 * how many of them it affects (I6): answer tiles, conflict fixes and the
 * canvas. Null outside the workspace or while loading — previews then say
 * nothing about responses rather than "0".
 */
const CollectedResponsesContext = createContext<readonly FormResponse[] | null>(
  null,
);

export function CollectedResponsesProvider({
  portfolioId,
  children,
}: {
  portfolioId: string;
  children: React.ReactNode;
}) {
  // Refreshed every 30 s: responses keep arriving while a form is live
  const { data } = useCollectedResponses(portfolioId);
  return (
    <CollectedResponsesContext.Provider value={data ?? null}>
      {children}
    </CollectedResponsesContext.Provider>
  );
}

/**
 * How many collected responses the change from `before` to `after` affects
 * (answers to fields it removes, retypes, relabels or rekeys). Null when the
 * responses aren't known here or there is no change to look at.
 */
export function useResponseImpact(
  before: PortfolioSchema,
  after: PortfolioSchema | null,
): ResponseImpact | null {
  const responses = useContext(CollectedResponsesContext);
  return useMemo(
    () => (responses && after ? affectedResponses(before, after, responses) : null),
    [responses, before, after],
  );
}

/** "affects 40 collected responses" */
export function impactText(responses: number): string {
  return `affects ${responses} collected response${responses === 1 ? "" : "s"}`;
}

/** "Age: 40 answers, Notes: 12 answers" — which fields, for a tooltip */
export function impactDetail(impact: ResponseImpact): string {
  return impact.fields
    .filter((f) => f.answers > 0)
    .map((f) => `${f.label}: ${f.answers} answer${f.answers === 1 ? "" : "s"}`)
    .join(", ");
}
