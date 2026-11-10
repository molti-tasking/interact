/**
 * Roll case results up into the numbers worth watching, and compare two
 * runs. Pure — no model, no files.
 */

import { mean, percentile, share } from "interact/forms/replay-metrics";
import type { CaseResult } from "./execute";

export interface RunMeta {
  startedAt: string;
  model: string;
  fastModel: string;
  dataset: string;
  cases: number;
  offline: boolean;
  /** `git rev-parse --short HEAD` (+ "-dirty"), when available */
  revision?: string;
}

export interface RunSummary {
  meta: RunMeta;
  /** Group (operation, or operation/strategy) → metric → value */
  groups: Record<string, Record<string, number>>;
}

export interface RunFile extends RunSummary {
  results: CaseResult[];
}

const sum = (results: CaseResult[], key: string) =>
  results.reduce((total, r) => total + (r.metrics[key] ?? 0), 0);

function costMetrics(all: CaseResult[]): Record<string, number> {
  const calls = all.flatMap((r) => r.calls);
  if (calls.length === 0) return {};
  return {
    "case latency p50 (s)": percentile(all.map((r) => r.ms), 50) / 1000,
    "case latency p95 (s)": percentile(all.map((r) => r.ms), 95) / 1000,
    "call latency p50 (s)": percentile(calls.map((c) => c.ms), 50) / 1000,
    "call latency p95 (s)": percentile(calls.map((c) => c.ms), 95) / 1000,
    "LLM calls per case": share(calls.length, all.length),
    "output tokens per call": mean(calls.map((c) => c.outputTokens)),
    "input tokens per call": mean(calls.map((c) => c.inputTokens)),
    "cached input share": share(
      calls.reduce((a, c) => a + c.cachedInputTokens, 0),
      calls.reduce((a, c) => a + c.inputTokens, 0),
    ),
  };
}

function patchMetrics(ok: CaseResult[]): Record<string, number> {
  const ops = sum(ok, "ops");
  const expected = ok.filter((r) => r.metrics.hasExpectation);
  return {
    "patch ops": ops,
    "skipped op share": share(sum(ok, "skippedUnknown") + sum(ok, "skippedLocked"), ops),
    "ops on locked fields": sum(ok, "skippedLocked"),
    "cases changing unmentioned properties": share(
      ok.filter((r) => r.metrics.unmentionedFields > 0).length,
      ok.length,
    ),
    ...(expected.length
      ? {
          "cases with expectations": expected.length,
          "cases with unwanted changes": share(
            expected.filter((r) => r.metrics.unwantedFields > 0).length,
            expected.length,
          ),
        }
      : {}),
  };
}

function purposeMetrics(ok: CaseResult[]): Record<string, number> {
  const changed = ok.filter((r) => r.metrics.purposeChanged);
  const expectedUnchanged = ok.filter((r) => r.metrics.purposeExpectedUnchanged);
  return {
    "purpose changed": share(changed.length, ok.length),
    "purpose kept verbatim": share(sum(ok, "purposePreserved"), ok.length),
    "purpose sentences lost": sum(ok, "purposeLost"),
    "purpose growth per edit (chars)": mean(changed.map((r) => r.metrics.purposeGrownBy)),
    ...(expectedUnchanged.length
      ? {
          "purpose changed against expectation": share(
            sum(expectedUnchanged, "purposeUnwantedChange"),
            expectedUnchanged.length,
          ),
        }
      : {}),
  };
}

