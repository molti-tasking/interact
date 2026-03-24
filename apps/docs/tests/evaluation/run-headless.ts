#!/usr/bin/env tsx
/**
 * Headless CDN Evaluation Runner
 *
 * Runs the full evaluation pipeline WITHOUT Playwright or Next.js.
 * Calls LLM directly + writes to Postgres for artifact collection.
 *
 * Much lighter weight — no browser, no dev server needed.
 */

import { Client } from "pg";
import fs from "fs";
import path from "path";
import { personas, scenarios, type Persona, type Scenario } from "./personas";
import { judgeSession, type SessionScores } from "./judge-cdn";
import { aggregateScores, generateLatexTable } from "./aggregate";
import {
  cdnDimensions,
  type SessionArtifacts,
} from "./cdn-rubric";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DB_URL =
  process.env.EVAL_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/interact_eval";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_MODEL = process.env.EVAL_MODEL ?? "claude-haiku-4-5-20251001";
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "claude-sonnet-4-5-20250514";

const RESULTS_DIR = path.resolve(__dirname, "results");
const ARTIFACTS_DIR = path.join(RESULTS_DIR, "artifacts");
const JUDGE_RUNS = parseInt(process.env.EVAL_JUDGE_RUNS ?? "1", 10);

// ---------------------------------------------------------------------------
// Anthropic API helper
// ---------------------------------------------------------------------------

