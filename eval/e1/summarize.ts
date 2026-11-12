/**
 * E1's numbers from saved runs alone (no model, no database): per request,
 * per scenario and per pipeline, with 95 % bootstrap intervals.
 *
 * Aggregation (frozen with the material):
 * - collateral: mean count per request (aligned variant; key-only alongside)
 * - bound responses: mean of per-request shares, base-form requests other
 *   than derives (the responses answer the base form)
 * - fulfilment: mean of per-request shares of satisfied assertions
 * - agreement: per request, the share of identical run pairs; then the mean
 *   over requests
 * - link integrity: per derived form and run, after the script's last
 *   request; mean over those
 * - cost: mean USD per request; latency: mean seconds per request the
 *   creator waits for (P: preview and apply, not the purpose update after)
 * Intervals resample request-runs (agreement: requests; link: derived
 * forms) within each scenario, 10,000 times, seed "e1-bootstrap".
 */

import fs from "node:fs";
import path from "node:path";
import type { PortfolioSchema } from "@/lib/types";
import { bootstrapMean, mean, type Estimate } from "../lib/stats";
import compat from "./compat.json";
import { loadBaseSchema, loadScript, type ScenarioName, type ScriptRequest } from "./material";
import {
  agreement,
  boundResponses,
  canonical,
  collateral,
  fulfilment,
  linkIntegrity,
  matches,
  type Selector,
} from "./measures";
import type { PipelineName } from "./pipelines";
import type { RequestRecord, Trajectory } from "./run.eval";

export interface RequestMeasures {
  scenario: ScenarioName;
  pipeline: PipelineName;
  rep: number;
  id: string;
  kind: ScriptRequest["kind"];
  error?: string;
  collateral: number;
  collateralKeyOnly: number;
  collateralDetail: { changed: string[]; added: string[]; removed: string[] };
  fulfilment: number;
  bound: number | null;
  costUsd: number;
  foregroundS: number;
  totalS: number;
}

/** Keys the request's (and earlier requests') gold specs intend to remove. */
function intendedRemovals(before: PortfolioSchema, selectors: readonly Selector[] | undefined): string[] {
  return before.fields.filter((f) => (selectors ?? []).some((s) => matches(f, s))).map((f) => f.name);
}

export function measureTrajectory(
  t: Trajectory,
  script: ScriptRequest[],
  responses: readonly { data: Record<string, unknown> }[],
): RequestMeasures[] {
  const base = loadBaseSchema(t.scenario);
  const removed = new Set<string>();
  const out: RequestMeasures[] = [];
  for (const r of t.requests) {
    const spec = script.find((s) => s.id === r.id);
    if (!spec) throw new Error(`${t.scenario}: no gold spec for ${r.id}`);
    const derive = r.kind === "derive";
    const before = derive ? (r.baseAtDerive ?? r.before.schema) : r.before.schema;
    const after = derive ? (r.derived?.schema ?? { fields: [], groups: [], version: 0 }) : r.after.schema;
    const c = collateral(before, after, spec.gold, { derive });
    const ck = collateral(before, after, spec.gold, { derive, byLabel: false });
    let bound: number | null = null;
    if (!derive && r.target === "base") {
      for (const key of intendedRemovals(r.before.schema, spec.gold.scope.remove)) removed.add(key);
      bound = boundResponses(responses, base, after, removed, compat.compatible).share;
    }
    out.push({
      scenario: t.scenario,
      pipeline: t.pipeline,
      rep: t.rep,
      id: r.id,
      kind: r.kind,
      ...(r.error ? { error: r.error } : {}),
      collateral: c.total,
      collateralKeyOnly: ck.total,
      collateralDetail: { changed: c.changed, added: c.added, removed: c.removed },
      fulfilment: fulfilment(after, spec.gold.assertions).share,
      bound,
      costUsd: r.costUsd,
      foregroundS: r.foregroundMs / 1000,
      totalS: r.totalMs / 1000,
    });
  }
  return out;
}

const targetOf = (r: RequestRecord) => (r.kind === "derive" ? r.derived?.schema : r.after.schema);

export interface Summary {
  runs: string[];
  trajectories: { total: number; completed: number; failed: number; aborted: number };
  byPipeline: Record<PipelineName, Record<string, Estimate>>;
  byScenario: Record<string, Record<PipelineName, Record<string, number | null>>>;
  byRequest: Record<string, Record<PipelineName, Record<string, number | null>>>;
  totalCostUsd: number;
}

