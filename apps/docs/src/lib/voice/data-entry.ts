import type { PortfolioSchema } from "@/lib/types";

/**
 * Convert LLM-extracted string values into a response `data` object shaped
 * like a FormRenderer submission: keyed by field name, typed per field kind.
 */
export function buildResponseData(
  schema: PortfolioSchema,
  values: { field: string; value: string }[],
): Record<string, unknown> {
  const fieldsByName = new Map(schema.fields.map((f) => [f.name, f]));
  const data: Record<string, unknown> = {};

  for (const { field, value } of values) {
    const def = fieldsByName.get(field);
    if (!def) continue;

    switch (def.type.kind) {
      case "number": {
        const n = Number(value);
        if (Number.isFinite(n)) data[field] = n;
        break;
      }
      case "boolean": {
        const v = value.trim().toLowerCase();
        data[field] = ["true", "yes", "ja", "1"].includes(v);
        break;
      }
      case "select": {
        // Accept an option value directly, or map a label to its value
        const options = def.type.options;
        const match =
          options.find((o) => o.value === value) ??
          options.find(
            (o) => o.label.toLowerCase() === value.trim().toLowerCase(),
          );
        if (match) data[field] = match.value;
        else data[field] = value;
        break;
      }
      default:
        data[field] = value;
    }
  }

  return data;
}
