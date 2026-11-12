/**
 * E1's three pipelines. Each takes a change request (or a derive request)
 * to a form in the local stack and leaves the form changed — every write
 * through the app's commit function.
 *
 * - P (Malleable Forms): the request is a typed answer to the carrier
 *   question; the app works out its preview (with scope) and applies it
 *   through the answer path, then updates the purpose as after any answer.
 *   Derive: the app's derive action and derived-form assembly.
 * - W (whole-schema rewrite): the model gets the current schema, the field
 *   vocabulary and the request, and returns a complete schema that
 *   replaces the old one. Prompts: prompts/w-*.md.
 * - R (regeneration): the request is appended to the intent's purpose and
 *   the form is generated again with the app's first-generation action;
 *   the result replaces the old one (D6).
 */
import fs from "node:fs";
import path from "node:path";
import { generateText, Output } from "ai";
import {
  previewDesignProbeOptionsAction,
  syncIntentFromFieldEditAction,
} from "@/app/actions/design-probe-actions";
import { deriveSchemaAction } from "@/app/actions/derive-actions";
import { intentToSchemaAction } from "@/app/actions/schema-actions";
import { answerChange } from "@/lib/engine/answer-change";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { derivedPortfolio } from "@/lib/derivation";
import { model } from "@/lib/model";
import { finalizeGeneratedSchema, schemaResponseSchema } from "@/lib/schema-generation";
import type { Field, Portfolio, PortfolioSchema, StructuredIntent } from "@/lib/types";
import {
  FORM_MODEL_RULES,
  NEW_FIELD_RULES,
  SCALE_FIELD_RULES,
  SECTION_RULES,
} from "interact/forms/form-model";
import { patchFieldFromField } from "interact/forms/schema-patch";
import { sanitizePurposeText } from "interact/forms/structured-intent";
import { sha256 } from "../lib/hash";
import { insertPortfolio, readPortfolio } from "../lib/db";

export type PipelineName = "P" | "W" | "R";
export const PIPELINES: PipelineName[] = ["P", "W", "R"];

/** P's carrier question (D5); part of the frozen material */
export const CARRIER_QUESTION = "Anything else to change on this form?";

/** Who the history names for the evaluation's writes */
const ACTOR = "E1 evaluation";

const PROMPTS_DIR = path.join(__dirname, "prompts");
const readPrompt = (name: string) => fs.readFileSync(path.join(PROMPTS_DIR, name), "utf-8");

/** The prompt files and the app-side texts a run depends on, hashed. */
export function promptHashes(): Record<string, string> {
  return {
    "w-change.md": sha256(readPrompt("w-change.md")),
    "w-derive.md": sha256(readPrompt("w-derive.md")),
    formRules: sha256(formRules()),
    carrierQuestion: sha256(CARRIER_QUESTION),
  };
}

function formRules(): string {
  return [FORM_MODEL_RULES, NEW_FIELD_RULES, SCALE_FIELD_RULES, SECTION_RULES].join("\n\n");
}

// ---------------------------------------------------------------------------
// The schema as the model sees it (W)
// ---------------------------------------------------------------------------

function scaleSpecOf(field: Field) {
  if (field.type.kind !== "scale") return null;
  const t = field.type;
  return {
    min: t.min,
    max: t.max,
    ...(t.points ? { points: t.points } : {}),
    ...(t.labels ? { lowLabel: t.labels.low, highLabel: t.labels.high } : {}),
  };
}

/** The form in the model's own field vocabulary, with sections. */
export function schemaForModel(schema: PortfolioSchema): string {
  const sectionOf = (id: string) => schema.groups.find((g) => g.fieldIds.includes(id))?.label;
  return JSON.stringify(
    schema.fields.map((f) => {
      const scale = scaleSpecOf(f);
      const section = sectionOf(f.id);
      return {
        ...patchFieldFromField(f),
        ...(scale ? { scale } : {}),
        ...(section ? { section } : {}),
      };
    }),
    null,
    2,
  );
}

async function rewriteSchema(template: string, schema: PortfolioSchema, request: string, functionId: string) {
  const prompt = template
    .replace("{{form_rules}}", formRules())
    .replace("{{schema}}", schemaForModel(schema))
    .replace("{{request}}", request);
  const result = await generateText({
    model,
    output: Output.object({ schema: schemaResponseSchema }),
    prompt,
    experimental_telemetry: { isEnabled: false, functionId },
  });
  if (!result.output) throw new Error("No structured output");
  return finalizeGeneratedSchema(result.output, []);
}

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------

export interface RequestOutcome {
  /** The form the request was about, after it */
  targetId: string;
  /** A derive request's new form */
  derivedId?: string;
  /** What the creator waits for, in ms (P: preview and apply; not the purpose update after it) */
  foregroundMs: number;
  /** Everything, in ms */
  totalMs: number;
  notes: string[];
}

function withPurpose(intent: StructuredIntent, sentence: string): StructuredIntent {
  const purpose = intent.purpose.content.trim();
  const joined = purpose ? `${purpose}${/[.!?]$/.test(purpose) ? "" : "."} ${sentence.trim()}` : sentence.trim();
  return { ...intent, purpose: { content: joined, updatedAt: new Date().toISOString() } };
}

