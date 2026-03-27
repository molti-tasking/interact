/**
 * Phase 2: CDN Rubric Judging
 *
 * Sends session artifacts to an LLM judge for each CDN dimension.
 * Returns structured scores with evidence citations.
 */

import { cdnDimensions, buildJudgingPrompt, type SessionArtifacts } from "./cdn-rubric";

// Env vars are read lazily so that .env is loaded before access
const judgeEnv = () => ({
  JUDGE_HOST: process.env.EVAL_JUDGE_HOST ?? process.env.LLM_HOST ?? "http://localhost:4000/v1",
  JUDGE_KEY: process.env.EVAL_JUDGE_KEY ?? process.env.LLM_API_KEY ?? "",
  JUDGE_MODEL: process.env.EVAL_JUDGE_MODEL ?? process.env.LLM_MODEL_NAME ?? "default",
});

export interface DimensionScore {
  dimensionId: string;
  dimensionName: string;
  score: number;
  observations: string[];
  justification: string;
}

export interface SessionScores {
  personaId: string;
  scenarioId: string;
  dimensions: DimensionScore[];
}

/**
 * Judge a single session across all 8 CDN dimensions.
 */
export async function judgeSession(
  artifacts: SessionArtifacts,
  personaId: string,
  scenarioId: string,
): Promise<SessionScores> {
  const { JUDGE_HOST, JUDGE_KEY, JUDGE_MODEL } = judgeEnv();

  console.log(`[judge] ${personaId} × ${scenarioId} → ${JUDGE_HOST} (model: ${JUDGE_MODEL})`);

  const judgeDimension = async (dim: (typeof cdnDimensions)[number]): Promise<DimensionScore> => {
    const prompt = buildJudgingPrompt(dim, artifacts);
    console.log(`[judge] ${personaId} × ${scenarioId} — ${dim.name}...`);

    try {
      const response = await fetch(`${JUDGE_HOST}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${JUDGE_KEY}`,
        },
        body: JSON.stringify({
          model: JUDGE_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        console.error(`[judge] LLM error for ${dim.name}: ${response.status}`);
        return {
          dimensionId: dim.id,
          dimensionName: dim.name,
          score: -1,
          observations: ["LLM judge request failed"],
          justification: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);

      console.log(`[judge] ${personaId} × ${scenarioId} — ${dim.name} ✓ score=${parsed.score}`);
      return {
        dimensionId: dim.id,
        dimensionName: dim.name,
        score: Math.min(5, Math.max(1, Math.round(parsed.score))),
        observations: parsed.observations ?? [],
        justification: parsed.justification ?? "",
      };
    } catch (err) {
      console.error(`[judge] Error for ${dim.name}:`, err);
      return {
        dimensionId: dim.id,
        dimensionName: dim.name,
        score: -1,
        observations: ["Failed to parse judge response"],
        justification: String(err),
      };
    }
  };

  // Judge all 8 dimensions in parallel
  const dimensions = await Promise.all(cdnDimensions.map(judgeDimension));

  return { personaId, scenarioId, dimensions };
}
