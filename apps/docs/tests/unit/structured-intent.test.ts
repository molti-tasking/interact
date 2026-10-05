import { describe, expect, it } from "vitest";
import {
  applyExclusions,
  computeDelta,
  determinePipelineStrategy,
  filterExcludedFields,
  mergeIntentText,
  normalizeFieldKey,
  parseExclusionTerms,
  parseFromMarkdown,
  serializeForLLM,
  serializeSchemaForLLM,
  serializeToMarkdown,
} from "@/lib/engine/structured-intent";
import {
  emptyPortfolioSchema,
  emptyStructuredIntent,
  type PortfolioSchema,
  type StructuredIntent,
} from "@/lib/types";

function intentWith(sections: Partial<Record<keyof StructuredIntent, string>>) {
  const intent = emptyStructuredIntent();
  for (const [key, content] of Object.entries(sections)) {
    intent[key as keyof StructuredIntent] = {
      content: content ?? "",
      updatedAt: "2026-01-01T00:00:00Z",
    };
  }
  return intent;
}

describe("pipeline strategy for routed voice utterances", () => {
  const baseSchema: PortfolioSchema = {
    ...emptyPortfolioSchema(),
    fields: [
      {
        id: "f1",
        name: "email",
        label: "Email",
        type: { kind: "text" },
        required: true,
        constraints: [],
        origin: "system",
        tags: [],
      },
    ],
  };

  it("an exclusions-only change picks the deterministic filter (no LLM)", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const next = intentWith({
      purpose: "Collect feedback",
      exclusions: "email, phone",
    });
    const delta = computeDelta(prev, next);
    expect(determinePipelineStrategy(delta, baseSchema.fields.length > 0)).toEqual(
      { kind: "filter-only" },
    );
  });

  it("a constraints-only change only re-checks conflicts", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const next = intentWith({
      purpose: "Collect feedback",
      constraints: "GDPR compliant",
    });
    const delta = computeDelta(prev, next);
    expect(determinePipelineStrategy(delta, true)).toEqual({
      kind: "recheck-constraints",
    });
  });

  it("a purpose change triggers the full pipeline", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const next = intentWith({ purpose: "Collect detailed feedback" });
    const delta = computeDelta(prev, next);
    expect(determinePipelineStrategy(delta, true)).toEqual({ kind: "full" });
  });

  it("an unchanged intent is a noop", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const delta = computeDelta(prev, intentWith({ purpose: "Collect feedback" }));
    expect(determinePipelineStrategy(delta, true)).toEqual({ kind: "noop" });
  });

  it("exclusion keywords remove matching fields deterministically", () => {
    const filtered = applyExclusions(baseSchema, "email");
    expect(filtered.fields).toHaveLength(0);
    expect(filtered.version).toBe(baseSchema.version + 1);
  });
});

describe("markdown projection", () => {
  it("keeps voice-appended purpose out of other sections on round-trip", () => {
    const intent = intentWith({
      purpose: "Collect feedback.\n\nAlso ask about delivery.",
      constraints: "Anonymous only",
    });
    const markdown = serializeToMarkdown(intent);
    const parsed = parseFromMarkdown(markdown, intent);
    expect(parsed.purpose.content).toContain("Also ask about delivery.");
    expect(parsed.constraints.content).toBe("Anonymous only");
  });
});

function field(name: string, label: string, id = name): PortfolioSchema["fields"][number] {
  return {
    id,
    name,
    label,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
  };
}

function schemaOf(...fields: PortfolioSchema["fields"]): PortfolioSchema {
  return { ...emptyPortfolioSchema(), fields };
}

