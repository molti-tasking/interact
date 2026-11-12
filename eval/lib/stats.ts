import { rng } from "./random";

export const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs: readonly number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export interface Estimate {
  value: number | null;
  ci95: [number, number] | null;
  n: number;
}

/**
 * The mean of `values` with a 95 % percentile bootstrap interval:
 * `resamples` draws, each resampling with replacement *within* each stratum
 * (the scenario), seeded so the interval is the same on every run.
 */
export function bootstrapMean(
  values: readonly { stratum: string; value: number }[],
  opts: { resamples?: number; seed?: string } = {},
): Estimate {
  const resamples = opts.resamples ?? 10_000;
  const value = mean(values.map((v) => v.value));
  if (!values.length) return { value: null, ci95: null, n: 0 };
  const strata = new Map<string, number[]>();
  for (const v of values) {
    const list = strata.get(v.stratum) ?? [];
    list.push(v.value);
    strata.set(v.stratum, list);
  }
  const random = rng(opts.seed ?? "e1-bootstrap");
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    let n = 0;
    for (const list of strata.values()) {
      for (let i = 0; i < list.length; i++) {
        sum += list[Math.floor(random() * list.length)];
        n++;
      }
    }
    means.push(sum / n);
  }
  return { value, ci95: [quantile(means, 0.025)!, quantile(means, 0.975)!], n: values.length };
}
