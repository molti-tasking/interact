/**
 * Seed cases from the recorded fixture scenario (tests/fixtures), so the
 * harness runs without study data:
 *
 *   tsx tests/evaluation/replay/from-fixtures.ts
 *
 * The fixtures give the form, the probes and the answers. They don't cover
 * intent edits, intent sync or locked fields, so a few hand-written cases on
 * the same form are added — each with what must not happen (`expect`).
 */

import fs from "node:fs";
import path from "node:path";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { caseProblem, serializeCases, type ReplayCase } from "./cases";

const SCENARIO = "fitness-coaching";
const dir = path.resolve(__dirname, "../../fixtures", SCENARIO);
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

function intentOf(purpose: string, sections: Partial<Record<keyof StructuredIntent, string>> = {}) {
  const at = "2026-01-01T00:00:00.000Z";
  const section = (content = "") => ({ content, updatedAt: at });
  return {
    purpose: section(purpose),
    audience: section(sections.audience),
    exclusions: section(sections.exclusions),
    constraints: section(sections.constraints),
  } satisfies StructuredIntent;
}

const generated = read("000-intentToSchema.json");
const probes = read("001-generateDesignProbesAction.json");
const answers = [read("002-resolveDesignProbeAction.json"), read("003-resolveDesignProbeAction.json")];

const purpose: string = generated.input.basePrompt;
const intent = intentOf(purpose);
const schema: PortfolioSchema = generated.output.result.artifactFormSchema;
/** The form after the first recorded answer — the "later" state for previews */
const afterFirstAnswer: PortfolioSchema = answers[0].output.result.artifactFormSchema;
const keys = schema.fields.map((f) => f.name);
const source = `fixture:${SCENARIO}`;

const cases: ReplayCase[] = [
  {
    id: "fitness-probes",
    op: "generate-probes",
    source,
    note: "Probe generation on the generated form, both strategies",
    input: { intent, schema },
  },
  ...probes.output.interactions.map(
    (p: { text: string; options: { value: string; label: string }[] }, i: number): ReplayCase => ({
      id: `fitness-preview-${i + 1}`,
      op: "preview-probe-options",
      source,
      input: {
        intent,
        schema,
        probe: { text: p.text, options: p.options.map(({ value, label }) => ({ value, label })) },
        laterSchema: afterFirstAnswer,
      },
    }),
  ),
  ...answers.map(
    (a, i): ReplayCase => ({
      id: `fitness-resolve-${i + 1}`,
      op: "resolve-probe",
      source,
      input: {
        intent,
        schema: i === 0 ? schema : afterFirstAnswer,
        question: a.input.interactionText,
        answer: a.input.selectedOptionLabel,
      },
      // Answers to these questions add fields; nothing existing should change
      expect: { mayChange: [] },
    }),
  ),

  // ---- Hand-written, on the same form ----
  {
    id: "fitness-refine-add",
    op: "refine-schema",
    source: "seed",
    note: "An intent edit that asks for one more thing: only additions",
    input: {
      previousIntent: intent,
      intent: intentOf(`${purpose} I also want to know how they heard about us.`),
      schema,
    },
    expect: { mayChange: [] },
  },
  {
    id: "fitness-refine-reword",
    op: "refine-schema",
    source: "seed",
    note: "A rewording that asks for nothing new: the form must stay as it is",
    input: {
      previousIntent: intent,
      intent: intentOf(
        "This form gathers intake information from new fitness coaching clients: their health history, their fitness goals and their availability.",
      ),
      schema,
    },
    expect: { noFormChange: true },
  },
  {
    id: "fitness-refine-locked",
    op: "refine-schema",
    source: "seed",
    note: "The edit drops a topic whose field the creator locked: the field must survive",
    input: {
      previousIntent: intent,
      intent: intentOf(`${purpose} We no longer need their date of birth.`),
      schema: {
        ...schema,
        fields: schema.fields.map((f) => (f.name === "dateOfBirth" ? { ...f, locked: true } : f)),
      },
    },
    expect: { mayChange: [], mustKeep: keys },
  },
  {
    id: "fitness-refine-decisions",
    op: "refine-schema",
    source: "seed",
    note: "An unrelated edit must not undo an earlier decision (nutrition fields stay)",
    input: {
      previousIntent: intent,
      intent: intentOf(purpose, { audience: "New clients, on their phone before the first session." }),
      schema: afterFirstAnswer,
      decisions: [
        { question: answers[0].input.interactionText, answer: answers[0].input.selectedOptionLabel },
      ],
    },
    expect: { mustKeep: afterFirstAnswer.fields.map((f) => f.name), mayAdd: false },
  },
  {
    id: "fitness-sync-trivial",
    op: "sync-intent",
    source: "seed",
    note: "A label fix is too small to mention: the purpose must stay as written",
    input: {
      intent,
      schema,
      editDescription: 'Renamed field "Full Name" to "Your full name"',
      kind: "field-edit",
    },
    expect: { purposeUnchanged: true },
  },
  {
    id: "fitness-sync-decision",
    op: "sync-intent",
    source: "seed",
    note: "A design decision should show in the purpose as one edit; the rest stays verbatim",
    input: {
      intent,
      schema: afterFirstAnswer,
      editDescription: `"${answers[0].input.interactionText}" → "${answers[0].input.selectedOptionLabel}"`,
      kind: "design-decision",
    },
  },
];

for (const c of cases) {
  const problem = caseProblem(c);
  if (problem) throw new Error(`${c.id}: ${problem}`);
}
const out = path.join(__dirname, "cases", "seed.jsonl");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, serializeCases(cases));
console.log(`${cases.length} cases → ${path.relative(process.cwd(), out)}`);
