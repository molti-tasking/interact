import { describe, expect, it } from "vitest";
import {
  coerceValueForField,
  formatValue,
  labelIncludesUnit,
  matchesAccept,
  maxSizeBytes,
  mergeEditedResponse,
  orphanKeys,
  replaceFilesDeep,
  toIsoDate,
  valuesEqual,
  type StoredFile,
} from "@/lib/form-renderer/values";
import {
  emptyPortfolioSchema,
  type Field,
  type FieldType,
  type PortfolioSchema,
} from "@/lib/types";

function field(name: string, type: FieldType, label = name): Field {
  return {
    id: `id-${name}`,
    name,
    label,
    type,
    required: false,
    constraints: [],
    origin: "creator",
    tags: [],
  };
}

const select = field("color", {
  kind: "select",
  multiple: false,
  options: [
    { label: "Red", value: "red" },
    { label: "Dark Blue", value: "darkBlue" },
  ],
});
const multi = field("tags", {
  kind: "select",
  multiple: true,
  options: [
    { label: "A", value: "a" },
    { label: "B", value: "b" },
  ],
});

describe("coerceValueForField", () => {
  it("parses booleans instead of storing truthy strings", () => {
    const f = field("ok", { kind: "boolean" });
    expect(coerceValueForField(f, "false")).toEqual({ ok: true, value: false });
    expect(coerceValueForField(f, "Yes")).toEqual({ ok: true, value: true });
    expect(coerceValueForField(f, "maybe").ok).toBe(false);
  });

  it("parses numbers with separators/units and checks bounds", () => {
    const f = field("pct", { kind: "number", min: 0, max: 100, unit: "%" });
    expect(coerceValueForField(f, "42")).toEqual({ ok: true, value: 42 });
    expect(coerceValueForField(f, "42.5 %")).toEqual({ ok: true, value: 42.5 });
    expect(coerceValueForField(f, "150").ok).toBe(false);
    expect(coerceValueForField(f, "forty").ok).toBe(false);
    const big = field("n", { kind: "number" });
    expect(coerceValueForField(big, "1,234,567")).toEqual({
      ok: true,
      value: 1234567,
    });
  });

  it("requires whole numbers within a scale", () => {
    const f = field("r", { kind: "scale", min: 1, max: 5 });
    expect(coerceValueForField(f, "4")).toEqual({ ok: true, value: 4 });
    expect(coerceValueForField(f, "4.5").ok).toBe(false);
    expect(coerceValueForField(f, "9").ok).toBe(false);
  });

  it("matches select options by value or label", () => {
    expect(coerceValueForField(select, "red")).toEqual({ ok: true, value: "red" });
    expect(coerceValueForField(select, "dark blue")).toEqual({
      ok: true,
      value: "darkBlue",
    });
    expect(coerceValueForField(select, "green").ok).toBe(false);
  });

  it("parses multi-selects from lists or JSON", () => {
    expect(coerceValueForField(multi, "a, B")).toEqual({
      ok: true,
      value: ["a", "b"],
    });
    expect(coerceValueForField(multi, '["b"]')).toEqual({ ok: true, value: ["b"] });
    expect(coerceValueForField(multi, "a, z").ok).toBe(false);
  });

  it("normalizes dates and checks ranges", () => {
    const f = field("d", {
      kind: "date",
      range: { min: "2024-01-01", max: "2024-12-31" },
    });
    expect(coerceValueForField(f, "2024-03-05")).toEqual({
      ok: true,
      value: "2024-03-05",
    });
    expect(coerceValueForField(f, "March 5, 2024")).toEqual({
      ok: true,
      value: "2024-03-05",
    });
    expect(coerceValueForField(f, "2023-12-31").ok).toBe(false);
    expect(coerceValueForField(f, "someday").ok).toBe(false);
  });

  it("treats empty output as clearing the value", () => {
    expect(coerceValueForField(select, null)).toEqual({ ok: true, value: undefined });
    expect(coerceValueForField(select, "  ")).toEqual({ ok: true, value: undefined });
  });

  it("refuses kinds that can't be written from text", () => {
    const ref = field("team", { kind: "reference", targetPortfolioId: "t" });
    expect(coerceValueForField(ref, "Tigers").ok).toBe(false);
  });
});

