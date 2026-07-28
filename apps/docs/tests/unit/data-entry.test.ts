import { describe, expect, it } from "vitest";
import {
  buildResponseData,
  resolveReferenceFields,
  type ReferenceIO,
} from "@/lib/voice/data-entry";
import { emptyPortfolioSchema, type PortfolioSchema } from "@/lib/types";

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

  it("leaves non-reference and empty values untouched", async () => {
    const { data } = await resolveReferenceFields(
      inventorySchema,
      { product: "  ", quantity: 2 },
      fakeIO(),
    );
    expect(data).toEqual({ product: "  ", quantity: 2 });
  });
});