async function callAnthropic(
  prompt: string,
  model: string = ANTHROPIC_MODEL,
  maxTokens: number = 4096,
  temperature: number = 0.3,
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// Phase 1: Simulate a persona session (headless, no UI)
// ---------------------------------------------------------------------------

async function simulateSession(
  db: Client,
  persona: Persona,
  scenario: Scenario,
): Promise<SessionArtifacts> {
  console.log(
    `\n  🎭 ${persona.name} (${persona.skillLevel}) × ${scenario.name}`,
  );

  // 1. Create portfolio
  const intentObj = {
    purpose: { content: scenario.intent.replace(/^##\s+Purpose\n/, "").split("\n\n## ")[0], updatedAt: new Date().toISOString() },
    audience: { content: extractSection(scenario.intent, "Audience"), updatedAt: new Date().toISOString() },
    exclusions: { content: extractSection(scenario.intent, "Exclusions"), updatedAt: new Date().toISOString() },
    constraints: { content: extractSection(scenario.intent, "Constraints"), updatedAt: new Date().toISOString() },
  };

  const { rows: [portfolio] } = await db.query(
    `INSERT INTO portfolios (title, intent, schema) VALUES ($1, $2, $3) RETURNING id`,
    [scenario.title, JSON.stringify(intentObj), JSON.stringify({ fields: [], groups: [], version: 1 })],
  );
  const portfolioId = portfolio.id;
  console.log(`     Portfolio: ${portfolioId}`);

  // 2. Generate dimensions via LLM
  const intentText = `## Purpose\n${intentObj.purpose.content}\n\n## Audience\n${intentObj.audience.content}${intentObj.exclusions.content ? `\n\n## Exclusions\n${intentObj.exclusions.content}` : ""}${intentObj.constraints.content ? `\n\n## Constraints\n${intentObj.constraints.content}` : ""}`;

  const dimensionsPrompt = `You are a form design assistant. Analyze this form description and identify 3-6 key dimensions (aspects/categories) the form should cover.

Form description: ${intentText}

Return ONLY valid JSON:
{
  "dimensions": [
    { "name": "Dimension Name", "description": "What this dimension covers", "importance": "Why it matters", "scope": "broad|narrow" }
  ]
}`;

  const dimResponse = await callAnthropic(dimensionsPrompt);
  let dimensions: { name: string; description: string }[] = [];
  try {
    const parsed = JSON.parse(dimResponse.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    dimensions = parsed.dimensions ?? [];
  } catch { /* use empty */ }
  console.log(`     Dimensions: ${dimensions.map((d) => d.name).join(", ")}`);

  // 3. Generate schema via LLM
  const schemaPrompt = `You are a form design assistant. Generate a form schema based on this description and dimensions.

Description: ${intentText}

Dimensions: ${dimensions.map((d) => `- ${d.name}: ${d.description}`).join("\n")}

Return ONLY valid JSON:
{
  "fields": [
    { "id": "field-1", "name": "fieldName", "label": "Field Label", "type": { "kind": "text" }, "required": true, "constraints": [], "description": "...", "origin": "system", "tags": [] }
  ]
}

Field type kinds: text, number, select (with options: [{label, value}], multiple: false), date, boolean, email, scale (min, max).
Use camelCase for field names. Generate 6-15 fields.`;

  const schemaResponse = await callAnthropic(schemaPrompt);
  let schema = { fields: [] as any[], groups: [] as any[], version: 1 };
  try {
    const parsed = JSON.parse(schemaResponse.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    schema = { fields: parsed.fields ?? [], groups: [], version: 1 };
  } catch { /* use empty */ }
  console.log(`     Schema: ${schema.fields.length} fields`);

  // Update portfolio with schema
  await db.query(
    `UPDATE portfolios SET schema = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(schema), portfolioId],
  );

  // Log provenance
  await db.query(
    `INSERT INTO provenance_log (portfolio_id, action, layer, diff, prev_intent, rationale, actor) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [portfolioId, "schema_generated", "configuration", JSON.stringify({ added: schema.fields.map((f: any) => f.id), removed: [], modified: [] }), JSON.stringify(intentObj), "Initial schema generation", "system"],
  );

  // 4. Generate opinion questions
  const opinionsPrompt = `You are a form design assistant. Generate 3-5 refinement questions to improve this form design.

Form description: ${intentText}
Current fields: ${schema.fields.map((f: any) => `${f.label} (${f.type.kind})`).join(", ")}

Return ONLY valid JSON:
{
  "interactions": [
    { "text": "Question?", "layer": "dimensions", "options": [{ "value": "optionA", "label": "Option A" }, { "value": "optionB", "label": "Option B" }] }
  ]
}`;

  const opinionsResponse = await callAnthropic(opinionsPrompt);
  let opinionQuestions: any[] = [];
  try {
    const parsed = JSON.parse(opinionsResponse.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    opinionQuestions = parsed.interactions ?? [];
  } catch { /* use empty */ }

  // Insert opinions into DB
  for (const oq of opinionQuestions) {
    await db.query(
      `INSERT INTO opinion_interactions (portfolio_id, text, layer, source, options, status) VALUES ($1, $2, $3, $4, $5, $6)`,
      [portfolioId, oq.text, oq.layer ?? "both", "llm", JSON.stringify(oq.options ?? []), "pending"],
    );
  }
  console.log(`     Opinions: ${opinionQuestions.length} questions`);

  // 5. Persona resolves opinions via LLM
  const resolvedOpinions: SessionArtifacts["opinions"] = [];

  for (const oq of opinionQuestions) {
    const options = oq.options ?? [];
    if (options.length === 0) continue;

    const decisionPrompt = `You are ${persona.name}, a ${persona.role} (${persona.skillLevel}).
${persona.description}
Decision style: ${persona.decisionStyle}

You're designing a form and the system asks: "${oq.text}"
Options: ${options.map((o: any, i: number) => `${i + 1}. "${o.label}"`).join(", ")}

Which do you pick? Return ONLY the option value (e.g., "${options[0].value}").`;

    const decision = await callAnthropic(decisionPrompt, ANTHROPIC_MODEL, 50);
    const chosen = options.find(
      (o: any) =>
        decision.includes(o.value) || decision.toLowerCase().includes(o.label.toLowerCase()),
    ) ?? options[0];

    // Update DB
    await db.query(
      `UPDATE opinion_interactions SET selected_option = $1, status = 'resolved' WHERE portfolio_id = $2 AND text = $3`,
      [chosen.value, portfolioId, oq.text],
    );

    // Log provenance
    await db.query(
      `INSERT INTO provenance_log (portfolio_id, action, layer, diff, rationale, actor) VALUES ($1, $2, $3, $4, $5, $6)`,
      [portfolioId, "opinion_resolved", "dimensions", JSON.stringify({ added: [], removed: [], modified: [] }), `"${oq.text}" → "${chosen.label}"`, "creator"],
    );

    resolvedOpinions.push({
      text: oq.text,
      selectedLabel: chosen.label,
      status: "resolved",
    });
    console.log(`     → "${oq.text}" → "${chosen.label}"`);
  }

  // 6. Collect final intent (may have been updated by opinion resolutions)
  const { rows: [final] } = await db.query(
    `SELECT intent, schema FROM portfolios WHERE id = $1`,
    [portfolioId],
  );
  const finalIntent = typeof final.intent === "string" ? final.intent : JSON.stringify(final.intent);

  // Count provenance entries
  const { rows: [{ count: provCount }] } = await db.query(
    `SELECT count(*) FROM provenance_log WHERE portfolio_id = $1`,
    [portfolioId],
  );

  return {
    persona: {
      name: persona.name,
      role: persona.role,
      skillLevel: persona.skillLevel,
      description: persona.description,
    },
    scenario: { name: scenario.name },
    initialIntent: intentText,
    finalIntent,
    opinions: resolvedOpinions,
    fieldCount: schema.fields.length,
    schemaDescription: `${schema.fields.length} fields: ${schema.fields.map((f: any) => f.label).join(", ")}`,
    provenanceEntries: parseInt(provCount),
    provenanceSummary: `Schema generated once. ${resolvedOpinions.length} opinion resolutions recorded. ${parseInt(provCount)} total provenance entries.`,
  };
}

function extractSection(markdown: string, heading: string): string {
  const regex = new RegExp(`##\\s+${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = markdown.match(regex);
  return match ? match[1].trim() : "";
}

// ---------------------------------------------------------------------------
// Override judge-cdn to use Anthropic directly
// ---------------------------------------------------------------------------

async function judgeSessionAnthropic(
  artifacts: SessionArtifacts,
  personaId: string,
  scenarioId: string,
): Promise<SessionScores> {
  const { buildJudgingPrompt } = await import("./cdn-rubric");
  const dimensions: SessionScores["dimensions"] = [];

  for (const dim of cdnDimensions) {
    const prompt = buildJudgingPrompt(dim, artifacts);
    console.log(`     ⚖️  ${dim.name}...`);

    try {
      const text = await callAnthropic(prompt, JUDGE_MODEL, 500, 0.1);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON");
      const parsed = JSON.parse(jsonMatch[0]);

      dimensions.push({
        dimensionId: dim.id,
        dimensionName: dim.name,
        score: Math.min(5, Math.max(1, Math.round(parsed.score))),
        observations: parsed.observations ?? [],
        justification: parsed.justification ?? "",
      });
    } catch (err) {
      console.error(`     ❌ ${dim.name}: ${err}`);
      dimensions.push({
        dimensionId: dim.id,
        dimensionName: dim.name,
        score: -1,
        observations: ["Judge error"],
        justification: String(err),
      });
    }

    // Rate limit: ~50 req/min for Haiku
    await new Promise((r) => setTimeout(r, 1200));
  }

  return { personaId, scenarioId, dimensions };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY is required");
    process.exit(1);
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  console.log(`\n🔬 CDN Evaluation Runner (Headless)`);
  console.log(`   DB: ${DB_URL}`);
  console.log(`   Model (simulation): ${ANTHROPIC_MODEL}`);
  console.log(`   Model (judging): ${JUDGE_MODEL}`);
  console.log(`   Personas: ${personas.length} × Scenarios: ${scenarios.length} = ${personas.length * scenarios.length} sessions`);
  console.log(`   Judge runs: ${JUDGE_RUNS}`);
  console.log(`   Total LLM calls: ~${personas.length * scenarios.length * (4 + 4)} (simulation) + ${personas.length * scenarios.length * 8 * JUDGE_RUNS} (judging)\n`);

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // Clean slate
  await db.query("TRUNCATE opinion_interactions, provenance_log, responses, portfolios CASCADE");

  // =========================================================================
  // Phase 1: Persona Simulation
  // =========================================================================
  console.log("🎭 Phase 1: Persona Simulation\n");
  const allArtifacts: Map<string, SessionArtifacts> = new Map();

  for (const persona of personas) {
    for (const scenario of scenarios) {
      const key = `${persona.id}-${scenario.id}`;
      try {
        const artifacts = await simulateSession(db, persona, scenario);
        allArtifacts.set(key, artifacts);
        fs.writeFileSync(
          path.join(ARTIFACTS_DIR, `${key}.json`),
          JSON.stringify(artifacts, null, 2),
        );
      } catch (err) {
        console.error(`  ❌ ${key}: ${err}`);
      }
    }
  }

  console.log(`\n✅ Phase 1 done: ${allArtifacts.size} sessions\n`);

  // =========================================================================
  // Phase 2: CDN Judging
  // =========================================================================
  console.log("⚖️  Phase 2: CDN Rubric Judging\n");
  const allScores: SessionScores[] = [];

  for (const persona of personas) {
    for (const scenario of scenarios) {
      const key = `${persona.id}-${scenario.id}`;
      const artifacts = allArtifacts.get(key);
      if (!artifacts) continue;

      console.log(`  Judging ${persona.name} × ${scenario.name}:`);
      for (let run = 0; run < JUDGE_RUNS; run++) {
        const scores = await judgeSessionAnthropic(
          artifacts,
          persona.id,
          scenario.id,
        );
        allScores.push(scores);
      }
    }
  }

  fs.writeFileSync(
    path.join(RESULTS_DIR, "cdn-scores-raw.json"),
    JSON.stringify(allScores, null, 2),
  );
  console.log(`\n✅ Phase 2 done: ${allScores.length} scored sessions\n`);

  // =========================================================================
  // Phase 3: Aggregation
  // =========================================================================
  console.log("📊 Phase 3: Aggregation\n");
  const results = aggregateScores(allScores, scenarios);

  fs.writeFileSync(
    path.join(RESULTS_DIR, "cdn-scores.json"),
    JSON.stringify(results.table, null, 2),
  );

  const latexTable = generateLatexTable(results, scenarios);
  fs.writeFileSync(path.join(RESULTS_DIR, "cdn-table.tex"), latexTable);

  // Print summary
  console.log(latexTable);
  console.log("\n\n📋 Summary:\n");

  const header = ["Dimension", ...scenarios.map((s) => s.paperLabel)];
  console.log(header.join("\t\t"));
  console.log("-".repeat(70));
  for (const dim of cdnDimensions) {
    const arrow = dim.lowerIsBetter ? "↓" : "↑";
    const scores = scenarios
      .map((s) => {
        const score = results.table[s.id]?.[dim.id];
        return score && score > 0 ? score.toFixed(1) : "--";
      })
      .join("\t\t");
    console.log(`${dim.name} ${arrow}\t\t${scores}`);
  }

  await db.end();
  console.log(`\n✅ Done. Results in ${RESULTS_DIR}/`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
