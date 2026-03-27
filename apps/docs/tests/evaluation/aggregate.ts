/**
 * Phase 3: Results Aggregation
 *
 * Computes mean scores and generates LaTeX table for the paper.
 */

import { cdnDimensions } from "./cdn-rubric";
import type { SessionScores } from "./judge-cdn";
import type { Scenario } from "./personas";

export interface AggregatedResults {
  /** scenarioId → dimensionId → mean score */
  table: Record<string, Record<string, number>>;
  /** Raw per-persona scores for reproducibility */
  raw: SessionScores[];
}

/**
 * Aggregate per-persona scores into mean scores per scenario × dimension.
 */
export function aggregateScores(
  allScores: SessionScores[],
  scenarios: Scenario[],
): AggregatedResults {
  const table: Record<string, Record<string, number>> = {};

  for (const scenario of scenarios) {
    table[scenario.id] = {};

    for (const dim of cdnDimensions) {
      const relevant = allScores
        .filter((s) => s.scenarioId === scenario.id)
        .flatMap((s) => s.dimensions)
        .filter((d) => d.dimensionId === dim.id && d.score > 0);

      if (relevant.length === 0) {
        table[scenario.id][dim.id] = -1;
      } else {
        const mean =
          relevant.reduce((sum, d) => sum + d.score, 0) / relevant.length;
        table[scenario.id][dim.id] = Math.round(mean * 10) / 10; // 1 decimal
      }
    }
  }

  return { table, raw: allScores };
}
