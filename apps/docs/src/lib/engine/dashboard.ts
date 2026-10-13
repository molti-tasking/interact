/**
 * The response dashboard's spec: which widgets chart which fields.
 *
 * The LLM proposes widgets (validated here against the form), the creator
 * edits them, and the spec is stored with the schema (`schema.dashboard`)
 * so changes are versioned and show in History. All numbers come from
 * `response-stats.ts`.
 */

import { z } from "zod";
import {
  DASHBOARD_WIDGET_KINDS,
  type DashboardSpec,
  type DashboardWidget,
  type DashboardWidgetKind,
  type Field,
  type PortfolioSchema,
} from "../types";
import {
  categoryStats,
  crosstabStats,
  isCategorical,
  kpiStats,
  likertStats,
  numericStats,
  textStats,
  timelineStats,
  type CategoryStats,
  type CrosstabStats,
  type KpiStats,
  type LikertStats,
  type NumericStats,
  type StatsRow,
  type TextStats,
  type TimelineStats,
} from "./response-stats";
import { groupLikertRuns, MAX_GRID_POINTS, scaleChoices } from "./scale";

export const WIDGET_KIND_INFO: Record<
  DashboardWidgetKind,
  { label: string; takes: string }
> = {
  kpi: { label: "Overview", takes: "no fields" },
  distribution: {
    label: "Answer counts",
    takes: "one choice, yes/no or rating-scale field",
  },
  likert: {
    label: "Likert scale",
    takes: "one or more rating-scale fields with the same points (a battery)",
  },
  numeric: { label: "Number summary", takes: "one number or rating-scale field" },
  timeline: {
    label: "Over time",
    takes: "no field (responses per day) or one date field",
  },
  crosstab: {
    label: "Cross-tab",
    takes: "two choice, yes/no or rating-scale fields (rows, columns)",
  },
  text: { label: "Text answers", takes: "one free-text field" },
};

/** Dashboards stay scannable; suggestions are capped here. */
export const MAX_WIDGETS = 10;

// ---------------------------------------------------------------------------
// Which widget fits which fields
// ---------------------------------------------------------------------------

function isLikertField(field: Field): boolean {
  const choices = scaleChoices(field.type);
  return !!choices && choices.length <= MAX_GRID_POINTS;
}

function sameChoices(a: Field, b: Field): boolean {
  return (
    JSON.stringify(scaleChoices(a.type)) === JSON.stringify(scaleChoices(b.type))
  );
}

/** Whether `kind` can chart exactly these fields. */
export function widgetFits(kind: DashboardWidgetKind, fields: readonly Field[]): boolean {
  switch (kind) {
    case "kpi":
      return fields.length === 0;
    case "timeline":
      return (
        fields.length === 0 ||
        (fields.length === 1 && fields[0].type.kind === "date")
      );
    case "distribution":
      return fields.length === 1 && isCategorical(fields[0]);
    case "likert":
      return (
        fields.length >= 1 &&
        fields.every(isLikertField) &&
        fields.every((f) => sameChoices(f, fields[0]))
      );
    case "numeric":
      return (
        fields.length === 1 &&
        (fields[0].type.kind === "number" || fields[0].type.kind === "scale")
      );
    case "crosstab":
      return (
        fields.length === 2 &&
        fields[0].id !== fields[1].id &&
        fields.every(isCategorical)
      );
    case "text":
      return fields.length === 1 && fields[0].type.kind === "text";
  }
}

/** Kinds that can chart one field, best first; empty when it can't be charted. */
export function kindsForField(field: Field): DashboardWidgetKind[] {
  const order: DashboardWidgetKind[] = [
    "likert",
    "distribution",
    "numeric",
    "text",
    "timeline",
  ];
  return order.filter((kind) => widgetFits(kind, [field]));
}

/** The widget's default width when it doesn't set one. */
export function widgetSize(widget: DashboardWidget): "half" | "full" {
  if (widget.size) return widget.size;
  return ["kpi", "timeline", "likert", "crosstab"].includes(widget.kind)
    ? "full"
    : "half";
}

