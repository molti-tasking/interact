import { APICallError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyStructuredIntent,
  type Field,
  type PortfolioSchema,
  type StructuredIntent,
} from "@/lib/types";

const generateText = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));

vi.mock("@/lib/telemetry", () => ({
  withTracing: (_opts: unknown, fn: () => unknown) => fn(),
  telemetry: (functionId: string) => ({ isEnabled: false, functionId }),
}));

import {
  detectSchemaConflictsAction,
  previewConflictFixesAction,
  resolveSchemaConflictAction,
  type SchemaConflict,
} from "@/app/actions/conflict-actions";
import { applyConflictChanges } from "@/lib/engine/conflict-changes";
import { deriveSchemaAction } from "@/app/actions/derive-actions";
import {
  curateDesignProbesAction,
  generateDesignProbesAction,
  previewDesignProbeOptionsAction,
  resolveDesignProbeAction,
} from "@/app/actions/design-probe-actions";
import {
  intentToSchemaAction,
  refineSchemaFromIntentAction,
} from "@/app/actions/schema-actions";
import { interpretSpokenAnswerAction } from "@/app/actions/spoken-answer-actions";
import {
  reviseWidgetAction,
  suggestDashboardAction,
} from "@/app/actions/dashboard-actions";
import { serializeForLLM } from "@/lib/engine/structured-intent";
import { getStandardById } from "@/lib/standards";

process.env.LLM_RATE_LIMIT_PER_MIN = "0";

function field(partial: Partial<Field> & Pick<Field, "id" | "name">): Field {
  return {
    label: partial.name,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...partial,
  };
}

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

