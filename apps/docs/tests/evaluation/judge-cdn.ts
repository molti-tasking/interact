/**
 * Phase 2: CDN Rubric Judging
 *
 * Sends session artifacts to an LLM judge for each CDN dimension.
 * Returns structured scores with evidence citations.
 */

import { cdnDimensions, buildJudgingPrompt, type SessionArtifacts } from "./cdn-rubric";

const JUDGE_HOST = process.env.EVAL_JUDGE_HOST ?? process.env.LLM_HOST ?? "http://localhost:4000/v1";
const JUDGE_KEY = process.env.EVAL_JUDGE_KEY ?? process.env.LLM_API_KEY ?? "";
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? process.env.LLM_MODEL_NAME ?? "default";

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
  const dimensions: DimensionScore[] = [];

  for (const dim of cdnDimensions) {
    const prompt = buildJudgingPrompt(dim, artifacts);

    console.log(`[judge] ${personaId} × ${scenarioId} — ${dim.name}...`);

    const response = await fetch(`${JUDGE_HOST}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JUDGE_KEY}`,
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1, // Low temp for consistent judging
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error(`[judge] LLM error for ${dim.name}: ${response.status}`);
      dimensions.push({
        dimensionId: dim.id,
        dimensionName: dim.name,
        score: -1,
        observations: ["LLM judge request failed"],
        justification: `HTTP ${response.status}`,
      });
      continue;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);

      dimensions.push({
        dimensionId: dim.id,
        dimensionName: dim.name,
        score: Math.min(5, Math.max(1, Math.round(parsed.score))),
        observations: parsed.observations ?? [],
        justification: parsed.justification ?? "",
      });
    } catch {
      console.error(`[judge] Parse error for ${dim.name}: ${text.slice(0, 100)}`);
      dimensions.push({
        dimensionId: dim.id,
        dimensionName: dim.name,
        score: -1,
        observations: ["Failed to parse judge response"],
        justification: text.slice(0, 200),
      });
    }

    // Rate limit buffer
    await new Promise((r) => setTimeout(r, 500));
  }

  return { personaId, scenarioId, dimensions };
}