export function newWidgetId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `widget-${uuid}`
    : `widget-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ResolvedWidget {
  widget: DashboardWidget;
  /** The widget's fields that still exist */
  fields: Field[];
  /** How many of its fields were removed from the form */
  missing: number;
  /** Whether what's left can still be charted as this kind */
  fits: boolean;
}

/** Look up a stored widget's fields in the current form. */
export function resolveWidget(
  widget: DashboardWidget,
  schema: PortfolioSchema,
): ResolvedWidget {
  const byId = new Map(schema.fields.map((f) => [f.id, f]));
  const fields = widget.fieldIds
    .map((id) => byId.get(id))
    .filter((f): f is Field => !!f);
  return {
    widget,
    fields,
    missing: widget.fieldIds.length - fields.length,
    fits: widgetFits(widget.kind, fields),
  };
}

export type WidgetData =
  | { kind: "kpi"; stats: KpiStats }
  | { kind: "distribution"; stats: CategoryStats }
  | { kind: "likert"; stats: LikertStats }
  | { kind: "numeric"; stats: NumericStats }
  | { kind: "timeline"; stats: TimelineStats }
  | { kind: "crosstab"; stats: CrosstabStats; rowField: Field; colField: Field }
  | { kind: "text"; stats: TextStats };

/** What a widget shows, computed from the responses; null when it can't chart its fields. */
export function widgetData(
  resolved: ResolvedWidget,
  schema: PortfolioSchema,
  rows: readonly StatsRow[],
): WidgetData | null {
  const { widget, fields, fits } = resolved;
  if (!fits) return null;
  switch (widget.kind) {
    case "kpi":
      return { kind: "kpi", stats: kpiStats(schema, rows) };
    case "distribution":
      return { kind: "distribution", stats: categoryStats(fields[0], rows) };
    case "likert": {
      const stats = likertStats(fields, rows);
      return stats && { kind: "likert", stats };
    }
    case "numeric":
      return { kind: "numeric", stats: numericStats(fields[0], rows) };
    case "timeline":
      return { kind: "timeline", stats: timelineStats(rows, fields[0]) };
    case "crosstab":
      return {
        kind: "crosstab",
        stats: crosstabStats(fields[0], fields[1], rows),
        rowField: fields[0],
        colField: fields[1],
      };
    case "text":
      return { kind: "text", stats: textStats(fields[0], rows) };
  }
}

// ---------------------------------------------------------------------------
// Default dashboard (no LLM; also the fallback when suggesting fails)
// ---------------------------------------------------------------------------

export function defaultDashboard(schema: PortfolioSchema): DashboardSpec {
  const widgets: DashboardWidget[] = [
    { id: newWidgetId(), kind: "kpi", title: "Overview", fieldIds: [] },
    { id: newWidgetId(), kind: "timeline", title: "Responses over time", fieldIds: [] },
  ];

  for (const block of groupLikertRuns(schema.fields)) {
    if (widgets.length >= MAX_WIDGETS) break;
    if (Array.isArray(block)) {
      if (widgetFits("likert", block)) {
        widgets.push({
          id: newWidgetId(),
          kind: "likert",
          title: `Ratings (${block.length} statements)`,
          fieldIds: block.map((f) => f.id),
        });
      }
      continue;
    }
    const kind = kindsForField(block)[0];
    if (kind) {
      widgets.push({ id: newWidgetId(), kind, title: block.label, fieldIds: [block.id] });
    }
  }

  return { widgets };
}

// ---------------------------------------------------------------------------
// LLM proposals → widgets
// ---------------------------------------------------------------------------

/**
 * One proposed widget. All properties are required and `fieldKeys` follows
 * `kind` — the provider caps optional parameters, and the model tends to
 * skip properties placed far from the one they depend on.
 */
const widgetProposalSchema = z.object({
  kind: z.enum(DASHBOARD_WIDGET_KINDS),
  fieldKeys: z
    .array(z.string())
    .describe("Exact field keys from the form, as listed — as many as the kind takes"),
  title: z.string().describe("Short title saying what it shows, max ~6 words"),
  rationale: z
    .string()
    .describe("One short sentence: the question from the form's purpose this answers"),
  size: z.enum(["half", "full"]),
});

export type WidgetProposal = z.infer<typeof widgetProposalSchema>;

export const dashboardSuggestionSchema = z.object({
  widgets: z
    .array(widgetProposalSchema)
    .describe(`Most important first, at most ${MAX_WIDGETS}`),
});

export const widgetRevisionSchema = z.object({ widget: widgetProposalSchema });

/** The widget kinds for prompts. */
export const WIDGET_KIND_GUIDE = DASHBOARD_WIDGET_KINDS.map(
  (kind) => `- "${kind}" (${WIDGET_KIND_INFO[kind].label}): ${WIDGET_KIND_INFO[kind].takes}`,
).join("\n");

/**
 * Turn proposals into widgets: field keys (or labels) → ids, then drop or
 * repair what doesn't fit the form. `keepId` keeps the id of a revised widget.
 */
export function widgetsFromProposals(
  proposals: readonly WidgetProposal[],
  schema: PortfolioSchema,
  opts: { keepId?: string; prompt?: string } = {},
): DashboardWidget[] {
  const byKey = new Map<string, Field>();
  for (const f of schema.fields) {
    byKey.set(f.name, f);
    byKey.set(f.label.trim().toLowerCase(), f);
  }

  const widgets: DashboardWidget[] = [];
  const seen = new Set<string>();
  for (const p of proposals) {
    let fields = [
      ...new Set(
        p.fieldKeys
          .map((k) => byKey.get(k.trim()) ?? byKey.get(k.trim().toLowerCase()))
          .filter((f): f is Field => !!f),
      ),
    ];
    let kind = p.kind;
    if (!widgetFits(kind, fields)) {
      // Repair: chart the first field the best way it can be charted
      const fallback = fields[0] && kindsForField(fields[0])[0];
      if (!fallback) continue;
      kind = fallback;
      fields = [fields[0]];
    }
    // The same chart twice is noise
    const signature = `${kind}:${fields.map((f) => f.id).join(",")}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    widgets.push({
      id: opts.keepId && widgets.length === 0 ? opts.keepId : newWidgetId(),
      kind,
      title: p.title.trim() || WIDGET_KIND_INFO[kind].label,
      fieldIds: fields.map((f) => f.id),
      rationale: p.rationale.trim() || undefined,
      size: p.size,
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
    });
    if (widgets.length >= MAX_WIDGETS) break;
  }
  return widgets;
}

