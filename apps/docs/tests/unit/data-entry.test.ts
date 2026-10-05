import { describe, expect, it } from "vitest";
import {
  buildResponseData,
  buildResponseEntry,
  dictatableFields,
  parseSpokenBoolean,
  parseSpokenDate,
  parseSpokenNumber,
  resolveReferenceFields,
  type ReferenceIO,
} from "@/lib/voice/data-entry";
import {
  emptyPortfolioSchema,
  type Field,
  type FieldType,
  type PortfolioSchema,
} from "@/lib/types";

function field(
  name: string,
  type: FieldType,
  required = false,
): Field {
  return {
    id: `id-${name}`,
    name,
    label: name[0].toUpperCase() + name.slice(1),
    type,
    required,
    constraints: [],
    origin: "system",
    tags: [],
  };
}

const schema: PortfolioSchema = {
  ...emptyPortfolioSchema(),
  fields: [
    {
      id: "f1",
      name: "itemName",
      label: "Item name",
      type: { kind: "text" },
      required: true,
      constraints: [],
      origin: "system",
      tags: [],
    },
    {
      id: "f2",
      name: "quantity",
      label: "Quantity",
      type: { kind: "number" },
      required: true,
      constraints: [],
      origin: "system",
      tags: [],
    },
    {
      id: "f3",
      name: "condition",
      label: "Condition",
      type: {
        kind: "select",
        multiple: false,
        options: [
          { label: "Like new", value: "likeNew" },
          { label: "Used", value: "used" },
        ],
      },
      required: false,
      constraints: [],
      origin: "system",
      tags: [],
    },
  ],
};

describe("buildResponseData", () => {
  it("types values per field kind, keyed by field name", () => {
    const data = buildResponseData(schema, [
      { field: "itemName", value: "T-Shirt" },
      { field: "quantity", value: "2" },
    ]);
    expect(data).toEqual({ itemName: "T-Shirt", quantity: 2 });
  });

  it("maps select labels to option values", () => {
    const data = buildResponseData(schema, [
      { field: "condition", value: "Like new" },
    ]);
    expect(data).toEqual({ condition: "likeNew" });
  });

  it("drops unknown fields and non-numeric numbers", () => {
    const data = buildResponseData(schema, [
      { field: "bogus", value: "x" },
      { field: "quantity", value: "a few" },
    ]);
    expect(data).toEqual({});
  });
});

