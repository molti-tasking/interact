/**
 * Olsen Criteria LLM Judge
 *
 * Evaluates the system against Olsen's UI systems evaluation criteria
 * using multiple LLM models × multiple judge roles for adversarial reliability.
 *
 * Architecture:
 *   10 models × 3 roles (neutral, skeptical, comparative) = 30 evaluations
 *   + limitation pass (what prevents a 5?)
 *   + baseline comparison (Google Forms, Airtable)
 */

import { logEvalGeneration } from "./langfuse-eval";
import {
  buildLimitationPrompt,
  buildOlsenJudgingPrompt,
  JUDGE_ROLES,
  olsenCriteria,
  type JudgeRole,
  type OlsenCriterion,
} from "./olsen-rubric";
import {
  AIRTABLE_DESCRIPTION,
  GOOGLE_FORMS_DESCRIPTION,
  SYSTEM_DESCRIPTION,
} from "./olsen-system-description";

// ---------------------------------------------------------------------------
// Judge model pool
// ---------------------------------------------------------------------------

export const JUDGE_MODELS = [
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5-20251001",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/o3-mini",
  "gemini/gemini-2.5-pro",
  "gemini/gemini-2.5-flash",
  "mistral/mistral-large-latest",
  "deepseek/deepseek-chat",
  "meta-llama/llama-4-maverick",
];

export const BASELINES = [
  { id: "google-forms", name: "Google Forms", description: GOOGLE_FORMS_DESCRIPTION },
  { id: "airtable", name: "Airtable", description: AIRTABLE_DESCRIPTION },
];

// Env vars read lazily so .env is loaded first
const judgeEnv = () => ({
  JUDGE_HOST:
    process.env.EVAL_JUDGE_HOST ??
    process.env.LLM_HOST ??
    "http://localhost:4000/v1",
  JUDGE_KEY: process.env.EVAL_JUDGE_KEY ?? process.env.LLM_API_KEY ?? "",
});

/**
 * Unique run ID for Langfuse session grouping.
 * Set via setLangfuseRunId() before starting evaluations.
 */