describe("exclusion filtering", () => {
  it("matches whole words, not substrings", () => {
    const schema = schemaOf(
      field("age", "Age"),
      field("ageGroup", "Age group"),
      field("message", "Message"),
      field("language", "Preferred language"),
      field("pageCount", "Page count"),
    );
    const { schema: filtered, removedFields } = filterExcludedFields(schema, "age");
    expect(removedFields.map((f) => f.name)).toEqual(["age", "ageGroup"]);
    expect(filtered.fields.map((f) => f.name)).toEqual([
      "message",
      "language",
      "pageCount",
    ]);
  });

  it("splits free text into terms and drops filler words", () => {
    expect(parseExclusionTerms("Don't ask about salary or phone number")).toEqual([
      ["salary"],
      ["phone"],
    ]);
    const schema = schemaOf(
      field("expectedSalary", "Expected salary"),
      field("phone", "Phone"),
      field("email", "Email"),
    );
    const result = filterExcludedFields(
      schema,
      "Don't ask about salary or phone number",
    );
    expect(result.removedFields.map((f) => f.name)).toEqual([
      "expectedSalary",
      "phone",
    ]);
    expect(result.terms).toEqual(["salary", "phone"]);
  });

  it("matches multi-word terms against camelCase names in any order", () => {
    const schema = schemaOf(field("birthDate", "Birthday"), field("date", "Date"));
    const { removedFields } = filterExcludedFields(schema, "date of birth");
    expect(removedFields.map((f) => f.name)).toEqual(["birthDate"]);
  });

  it("handles plurals, hyphens and bullet lists", () => {
    const schema = schemaOf(
      field("phoneNumber", "Phone number"),
      field("contactEmail", "Contact e-mail"),
      field("homeAddress", "Home address"),
      field("notes", "Notes"),
    );
    const { removedFields } = filterExcludedFields(
      schema,
      "- phones\n- E-mail\n- addresses",
    );
    expect(removedFields.map((f) => f.name)).toEqual([
      "phoneNumber",
      "contactEmail",
      "homeAddress",
    ]);
  });

  it("ignores descriptions and leaves the schema untouched when nothing matches", () => {
    const schema = schemaOf({
      ...field("notes", "Notes"),
      description: "Anything about salary expectations",
    });
    const result = filterExcludedFields(schema, "salary");
    expect(result.removedFields).toHaveLength(0);
    expect(result.schema).toBe(schema);
    expect(applyExclusions(schema, "salary").version).toBe(schema.version);
  });

  it("prunes removed fields from groups", () => {
    const schema: PortfolioSchema = {
      ...schemaOf(field("salary", "Salary", "f1"), field("name", "Name", "f2")),
      groups: [
        { id: "g1", label: "Pay", fieldIds: ["f1"] },
        { id: "g2", label: "Person", fieldIds: ["f1", "f2"] },
      ],
    };
    const filtered = applyExclusions(schema, "salary");
    expect(filtered.groups).toEqual([
      { id: "g2", label: "Person", fieldIds: ["f2"] },
    ]);
  });
});

describe("pipeline strategy when exclusions change", () => {
  it("adding an exclusion filters deterministically", () => {
    const prev = intentWith({ purpose: "Collect feedback", exclusions: "email" });
    const next = intentWith({
      purpose: "Collect feedback",
      exclusions: "email, phone",
    });
    const delta = computeDelta(prev, next);
    expect(delta.exclusionsRemoved).toBe(false);
    expect(determinePipelineStrategy(delta, true)).toEqual({ kind: "filter-only" });
  });

  it("deleting an exclusion runs the full pipeline (filtering can't restore fields)", () => {
    const prev = intentWith({
      purpose: "Collect feedback",
      exclusions: "email, phone",
    });
    const next = intentWith({ purpose: "Collect feedback", exclusions: "email" });
    const delta = computeDelta(prev, next);
    expect(delta.exclusionsRemoved).toBe(true);
    expect(determinePipelineStrategy(delta, true)).toEqual({ kind: "full" });
  });

  it("rewording without dropping a term stays filter-only", () => {
    const prev = intentWith({ purpose: "Collect feedback", exclusions: "phone" });
    const next = intentWith({
      purpose: "Collect feedback",
      exclusions: "Don't ask about phone numbers",
    });
    expect(determinePipelineStrategy(computeDelta(prev, next), true)).toEqual({
      kind: "filter-only",
    });
  });
});