describe("buildResponseEntry — per field kind", () => {
  const kinds: PortfolioSchema = {
    ...emptyPortfolioSchema(),
    fields: [
      field("item", { kind: "text" }, true),
      field("quantity", { kind: "number" }, true),
      field(
        "colors",
        {
          kind: "select",
          multiple: true,
          options: [
            { label: "Red", value: "red" },
            { label: "Blue", value: "blue" },
            { label: "Black and white", value: "bw" },
          ],
        },
      ),
      field("giftWrapped", { kind: "boolean" }),
      field("foundOn", { kind: "date" }),
      field("rating", { kind: "scale", min: 1, max: 5 }),
      field("photo", { kind: "file", accept: ["image/*"] }),
    ],
  };
  const now = new Date(2026, 9, 5); // 5 Oct 2026, local time

  it("stores multi-select values as an array of option values", () => {
    const { data, issues } = buildResponseEntry(kinds, [
      { field: "colors", value: "red and Blue" },
    ]);
    expect(data.colors).toEqual(["red", "blue"]);
    expect(issues).toEqual([]);
  });

  it("does not split an option whose label contains a conjunction", () => {
    const { data } = buildResponseEntry(kinds, [
      { field: "colors", value: "Black and white, red" },
    ]);
    expect(data.colors).toEqual(["bw", "red"]);
  });

  it("accepts JSON arrays and keeps unknown items, reporting them", () => {
    const { data, issues } = buildResponseEntry(kinds, [
      { field: "colors", value: '["red", "green"]' },
    ]);
    expect(data.colors).toEqual(["red", "green"]);
    expect(issues).toEqual([
      { field: "colors", value: '["red", "green"]', reason: "not-an-option" },
    ]);
  });

  it("skips unrecognised booleans instead of storing false", () => {
    const yes = buildResponseEntry(kinds, [{ field: "giftWrapped", value: "Yes." }]);
    expect(yes.data.giftWrapped).toBe(true);
    const no = buildResponseEntry(kinds, [{ field: "giftWrapped", value: "nope" }]);
    expect(no.data.giftWrapped).toBe(false);
    const maybe = buildResponseEntry(kinds, [{ field: "giftWrapped", value: "maybe" }]);
    expect(maybe.data).not.toHaveProperty("giftWrapped");
    expect(maybe.issues[0]).toMatchObject({ field: "giftWrapped", reason: "unparsed" });
  });

  it("skips empty numbers instead of storing 0", () => {
    const { data } = buildResponseEntry(kinds, [{ field: "quantity", value: "  " }]);
    expect(data).not.toHaveProperty("quantity");
  });

  it("normalizes dates to yyyy-mm-dd", () => {
    const cases: [string, string][] = [
      ["2026-03-04", "2026-03-04"],
      ["04.03.2026", "2026-03-04"],
      ["March 4, 2026", "2026-03-04"],
      ["today", "2026-10-05"],
      ["yesterday", "2026-10-04"],
    ];
    for (const [spoken, iso] of cases) {
      const { data } = buildResponseEntry(
        kinds,
        [{ field: "foundOn", value: spoken }],
        { now },
      );
      expect(data.foundOn, spoken).toBe(iso);
    }
  });

  it("keeps an unparseable date as said and reports it", () => {
    const { data, issues } = buildResponseEntry(
      kinds,
      [{ field: "foundOn", value: "last spring" }],
      { now },
    );
    expect(data.foundOn).toBe("last spring");
    expect(issues[0]).toMatchObject({ reason: "unparsed-date" });
  });

  it("clamps scale values to an integer within min..max", () => {
    expect(
      buildResponseEntry(kinds, [{ field: "rating", value: "7" }]).data.rating,
    ).toBe(5);
    expect(
      buildResponseEntry(kinds, [{ field: "rating", value: "3.6" }]).data.rating,
    ).toBe(4);
    const low = buildResponseEntry(kinds, [{ field: "rating", value: "0" }]);
    expect(low.data.rating).toBe(1);
    expect(low.issues[0]).toMatchObject({ reason: "clamped" });
  });

  it("does not store dictated text in file fields", () => {
    const { data, issues } = buildResponseEntry(kinds, [
      { field: "photo", value: "a picture of it" },
    ]);
    expect(data).not.toHaveProperty("photo");
    expect(issues[0]).toMatchObject({ reason: "unsupported" });
  });

  it("reports missing required fields without blocking the record", () => {
    const { data, missingRequired } = buildResponseEntry(kinds, [
      { field: "item", value: "Hoodie" },
    ]);
    expect(data).toEqual({ item: "Hoodie" });
    expect(missingRequired).toEqual(["quantity"]);
  });
});

describe("buildResponseEntry — groups", () => {
  const withGroup: PortfolioSchema = {
    ...emptyPortfolioSchema(),
    fields: [
      field("item", { kind: "text" }, true),
      field(
        "address",
        {
          kind: "group",
          fields: [
            field("city", { kind: "text" }, true),
            field("zip", { kind: "number" }),
          ],
        },
      ),
    ],
  };

  it("stores group children nested under the group, never as flat keys", () => {
    const { data } = buildResponseEntry(withGroup, [
      { field: "address.city", value: "Aarhus" },
      { field: "zip", value: "8000" },
    ]);
    expect(data).toEqual({ address: { city: "Aarhus", zip: 8000 } });
  });

  it("only reports required group children once the group is partly filled", () => {
    const empty = buildResponseEntry(withGroup, [
      { field: "item", value: "Hoodie" },
    ]);
    expect(empty.missingRequired).toEqual([]);
    const partial = buildResponseEntry(withGroup, [
      { field: "item", value: "Hoodie" },
      { field: "address.zip", value: "8000" },
    ]);
    expect(partial.missingRequired).toEqual(["address.city"]);
  });

  it("refuses a single value for a whole group", () => {
    const { data, issues } = buildResponseEntry(withGroup, [
      { field: "address", value: "Aarhus" },
    ]);
    expect(data).toEqual({});
    expect(issues[0]).toMatchObject({ field: "address", reason: "unsupported" });
  });

  it("lists dictatable fields with dotted keys and group-prefixed labels", () => {
    expect(
      dictatableFields(withGroup).map((f) => [f.key, f.label]),
    ).toEqual([
      ["item", "Item"],
      ["address.city", "Address › City"],
      ["address.zip", "Address › Zip"],
    ]);
  });
});

