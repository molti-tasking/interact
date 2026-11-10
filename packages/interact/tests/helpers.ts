import type { DesignProbeOption, Field, PortfolioSchema } from "../src/forms/types";

export function field(name: string, overrides: Partial<Field> = {}): Field {
  return {
    id: `f-${name}`,
    name,
    label: name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...overrides,
  };
}

export function schema(...names: string[]): PortfolioSchema {
  return { fields: names.map((n) => field(n)), groups: [], version: 1 };
}

/** An answer that adds one text field. */
export function adds(value: string, key: string): DesignProbeOption {
  return {
    value,
    label: `Add ${key}`,
    preview: {
      summary: `Adds ${key}`,
      schemaPatch: {
        addFields: [{ key, label: key, type: "string", required: false }],
      },
      scope: { added: [key], updated: [], removed: [] },
    },
  };
}

export const bare = (value: string, label = value): DesignProbeOption => ({ value, label });
