/**
 * Study export → replay cases.
 *
 * The facilitator's export (`useStudyExport`, the JSON bundle from
 * /studies/<id>) has everything a replay needs in structured form: every
 * automated change is a `provenance_log` row with the form and intent as
 * they were just before it (`prev_schema`, `prev_intent`), and the probes
 * carry the previews participants were shown. That is why cases are built
 * from the export rather than from LLM traces: a trace holds the prompt as
 * text, which stops matching as soon as a prompt is reworded.
 *
 * Personal data: participant ids, user ids, names, panel ids, events and
 * questionnaire answers are not read at all. What stays is what participants
 * typed into their forms (descriptions, labels, custom answers) — free text
 * that can still identify someone. Keep converted cases in the gitignored
 * `private/` directory.
 *
 *   tsx tests/evaluation/replay/from-study-export.ts <export.json> [out.jsonl]
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DesignProbeOption,
  PortfolioSchema,
  StructuredIntent,
} from "@/lib/types";
import {
  caseProblem,
  serializeCases,
  type ReplayCase,
} from "./cases";

/** The parts of a study export the converter reads. */
export interface StudyExportLike {
  session?: { join_code?: string | null } | null;
  portfolios: {
    id: string;
    schema: unknown;
    intent: unknown;
  }[];
  provenance: {
    id: string;
    portfolio_id: string;
    action: string;
    created_at: string | null;
    rationale: string | null;
    prev_schema: unknown;
    prev_intent: unknown;
  }[];
  designProbes: {
    id: string;
    portfolio_id: string;
    text: string;
    explanation: string | null;
    options: unknown;
    selected_option: string | null;
    source: string;
  }[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function toSchema(value: unknown): PortfolioSchema | null {
  if (!isObject(value) || !Array.isArray(value.fields)) return null;
  return {
    ...(value as unknown as PortfolioSchema),
    groups: Array.isArray(value.groups) ? (value.groups as PortfolioSchema["groups"]) : [],
    version: typeof value.version === "number" ? value.version : 1,
  };
}

function toIntent(value: unknown): StructuredIntent | null {
  if (!isObject(value)) return null;
  const section = (key: string) => {
    const s = value[key];
    return {
      content: isObject(s) && typeof s.content === "string" ? s.content : "",
      updatedAt: isObject(s) && typeof s.updatedAt === "string" ? s.updatedAt : "",
    };
  };
  if (!isObject(value.purpose)) return null;
  return {
    purpose: section("purpose"),
    audience: section("audience"),
    exclusions: section("exclusions"),
    constraints: section("constraints"),
  };
}

function toOptions(value: unknown): DesignProbeOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (o): o is DesignProbeOption =>
      isObject(o) && typeof o.value === "string" && typeof o.label === "string",
  );
}

/** `"question" → "answer"`, as `design_probe_resolved` rows record it. */
export function parseDecisionRationale(
  rationale: string | null,
): { question: string; answer: string } | null {
  const match = rationale?.match(
    /^(?:Re-edited: )?"([\s\S]*?)" → "([\s\S]*?)"(?: \(was: [\s\S]*\))?$/,
  );
  return match ? { question: match[1], answer: match[2] } : null;
}

/** The description part of an `intent_synced_from_edit` rationale. */
export function parseSyncRationale(
  rationale: string | null,
): { editDescription: string; kind: "field-edit" | "design-decision" } | null {
  const match = rationale?.match(/^Purpose updated after (design decisions|field edits): ([\s\S]+)$/);
  if (!match) return null;
  return {
    editDescription: match[2],
    kind: match[1] === "design decisions" ? "design-decision" : "field-edit",
  };
}

export interface ConversionReport {
  cases: ReplayCase[];
  /** Rows that couldn't become a case, by reason */
  skipped: Record<string, number>;
}

/**
 * One case per automated change in the export:
 * - `design_probe_resolved` / `design_probe_re_resolved` → a resolve-probe
 *   case, and (once per probe) a preview case with the recorded previews
 *   and the final form as the "later" state;
 * - `schema_refined` → a refine-schema case (previous intent from the
 *   `intent_updated` row before it);
 * - `intent_synced_from_edit` → a sync-intent case;
 * - `schema_generated` → a generate-probes case on the generated form.
 */
