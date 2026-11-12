import { describe, expect, it } from "vitest";
import type { Field, PortfolioSchema } from "@/lib/types";
import compat from "./compat.json";
import {
  agreement,
  align,
  boundResponses,
  canonical,
  collateral,
  fulfilment,
  holds,
  linkIntegrity,
  maxWeightMatching,
  type GoldSpec,
} from "./measures";
import { generateResponses } from "./responses";

const f = (name: string, label: string, extra: Partial<Field> = {}): Field => ({
  id: `id-${name}`,
  name,
  label,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
  ...extra,
});
const schema = (...fields: Field[]): PortfolioSchema => ({ fields, groups: [], version: 1 });
const gold = (scope: GoldSpec["scope"], assertions: GoldSpec["assertions"] = []): GoldSpec => ({
  reviewed: false,
  scope,
  assertions,
});

describe("maximum-weight matching", () => {
  it("finds the best total, not the greedy first pick", () => {
    // Greedy takes 0.9 (row 0 → col 0) and leaves row 1 without a partner
    expect(maxWeightMatching([[0.9, 0.8], [0.85, 0]])).toEqual([1, 0]);
  });
  it("leaves rows without a positive weight unmatched", () => {
    expect(maxWeightMatching([[0, 0], [0, 0.7]])).toEqual([-1, 1]);
  });
});

describe("alignment", () => {
  const before = schema(f("phone", "Parent phone number"), f("dob", "Date of birth", { type: { kind: "date" } }));
  it("matches by key, then by label within a type family", () => {
    const after = schema(f("phone", "Mobile number"), f("birthDate", "Date of birth", { type: { kind: "date" } }));
    const a = align(before, after);
    expect(a.pairs.map((p) => [p.before.name, p.after.name, p.by])).toEqual([
      ["phone", "phone", "key"],
      ["dob", "birthDate", "label"],
    ]);
    expect(align(before, after, false).removed.map((x) => x.name)).toEqual(["dob"]);
  });
  it("doesn't align across families or below the threshold", () => {
    const after = schema(f("birthDate", "Date of birth"), f("x", "Birth"));
    const a = align(schema(before.fields[1]), after);
    expect(a.pairs).toEqual([]);
  });
});

describe("collateral changes", () => {
  const before = schema(f("a", "Name", { required: true }), f("b", "Email"), f("c", "Notes"));
  it("counts changes, additions and removals outside the scope", () => {
    const after = schema(
      f("a", "Full name", { required: true }), // relabelled: outside scope
      f("b", "Email", { required: true }), // in scope
      f("d", "School"), // covered by an add descriptor
      f("e", "Shoe size"), // not covered
    );
    const c = collateral(before, after, gold({ change: [{ key: "b" }], add: [{ label: "/school/i" }] }));
    expect(c).toEqual({ changed: ["a"], added: ["e"], removed: ["c"], total: 3 });
  });
  it("for a derive: an inherited field changed, a kept field missing, a stray new field", () => {
    const derived = schema(f("a", "Name (patient)", { required: true }), f("z", "Implant lot"), f("q", "Lunch"));
    const c = collateral(before, derived, gold({ include: [{ key: "a" }, { key: "b" }], add: [{ label: "/implant/i" }] }), {
      derive: true,
    });
    expect(c).toEqual({ changed: ["a"], added: ["q"], removed: ["b"], total: 3 });
  });
});

describe("assertions", () => {
  const s = schema(
    f("industry", "Industries sold into", {
      required: true,
      type: { kind: "select", multiple: true, options: ["SaaS", "Fintech", "Healthcare", "Other"].map((l) => ({ label: l, value: l })) },
    }),
    f("pain", "Pain score", { type: { kind: "scale", min: 0, max: 10 } }),
  );
  it("checks type, requiredness, options and scales", () => {
    expect(holds(s, { field: { label: "/industr/i" }, type: "select", required: true })).toBe(true);
    expect(holds(s, { field: { label: "/industr/i" }, options: { exactly: ["/^saas$/i", "/^fintech$/i", "/^health ?care$/i", "/^other$/i"] } })).toBe(true);
    expect(holds(s, { field: { label: "/industr/i" }, options: { exactly: ["/^saas$/i", "/^other$/i"] } })).toBe(false);
    expect(holds(s, { field: { label: "/pain/i" }, type: "scale", scale: { min: 0, max: 10 } })).toBe(true);
    expect(holds(s, { field: { key: "resume" }, exists: false })).toBe(true);
    expect(fulfilment(s, [{ field: { label: "/pain/i" } }, { field: { label: "/linkedin/i" } }]).share).toBe(0.5);
  });
});

