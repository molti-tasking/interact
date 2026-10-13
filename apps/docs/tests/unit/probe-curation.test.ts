import {
  planProbeCuration,
  schemaFingerprint,
  type ProbeReview,
} from "@/lib/engine/probe-curation";
import type { Field, PortfolioSchema, ProbePriority } from "@/lib/types";
import { describe, expect, it } from "vitest";

function probe(id: string, priority: ProbePriority) {
  return { id, priority };
}

function review(keep: boolean, priority: ProbePriority): ProbeReview {
  return { keep, priority };
}

describe("planProbeCuration", () => {
  it("drops what the review retires and keeps unreviewed probes as they were", () => {
    const plan = planProbeCuration(
      [probe("a", 1), probe("b", 2), probe("c", 3)],
      new Map([
        ["a", review(false, 1)],
        ["b", review(true, 1)],
      ]),
      [],
      6,
    );
    expect(plan.drop).toEqual(["a"]);
    expect(plan.priorities).toEqual({ b: 1 });
    expect(plan.add).toEqual([]);
  });

  it("caps the deck: the least important kept probes go first", () => {
    const open = Array.from({ length: 22 }, (_, i) =>
      probe(`p${i}`, ((i % 3) + 1) as ProbePriority),
    );
    const plan = planProbeCuration(open, new Map(), [], 6);
    expect(open.length - plan.drop.length).toBe(6);
    // All six survivors are high priority
    const kept = open.filter((p) => !plan.drop.includes(p.id));
    expect(kept.every((p) => p.priority === 1)).toBe(true);
  });

  it("lets new important questions displace kept polish, but kept ones win ties", () => {
    const plan = planProbeCuration(
      [probe("a", 2), probe("b", 3)],
      new Map(),
      [
        { text: "new high", priority: 1 as const },
        { text: "new medium", priority: 2 as const },
      ],
      2,
    );
    expect(plan.add.map((p) => p.text)).toEqual(["new high"]);
    expect(plan.drop).toEqual(["b"]);
  });
});

describe("schemaFingerprint", () => {
  const field = (extra: Partial<Field> = {}): Field => ({
    id: "1",
    name: "goal",
    label: "Goal",
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...extra,
  });
  const schema = (fields: Field[]): PortfolioSchema => ({ fields, groups: [], version: 1 });

  it("changes with what probes depend on, not with help text or versions", () => {
    const base = schemaFingerprint(schema([field()]));
    expect(schemaFingerprint({ ...schema([field({ description: "x" })]), version: 9 })).toBe(base);
    expect(schemaFingerprint(schema([field({ required: true })]))).not.toBe(base);
    expect(schemaFingerprint(schema([field(), field({ id: "2", name: "diet" })]))).not.toBe(base);
  });
});