const baseSchema: PortfolioSchema = {
  fields: [
    field({
      id: "f-weight",
      name: "weight",
      label: "Weight",
      type: { kind: "number", min: 0, max: 500, unit: "kg" },
      description: "Body weight",
      tooltip: "Use a scale",
    }),
    field({
      id: "f-size",
      name: "size",
      label: "Size",
      type: {
        kind: "select",
        multiple: true,
        options: [
          { label: "Small", value: "s" },
          { label: "Large", value: "l" },
        ],
      },
    }),
    field({ id: "f-email", name: "email", label: "Email" }),
  ],
  groups: [{ id: "g1", label: "Body", fieldIds: ["f-weight", "f-size"] }],
  version: 3,
  acceptedStandards: [
    { standardId: "fhir-patient-intake", standardName: "FHIR", domain: "healthcare" },
  ],
  columnActions: [
    {
      id: "ca1",
      fieldId: "f-email",
      prompt: "split",
      label: "Split",
      addedFields: [],
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
};

beforeEach(() => {
  generateText.mockReset();
});

describe("resolveDesignProbeAction", () => {
  const request = {
    intent: intentWith({ purpose: "Fitness check-in", exclusions: "phone" }),
    currentSchema: baseSchema,
    interactionText: "Track weight?",
    selectedOptionLabel: "Yes, in kg",
  };

  it("applies the patch without resetting type details or omitted descriptions", async () => {
    generateText.mockResolvedValue({
      output: {
        refinementDelta: "Made weight required.",
        updatedPurpose: "Fitness check-in with weight.",
        schemaPatch: {
          updateFields: [
            { key: "weight", label: "Body weight", type: "number", required: true },
            {
              key: "size",
              label: "Size",
              type: "select",
              required: false,
              validation: { options: [{ label: "Small", value: "small" }, { label: "Medium", value: "m" }] },
            },
          ],
          // Colliding add → treated as update, no duplicate key
          addFields: [{ key: "email", label: "E-mail", type: "email", required: true }],
        },
      },
    });

    const response = await resolveDesignProbeAction(request);
    expect(response.success).toBe(true);
    const schema = response.result!.artifactFormSchema;
    const weight = schema.fields.find((f) => f.name === "weight")!;
    expect(weight.type).toEqual({ kind: "number", min: 0, max: 500, unit: "kg" });
    expect(weight.description).toBe("Body weight");
    expect(weight.tooltip).toBe("Use a scale");
    expect(weight.required).toBe(true);

    const size = schema.fields.find((f) => f.name === "size")!;
    expect(size.type).toEqual({
      kind: "select",
      multiple: true,
      options: [
        { label: "Small", value: "s" },
        { label: "Medium", value: "m" },
      ],
    });

    expect(schema.fields.filter((f) => f.name === "email")).toHaveLength(1);
    expect(schema.version).toBe(4);
    expect(response.result!.schemaPatch).toBeDefined();
    expect(response.result!.applied?.updated).toEqual(
      expect.arrayContaining(["weight", "size", "email"]),
    );

    // Prompt uses the compact schema rendering and a static system prompt
    const call = generateText.mock.calls[0][0];
    expect(call.system).toMatch(/^You are a form design assistant\./);
    expect(call.prompt).toContain('- weight: "Weight" (number, min 0, max 500, unit kg)');
    expect(call.prompt).not.toContain('"fields"');
  });

  it("reports unknown keys and doesn't claim changes that didn't happen", async () => {
    generateText.mockResolvedValue({
      output: {
        refinementDelta: "Removed the phone field.",
        updatedPurpose: "Fitness check-in.",
        schemaPatch: { removeFieldKeys: ["phone"] },
      },
    });
    const response = await resolveDesignProbeAction(request);
    expect(response.result!.skipped).toEqual({ updated: [], removed: ["phone"] });
    expect(response.result!.refinementDelta).toBe("No schema changes applied.");
    expect(response.result!.artifactFormSchema.version).toBe(baseSchema.version);
  });

  it("rejects oversized custom answers before calling the model", async () => {
    const response = await resolveDesignProbeAction({
      ...request,
      selectedOptionLabel: "x".repeat(5_000),
    });
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/too long/);
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("generateDesignProbesAction", () => {
  it("maps priorities and defaults missing ones to medium", async () => {
    generateText.mockResolvedValue({
      output: {
        interactions: [
          {
            text: "Track weight?",
            layer: "dimensions",
            priority: "high",
            options: [{ value: "yes", label: "Yes" }],
          },
          {
            text: "Label tone?",
            layer: "intent",
            options: [{ value: "formal", label: "Formal" }],
          },
        ],
      },
    });

    const response = await generateDesignProbesAction(
      intentWith({ purpose: "Fitness check-in" }),
    );
    expect(response.success).toBe(true);
    expect(response.interactions!.map((p) => p.priority)).toEqual([1, 2]);
  });

  it("tells the model what forms can do and what was already asked", async () => {
    generateText.mockResolvedValue({ output: { interactions: [] } });
    await generateDesignProbesAction(
      intentWith({ purpose: "Study consent form" }),
      5,
      undefined,
      undefined,
      undefined,
      baseSchema,
      ["Track weight?"],
    );
    const call = generateText.mock.calls[0][0];
    expect(call.system).toContain("HOW FORMS WORK HERE");
    expect(call.prompt).toContain("ALREADY ASKED");
    expect(call.prompt).toContain("- Track weight?");
  });
});

describe("curateDesignProbesAction", () => {
  const openProbes = [
    { id: "id-a", text: "Track weight?", priority: 2 as const, options: [{ value: "yes", label: "Yes" }] },
    { id: "id-b", text: "Weight unit?", priority: 3 as const, options: [{ value: "kg", label: "kg" }] },
  ];
  const request = {
    intent: intentWith({ purpose: "Fitness check-in" }),
    currentSchema: baseSchema,
    openProbes,
    decisions: [{ question: "Collect email?", answer: "Yes" }],
    mode: "changes" as const,
  };

  it("maps refs back to ids, re-ranks, and skips repeated or option-less new questions", async () => {
    generateText.mockResolvedValue({
      output: {
        open: [
          { ref: "q1", keep: false, priority: "medium" },
          { ref: "q2", keep: true, priority: "high" },
          { ref: "q9", keep: false, priority: "low" }, // unknown ref — ignored
        ],
        add: [
          { text: "Collect email?", layer: "both", priority: "high", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
          { text: "Only one option", layer: "both", priority: "high", options: [{ value: "a", label: "A" }] },
          { text: "Track sleep?", layer: "dimensions", priority: "medium", options: [{ value: "y", label: "Yes" }, { value: "n", label: "No" }] },
        ],
      },
    });

    const response = await curateDesignProbesAction(request);
    expect(response.success).toBe(true);
    expect(response.result!.drop).toEqual(["id-a"]);
    expect(response.result!.priorities).toEqual({ "id-b": 1 });
    expect(response.result!.add.map((p) => p.text)).toEqual(["Track sleep?"]);

    const call = generateText.mock.calls[0][0];
    expect(call.system).toContain("HOW FORMS WORK HERE");
    expect(call.prompt).toContain('- q1 [medium] "Track weight?"');
    expect(call.prompt).toContain('- "Collect email?" → "Yes"');
    expect(call.prompt).not.toContain("id-a");
  });
});

describe("interpretSpokenAnswerAction", () => {
  const questions = [
    {
      id: "probe-1",
      text: "Include nutrition tracking?",
      options: [
        { value: "daily", label: "Daily log" },
        { value: "none", label: "No nutrition" },
      ],
      allowCustom: true,
    },
    {
      id: "conflict-1",
      text: "'Email' and 'Contact email' overlap",
      options: [{ value: "merge", label: "Merge them" }],
      allowCustom: false,
    },
  ];

  it("maps refs to ids and keeps only valid answers", async () => {
    generateText.mockResolvedValue({
      output: {
        answers: [
          { ref: "q1", action: "option", option: "Daily log" }, // label instead of value
          { ref: "q1", action: "skip" }, // second answer to the same question
          { ref: "q2", action: "custom", customAnswer: "keep both" }, // custom not allowed
          { ref: "q7", action: "skip" }, // unknown ref
        ],
      },
    });

    const response = await interpretSpokenAnswerAction({
      utterance: "a daily log I guess, and keep both emails",
      questions,
      currentId: "probe-1",
      previous: { utterance: "skip", outcome: "Skipped" },
    });

    expect(response.success).toBe(true);
    expect(response.answers).toEqual([
      { questionId: "probe-1", answer: { action: "option", value: "daily" } },
    ]);
    const call = generateText.mock.calls[0][0];
    expect(call.prompt).toContain('q1 (CURRENT — on screen): "Include nutrition tracking?"');
    expect(call.prompt).toContain('[daily] "Daily log"');
    expect(call.prompt).toContain("free-text answers: not allowed");
    expect(call.prompt).toContain('Previous phrase: "skip" → Skipped');
  });

  it("passes the note on when nothing was answered", async () => {
    generateText.mockResolvedValue({
      output: { answers: [], note: "thinking aloud" },
    });
    const response = await interpretSpokenAnswerAction({
      utterance: "hmm let me think",
      questions,
      currentId: "probe-1",
    });
    expect(response.answers).toEqual([]);
    expect(response.note).toBe("thinking aloud");
  });
});

describe("refineSchemaFromIntentAction", () => {
  it("returns only the patch for the edit, with normalized new keys", async () => {
    generateText.mockResolvedValue({
      output: {
        summary: "Added a dietary preference field.",
        schemaPatch: {
          addFields: [{ key: "Dietary Preference", label: "Dietary preference", type: "string", required: false }],
          updateFields: [{ key: "email", label: "Email", type: "email", required: true }],
        },
      },
    });

    const response = await refineSchemaFromIntentAction({
      previousIntent: intentWith({ purpose: "Fitness check-in" }),
      intent: intentWith({ purpose: "Fitness check-in with nutrition" }),
      currentSchema: baseSchema,
      decisions: [{ question: "Track weight?", answer: "Yes, in kg" }],
    });

    expect(response.success).toBe(true);
    const patch = response.result!.schemaPatch;
    expect(patch.addFields!.map((f) => f.key)).toEqual(["dietaryPreference"]);
    expect(patch.updateFields!.map((f) => f.key)).toEqual(["email"]);

    const call = generateText.mock.calls[0][0];
    expect(call.system).toContain("HOW FORMS WORK HERE");
    expect(call.prompt).toContain("Previous form description:\n## Purpose\nFitness check-in");
    expect(call.prompt).toContain("Edited form description:\n## Purpose\nFitness check-in with nutrition");
    expect(call.prompt).toContain('- "Track weight?" → "Yes, in kg"');
    expect(call.prompt).toContain('- weight: "Weight"');
    expect(call.maxRetries).toBe(0);
  });
});

describe("previewDesignProbeOptionsAction", () => {
  const request = {
    intent: intentWith({ purpose: "Fitness check-in" }),
    currentSchema: baseSchema,
    probe: {
      text: "Track body measurements?",
      options: [
        { value: "full", label: "Full measurements" },
        { value: "none", label: "No, keep it short" },
        { value: "later", label: "Ask me later" },
      ],
    },
  };

  it("attaches a preview to each option the model answered", async () => {
    generateText.mockResolvedValue({
      output: {
        outcomes: [
          {
            value: "full",
            summary: "Adds waist and hip",
            schemaPatch: {
              addFields: [
                { key: "waist", label: "Waist", type: "number", required: false },
                { key: "hip", label: "Hip", type: "number", required: false },
              ],
            },
            followUp: {
              text: "Which unit?",
              options: [
                { value: "cm", label: "Centimetres" },
                { value: "in", label: "Inches" },
              ],
            },
          },
          {
            value: "none",
            summary: "Removes size",
            schemaPatch: { removeFieldKeys: ["size"] },
          },
          // Not one of the probe's options — dropped
          { value: "invented", summary: "Adds x", schemaPatch: {} },
        ],
      },
    });

    const response = await previewDesignProbeOptionsAction(request);
    expect(response.success).toBe(true);
    const [full, none, later] = response.options!;

    expect(full.preview?.summary).toBe("Adds waist and hip");
    expect(full.preview?.schemaPatch.addFields?.map((f) => f.key)).toEqual([
      "waist",
      "hip",
    ]);
    expect(full.preview?.followUp?.text).toBe("Which unit?");
    expect(none.preview?.schemaPatch.removeFieldKeys).toEqual(["size"]);
    expect(none.preview?.followUp).toBeUndefined();
    // No outcome → no preview; answering it falls back to the LLM
    expect(later).toEqual({ value: "later", label: "Ask me later" });
    expect(response.options).toHaveLength(3);
  });

  it("doesn't let the summary claim a change the patch can't make", async () => {
    generateText.mockResolvedValue({
      output: {
        outcomes: [
          {
            value: "none",
            summary: "Removes notes",
            schemaPatch: { removeFieldKeys: ["notes"] },
          },
        ],
      },
    });

    const response = await previewDesignProbeOptionsAction(request);
    expect(response.options![1].preview?.summary).toBe("No form change");
  });

  it("reports LLM failures instead of throwing", async () => {
    generateText.mockRejectedValue(new Error("boom"));
    const response = await previewDesignProbeOptionsAction(request);
    expect(response).toEqual({ success: false, error: "boom" });
  });
});

describe("resolveSchemaConflictAction", () => {
  const conflict: SchemaConflict = {
    id: "c1",
    kind: "duplicate_fields",
    severity: "error",
    description: 'Multiple fields share the name "email"',
    fieldIds: ["f-email", "f-email-2"],
    fixes: [],
  };
  const schemaWithDuplicate: PortfolioSchema = {
    ...baseSchema,
    fields: [
      ...baseSchema.fields,
      field({ id: "f-email-2", name: "email", label: "Work email" }),
    ],
  };
  const intent = intentWith({
    purpose: "Collect check-ins",
    exclusions: "phone",
    constraints: "GDPR",
  });

  it("applies id-keyed changes and keeps schema metadata", async () => {
    generateText.mockResolvedValue({
      output: {
        updatedIntent: serializeForLLM(intent),
        changes: {
          updateFields: [{ id: "f-email-2", name: "workEmail" }],
          removeFieldIds: ["does-not-exist"],
        },
        rationale: "Renamed the second email.",
      },
    });

    const response = await resolveSchemaConflictAction(
      schemaWithDuplicate,
      intent,
      conflict,
      { value: "rename", label: "Rename duplicates", description: "…" },
    );
    expect(response.success).toBe(true);
    const { updatedSchema, updatedIntent, skipped } = response.result!;
    expect(updatedSchema.fields.map((f) => f.name)).toEqual([
      "weight",
      "size",
      "email",
      "workEmail",
    ]);
    expect(updatedSchema.fields[3].id).toBe("f-email-2");
    expect(updatedSchema.columnActions).toEqual(baseSchema.columnActions);
    expect(updatedSchema.acceptedStandards).toEqual(baseSchema.acceptedStandards);
    expect(updatedSchema.version).toBe(baseSchema.version + 1);
    expect(skipped).toEqual(["remove does-not-exist"]);

    // The echoed intent must not be folded into purpose
    expect(updatedIntent.purpose.content).toBe("Collect check-ins");
    expect(updatedIntent.exclusions.content).toBe("phone");
    expect(updatedIntent.constraints.content).toBe("GDPR");

    const call = generateText.mock.calls[0][0];
    expect(call.prompt).toContain("[f-email-2] email:");
    expect(call.prompt).not.toContain("addedFields");
  });

  it("removes a duplicate by id and prunes groups", async () => {
    generateText.mockResolvedValue({
      output: {
        updatedIntent: "",
        changes: { removeFieldIds: ["f-email-2", "f-size"] },
        rationale: "Removed.",
      },
    });
    const response = await resolveSchemaConflictAction(
      schemaWithDuplicate,
      intent,
      conflict,
      { value: "remove", label: "Keep first", description: "…" },
    );
    const { updatedSchema, updatedIntent } = response.result!;
    expect(updatedSchema.fields.map((f) => f.id)).toEqual(["f-weight", "f-email"]);
    expect(updatedSchema.groups).toEqual([
      { id: "g1", label: "Body", fieldIds: ["f-weight"] },
    ]);
    expect(updatedIntent).toBe(intent);
  });
});

describe("previewConflictFixesAction", () => {
  const conflict: SchemaConflict = {
    id: "c1",
    kind: "duplicate_fields",
    severity: "error",
    description: 'Multiple fields share the name "email"',
    fieldIds: ["f-email", "f-email-2"],
    fixes: [
      { value: "rename", label: "Rename duplicates", description: "…" },
      { value: "remove", label: "Keep first", description: "…" },
      { value: "merge", label: "Merge", description: "…" },
    ],
  };
  const schemaWithDuplicate: PortfolioSchema = {
    ...baseSchema,
    fields: [
      ...baseSchema.fields,
      field({ id: "f-email-2", name: "email", label: "Work email" }),
    ],
  };
  const intent = intentWith({ purpose: "Collect check-ins" });

  it("returns replayable changes per known fix", async () => {
    generateText.mockResolvedValue({
      output: {
        outcomes: [
          {
            value: "rename",
            summary: "Renames the work email",
            changes: { updateFields: [{ id: "f-email-2", name: "workEmail" }] },
          },
          {
            value: "remove",
            summary: "Removes the work email",
            changes: { removeFieldIds: ["f-email-2"] },
          },
          // Not one of the conflict's fixes — dropped
          { value: "invented", summary: "x", changes: {} },
        ],
      },
    });

    const response = await previewConflictFixesAction(
      schemaWithDuplicate,
      intent,
      conflict,
    );
    expect(response.success).toBe(true);
    expect(Object.keys(response.previews!)).toEqual(["rename", "remove"]);

    // The client replays a preview on the current schema
    const { schema } = applyConflictChanges(
      schemaWithDuplicate,
      response.previews!.rename.changes,
    );
    expect(schema.fields.map((f) => f.name)).toEqual([
      "weight",
      "size",
      "email",
      "workEmail",
    ]);
  });

  it("doesn't let the summary claim a change the fix can't make", async () => {
    generateText.mockResolvedValue({
      output: {
        outcomes: [
          {
            value: "remove",
            summary: "Removes a field",
            changes: { removeFieldIds: ["no-such-field"] },
          },
        ],
      },
    });
    const response = await previewConflictFixesAction(
      schemaWithDuplicate,
      intent,
      conflict,
    );
    expect(response.previews!.remove.summary).toBe("No form change");
  });
});

describe("detectSchemaConflictsAction", () => {
  it("gives LLM conflicts deterministic ids and maps cited names to ids", async () => {
    generateText.mockResolvedValue({
      output: {
        conflicts: [
          {
            kind: "semantic_overlap",
            severity: "warning",
            description: "Weight and size overlap",
            fieldIds: ["weight", "f-size"],
            fixes: [],
          },
          {
            kind: "semantic_overlap",
            severity: "info",
            description: "Same fields, other wording",
            fieldIds: ["f-size", "f-weight"],
            fixes: [],
          },
        ],
      },
    });
    const intent = intentWith({ purpose: "Check-in" });
    const first = await detectSchemaConflictsAction(baseSchema, intent);
    const second = await detectSchemaConflictsAction(baseSchema, intent);
    const ids = first.conflicts!.map((c) => c.id);
    expect(ids).toEqual(second.conflicts!.map((c) => c.id));
    expect(new Set(ids).size).toBe(2);
    expect(first.conflicts![0].fieldIds).toEqual(["f-weight", "f-size"]);
  });
});

describe("deriveSchemaAction", () => {
  const parentIntent = intentWith({
    purpose: "Patient intake",
    audience: "Patients",
    exclusions: "salary",
    constraints: "HIPAA",
  });

  it("enforces 'super', dedupes new fields, inherits groups/standards/intent", async () => {
    generateText.mockResolvedValue({
      output: {
        derivationType: "super",
        includedFieldKeys: ["weight"], // model forgot the rest
        additionalFields: [
          { key: "email", label: "Email again", type: "email", required: true },
          { key: "surgeryDate", label: "Surgery date", type: "date", required: true },
          { key: "surgeryDate", label: "Duplicate", type: "date", required: false },
          { key: "expectedSalary", label: "Expected salary", type: "number", required: false },
        ],
        derivedPurpose: "Surgical planning view.",
      },
    });

    const response = await deriveSchemaAction({
      parentIntent,
      parentSchema: {
        ...baseSchema,
        fields: [...baseSchema.fields, field({ id: "f-given", name: "givenName" })],
      },
      scenarioDescription: "Surgical planning",
    });
    expect(response.success).toBe(true);
    const { schema, includedFieldKeys, additionalFields, derivedIntent } =
      response.result!;
    expect(includedFieldKeys).toEqual(["weight", "size", "email", "givenName"]);
    expect(additionalFields.map((f) => f.name)).toEqual(["surgeryDate"]);
    expect(schema.fields.map((f) => f.name)).toEqual([
      "weight",
      "size",
      "email",
      "givenName",
      "surgeryDate",
    ]);
    expect(schema.fields[0].derivedFrom).toBe("f-weight");
    expect(schema.version).toBe(baseSchema.version + 1);
    expect(schema.groups).toEqual(baseSchema.groups);
    expect(schema.acceptedStandards).toEqual(baseSchema.acceptedStandards);
    expect(schema.columnActions).toBeUndefined();
    expect(derivedIntent).toMatchObject({
      purpose: { content: "Surgical planning view." },
      audience: { content: "" },
      exclusions: { content: "salary" },
      constraints: { content: "HIPAA" },
    });
  });

  it("drops standards whose fields are no longer present", async () => {
    generateText.mockResolvedValue({
      output: {
        derivationType: "sub",
        includedFieldKeys: ["size"],
        additionalFields: [],
        derivedPurpose: "Sizes only.",
      },
    });
    const response = await deriveSchemaAction({
      parentIntent,
      parentSchema: baseSchema,
      scenarioDescription: "Sizes",
    });
    expect(response.result!.schema.acceptedStandards).toBeUndefined();
    expect(response.result!.schema.groups).toEqual([
      { id: "g1", label: "Body", fieldIds: ["f-size"] },
    ]);
  });
});

describe("intentToSchemaAction", () => {
  const gs1 = getStandardById("gs1-gtin")!;
  const accepted = [
    {
      standard: gs1,
      confidence: 0.5,
      matchedKeywords: ["gtin"],
      relevantConstraints: gs1.fieldConstraints,
    },
  ];
  const output = {
    artifactFormSchema: {
      name: "Order",
      description: "Order form",
      fields: [
        { key: "Product Name", label: "Product name", type: "string", required: true },
        {
          key: "productCode",
          label: "GTIN",
          type: "string",
          required: true,
          standardReference: "GS1 GTIN-14 (AI 01)",
        },
        { key: "product_name", label: "Duplicate", type: "string", required: false },
      ],
    },
    configuratorFormValues: [],
  };

  it("normalizes and dedupes names, maps standard refs to keys, adds patterns", async () => {
    generateText.mockResolvedValue({ output });
    const response = await intentToSchemaAction(
      intentWith({ purpose: "Order form with GTINs" }),
      accepted,
    );
    expect(response.success).toBe(true);
    const fields = response.result!.artifactFormSchema.fields;
    expect(fields.map((f) => f.name)).toEqual(["productName", "gtin14"]);
    expect(fields[1].constraints).toEqual([
      expect.objectContaining({ type: "regex", rule: "^\\d{14}$" }),
    ]);
    expect(generateText.mock.calls[0][0].maxRetries).toBe(0);
  });

  it("groups generated fields into sections with their intros", async () => {
    generateText.mockResolvedValue({
      output: {
        artifactFormSchema: {
          name: "Study",
          description: "Post-session",
          sections: [{ title: "Usability", description: "Rate each statement." }],
          fields: [
            { key: "group", label: "Group", type: "string", required: true, section: "About you" },
            { key: "easy", label: "Easy to use", type: "string", required: true, section: "Usability" },
            { key: "notes", label: "Notes", type: "string", required: false },
          ],
        },
      },
    });
    const schema = (await intentToSchemaAction(intentWith({ purpose: "Study" }))).result!.artifactFormSchema;
    expect(schema.groups.map((g) => [g.label, g.description])).toEqual([
      ["About you", undefined],
      ["Usability", "Rate each statement."],
    ]);
    expect(schema.fields.map((f) => f.name)).toEqual(["notes", "group", "easy"]);
  });

  it("retries once on a transient error", async () => {
    generateText
      .mockRejectedValueOnce(
        new APICallError({
          message: "Bad gateway",
          url: "http://llm",
          requestBodyValues: {},
          statusCode: 502,
        }),
      )
      .mockResolvedValueOnce({ output });
    const response = await intentToSchemaAction(intentWith({ purpose: "Order" }));
    expect(response.success).toBe(true);
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient error", async () => {
    generateText.mockRejectedValue(
      new APICallError({
        message: "Bad request",
        url: "http://llm",
        requestBodyValues: {},
        statusCode: 400,
      }),
    );
    const response = await intentToSchemaAction(intentWith({ purpose: "Order" }));
    expect(response.success).toBe(false);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});

describe("dashboard actions", () => {
  const intent = intentWith({ purpose: "Fitness check-in" });

  it("suggests widgets on the form's fields only", async () => {
    generateText.mockResolvedValue({
      output: {
        widgets: [
          { kind: "kpi", fieldKeys: [], title: "Overview", rationale: "How many?", size: "full" },
          { kind: "distribution", fieldKeys: ["size"], title: "Sizes", rationale: "Which sizes?", size: "half" },
          { kind: "numeric", fieldKeys: ["shoeSize"], title: "Ghost", rationale: "", size: "half" },
        ],
      },
    });
    const response = await suggestDashboardAction({ intent, schema: baseSchema, responseCount: 12 });
    expect(response.success).toBe(true);
    expect(response.widgets!.map((w) => [w.kind, w.fieldIds])).toEqual([
      ["kpi", []],
      ["distribution", ["f-size"]],
    ]);
    const call = generateText.mock.calls[0][0];
    expect(call.prompt).toContain("Responses so far: 12");
    expect(call.system).toContain('"likert"');
    // No response data reaches the model
    expect(call.prompt).not.toContain("submittedAt");
  });

  it("revises a widget in place, or explains what the form lacks", async () => {
    const widget = { id: "w1", kind: "distribution" as const, title: "Sizes", fieldIds: ["f-size"] };
    generateText.mockResolvedValueOnce({
      output: {
        possible: true,
        reason: "",
        widget: { kind: "numeric", fieldKeys: ["weight"], title: "Weight", rationale: "", size: "half" },
      },
    });
    const revised = await reviseWidgetAction({ intent, schema: baseSchema, widget, instruction: "show weight instead" });
    expect(revised.widget).toMatchObject({ id: "w1", kind: "numeric", fieldIds: ["f-weight"], prompt: "show weight instead" });
    expect(generateText.mock.calls[0][0].prompt).toContain('fields [size]');

    generateText.mockResolvedValueOnce({
      output: {
        possible: false,
        reason: "The form doesn't ask for the respondent's role.",
        widget: { kind: "kpi", fieldKeys: [], title: "", rationale: "", size: "half" },
      },
    });
    const impossible = await reviseWidgetAction({ intent, schema: baseSchema, instruction: "split by role" });
    expect(impossible).toEqual({ success: false, error: "The form doesn't ask for the respondent's role." });
  });
});