export function casesFromStudyExport(data: StudyExportLike): ConversionReport {
  const code = data.session?.join_code?.trim() || "session";
  const source = `study:${code}`;
  const cases: ReplayCase[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  // Portfolios are numbered in a stable order; their ids don't leave here
  const portfolios = [...data.portfolios].sort((a, b) => a.id.localeCompare(b.id));

  portfolios.forEach((portfolio, portfolioIndex) => {
    const prefix = `${code}-p${portfolioIndex + 1}`;
    const rows = data.provenance
      .filter((r) => r.portfolio_id === portfolio.id)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    const probes = data.designProbes.filter((p) => p.portfolio_id === portfolio.id);
    const finalSchema = toSchema(portfolio.schema);
    const finalIntent = toIntent(portfolio.intent);

    /** The form right after row `i`: what the next row saw, or the final one. */
    const after = (i: number) => ({
      schema: toSchema(rows[i + 1]?.prev_schema) ?? finalSchema,
      intent: toIntent(rows[i + 1]?.prev_intent) ?? finalIntent,
    });

    const previewed = new Set<string>();
    const decisions: { question: string; answer: string }[] = [];
    let count = 0;
    const nextId = (op: string) => `${prefix}-${String(++count).padStart(3, "0")}-${op}`;

    rows.forEach((row, i) => {
      const schema = toSchema(row.prev_schema);
      const intent = toIntent(row.prev_intent);

      switch (row.action) {
        case "design_probe_resolved":
        case "design_probe_re_resolved": {
          const decision = parseDecisionRationale(row.rationale);
          if (!decision) return skip("decision rationale not parsable");
          if (!schema || !intent) return skip("no previous form state");
          cases.push({
            id: nextId("resolve"),
            op: "resolve-probe",
            source,
            input: { intent, schema, question: decision.question, answer: decision.answer },
          });

          const probe = probes.find((p) => p.text === decision.question && !previewed.has(p.id));
          const options = toOptions(probe?.options);
          // Findings and standards have computed answers — nothing to preview
          if (probe && options.length >= 2 && !["data", "standard"].includes(probe.source)) {
            previewed.add(probe.id);
            cases.push({
              id: nextId("preview"),
              op: "preview-probe-options",
              source,
              input: {
                intent,
                schema,
                probe: {
                  text: probe.text,
                  ...(probe.explanation ? { explanation: probe.explanation } : {}),
                  options: options.map(({ value, label }) => ({ value, label })),
                },
                ...(finalSchema ? { laterSchema: finalSchema } : {}),
              },
              ...(options.some((o) => o.preview)
                ? { recorded: { options, selected: probe.selected_option } }
                : {}),
            });
          }
          decisions.unshift(decision);
          return;
        }

        case "schema_refined": {
          if (!schema || !intent) return skip("no previous form state");
          const edit = rows
            .slice(0, i)
            .reverse()
            .find((r) => r.action === "intent_updated");
          const previousIntent = toIntent(edit?.prev_intent);
          if (!previousIntent) return skip("no intent edit before refinement");
          cases.push({
            id: nextId("refine"),
            op: "refine-schema",
            source,
            input: {
              previousIntent,
              intent,
              schema,
              ...(decisions.length ? { decisions: decisions.slice(0, 20) } : {}),
            },
          });
          return;
        }

        case "intent_synced_from_edit": {
          const sync = parseSyncRationale(row.rationale);
          if (!sync) return skip("sync rationale not parsable");
          if (!schema || !intent) return skip("no previous form state");
          cases.push({
            id: nextId("sync"),
            op: "sync-intent",
            source,
            input: { intent, schema, ...sync },
          });
          return;
        }

        case "schema_generated": {
          const generated = after(i);
          if (!generated.schema || !generated.intent) return skip("no form after generation");
          if (generated.schema.fields.length === 0) return skip("generation produced no fields");
          cases.push({
            id: nextId("probes"),
            op: "generate-probes",
            source,
            input: { intent: generated.intent, schema: generated.schema },
          });
          return;
        }
      }
    });
  });

  for (const c of cases) {
    const problem = caseProblem(c);
    if (problem) throw new Error(`Converter produced an invalid case ${c.id}: ${problem}`);
  }
  return { cases, skipped };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error("Usage: tsx tests/evaluation/replay/from-study-export.ts <export.json> [out.jsonl]");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(input, "utf8")) as StudyExportLike;
  const { cases, skipped } = casesFromStudyExport(data);
  const out =
    output ??
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "private",
      `${data.session?.join_code?.trim() || "session"}.jsonl`,
    );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serializeCases(cases));

  const byOp = new Map<string, number>();
  for (const c of cases) byOp.set(c.op, (byOp.get(c.op) ?? 0) + 1);
  console.log(`${cases.length} cases → ${out}`);
  for (const [op, n] of byOp) console.log(`  ${op}: ${n}`);
  for (const [reason, n] of Object.entries(skipped)) console.log(`  skipped (${reason}): ${n}`);
  console.log(
    "These cases contain what participants typed into their forms. Keep them out of the repo.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