describe("parseFromMarkdown", () => {
  it("clears a section whose heading block was deleted while other headings remain", () => {
    const prev = intentWith({
      purpose: "Collect feedback",
      audience: "Customers",
      exclusions: "email",
    });
    const parsed = parseFromMarkdown(
      "## Purpose\nCollect feedback\n\n## Audience\nCustomers",
      prev,
    );
    expect(parsed.exclusions.content).toBe("");
    expect(parsed.audience).toBe(prev.audience);
  });

  it("treats text before the first heading as purpose", () => {
    const prev = intentWith({ purpose: "Old", exclusions: "email" });
    const parsed = parseFromMarkdown("New purpose\n\n## Exclusions\nemail", prev);
    expect(parsed.purpose.content).toBe("New purpose");
    expect(parsed.exclusions).toBe(prev.exclusions);
  });

  it("maps headingless text to purpose verbatim and clears nothing else when only purpose was shown", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const parsed = parseFromMarkdown("Collect feedback\n", prev);
    expect(parsed.purpose.content).toBe("Collect feedback\n");
    expect(parsed.audience).toBe(prev.audience);
  });

  it("clears other sections when the user removed every heading the editor showed", () => {
    const prev = intentWith({ purpose: "Collect feedback", exclusions: "email" });
    // Editor showed "## Purpose\n…\n\n## Exclusions\nemail"; user deleted the
    // Exclusions block and the Purpose heading.
    const parsed = parseFromMarkdown("Collect feedback", prev);
    expect(parsed.purpose.content).toBe("Collect feedback");
    expect(parsed.exclusions.content).toBe("");
  });

  it("recognizes the decorated headings serializeForLLM emits", () => {
    const prev = intentWith({ purpose: "A", exclusions: "email" });
    const parsed = parseFromMarkdown(serializeForLLM(prev), prev);
    expect(parsed.purpose.content).toBe("A");
    expect(parsed.exclusions.content).toBe("email");
  });

  it("does not treat a mid-line '## ' as a heading", () => {
    const prev = intentWith({ purpose: "A", constraints: "GDPR" });
    const parsed = parseFromMarkdown("## Purpose\nUse ## for notes\n\n## Constraints\nGDPR", prev);
    expect(parsed.purpose.content).toBe("Use ## for notes");
    expect(parsed.constraints).toBe(prev.constraints);
  });
});

describe("mergeIntentText (LLM output)", () => {
  it("keeps sections the model left out", () => {
    const prev = intentWith({
      purpose: "Collect feedback",
      audience: "Customers",
      exclusions: "email",
    });
    const merged = mergeIntentText("## Purpose\nCollect detailed feedback", prev);
    expect(merged.purpose.content).toBe("Collect detailed feedback");
    expect(merged.audience).toBe(prev.audience);
    expect(merged.exclusions).toBe(prev.exclusions);
  });

  it("does not compound the serialized intent into purpose", () => {
    const prev = intentWith({
      purpose: "Collect feedback",
      exclusions: "email",
      constraints: "GDPR",
    });
    const echoed = serializeForLLM(prev).replace("GDPR", "GDPR and CCPA");
    const merged = mergeIntentText(echoed, prev);
    expect(merged.purpose).toBe(prev.purpose);
    expect(merged.exclusions).toBe(prev.exclusions);
    expect(merged.constraints.content).toBe("GDPR and CCPA");
    // Round-tripping again is stable
    expect(mergeIntentText(serializeForLLM(merged), merged)).toEqual(merged);
  });

  it("maps headingless text to purpose only", () => {
    const prev = intentWith({ purpose: "Old", audience: "Staff" });
    const merged = mergeIntentText("New purpose.", prev);
    expect(merged.purpose.content).toBe("New purpose.");
    expect(merged.audience).toBe(prev.audience);
  });
});

describe("serializeSchemaForLLM", () => {
  it("renders one compact line per field with type details", () => {
    const schema: PortfolioSchema = {
      ...emptyPortfolioSchema(),
      fields: [
        { ...field("weight", "Weight"), type: { kind: "number", min: 0, unit: "kg" }, required: true },
        {
          ...field("size", "Size"),
          type: {
            kind: "select",
            multiple: false,
            options: [
              { label: "Small", value: "small" },
              { label: "L", value: "L" },
            ],
          },
          description: "Shirt size",
        },
      ],
    };
    expect(serializeSchemaForLLM(schema)).toBe(
      '- weight: "Weight" (number, min 0, unit kg, required)\n' +
        '- size: "Size" (select: [Small=small | L]) — Shirt size',
    );
    expect(serializeSchemaForLLM(schema, { ids: true })).toContain("- [weight] weight:");
  });
});

describe("normalizeFieldKey", () => {
  it.each([
    ["firstName", "firstName"],
    ["FirstName", "firstName"],
    ["first_name", "firstName"],
    ["First Name", "firstName"],
    ["GTIN-14", "gtin14"],
    ["GTIN14", "gtin14"],
    ["URLPath", "urlPath"],
    ["  email ", "email"],
    ["2nd address", "field2ndAddress"],
    ["Straße", "straße"],
    ["", "field"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeFieldKey(raw)).toBe(expected);
  });
});