export function summarize(runDirs: string[]): Summary {
  const trajectories: Trajectory[] = [];
  for (const dir of runDirs) {
    for (const scenario of fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const file of fs.readdirSync(path.join(dir, scenario.name)).filter((f) => f.endsWith(".json"))) {
        trajectories.push(JSON.parse(fs.readFileSync(path.join(dir, scenario.name, file), "utf-8")));
      }
    }
  }
  const scripts = new Map<string, ScriptRequest[]>();
  const responsesOf = new Map<string, { data: Record<string, unknown> }[]>();
  const rows: RequestMeasures[] = [];
  for (const t of trajectories.filter((x) => x.status !== "aborted")) {
    if (!scripts.has(t.scenario)) {
      scripts.set(t.scenario, loadScript(t.scenario));
      responsesOf.set(
        t.scenario,
        JSON.parse(fs.readFileSync(path.join(__dirname, "scenarios", t.scenario, "responses.json"), "utf-8")),
      );
    }
    rows.push(...measureTrajectory(t, scripts.get(t.scenario)!, responsesOf.get(t.scenario)!));
  }

  const pipelines = [...new Set(rows.map((r) => r.pipeline))] as PipelineName[];
  const byPipeline = {} as Summary["byPipeline"];
  const byScenario: Summary["byScenario"] = {};
  const byRequest: Summary["byRequest"] = {};

  for (const p of pipelines) {
    const mine = rows.filter((r) => r.pipeline === p);
    const est = (pick: (r: RequestMeasures) => number | null, seed: string) =>
      bootstrapMean(
        mine.flatMap((r) => {
          const v = pick(r);
          return v === null ? [] : [{ stratum: r.scenario, value: v }];
        }),
        { seed: `e1-bootstrap:${seed}:${p}` },
      );

    // Agreement: per scenario × request, over the runs
    const agreementRows: { stratum: string; value: number }[] = [];
    const linkRows: { stratum: string; value: number }[] = [];
    for (const [scenario, script] of scripts) {
      const runs = trajectories.filter((t) => t.pipeline === p && t.scenario === scenario && t.status !== "aborted");
      for (const s of script) {
        const forms = runs.flatMap((t) => {
          const r = t.requests.find((x) => x.id === s.id);
          const schema = r && targetOf(r);
          return schema ? [canonical(schema)] : [];
        });
        const a = agreement(forms);
        if (a !== null) agreementRows.push({ stratum: scenario, value: a });
        (byRequest[s.id] ??= {} as Record<PipelineName, Record<string, number | null>>)[p] = {
          agreement: a,
          collateral: mean(mine.filter((r) => r.id === s.id).map((r) => r.collateral)),
          fulfilment: mean(mine.filter((r) => r.id === s.id).map((r) => r.fulfilment)),
          bound: mean(mine.filter((r) => r.id === s.id && r.bound !== null).map((r) => r.bound!)),
          costUsd: mean(mine.filter((r) => r.id === s.id).map((r) => r.costUsd)),
          foregroundS: mean(mine.filter((r) => r.id === s.id).map((r) => r.foregroundS)),
        };
      }
      for (const t of runs) {
        for (const r of t.requests.filter((x) => x.kind === "derive")) {
          const derived = t.final.derived[r.name ?? r.id];
          if (!derived || !r.baseAtDerive || !t.final.base) continue;
          const l = linkIntegrity(derived, r.baseAtDerive, t.final.base, p === "P" ? "link" : "key");
          if (l.share !== null) linkRows.push({ stratum: scenario, value: l.share });
        }
      }
      const inScenario = mine.filter((r) => r.scenario === scenario);
      (byScenario[scenario] ??= {} as Record<PipelineName, Record<string, number | null>>)[p] = {
        collateral: mean(inScenario.map((r) => r.collateral)),
        fulfilment: mean(inScenario.map((r) => r.fulfilment)),
        bound: mean(inScenario.filter((r) => r.bound !== null).map((r) => r.bound!)),
        agreement: mean(agreementRows.filter((x) => x.stratum === scenario).map((x) => x.value)),
        link: mean(linkRows.filter((x) => x.stratum === scenario).map((x) => x.value)),
        costUsd: mean(inScenario.map((r) => r.costUsd)),
        foregroundS: mean(inScenario.map((r) => r.foregroundS)),
      };
    }

    byPipeline[p] = {
      collateral: est((r) => r.collateral, "collateral"),
      collateralKeyOnly: est((r) => r.collateralKeyOnly, "collateralKeyOnly"),
      bound: est((r) => r.bound, "bound"),
      fulfilment: est((r) => r.fulfilment, "fulfilment"),
      agreement: bootstrapMean(agreementRows, { seed: `e1-bootstrap:agreement:${p}` }),
      link: bootstrapMean(linkRows, { seed: `e1-bootstrap:link:${p}` }),
      costUsd: est((r) => r.costUsd, "cost"),
      foregroundS: est((r) => r.foregroundS, "latency"),
      totalS: est((r) => r.totalS, "latencyTotal"),
    };
  }

  return {
    runs: runDirs.map((d) => path.basename(d)),
    trajectories: {
      total: trajectories.length,
      completed: trajectories.filter((t) => t.status === "completed").length,
      failed: trajectories.filter((t) => t.status === "failed").length,
      aborted: trajectories.filter((t) => t.status === "aborted").length,
    },
    byPipeline,
    byScenario,
    byRequest,
    totalCostUsd: rows.reduce((s, r) => s + r.costUsd, 0),
  };
}
