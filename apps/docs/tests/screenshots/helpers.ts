/**
 * Database seed helpers for paper screenshot automation.
 *
 * These helpers insert portfolios, design probes, and provenance entries
 * directly into the local Supabase database, bypassing the LLM pipeline.
 * This gives full control over screenshot content without requiring fixtures.
 */

import type { Page } from "@playwright/test";
import { Client } from "pg";
import path from "path";

export const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const SCREENSHOT_DIR = path.resolve(process.cwd(), "tests/screenshots/output");
export const SIDEBAR_WIDTH = 220;

// ---------------------------------------------------------------------------
// Database seed helpers
// ---------------------------------------------------------------------------

export async function seedPortfolio(data: {
  id: string;
  title: string;
  intent: Record<string, unknown>;
  schema: Record<string, unknown>;
  status?: string;
  base_id?: string;
  projection?: Record<string, unknown>;
}) {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  await client.query(
    `INSERT INTO portfolios (id, title, intent, schema, status, base_id, projection)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      data.id,
      data.title,
      JSON.stringify(data.intent),
      JSON.stringify(data.schema),
      data.status ?? "draft",
      data.base_id ?? null,
      data.projection ? JSON.stringify(data.projection) : null,
    ],
  );
  await client.end();
}

export async function seedDesignProbes(
  portfolioId: string,
  probes: {
    id: string;
    text: string;
    explanation?: string;
    layer: string;
    source?: string;
    options: { value: string; label: string }[];
    status?: string;
    dimensionName?: string;
    dimensionId?: string;
  }[],
) {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  for (const probe of probes) {
    await client.query(
      `INSERT INTO design_probes (id, portfolio_id, text, explanation, layer, source, options, status, dimension_name, dimension_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        probe.id,
        portfolioId,
        probe.text,
        probe.explanation ?? null,
        probe.layer,
        probe.source ?? "llm",
        JSON.stringify(probe.options),
        probe.status ?? "pending",
        probe.dimensionName ?? null,
        probe.dimensionId ?? null,
      ],
    );
  }
  await client.end();
}

export async function seedProvenance(
  portfolioId: string,
  entries: {
    layer: string;
    action: string;
    actor: string;
    rationale?: string;
    diff?: Record<string, unknown>;
  }[],
) {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  for (const entry of entries) {
    await client.query(
      `INSERT INTO provenance_log (portfolio_id, layer, action, actor, rationale, diff)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        portfolioId,
        entry.layer,
        entry.action,
        entry.actor,
        entry.rationale ?? null,
        JSON.stringify(entry.diff ?? { added: [], removed: [], modified: [] }),
      ],
    );
  }
  await client.end();
}

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

export function field(
  id: string,
  name: string,
  label: string,
  type: Record<string, unknown>,
  opts?: { required?: boolean; description?: string },
) {
  return {
    id,
    name,
    label,
    type,
    required: opts?.required ?? false,
    constraints: [],
    description: opts?.description,
    origin: "system" as const,
    tags: [],
  };
}

export function intentSection(content: string) {
  return { content, updatedAt: new Date().toISOString() };
}

export function structuredIntent(
  purpose: string,
  audience?: string,
  constraints?: string,
) {
  return {
    purpose: intentSection(purpose),
    audience: intentSection(audience ?? ""),
    exclusions: intentSection(""),
    constraints: intentSection(constraints ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------

export async function cropScreenshot(page: Page, filename: string) {
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    clip: {
      x: SIDEBAR_WIDTH,
      y: 0,
      width: 1920 - SIDEBAR_WIDTH,
      height: 1080,
    },
  });
}