function groupMetrics(group: string, all: CaseResult[]): Record<string, number> {
  const ok = all.filter((r) => r.ok);
  const base: Record<string, number> = {
    cases: all.length,
    failed: all.length - ok.length,
  };
  const op = group.split("/")[0];

  if (op === "preview-probe-options") {
    const previews = sum(ok, "previews");
    const ops = sum(ok, "ops");
    const replayed = sum(ok, "replayed");
    const recorded = sum(all, "recordedAnswers");
    const recordedScoped = sum(all, "recordedScoped");
    Object.assign(base, {
      // Nothing was asked of the model in an offline run
      ...(sum(ok, "options")
        ? {
            "options with a preview": share(previews, sum(ok, "options")),
            "patch ops": ops,
            "skipped op share": share(sum(ok, "skippedUnknown") + sum(ok, "skippedLocked"), ops),
            "options changing unmentioned properties": share(sum(ok, "optionsUnmentioned"), previews),
            "options changing fields their summary doesn't name": share(
              sum(ok, "optionsBeyondSummary"),
              sum(ok, "optionsChanging"),
            ),
          }
        : {}),
      ...(replayed
        ? {
            "previews replayed on a later form": replayed,
            "replays spilling without scoping": share(sum(ok, "unscopedSpillOptions"), replayed),
            "replays spilling with scoping": share(sum(ok, "scopedSpillOptions"), replayed),
            "ops dropped by scoping": sum(ok, "droppedOps"),
          }
        : {}),
      ...(recorded
        ? {
            "recorded answers": recorded,
            "recorded answers overwriting a field by add": share(
              sum(all, "recordedAddOverwrites"),
              recorded,
            ),
          }
        : {}),
      ...(recordedScoped
        ? {
            "recorded answers spilling without scoping": share(
              sum(all, "recordedUnscopedSpill"),
              recordedScoped,
            ),
            "recorded answers spilling with scoping": share(
              sum(all, "recordedScopedSpill"),
              recordedScoped,
            ),
          }
        : {}),
    });
  } else if (op === "resolve-probe") {
    Object.assign(base, patchMetrics(ok), purposeMetrics(ok));
  } else if (op === "refine-schema") {
    Object.assign(base, patchMetrics(ok));
  } else if (op === "sync-intent") {
    Object.assign(base, purposeMetrics(ok));
  } else if (op === "generate-probes") {
    Object.assign(base, {
      "probes per case": mean(ok.map((r) => r.metrics.probes)),
      "probes with ready previews": mean(ok.map((r) => r.metrics.readyPreviewShare)),
    });
    if (group.endsWith("/committee")) {
      const ran = ok.filter((r) => (r.metrics.drafts ?? 0) >= 2);
      Object.assign(base, {
        "fell back to prompted": share(sum(ok, "fellBack"), ok.length),
        "drafts per case": mean(ok.map((r) => r.metrics.drafts ?? 0)),
        "disagreement ops per case": mean(ran.map((r) => r.metrics.committeeOps)),
        "mean vote entropy (bits)": mean(ran.map((r) => r.metrics.committeeMeanEntropy)),
        "unanimous ops per case": mean(ran.map((r) => r.metrics.committeeUnanimousOps)),
      });
    }
  }
  return { ...base, ...costMetrics(all) };
}

export function groupOf(result: Pick<CaseResult, "op" | "variant">): string {
  return result.variant ? `${result.op}/${result.variant}` : result.op;
}

