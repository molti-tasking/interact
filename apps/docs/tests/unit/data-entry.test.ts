import { describe, expect, it } from "vitest";
import { buildResponseData } from "@/lib/voice/data-entry";
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
