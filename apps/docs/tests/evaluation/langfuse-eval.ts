/**
 * Langfuse integration for evaluation scripts.
 *
 * Creates traces and generations for each LLM call so results
 * appear in the Langfuse dashboard with structured tags for filtering.
 *
 * Env vars (loaded from .env.local via @next/env):
 *   LANGFUSE_SECRET_KEY
 *   LANGFUSE_PUBLIC_KEY
 *   LANGFUSE_BASE_URL
 */

import Langfuse from "langfuse";

let _instance: Langfuse | null = null;

function getInstance(): Langfuse | null {
  if (_instance) return _instance;

  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL;

  if (!secretKey || !publicKey) {
    console.warn("[langfuse] Missing LANGFUSE_SECRET_KEY or LANGFUSE_PUBLIC_KEY — tracing disabled");
    return null;
  }

  _instance = new Langfuse({ secretKey, publicKey, baseUrl });
  return _instance;
}

export interface EvalTraceContext {
  /** Run ID for session grouping, e.g. "olsen-run-20260329_1400" */
  runId: string;
  /** e.g. "scoring", "limitation", "baseline" */
  callType: string;
  /** e.g. "expressive-match" */
  criterion?: string;
  /** e.g. "neutral", "skeptical", "comparative" */
  role?: string;
  /** e.g. "google-forms" */
  baseline?: string;
  /** The LLM model used */
  model: string;
}

/**
 * Log an LLM call to Langfuse as a generation within a trace.
 * Call this AFTER receiving the response.
 */
export function logEvalGeneration(
  ctx: EvalTraceContext,
  input: string,
  output: string,
  metrics: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  },
  metadata?: {
    score?: number;
    error?: string;
  },
) {
  const langfuse = getInstance();
  if (!langfuse) return;

  const tags = [
    "olsen-eval",
    `olsen:${ctx.callType}`,
    ...(ctx.criterion ? [`criterion:${ctx.criterion}`] : []),
    ...(ctx.role ? [`role:${ctx.role}`] : []),
    ...(ctx.baseline ? [`baseline:${ctx.baseline}`] : []),
  ];

  const name = [
    ctx.criterion,
    ctx.role ? `[${ctx.role}]` : null,
    ctx.baseline ? `vs:${ctx.baseline}` : null,
    ctx.callType === "limitation" ? "(limitations)" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const trace = langfuse.trace({
    name: `olsen:${ctx.callType}`,
    sessionId: ctx.runId,
    tags,
    metadata: {
      callType: ctx.callType,
      criterion: ctx.criterion,
      role: ctx.role,
      baseline: ctx.baseline,
      score: metadata?.score,
    },
  });

  trace.generation({
    name,
    model: ctx.model,
    input,
    output,
    usage: {
      input: metrics.inputTokens,
      output: metrics.outputTokens,
      total: metrics.totalTokens,
    },
    metadata: {
      latencyMs: metrics.latencyMs,
      score: metadata?.score,
      error: metadata?.error,
    },
    ...(metadata?.score != null && metadata.score > 0
      ? {
          statusMessage: `Score: ${metadata.score}/5`,
        }
      : {}),
    ...(metadata?.error
      ? {
          level: "ERROR" as const,
          statusMessage: metadata.error,
        }
      : {}),
  });
}

/**
 * Flush all pending Langfuse events. Call at the end of the run.
 */
export async function flushLangfuse() {
  const langfuse = getInstance();
  if (!langfuse) return;
  await langfuse.flushAsync();
}