let _langfuseRunId = `olsen-${Date.now()}`;
export function setLangfuseRunId(id: string) { _langfuseRunId = id; }
export function getLangfuseRunId() { return _langfuseRunId; }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMCallMetrics {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface OlsenDimensionScore {
  criterionId: string;
  criterionName: string;
  score: number;
  observations: string[];
  justification: string;
  limitations?: string[];
  rawResponse?: string;
  error?: string;
  metrics?: LLMCallMetrics;
  limitationMetrics?: LLMCallMetrics;
}

export interface OlsenScores {
  model: string;
  role: JudgeRole;
  criteria: OlsenDimensionScore[];
}

export interface BaselineScores {
  baselineId: string;
  baselineName: string;
  model: string;
  criteria: OlsenDimensionScore[];
}

// ---------------------------------------------------------------------------
// LLM call helper
// ---------------------------------------------------------------------------

interface TraceContext {
  callType: string;
  criterion?: string;
  role?: string;
  baseline?: string;
}

type CallResult =
  | { parsed: Record<string, unknown>; raw: string; metrics: LLMCallMetrics }
  | { error: string; raw: string; metrics?: LLMCallMetrics };

async function callLLM(
  model: string,
  prompt: string,
  label: string,
  trace?: TraceContext,
): Promise<CallResult> {
  const { JUDGE_HOST, JUDGE_KEY } = judgeEnv();
  const startTime = Date.now();

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
        ...(model.includes("/o3") || model.includes("/o1")
          ? {}
          : { temperature: 0.1 }),
        max_tokens:
          model.includes("/o3") ||
          model.includes("/o1") ||
          model.includes("gemini")
            ? 4096
            : 1200,
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const errorMsg = `HTTP ${response.status}: ${body.slice(0, 300)}`;
      console.error(`  [${model}] ERROR ${label}: ${errorMsg}`);
      return { error: errorMsg, raw: body.slice(0, 500), metrics: { latencyMs, inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    }

    const data = await response.json();

    // Extract token usage from OpenAI-compatible response
    const usage = data.usage ?? {};
    const metrics: LLMCallMetrics = {
      latencyMs,
      inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    };

    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

    if (!raw) {
      console.error(`  [${model}] ERROR ${label}: Empty response`);
      return { error: "Empty response from LLM", raw: JSON.stringify(data).slice(0, 500), metrics };
    }

    const stripped = raw
      .replace(/^```(?:json)?\s*\n?/m, "")
      .replace(/\n?```\s*$/m, "");
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`  [${model}] PARSE ERROR ${label}: No JSON in "${raw.slice(0, 150)}"`);
      return { error: `No JSON found in response`, raw: raw.slice(0, 500), metrics };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return { parsed, raw: raw.slice(0, 1000), metrics };
  } catch (err) {
    const errorMsg = `Fetch error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`  [${model}] FATAL ${label}: ${errorMsg}`);
    return { error: errorMsg, raw: "", metrics: { latencyMs: Date.now() - startTime, inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Single criterion judgment
// ---------------------------------------------------------------------------

async function judgeCriterion(
  criterion: OlsenCriterion,
  model: string,
  role: JudgeRole,
): Promise<OlsenDimensionScore> {
  const prompt = buildOlsenJudgingPrompt(criterion, SYSTEM_DESCRIPTION, role);
  const roleLabel = JUDGE_ROLES.find((r) => r.id === role)?.name ?? role;

  console.log(`  [${model}] (${roleLabel}) ${criterion.name}...`);

  const traceCtx = { callType: "scoring", criterion: criterion.id, role };
  const result = await callLLM(model, prompt, `${criterion.name} [${role}]`, traceCtx);

  if ("error" in result) {
    logEvalGeneration(
      { runId: _langfuseRunId, model, ...traceCtx },
      prompt, result.raw,
      result.metrics ?? { latencyMs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      { error: result.error },
    );
    return {
      criterionId: criterion.id,
      criterionName: criterion.name,
      score: -1,
      observations: [],
      justification: "",
      rawResponse: result.raw,
      error: result.error,
      metrics: result.metrics,
    };
  }

  const { parsed, raw, metrics } = result;

  if (typeof parsed.score !== "number" || parsed.score < 1 || parsed.score > 5) {
    console.warn(`  [${model}] WARNING ${criterion.name}: score=${parsed.score} (clamping)`);
  }

  const score = Math.min(5, Math.max(1, Math.round(parsed.score as number)));
  console.log(`  [${model}] (${role}) ${criterion.name} = ${score}/5 (${metrics.latencyMs}ms, ${metrics.inputTokens}+${metrics.outputTokens} tokens)`);

  logEvalGeneration(
    { runId: _langfuseRunId, model, ...traceCtx },
    prompt, raw, metrics, { score },
  );

  return {
    criterionId: criterion.id,
    criterionName: criterion.name,
    score,
    observations: Array.isArray(parsed.observations) ? parsed.observations as string[] : [],
    justification: (parsed.justification as string) ?? "",
    rawResponse: raw,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Limitation pass
// ---------------------------------------------------------------------------

async function getLimitations(
  criterion: OlsenCriterion,
  model: string,
  score: number,
): Promise<{ limitations: string[]; metrics?: LLMCallMetrics }> {
  const prompt = buildLimitationPrompt(criterion, SYSTEM_DESCRIPTION, score);

  console.log(`  [${model}] Limitations for ${criterion.name} (scored ${score})...`);

  const traceCtx = { callType: "limitation", criterion: criterion.id };
  const result = await callLLM(model, prompt, `limitations:${criterion.name}`, traceCtx);

  if ("error" in result) {
    logEvalGeneration(
      { runId: _langfuseRunId, model, ...traceCtx },
      prompt, result.raw,
      result.metrics ?? { latencyMs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      { error: result.error },
    );
    return { limitations: [], metrics: result.metrics };
  }

  logEvalGeneration(
    { runId: _langfuseRunId, model, ...traceCtx },
    prompt, result.raw, result.metrics,
  );

  const limitations = result.parsed.limitations;
  return {
    limitations: Array.isArray(limitations) ? limitations as string[] : [],
    metrics: result.metrics,
  };
}

// ---------------------------------------------------------------------------
// Baseline judgment
// ---------------------------------------------------------------------------

async function judgeBaseline(
  criterion: OlsenCriterion,
  model: string,
  baseline: { id: string; name: string; description: string },
): Promise<OlsenDimensionScore> {
  // Use the exact same prompt template as the main evaluation, just with a different system name + description
  const prompt = buildOlsenJudgingPrompt(criterion, baseline.description, "neutral", baseline.name);

  console.log(`  [${model}] Baseline: ${baseline.name} × ${criterion.name}...`);

  const traceCtx = { callType: "baseline", criterion: criterion.id, baseline: baseline.id };
  const result = await callLLM(model, prompt, `baseline:${baseline.name}:${criterion.name}`, traceCtx);

  if ("error" in result) {
    logEvalGeneration(
      { runId: _langfuseRunId, model, ...traceCtx },
      prompt, result.raw,
      result.metrics ?? { latencyMs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      { error: result.error },
    );
    return {
      criterionId: criterion.id,
      criterionName: criterion.name,
      score: -1,
      observations: [],
      justification: "",
      rawResponse: result.raw,
      error: result.error,
      metrics: result.metrics,
    };
  }

  const { parsed, raw, metrics } = result;
  const score = Math.min(5, Math.max(1, Math.round(parsed.score as number)));
  console.log(`  [${model}] ${baseline.name} × ${criterion.name} = ${score}/5 (${metrics.latencyMs}ms)`);

  logEvalGeneration(
    { runId: _langfuseRunId, model, ...traceCtx },
    prompt, raw, metrics, { score },
  );

  return {
    criterionId: criterion.id,
    criterionName: criterion.name,
    score,
    observations: Array.isArray(parsed.observations) ? parsed.observations as string[] : [],
    justification: (parsed.justification as string) ?? "",
    rawResponse: raw,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Full evaluation for one model + role
// ---------------------------------------------------------------------------

export async function judgeOlsenWithModel(
  model: string,
  role: JudgeRole,
): Promise<OlsenScores> {
  const { JUDGE_HOST } = judgeEnv();
  const roleLabel = JUDGE_ROLES.find((r) => r.id === role)?.name ?? role;
  console.log(`\n  ${model} [${roleLabel}] → ${JUDGE_HOST}`);

  // Score all 4 criteria in parallel
  const criteria = await Promise.all(
    olsenCriteria.map((c) => judgeCriterion(c, model, role)),
  );

  // Limitation pass: for each scored criterion, ask what prevents a 5
  for (const dim of criteria) {
    if (dim.score > 0) {
      const limResult = await getLimitations(
        olsenCriteria.find((c) => c.id === dim.criterionId)!,
        model,
        dim.score,
      );
      dim.limitations = limResult.limitations;
      dim.limitationMetrics = limResult.metrics;
    }
  }

  const succeeded = criteria.filter((c) => c.score > 0).length;
  const failed = criteria.filter((c) => c.score <= 0).length;
  console.log(`  ${model} [${role}]: ${succeeded} scored, ${failed} failed`);

  return { model, role, criteria };
}

/**
 * Run baseline evaluation for one model (all criteria for each baseline).
 */
export async function judgeBaselines(
  model: string,
): Promise<BaselineScores[]> {
  const results: BaselineScores[] = [];

  for (const baseline of BASELINES) {
    console.log(`\n  ${model} evaluating baseline: ${baseline.name}`);
    const criteria = await Promise.all(
      olsenCriteria.map((c) => judgeBaseline(c, model, baseline)),
    );
    results.push({
      baselineId: baseline.id,
      baselineName: baseline.name,
      model,
      criteria,
    });
  }

  return results;
}
