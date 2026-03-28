/**
 * Olsen Criteria LLM Judge
 *
 * Evaluates the system against Olsen's UI systems evaluation criteria
 * using multiple LLM models as judges for cross-model reliability.
 */

import {
  olsenCriteria,
  buildOlsenJudgingPrompt,
  type OlsenCriterion,
} from "./olsen-rubric";
import { SYSTEM_DESCRIPTION } from "./olsen-system-description";

// ---------------------------------------------------------------------------
// Judge model pool — each model judges all criteria independently
// ---------------------------------------------------------------------------

export const JUDGE_MODELS = [
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5-20251001",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/o3-mini",
  "gemini/gemini-2.5-pro",
  "gemini/gemini-2.5-flash",
  "deepseek/deepseek-chat",
  "meta-llama/llama-4-maverick",
  "mistral/mistral-large-latest",
];

// Env vars read lazily so .env is loaded first
const judgeEnv = () => ({
  JUDGE_HOST:
    process.env.EVAL_JUDGE_HOST ??
    process.env.LLM_HOST ??
    "http://localhost:4000/v1",
  JUDGE_KEY:
    process.env.EVAL_JUDGE_KEY ?? process.env.LLM_API_KEY ?? "",
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OlsenDimensionScore {
  criterionId: string;
  criterionName: string;
  score: number;
  observations: string[];
  justification: string;
  /** Raw LLM response text (for debugging) */
  rawResponse?: string;
  /** Error details if the call failed */
  error?: string;
}

export interface OlsenScores {
  model: string;
  criteria: OlsenDimensionScore[];
}

// ---------------------------------------------------------------------------
// Single criterion judgment
// ---------------------------------------------------------------------------

async function judgeCriterion(
  criterion: OlsenCriterion,
  model: string,
): Promise<OlsenDimensionScore> {
  const { JUDGE_HOST, JUDGE_KEY } = judgeEnv();
  const prompt = buildOlsenJudgingPrompt(criterion, SYSTEM_DESCRIPTION);

  console.log(`  [${model}] ${criterion.name}...`);

  let rawResponse = "";
  try {
    const response = await fetch(`${JUDGE_HOST}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JUDGE_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        // O-series models (o1, o3) don't support temperature
        ...(model.includes("/o3") || model.includes("/o1") ? {} : { temperature: 0.1 }),
        // O-series need higher token budget (reasoning tokens count against max_tokens)
        max_tokens: model.includes("/o3") || model.includes("/o1") ? 4096 : 800,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const errorMsg = `HTTP ${response.status}: ${body.slice(0, 300)}`;
      console.error(`  [${model}] ERROR ${criterion.name}: ${errorMsg}`);
      return {
        criterionId: criterion.id,
        criterionName: criterion.name,
        score: -1,
        observations: [],
        justification: "",
        rawResponse: body.slice(0, 500),
        error: errorMsg,
      };
    }

    const data = await response.json();
    rawResponse = data.choices?.[0]?.message?.content?.trim() ?? "";

    if (!rawResponse) {
      const errorMsg = "Empty response from LLM";
      console.error(`  [${model}] ERROR ${criterion.name}: ${errorMsg}`);
      console.error(`  [${model}] Full API response: ${JSON.stringify(data).slice(0, 300)}`);
      return {
        criterionId: criterion.id,
        criterionName: criterion.name,
        score: -1,
        observations: [],
        justification: "",
        rawResponse: JSON.stringify(data).slice(0, 500),
        error: errorMsg,
      };
    }

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const errorMsg = `No JSON found in response: "${rawResponse.slice(0, 200)}"`;
      console.error(`  [${model}] PARSE ERROR ${criterion.name}: ${errorMsg}`);
      return {
        criterionId: criterion.id,
        criterionName: criterion.name,
        score: -1,
        observations: [],
        justification: "",
        rawResponse: rawResponse.slice(0, 500),
        error: errorMsg,
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      const errorMsg = `JSON parse failed: ${parseErr}. Raw: "${jsonMatch[0].slice(0, 200)}"`;
      console.error(`  [${model}] PARSE ERROR ${criterion.name}: ${errorMsg}`);
      return {
        criterionId: criterion.id,
        criterionName: criterion.name,
        score: -1,
        observations: [],
        justification: "",
        rawResponse: rawResponse.slice(0, 500),
        error: errorMsg,
      };
    }

    if (typeof parsed.score !== "number" || parsed.score < 1 || parsed.score > 5) {
      console.warn(
        `  [${model}] WARNING ${criterion.name}: score=${parsed.score} (clamping to 1-5)`,
      );
    }

    const score = Math.min(5, Math.max(1, Math.round(parsed.score)));
    console.log(`  [${model}] ${criterion.name} = ${score}/5`);

    return {
      criterionId: criterion.id,
      criterionName: criterion.name,
      score,
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      justification: parsed.justification ?? "",
      rawResponse: rawResponse.slice(0, 1000),
    };
  } catch (err) {
    const errorMsg = `Fetch error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`  [${model}] FATAL ${criterion.name}: ${errorMsg}`);
    return {
      criterionId: criterion.id,
      criterionName: criterion.name,
      score: -1,
      observations: [],
      justification: "",
      rawResponse: rawResponse.slice(0, 500),
      error: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// Full evaluation for one model
// ---------------------------------------------------------------------------

/**
 * Run one model's evaluation of all 4 Olsen criteria (in parallel).
 */
export async function judgeOlsenWithModel(model: string): Promise<OlsenScores> {
  const { JUDGE_HOST } = judgeEnv();
  console.log(`\n🤖 ${model} → ${JUDGE_HOST}`);

  const criteria = await Promise.all(
    olsenCriteria.map((c) => judgeCriterion(c, model)),
  );

  const succeeded = criteria.filter((c) => c.score > 0).length;
  const failed = criteria.filter((c) => c.score <= 0).length;
  console.log(`  ${model}: ${succeeded} scored, ${failed} failed`);

  return { model, criteria };
}
