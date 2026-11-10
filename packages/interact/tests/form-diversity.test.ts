import { describe, expect, it } from "vitest";
import {
  fieldOverlap,
  pairwiseOverlaps,
  summarizeDiversity,
  type FormFields,
} from "../src/forms/form-diversity";

const f = (key: string, label = key) => ({ key, label });
const form = (id: string, ...keys: string[]): FormFields => ({ id, fields: keys.map((k) => f(k)) });

describe("form diversity: overlap of field sets", () => {
  it("is 1 for the same fields and 0 for disjoint ones", () => {
    expect(fieldOverlap([f("name"), f("email")], [f("email"), f("name")])).toBe(1);
    expect(fieldOverlap([f("name")], [f("allergies")])).toBe(0);
  });

  it("is the Jaccard index of matched fields", () => {
    // 2 shared of 4 distinct
    expect(fieldOverlap([f("name"), f("email"), f("age")], [f("name"), f("email"), f("phone")])).toBe(0.5);
  });

  it("matches fields the way committee drafts are aligned, not by exact key", () => {
    const a = [f("phoneNumber", "Phone number"), f("dietaryNeeds", "Dietary needs")];
    const b = [f("phone", "Phone number"), f("dietaryNeed", "Dietary need")];
    expect(fieldOverlap(a, b)).toBe(1);
  });

  it("matches each field at most once", () => {
    // Two phone fields against one: one match, three distinct fields → 1/2… of (2+1-1)
    expect(fieldOverlap([f("phone"), f("phone", "Phone")], [f("phone")])).toBe(0.5);
  });

  it("has nothing to say about two empty forms", () => {
    expect(fieldOverlap([], [])).toBeNull();
    expect(fieldOverlap([f("name")], [])).toBe(0);
  });

  it("is symmetric", () => {
    const a = [f("name"), f("email"), f("tShirtSize", "T-shirt size")];
    const b = [f("fullName", "Name"), f("shirtSize", "Shirt size"), f("allergies")];
    expect(fieldOverlap(a, b)).toBe(fieldOverlap(b, a));
  });

  it("compares every pair once", () => {
    const pairs = pairwiseOverlaps([form("a", "x"), form("b", "x"), form("c", "y")]);
    expect(pairs.map((p) => `${p.a}${p.b}`)).toEqual(["ab", "ac", "bc"]);
    expect(pairs.map((p) => p.overlap)).toEqual([1, 0, 0]);
  });

  it("summarises a group of forms", () => {
    const summary = summarizeDiversity([form("a", "x", "y"), form("b", "x", "y"), form("c", "x", "z")]);
    expect(summary).toMatchObject({ forms: 3, pairs: 3, minOverlap: 1 / 3, maxOverlap: 1, meanFields: 2 });
    expect(summary.meanOverlap).toBeCloseTo((1 + 1 / 3 + 1 / 3) / 3);
  });

  it("needs two forms", () => {
    expect(summarizeDiversity([form("a", "x")])).toMatchObject({ forms: 1, pairs: 0, meanOverlap: null });
    expect(summarizeDiversity([]).meanFields).toBeNull();
  });
});
