import { describe, expect, it } from "vitest";
import { bootstrapMean, median, quantile } from "./stats";

describe("statistics", () => {
  it("median and quantiles", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(quantile([0, 10], 0.9)).toBe(9);
  });

  it("bootstrap: the mean, a reproducible interval around it, strata kept apart", () => {
    const values = [
      ...[1, 2, 3, 4].map((value) => ({ stratum: "a", value })),
      ...[10, 10, 10, 10].map((value) => ({ stratum: "b", value })),
    ];
    const one = bootstrapMean(values, { seed: "t" });
    expect(one.value).toBe(6.25);
    expect(one).toEqual(bootstrapMean(values, { seed: "t" }));
    const [lo, hi] = one.ci95!;
    expect(lo).toBeLessThanOrEqual(6.25);
    expect(hi).toBeGreaterThanOrEqual(6.25);
    // Stratum b is constant: the spread comes from stratum a only
    expect(hi - lo).toBeLessThan(2);
    expect(bootstrapMean([])).toEqual({ value: null, ci95: null, n: 0 });
  });
});