export function summarize(meta: RunMeta, results: CaseResult[]): RunSummary {
  const byGroup = new Map<string, CaseResult[]>();
  for (const r of results) {
    const key = groupOf(r);
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }
  const groups: RunSummary["groups"] = {};
  for (const [group, all] of [...byGroup].sort(([a], [b]) => a.localeCompare(b))) {
    groups[group] = groupMetrics(group, all);
  }
  const calls = results.flatMap((r) => r.calls);
  groups.total = {
    cases: results.length,
    failed: results.filter((r) => !r.ok).length,
    "LLM calls": calls.length,
    "input tokens": calls.reduce((a, c) => a + c.inputTokens, 0),
    "output tokens": calls.reduce((a, c) => a + c.outputTokens, 0),
  };
  return { meta, groups };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Metrics where a higher value is the good direction; all others: lower. */
const HIGHER_IS_BETTER = new Set([
  "options with a preview",
  "purpose kept verbatim",
  "probes with ready previews",
  "cached input share",
  "mean vote entropy (bits)",
]);
/** Sizes of the run, not qualities of it */
const NEUTRAL = new Set([
  "cases",
  "patch ops",
  "cases with expectations",
  "previews replayed on a later form",
  "recorded answers",
  "probes per case",
  "drafts per case",
  "disagreement ops per case",
  "unanimous ops per case",
  "purpose changed",
  "purpose growth per edit (chars)",
  "LLM calls",
  "LLM calls per case",
  "input tokens",
  "output tokens",
  "input tokens per call",
  "ops dropped by scoping",
]);

const isShare = (name: string, value: number) =>
  value >= 0 &&
  value <= 1 &&
  /share|with a preview|changing|spilling|verbatim|unwanted|against expectation|fell back|ready previews|overwriting|^purpose changed$/.test(
    name,
  );

export function formatValue(name: string, value: number): string {
  if (isShare(name, value)) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDelta(name: string, now: number, before: number | undefined): string {
  if (before === undefined) return "";
  const delta = now - before;
  if (Math.abs(delta) < 1e-9) return "=";
  const sign = delta > 0 ? "+" : "−";
  const size = isShare(name, now) && isShare(name, before)
    ? `${(Math.abs(delta) * 100).toFixed(1)} pt`
    : formatValue(name, Math.abs(delta));
  if (NEUTRAL.has(name)) return `${sign}${size}`;
  const better = HIGHER_IS_BETTER.has(name) ? delta > 0 : delta < 0;
  return `${sign}${size} (${better ? "better" : "worse"})`;
}

export function renderMarkdown(current: RunSummary, previous?: RunSummary | null): string {
  const { meta } = current;
  const lines = [
    "# Replay run",
    "",
    `- Started: ${meta.startedAt}`,
    `- Model: ${meta.model}${meta.fastModel !== meta.model ? ` (fast: ${meta.fastModel})` : ""}`,
    `- Dataset: ${meta.dataset} — ${meta.cases} cases${meta.offline ? " (offline: recorded previews only, no model calls)" : ""}`,
    ...(meta.revision ? [`- Code: ${meta.revision}`] : []),
    ...(previous
      ? [
          `- Compared with: ${previous.meta.startedAt}, model ${previous.meta.model}${previous.meta.revision ? `, code ${previous.meta.revision}` : ""}${previous.meta.dataset !== meta.dataset || previous.meta.cases !== meta.cases ? " — **different dataset or case count, so the comparison is only indicative**" : ""}`,
        ]
      : []),
    "",
  ];
  for (const [group, metrics] of Object.entries(current.groups)) {
    lines.push(`## ${group}`, "");
    lines.push(previous ? "| Metric | Now | Before | Change |" : "| Metric | Value |");
    lines.push(previous ? "|---|---:|---:|---|" : "|---|---:|");
    for (const [name, value] of Object.entries(metrics)) {
      if (previous) {
        const before = previous.groups[group]?.[name];
        lines.push(
          `| ${name} | ${formatValue(name, value)} | ${before === undefined ? "–" : formatValue(name, before)} | ${formatDelta(name, value, before)} |`,
        );
      } else {
        lines.push(`| ${name} | ${formatValue(name, value)} |`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Failures and the cases behind the headline counts, for the summary's tail. */
export function renderProblems(results: CaseResult[]): string {
  const lines: string[] = [];
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    lines.push("## Failed cases", "");
    for (const r of failed) lines.push(`- ${r.id}${r.variant ? ` (${r.variant})` : ""}: ${r.error}`);
    lines.push("");
  }
  const flagged = results.filter(
    (r) =>
      r.ok &&
      (r.metrics.unwantedFields > 0 ||
        r.metrics.unmentionedFields > 0 ||
        r.metrics.optionsUnmentioned > 0 ||
        r.metrics.scopedSpillOptions > 0 ||
        r.metrics.purposeLost > 0 ||
        r.metrics.purposeUnwantedChange > 0),
  );
  if (flagged.length) {
    lines.push("## Cases to look at", "");
    for (const r of flagged) {
      const why = [
        r.metrics.unwantedFields > 0 && `unwanted changes: ${JSON.stringify(r.details.unwanted)}`,
        r.metrics.unmentionedFields > 0 && `unmentioned: ${JSON.stringify(r.details.unmentioned)}`,
        r.metrics.optionsUnmentioned > 0 && "an option changes unmentioned properties",
        r.metrics.scopedSpillOptions > 0 && "a scoped replay still spills",
        r.metrics.purposeLost > 0 && `purpose lost ${r.metrics.purposeLost} sentence(s)`,
        r.metrics.purposeUnwantedChange > 0 && "purpose changed against expectation",
      ].filter(Boolean);
      lines.push(`- ${r.id}: ${why.join("; ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