describe("formatValue", () => {
  it("renders booleans, option labels, references, files and groups", () => {
    expect(formatValue(false)).toBe("No");
    expect(formatValue("darkBlue", select)).toBe("Dark Blue");
    expect(formatValue(["a", "b"], multi)).toBe("A, B");
    expect(formatValue({ responseId: "r", label: "Tigers" })).toBe("Tigers");
    const file: StoredFile = {
      path: "p/x.pdf",
      name: "x.pdf",
      size: 1,
      type: "application/pdf",
      url: "https://x",
    };
    expect(formatValue(file)).toBe("x.pdf");
    const group = field("addr", {
      kind: "group",
      fields: [field("street", { kind: "text" }, "Street")],
    });
    expect(formatValue({ street: "Main" }, group)).toBe("Street: Main");
    expect(formatValue(undefined)).toBe("");
  });
});

describe("labelIncludesUnit", () => {
  it("detects units already in the label", () => {
    expect(labelIncludesUnit("Annual Quota Attainment (%)", "%")).toBe(true);
    expect(labelIncludesUnit("Weight in kg", "kg")).toBe(true);
    expect(labelIncludesUnit("Name", "m")).toBe(false);
    expect(labelIncludesUnit("Height (cm)", "m")).toBe(false);
    expect(labelIncludesUnit("Revenue", "EUR")).toBe(false);
  });
});

describe("files", () => {
  it("matches accept lists", () => {
    const pdf = { name: "CV.PDF", type: "application/pdf" };
    expect(matchesAccept(pdf, [".pdf"])).toBe(true);
    expect(matchesAccept(pdf, ["application/pdf"])).toBe(true);
    expect(matchesAccept(pdf, ["image/*"])).toBe(false);
    expect(matchesAccept(pdf, ["pdf"])).toBe(true);
    expect(matchesAccept(pdf, [])).toBe(true);
  });

  it("interprets small maxSize values as megabytes", () => {
    expect(maxSizeBytes(5)).toBe(5 * 1024 * 1024);
    expect(maxSizeBytes(2_000_000)).toBe(2_000_000);
    expect(maxSizeBytes(undefined)).toBeUndefined();
  });

  it("replaces File values at any depth", async () => {
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    const uploaded: string[] = [];
    const out = await replaceFilesDeep(
      { doc: file, group: { inner: file }, n: 1, list: [file] },
      async (f) => {
        uploaded.push(f.name);
        return { path: `p/${f.name}`, name: f.name, size: f.size, type: f.type, url: "u" };
      },
    );
    expect(uploaded).toHaveLength(3);
    expect(out).toEqual({
      doc: { path: "p/a.txt", name: "a.txt", size: 1, type: "text/plain", url: "u" },
      group: {
        inner: { path: "p/a.txt", name: "a.txt", size: 1, type: "text/plain", url: "u" },
      },
      n: 1,
      list: [{ path: "p/a.txt", name: "a.txt", size: 1, type: "text/plain", url: "u" }],
    });
  });
});

describe("orphanKeys / mergeEditedResponse", () => {
  const schema: PortfolioSchema = {
    ...emptyPortfolioSchema(),
    fields: [field("name", { kind: "text" }), field("age", { kind: "number" })],
  };

  it("lists data keys the schema no longer reads", () => {
    expect(orphanKeys({ name: "A", fullName: "Ada L", empty: "" }, schema)).toEqual([
      "fullName",
    ]);
  });

  it("replaces schema fields, clears removed values and keeps orphans", () => {
    const merged = mergeEditedResponse(
      { name: "A", age: 3, legacy: "keep" },
      { name: "B", age: undefined },
      schema,
    );
    expect(merged).toEqual({ name: "B", legacy: "keep" });
  });
});

describe("misc", () => {
  it("toIsoDate and valuesEqual", () => {
    expect(toIsoDate("2024-02-30")).toBeNull();
    expect(valuesEqual(undefined, "")).toBe(true);
    expect(valuesEqual([], null)).toBe(true);
    expect(valuesEqual(1, "1")).toBe(false);
  });
});