describe("bound responses", () => {
  const base = schema(f("name", "Name"), f("age", "Age", { type: { kind: "number" } }), f("notes", "Notes"));
  const responses = [{ data: { name: "A", age: 9, notes: "x" } }, { data: { name: "B", age: 11, notes: "" } }];
  it("counts answers that keep a same-key field of a compatible type", () => {
    const now = schema(
      f("name", "Full name"),
      f("age", "Age", { type: { kind: "scale", min: 0, max: 18 } }), // number → scale: compatible
    );
    // "notes" is gone but the gold intended it: out of the denominator
    expect(boundResponses(responses, base, now, new Set(["notes"]), compat.compatible)).toEqual({ bound: 4, total: 4, share: 1 });
    // Not intended: its one answer counts and doesn't bind
    expect(boundResponses(responses, base, now, new Set(), compat.compatible).share).toBe(4 / 5);
  });
  it("a key change unbinds the answers", () => {
    const now = schema(f("fullName", "Name"), f("age", "Age", { type: { kind: "number" } }), f("notes", "Notes"));
    expect(boundResponses(responses, base, now, new Set(), compat.compatible)).toMatchObject({ bound: 3, total: 5 });
  });
});

describe("agreement", () => {
  it("is the share of identical run pairs, ignoring ids and order", () => {
    const x = canonical(schema(f("a", "A"), f("b", "B")));
    const y = canonical({ ...schema(f("b", "B"), f("a", "A")), version: 9 });
    const z = canonical(schema(f("a", "A")));
    expect(x).toBe(y);
    expect(agreement([x, y, z])).toBeCloseTo(1 / 3);
    expect(agreement([x])).toBeNull();
  });
});

describe("link integrity", () => {
  const baseAtDerive = schema(f("name", "Name"), f("dob", "Date of birth"));
  const derived = schema(
    { ...f("name", "Name"), derivedFrom: "id-name" },
    { ...f("dob", "Date of birth"), derivedFrom: "id-dob" },
    f("allergies", "Allergies"),
  );
  it("by link: inherited fields whose base field still exists", () => {
    // The base renamed the key of "dob" but kept the field (same id)
    const baseNow = schema(f("name", "Name"), { ...f("birthDate", "Date of birth"), id: "id-dob" });
    expect(linkIntegrity(derived, baseAtDerive, baseNow, "link")).toEqual({ inherited: 2, resolved: 2, share: 1 });
    // By key (the baselines' rule), the renamed key no longer resolves
    expect(linkIntegrity(derived, baseAtDerive, baseNow, "key")).toEqual({ inherited: 2, resolved: 1, share: 0.5 });
  });
});

describe("synthetic responses", () => {
  const base = schema(
    f("playerFullName", "Player's full name", { required: true }),
    f("dob", "Player's date of birth", { required: true, type: { kind: "date" } }),
    f("email", "Parent email"),
    f("size", "Shirt size", { type: { kind: "select", multiple: false, options: [{ label: "S", value: "s" }, { label: "M", value: "m" }] } }),
  );
  it("are reproducible, answer every required field, and fit each type", () => {
    const a = generateResponses("soccer", base);
    expect(a).toEqual(generateResponses("soccer", base));
    expect(a).toHaveLength(30);
    for (const r of a) {
      expect(typeof r.data.playerFullName).toBe("string");
      expect(String(r.data.dob)).toMatch(/^20(1[2-7])-\d\d-\d\d$/);
      if ("size" in r.data) expect(["s", "m"]).toContain(r.data.size);
    }
  });
});