export async function runChange(pipeline: PipelineName, target: Portfolio, request: string): Promise<RequestOutcome> {
  const started = Date.now();
  const notes: string[] = [];

  if (pipeline === "P") {
    const preview = await previewDesignProbeOptionsAction({
      intent: target.intent,
      currentSchema: target.schema,
      probe: { text: CARRIER_QUESTION, options: [{ value: "ownAnswer", label: request }] },
      spacePortfolios: [],
    });
    const computed = preview.options?.[0]?.preview;
    if (!preview.success || !computed) throw new Error(preview.error ?? "No preview");
    // As the deck does for a typed answer: the preview without a follow-up
    const { followUp: _followUp, ...rest } = computed;
    const option = { value: `custom:${request}`, label: request, preview: rest };
    const commit = await commitPortfolioChange(target.id, answerChange({ text: CARRIER_QUESTION }, option, ACTOR));
    if (!commit) notes.push("the answer changed nothing on the form");
    const foregroundMs = Date.now() - started;

    // The purpose follows the decision (the deck's onDecisionApplied)
    const now = await readPortfolio(target.id);
    const sync = await syncIntentFromFieldEditAction({
      intent: now.intent,
      currentSchema: now.schema,
      editDescription: `"${CARRIER_QUESTION}" → "${request}" (${rest.summary})`,
      kind: "design-decision",
    });
    if (!sync.success) notes.push(`purpose update failed: ${sync.error}`);
    else if (sync.shouldUpdate && sync.updatedPurpose) {
      const basePurpose = now.intent.purpose.content;
      const updated = sanitizePurposeText(sync.updatedPurpose);
      await commitPortfolioChange(target.id, (current) =>
        current.intent.purpose.content !== basePurpose
          ? null
          : {
              trigger: "background",
              intent: { ...current.intent, purpose: { content: updated, updatedAt: new Date().toISOString() } },
              provenance: {
                layer: "intent",
                action: "intent_synced_from_edit",
                actor: "system",
                rationale: `Purpose updated after design decisions: ${request}`,
              },
            },
      );
    }
    return { targetId: target.id, foregroundMs, totalMs: Date.now() - started, notes };
  }

  if (pipeline === "W") {
    const schema = await rewriteSchema(readPrompt("w-change.md"), target.schema, request, "e1-w-change");
    await commitPortfolioChange(target.id, (current) => ({
      trigger: "request",
      schema: { ...schema, version: current.schema.version + 1 },
      provenance: { layer: "configuration", action: "e1_w_rewrite", actor: ACTOR, rationale: request },
    }));
    const ms = Date.now() - started;
    return { targetId: target.id, foregroundMs: ms, totalMs: ms, notes };
  }

  // R: the request joins the purpose; the form is generated anew and replaces the old one
  const intent = withPurpose(target.intent, request);
  const generated = await intentToSchemaAction(intent);
  if (!generated.success || !generated.result) throw new Error(generated.error ?? "Generation failed");
  const schema = generated.result.artifactFormSchema;
  await commitPortfolioChange(target.id, (current) => ({
    trigger: "intent-edit",
    intent,
    schema: { ...schema, version: current.schema.version + 1 },
    provenance: { layer: "configuration", action: "e1_r_regenerate", actor: ACTOR, rationale: request },
  }));
  const ms = Date.now() - started;
  return { targetId: target.id, foregroundMs: ms, totalMs: ms, notes };
}

export async function runDerive(
  pipeline: PipelineName,
  base: Portfolio,
  scenario: string,
  name: string,
): Promise<RequestOutcome> {
  const started = Date.now();
  const title = `${base.title} — ${name}`;

  if (pipeline === "P") {
    const result = await deriveSchemaAction({
      parentIntent: base.intent,
      parentSchema: base.schema,
      scenarioDescription: scenario,
    });
    if (!result.success || !result.result) throw new Error(result.error ?? "Derive failed");
    const insert = derivedPortfolio(base, base.schema, result.result, scenario, ACTOR);
    const created = await insertPortfolio({
      title,
      intent: insert.intent,
      schema: insert.schema,
      base_id: base.id,
      projection: insert.projection,
    });
    // The derived form's first history entry, as useCreatePortfolio writes it
    await commitPortfolioChange(created.id, () => ({
      trigger: "derive",
      provenance: {
        layer: "configuration",
        action: "portfolio_derived",
        actor: insert.derivation.actor,
        rationale: insert.derivation.rationale,
      },
    }));
    const ms = Date.now() - started;
    return { targetId: base.id, derivedId: created.id, foregroundMs: ms, totalMs: ms, notes: [] };
  }

  const schema =
    pipeline === "W"
      ? await rewriteSchema(readPrompt("w-derive.md"), base.schema, scenario, "e1-w-derive")
      : await (async () => {
          const generated = await intentToSchemaAction(withPurpose(base.intent, scenario));
          if (!generated.success || !generated.result) throw new Error(generated.error ?? "Generation failed");
          return generated.result.artifactFormSchema;
        })();
  const intent = pipeline === "R" ? withPurpose(base.intent, scenario) : base.intent;
  const created = await insertPortfolio({ title, intent, schema, base_id: base.id });
  const ms = Date.now() - started;
  return { targetId: base.id, derivedId: created.id, foregroundMs: ms, totalMs: ms, notes: [] };
}
