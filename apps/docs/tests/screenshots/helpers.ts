/**
 * Seeds and page helpers for the paper's figures and the demo recording.
 *
 * Portfolios, elicitation questions and history are written straight into
 * the test database (tests/db.ts: checked to be this project's), so the
 * figures need no model and come out the same every run.
 */

import type { BrowserContext, Page } from "@playwright/test";
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

// ---------------------------------------------------------------------------
// Focus and frame (figures and the demo recording)
// ---------------------------------------------------------------------------

/**
 * Only what a figure or the recording is about: no sidebar, no header bar,
 * no title and section tabs above a form (navigation and account controls
 * say nothing there), no example chips or extra options on the start
 * screen. What is left of the workspace is the intent and the elicitation
 * questions on the left and the form on the right. The app keeps all of it.
 */
export const FOCUS = `
(() => {
  const css = \`
    [data-slot="sidebar"], [data-slot="sidebar-inset"] > header { display: none !important; }
    [data-testid="portfolio-header"] { display: none !important; }
    [aria-label="Example intents"], [data-testid="new-portfolio-more"] { display: none !important; }
  \`;
  const boot = () => {
    if (!document.head || document.getElementById("__focus")) return;
    const style = document.createElement("style");
    style.id = "__focus";
    style.textContent = css;
    document.head.appendChild(style);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot); else boot();
  setInterval(boot, 300);
})();
`;

/** The window mockup's measures (CSS pixels). */
export const WINDOW_BAR = 38;
const WINDOW_RADIUS = 12;

/**
 * A window around a screenshot or a recording, as in the paper's figures:
 * a light title bar with three dots, rounded corners, a soft shadow.
 *
 * `content`: the size of what goes inside. `image`: put this picture
 * inside (figures); without it the content area is transparent (the
 * recording is placed there afterwards). `backdrop`: paint everything
 * outside the window in this colour (the video); without it the outside is
 * transparent, shadow included.
 */
export function windowFrame(opts: {
  content: { width: number; height: number };
  /** Where the window sits on the canvas */
  at: { x: number; y: number };
  canvas: { width: number; height: number };
  title?: string;
  image?: string;
  backdrop?: string;
}): string {
  const { content, at, canvas } = opts;
  const shadow = opts.backdrop
    ? `0 0 0 1px rgba(255,255,255,.14), 0 22px 60px rgba(0,0,0,.5), 0 0 0 4000px ${opts.backdrop}`
    : "0 0 0 1px rgba(0,0,0,.14), 0 14px 36px rgba(0,0,0,.22)";
  return `<!doctype html><html><body style="margin:0;width:${canvas.width}px;height:${canvas.height}px;background:transparent;overflow:hidden">
<div id="window" style="position:absolute;left:${at.x}px;top:${at.y}px;width:${content.width}px;height:${WINDOW_BAR + content.height}px;border-radius:${WINDOW_RADIUS}px;overflow:${opts.image ? "hidden" : "visible"};box-shadow:${shadow}">
  <div style="height:${WINDOW_BAR}px;box-sizing:border-box;border-radius:${WINDOW_RADIUS}px ${WINDOW_RADIUS}px 0 0;background:#e6e4df;border-bottom:1px solid #cfccc5;display:flex;align-items:center;gap:8px;padding:0 14px;font:500 13px -apple-system,'Helvetica Neue',Arial,sans-serif;color:#6b6b66">
    <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span>
    <span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span>
    <span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>
    <span style="flex:1;text-align:center;margin-right:60px">${opts.title ?? ""}</span>
  </div>
  ${opts.image ? `<img src="${opts.image}" style="display:block;width:${content.width}px;height:${content.height}px">` : ""}
</div></body></html>`;
}

/** Space around a framed figure, for its shadow */
export const FIGURE_MARGIN = 40;

/**
 * A screenshot of `page`, inside the window mockup, on a transparent
 * background. The result is larger than the page by the title bar and the
 * margin on every side.
 */
export async function framedScreenshot(
  page: Page,
  context: BrowserContext,
  file: string,
  title = "Malleable Forms",
): Promise<void> {
  const size = page.viewportSize()!;
  const shot = await page.screenshot();
  const canvas = {
    width: size.width + 2 * FIGURE_MARGIN,
    height: size.height + WINDOW_BAR + 2 * FIGURE_MARGIN,
  };
  const frame = await context.newPage();
  try {
    await frame.setViewportSize(canvas);
    await frame.setContent(
      windowFrame({
        content: size,
        at: { x: FIGURE_MARGIN, y: FIGURE_MARGIN },
        canvas,
        title,
        image: `data:image/png;base64,${shot.toString("base64")}`,
      }),
    );
    await frame.locator("img").evaluate((img: HTMLImageElement) => img.decode());
    await frame.screenshot({ path: file, omitBackground: true });
  } finally {
    await frame.close();
  }
}
