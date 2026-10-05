import { mergeIntentChange, mergeSchemaChange } from "@/lib/engine/merge";
import type { Field, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { describe, expect, it } from "vitest";

function field(id: string, name: string, extra: Partial<Field> = {}): Field {
  return {
    id,
    name,
    label: name,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...extra,
  };
}

function schema(fields: Field[], extra: Partial<PortfolioSchema> = {}): PortfolioSchema {
  return { fields, groups: [], version: 1, ...extra };
}

function intent(purpose: string, extra: Partial<Record<string, string>> = {}): StructuredIntent {
  const s = (content: string) => ({ content, updatedAt: "t" });
  return {
    purpose: s(purpose),
    audience: s(extra.audience ?? ""),
    exclusions: s(extra.exclusions ?? ""),
    constraints: s(extra.constraints ?? ""),
  };
}

describe("mergeSchemaChange", () => {
  const base = schema([field("a", "name"), field("b", "email")]);

  it("equals ours when nobody else changed anything", () => {
    const ours = schema([field("a", "name"), field("b", "email"), field("c", "phone")], { version: 2 });
    const merged = mergeSchemaChange(base, ours, base);
    expect(merged.fields.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(merged.version).toBe(2);
  });

  it("keeps a concurrent rename while applying our added field", () => {
    // probe resolution (ours) adds `phone`; meanwhile the user renamed `name`
    const ours = schema([field("a", "name"), field("b", "email"), field("c", "phone")], { version: 2 });
    const theirs = schema([field("a", "name", { label: "Full name" }), field("b", "email")], { version: 2 });
    const merged = mergeSchemaChange(base, ours, theirs);
    expect(merged.fields.find((f) => f.id === "a")?.label).toBe("Full name");
    expect(merged.fields.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(merged.version).toBe(3);
  });

  it("applies our removal and our property change, keeping their other changes", () => {
    const ours = schema([field("a", "name", { required: true })]);
    const theirs = schema([field("a", "name", { label: "Full name" }), field("b", "email"), field("d", "notes")]);
    const merged = mergeSchemaChange(base, ours, theirs);
    expect(merged.fields.map((f) => f.id)).toEqual(["a", "d"]);
    const a = merged.fields[0];
    expect(a.required).toBe(true);
    expect(a.label).toBe("Full name");
  });

  it("resolves same-property conflicts by policy", () => {
    const ours = schema([field("a", "name", { label: "Ours" }), field("b", "email")]);
    const theirs = schema([field("a", "name", { label: "Theirs" }), field("b", "email")]);
    expect(mergeSchemaChange(base, ours, theirs, "ours").fields[0].label).toBe("Ours");
    expect(mergeSchemaChange(base, ours, theirs, "theirs").fields[0].label).toBe("Theirs");
  });

  it("does not duplicate a field name added on both sides", () => {
    const ours = schema([...base.fields, field("x", "phone", { label: "Phone (ours)" })]);
    const theirs = schema([...base.fields, field("y", "phone")]);
    const merged = mergeSchemaChange(base, ours, theirs);
    expect(merged.fields.filter((f) => f.name === "phone")).toHaveLength(1);
    expect(merged.fields.find((f) => f.name === "phone")?.id).toBe("y");
  });

  it("does not resurrect a field they removed", () => {
    const ours = schema([field("a", "name", { required: true }), field("b", "email")]);
    const theirs = schema([field("b", "email")]);
    const merged = mergeSchemaChange(base, ours, theirs);
    expect(merged.fields.map((f) => f.id)).toEqual(["b"]);
  });

  it("carries metadata changed only on their side", () => {
    const theirs = schema(base.fields, {
      acceptedStandards: [{ standardId: "s", standardName: "S", domain: "d" }],
    });
    const ours = schema([...base.fields, field("c", "phone")]);
    const merged = mergeSchemaChange(base, ours, theirs);
    expect(merged.acceptedStandards).toHaveLength(1);
  });
});

describe("mergeIntentChange", () => {
  it("replays only the sections we changed", () => {
    const base = intent("p0", { audience: "a0" });
    const ours = intent("p1", { audience: "a0" });
    const theirs = intent("p0", { audience: "a1", constraints: "c1" });
    const merged = mergeIntentChange(base, ours, theirs);
    expect(merged.purpose.content).toBe("p1");
    expect(merged.audience.content).toBe("a1");
    expect(merged.constraints.content).toBe("c1");
  });

  it("lets theirs win a same-section conflict under the theirs policy", () => {
    const base = intent("p0");
    const merged = mergeIntentChange(base, intent("auto rewrite"), intent("human edit"), "theirs");
    expect(merged.purpose.content).toBe("human edit");
  });
});