describe("spoken value parsers", () => {
  it("parses numbers with units, decimal commas and thousands separators", () => {
    expect(parseSpokenNumber("2")).toBe(2);
    expect(parseSpokenNumber("2 kg")).toBe(2);
    expect(parseSpokenNumber("1,5")).toBe(1.5);
    expect(parseSpokenNumber("1,000")).toBe(1000);
    expect(parseSpokenNumber("")).toBeNull();
    expect(parseSpokenNumber("a few")).toBeNull();
  });

  it("parses yes/no in several languages, null otherwise", () => {
    expect(parseSpokenBoolean("ja")).toBe(true);
    expect(parseSpokenBoolean("Nej")).toBe(false);
    expect(parseSpokenBoolean("perhaps")).toBeNull();
  });

  it("refuses ambiguous slashed dates and impossible dates", () => {
    expect(parseSpokenDate("3/4/2026")).toBeNull();
    expect(parseSpokenDate("31.02.2026")).toBeNull();
  });
});

describe("resolveReferenceFields", () => {
  const inventorySchema: PortfolioSchema = {
    ...emptyPortfolioSchema(),
    fields: [
      {
        id: "f1",
        name: "product",
        label: "Product",
        type: { kind: "reference", targetPortfolioId: "products-1" },
        required: true,
        constraints: [],
        origin: "system",
        tags: [],
      },
      {
        id: "f2",
        name: "quantity",
        label: "Quantity",
        type: { kind: "number" },
        required: true,
        constraints: [],
        origin: "system",
        tags: [],
      },
    ],
  };

  function fakeIO(overrides?: Partial<ReferenceIO>): ReferenceIO {
    return {
      candidatesFor: async () => [
        { responseId: "r1", label: "SuperGlue 50ml" },
      ],
      createTarget: async (_id, label) => ({
        responseId: "created-1",
        label,
      }),
      ...overrides,
    };
  }

  it("links a spoken label to a matching target row", async () => {
    const { data, created } = await resolveReferenceFields(
      inventorySchema,
      { product: "the superglue 50ml", quantity: 3 },
      fakeIO(),
    );
    expect(data).toEqual({
      product: { responseId: "r1", label: "SuperGlue 50ml" },
      quantity: 3,
    });
    expect(created).toEqual([]);
  });

  it("creates and links a target row when nothing matches", async () => {
    const { data, created } = await resolveReferenceFields(
      inventorySchema,
      { product: "Wooden Pallet", quantity: 1 },
      fakeIO(),
    );
    expect(data.product).toEqual({
      responseId: "created-1",
      label: "Wooden Pallet",
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      field: "product",
      targetPortfolioId: "products-1",
    });
  });

  it("keeps the spoken string when the target cannot hold a new row", async () => {
    const { data, created } = await resolveReferenceFields(
      inventorySchema,
      { product: "Wooden Pallet", quantity: 1 },
      fakeIO({ createTarget: async () => null }),
    );
    expect(data.product).toBe("Wooden Pallet");
    expect(created).toEqual([]);
  });

  it("keeps ambiguous labels as text instead of guessing or creating a row", async () => {
    let createdCalls = 0;
    const { data, created, ambiguous } = await resolveReferenceFields(
      inventorySchema,
      { product: "beanie", quantity: 1 },
      fakeIO({
        candidatesFor: async () => [
          { responseId: "r1", label: "Blue Beanie" },
          { responseId: "r2", label: "Red Beanie" },
        ],
        createTarget: async () => {
          createdCalls += 1;
          return null;
        },
      }),
    );
    expect(data.product).toBe("beanie");
    expect(created).toEqual([]);
    expect(createdCalls).toBe(0);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].candidates.map((c) => c.responseId)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("resolves reference fields nested in a group", async () => {
    const grouped: PortfolioSchema = {
      ...emptyPortfolioSchema(),
      fields: [
        field("line", {
          kind: "group",
          fields: [
            field("product", {
              kind: "reference",
              targetPortfolioId: "products-1",
            }),
          ],
        }),
      ],
    };
    const input = { line: { product: "superglue 50ml" } };
    const { data } = await resolveReferenceFields(grouped, input, fakeIO());
    expect(data).toEqual({
      line: { product: { responseId: "r1", label: "SuperGlue 50ml" } },
    });
    expect(input.line.product).toBe("superglue 50ml"); // input not mutated
  });

  it("leaves non-reference and empty values untouched", async () => {
    const { data } = await resolveReferenceFields(
      inventorySchema,
      { product: "  ", quantity: 2 },
      fakeIO(),
    );
    expect(data).toEqual({ product: "  ", quantity: 2 });
  });
});
