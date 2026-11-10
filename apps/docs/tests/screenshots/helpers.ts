/**
 * Seeds and page helpers for the paper's figures and the demo recording.
 *
 * Portfolios, elicitation questions and history are written straight into
 * the test database (tests/db.ts: checked to be this project's), so the
 * figures need no model and come out the same every run.
 */

import type { Page } from "@playwright/test";
import path from "path";
import { connectOwnDatabase } from "../db";

/** `paper-figures/` at the repository root */
export const FIGURE_DIR = path.resolve(process.cwd(), "../../paper-figures");

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export interface SeedField {
  id: string;
  name: string;
  label: string;
  type: Record<string, unknown>;
  required: boolean;
  constraints: never[];
  description?: string;
  origin: "system" | "creator";
  tags: string[];
}

export function field(
  name: string,
  label: string,
  type: Record<string, unknown> = { kind: "text" },
  opts: { required?: boolean; description?: string; id?: string } = {},
): SeedField {
  return {
    id: opts.id ?? `f-${name}`,
    name,
    label,
    type,
    required: opts.required ?? false,
    constraints: [],
    ...(opts.description ? { description: opts.description } : {}),
    origin: "system",
    tags: [],
  };
}

export const choice = (...labels: string[]) => ({
  kind: "select",
  multiple: false,
  options: labels.map((label) => ({ label, value: label.toLowerCase().replace(/[^a-z0-9]+/g, "-") })),
});

export function intent(purpose: string, audience = "", constraints = "", exclusions = "") {
  const section = (content: string) => ({ content, updatedAt: "2026-03-02T09:00:00.000Z" });
  return {
    purpose: section(purpose),
    audience: section(audience),
    exclusions: section(exclusions),
    constraints: section(constraints),
  };
}

export const schemaOf = (fields: SeedField[]) => ({ fields, groups: [], version: 1 });

/** An answer that adds fields, with the preview the card and the form show. */
export function adds(value: string, label: string, summary: string, fields: SeedField[]) {
  const kind = (type: Record<string, unknown>) =>
    type.kind === "select" ? "select" : type.kind === "boolean" ? "boolean" : type.kind === "date" ? "date" : type.kind === "number" ? "number" : "string";
  return {
    value,
    label,
    preview: {
      summary,
      schemaPatch: {
        addFields: fields.map((f) => ({
          key: f.name,
          label: f.label,
          type: kind(f.type),
          required: f.required,
          ...(f.description ? { description: f.description } : {}),
          ...(f.type.kind === "select"
            ? { validation: { options: (f.type.options as { label: string }[]).map((o) => o.label) } }
            : {}),
        })),
      },
      scope: { added: fields.map((f) => f.name), updated: [], removed: [] },
    },
  };
}

/** An answer that changes existing fields. */
export function changes(
  value: string,
  label: string,
  summary: string,
  updates: Record<string, unknown>[],
) {
  return {
    value,
    label,
    preview: {
      summary,
      schemaPatch: { updateFields: updates },
      scope: { added: [], updated: updates.map((u) => u.key as string), removed: [] },
    },
  };
}

/** The answer that leaves the form as it is. */
export const keeps = (label = "Keep the form as it is") => ({
  value: "keepAsIs",
  label,
  unchanged: true,
  preview: {
    summary: "Keeps the form as it is",
    schemaPatch: {},
    scope: { added: [], updated: [], removed: [] },
  },
});