// ---------------------------------------------------------------------------
// Saving: merge and describe
// ---------------------------------------------------------------------------

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge by widget id, for saving an edit made from `base` onto a
 * dashboard someone else changed meanwhile (`theirs`): our adds, removals,
 * edits and order win; widgets only they added or changed are kept.
 */
export function mergeDashboard(
  base: DashboardSpec | undefined,
  ours: DashboardSpec,
  theirs: DashboardSpec | undefined,
): DashboardSpec {
  const baseById = new Map((base?.widgets ?? []).map((w) => [w.id, w]));
  const theirsById = new Map((theirs?.widgets ?? []).map((w) => [w.id, w]));

  const widgets: DashboardWidget[] = [];
  for (const w of ours.widgets) {
    const b = baseById.get(w.id);
    const t = theirsById.get(w.id);
    if (b && !t) {
      // They removed it; keep it only if we changed it
      if (!same(b, w)) widgets.push(w);
      continue;
    }
    widgets.push(b && same(b, w) && t ? t : w);
  }
  const ourIds = new Set(ours.widgets.map((w) => w.id));
  for (const t of theirs?.widgets ?? []) {
    if (!baseById.has(t.id) && !ourIds.has(t.id)) widgets.push(t);
  }

  return { ...theirs, ...ours, widgets };
}

/** History rationale for a dashboard edit. */
export function describeDashboardChanges(
  before: DashboardSpec | undefined,
  after: DashboardSpec,
): string {
  const beforeById = new Map((before?.widgets ?? []).map((w) => [w.id, w]));
  const afterIds = new Set(after.widgets.map((w) => w.id));
  const quote = (titles: string[]) => titles.map((t) => `"${t}"`).join(", ");

  const added = after.widgets.filter((w) => !beforeById.has(w.id)).map((w) => w.title);
  const removed = (before?.widgets ?? [])
    .filter((w) => !afterIds.has(w.id))
    .map((w) => w.title);
  const changed = after.widgets
    .filter((w) => {
      const b = beforeById.get(w.id);
      return b && !same({ ...b, size: undefined }, { ...w, size: undefined });
    })
    .map((w) => w.title);
  const kept = after.widgets.filter((w) => beforeById.has(w.id)).map((w) => w.id);
  const keptBefore = (before?.widgets ?? [])
    .filter((w) => afterIds.has(w.id))
    .map((w) => w.id);
  const resized = after.widgets.some((w) => {
    const b = beforeById.get(w.id);
    return b && b.size !== w.size;
  });

  const parts = [
    added.length && `added ${quote(added)}`,
    removed.length && `removed ${quote(removed)}`,
    changed.length && `changed ${quote(changed)}`,
    !same(kept, keptBefore) && "reordered widgets",
    resized && "resized widgets",
  ].filter(Boolean) as string[];
  if (parts.length === 0) return "Updated the response dashboard";
  const text = parts.join("; ");
  return `Dashboard: ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