/** Answers in the order they are shown, each remembering the model's position. */
export function shown<T extends { value: string }>(order: number[], options: T[]) {
  return order.map((i) => ({ ...options[i], modelPosition: options[i].value === "keepAsIs" ? null : i }));
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

export interface SeedPortfolio {
  id: string;
  title: string;
  intent: Record<string, unknown>;
  schema: Record<string, unknown>;
  status?: string;
  base_id?: string;
  projection?: Record<string, unknown>;
}

export interface SeedQuestion {
  id: string;
  text: string;
  explanation?: string;
  source?: string;
  priority?: 1 | 2 | 3;
  options: Record<string, unknown>[];
  /** Answered with this value (by `by`, `minutesAgo`) */
  answer?: string;
  by?: string;
  minutesAgo?: number;
}

export interface SeedHistory {
  layer: "intent" | "dimensions" | "configuration";
  action: string;
  actor: string;
  rationale: string;
  minutesAgo: number;
  added?: SeedField[];
  modified?: { fieldId: string; before: Record<string, unknown>; after: Record<string, unknown> }[];
  /** The purpose before this change (shows as "last change" in the intent) */
  previousPurpose?: string;
}

export async function seed(data: {
  portfolios?: SeedPortfolio[];
  questions?: Record<string, SeedQuestion[]>;
  history?: Record<string, SeedHistory[]>;
}) {
  const client = await connectOwnDatabase();
  try {
    for (const p of data.portfolios ?? []) {
      await client.query(
        `INSERT INTO portfolios (id, title, intent, schema, status, base_id, projection)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          p.id,
          p.title,
          JSON.stringify(p.intent),
          JSON.stringify(p.schema),
          p.status ?? "draft",
          p.base_id ?? null,
          p.projection ? JSON.stringify(p.projection) : null,
        ],
      );
    }
    for (const [portfolioId, questions] of Object.entries(data.questions ?? {})) {
      for (const [i, q] of questions.entries()) {
        const at = `now() - interval '${q.minutesAgo ?? 30 - i} minutes'`;
        await client.query(
          `INSERT INTO design_probes
             (id, portfolio_id, text, explanation, layer, source, options, selected_option,
              status, priority, preview_status, created_at, resolved_at, resolved_by)
           VALUES ($1, $2, $3, $4, 'dimensions', $5, $6, $7, $8, $9, 'ready',
                   ${at} - interval '5 minutes', ${q.answer ? at : "NULL"}, $10)`,
          [
            q.id,
            portfolioId,
            q.text,
            q.explanation ?? null,
            q.source ?? "committee",
            JSON.stringify(q.options),
            q.answer ?? null,
            q.answer ? "resolved" : "pending",
            q.priority ?? 2,
            q.answer ? (q.by ?? null) : null,
          ],
        );
      }
    }
    for (const [portfolioId, entries] of Object.entries(data.history ?? {})) {
      for (const entry of entries) {
        await client.query(
          `INSERT INTO provenance_log
             (portfolio_id, layer, action, actor, rationale, diff, prev_intent, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(mins => $8))`,
          [
            portfolioId,
            entry.layer,
            entry.action,
            entry.actor,
            entry.rationale,
            JSON.stringify({
              added: entry.added ?? [],
              removed: [],
              modified: entry.modified ?? [],
            }),
            entry.previousPurpose ? JSON.stringify(intent(entry.previousPurpose)) : null,
            entry.minutesAgo,
          ],
        );
      }
    }
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Nothing that identifies the authors: no repository link, no account or
 * persona name, no project or lab name in the shell. Also hides the
 * framework's development overlays and toasts. Runs before every page.
 */
export const ANONYMIZE = `
(() => {
  const css = \`
    nextjs-portal, [data-nextjs-toast], [data-next-badge-root], [data-sonner-toaster] { display: none !important; }
    a[href*="github.com"], a[href*="gitlab"], [data-anonymize] { display: none !important; }
    header [role="combobox"], header button[aria-label*="Sign out" i] { display: none !important; }
    *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }
  \`;
  const boot = () => {
    if (!document.head) return;
    if (!document.getElementById("__anon")) {
      const style = document.createElement("style");
      style.id = "__anon";
      style.textContent = css;
      document.head.appendChild(style);
    }
    // The line under the product name carries the project's name
    for (const el of document.querySelectorAll("span, p, div")) {
      if (el.children.length === 0 && /research prototype/i.test(el.textContent || "")) {
        el.style.visibility = "hidden";
      }
    }
    // The sign-out control (it shows who is signed in on some layouts)
    for (const el of document.querySelectorAll("header button")) {
      if (/sign out/i.test(el.textContent || "")) el.style.display = "none";
    }
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot); else boot();
  setInterval(boot, 300);
})();
`;

/** Words that must not appear in a figure. */
export const IDENTIFYING = /github|molti-tasking|research prototype|aarhus|@test\.local|e2e-admin/i;

/** The visible text of the page, for the anonymity check. */
export function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || rect.width === 0) continue;
      if (el.closest("[style*='display: none'], nextjs-portal")) continue;
      parts.push(walker.currentNode.textContent ?? "");
    }
    return parts.join(" ");
  });
}
