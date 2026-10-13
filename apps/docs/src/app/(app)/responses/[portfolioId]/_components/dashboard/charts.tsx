"use client";

import { useNow } from "@/hooks/use-now";
import type {
  CategoryBucket,
  CategoryStats,
  CrosstabStats,
  KpiStats,
  LikertStats,
  NumericOutlier,
  NumericStats,
  TextStats,
  TimelineStats,
} from "@/lib/engine/response-stats";
import { formatRelativeTime } from "@/lib/provenance-format";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";
import {
  AnsweredNote,
  ChartTip,
  EmptyChart,
  formatNumber,
  Legend,
  pct,
  plural,
} from "./chart-parts";

const BAR = "var(--viz-bar)";
/** De-emphasis for values the form doesn't offer — never a status colour */
const MUTED_MARK = "color-mix(in oklab, var(--muted-foreground) 45%, transparent)";

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function KpiTiles({ stats }: { stats: KpiStats }) {
  const now = useNow();
  return (
    <dl className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
      <div className="col-span-2 @xl:col-span-1">
        <dt className="text-xs text-muted-foreground">Responses</dt>
        <dd className="text-4xl font-semibold tracking-tight">
          {formatNumber(stats.responses)}
        </dd>
      </div>
      <Tile
        label="Complete"
        value={`${pct(stats.complete, stats.responses)}%`}
        hint="all required questions answered"
      />
      <Tile label="Last 7 days" value={formatNumber(stats.lastWeek)} />
      <Tile
        label="Latest"
        value={
          stats.lastSubmittedAt
            ? formatRelativeTime(stats.lastSubmittedAt, now)
            : "–"
        }
      />
    </dl>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Answer counts
// ---------------------------------------------------------------------------

export function CategoryBars({
  stats,
  actions,
}: {
  stats: CategoryStats;
  /** Per-category controls (recoding), shown at the end of its row */
  actions?: (bucket: CategoryBucket) => ReactNode;
}) {
  if (stats.total === 0) return <EmptyChart>No responses yet.</EmptyChart>;
  const max = Math.max(1, ...stats.buckets.map((b) => b.count));
  const unknown = stats.buckets.filter((b) => !b.known);

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {stats.buckets.map((bucket) => {
          const share = pct(bucket.count, stats.answered);
          return (
            <li
              key={bucket.key}
              data-testid={`bucket-${bucket.key}`}
              className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs"
            >
              <span
                className={cn("truncate", !bucket.known && "italic text-muted-foreground")}
                title={bucket.label}
              >
                {bucket.label}
              </span>
              <ChartTip
                value={`${bucket.count.toLocaleString()} · ${share}%`}
                label={
                  bucket.known
                    ? bucket.label
                    : `"${bucket.label}" — not one of the form's options`
                }
                className="flex h-6 min-w-0 items-center gap-1.5"
              >
                <span
                  className="h-4 shrink-0 rounded-r-[4px]"
                  style={{
                    width: `calc(${bucket.count / max} * (100% - 4.5rem))`,
                    minWidth: bucket.count ? 2 : 0,
                    background: bucket.known ? BAR : MUTED_MARK,
                  }}
                />
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {bucket.count.toLocaleString()}
                  <span className="opacity-70"> · {share}%</span>
                </span>
              </ChartTip>
              <span className="flex justify-end">{actions?.(bucket)}</span>
            </li>
          );
        })}
      </ul>
      <AnsweredNote
        answered={stats.answered}
        empty={stats.empty}
        extra={
          <>
            {stats.multiple && " · several answers per response"}
            {unknown.length > 0 &&
              ` · ${plural(unknown.length, "value", "values")} in italics aren't options`}
          </>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Likert: diverging stacked bars, centred on the neutral point
// ---------------------------------------------------------------------------

/** Red ↔ (gray) ↔ blue steps for `n` ordered points, lowest first. */
export function divergingColors(n: number): string[] {
  const arm = Math.floor(n / 2);
  const steps =
    arm === 1 ? [2] : arm === 2 ? [3, 1] : [3, 2, 1].slice(0, arm);
  const neg = steps.map((s) => `var(--viz-neg-${s})`);
  const pos = [...steps].reverse().map((s) => `var(--viz-pos-${s})`);
  return n % 2 === 1 ? [...neg, "var(--viz-neutral)", ...pos] : [...neg, ...pos];
}

export function LikertChart({ stats }: { stats: LikertStats }) {
  const { choices, items } = stats;
  const n = choices.length;
  const colors = divergingColors(n);
  const mid = n % 2 === 1 ? (n - 1) / 2 : null;
  const negEnd = Math.floor(n / 2); // indices below are the negative arm
  const posStart = mid === null ? n / 2 : mid + 1;
  const names = choices.map((c) => (c.hint ? `${c.label} – ${c.hint}` : c.label));

  const rows = items.map((item) => {
    const shares = item.counts.map((c) => (item.answered ? c / item.answered : 0));
    const neg = shares.slice(0, negEnd).reduce((a, b) => a + b, 0);
    const pos = shares.slice(posStart).reduce((a, b) => a + b, 0);
    const neu = mid === null ? 0 : shares[mid];
    return { item, shares, neg, pos, left: neg + neu / 2, right: pos + neu / 2 };
  });
  const maxSide = Math.max(0.01, ...rows.flatMap((r) => [r.left, r.right]));

  if (items.every((i) => i.answered === 0)) {
    return <EmptyChart>No ratings yet.</EmptyChart>;
  }

  return (
    <div className="space-y-3">
      <Legend items={names.map((label, i) => ({ label, color: colors[i] }))} />
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-x-2 text-[11px] text-muted-foreground @lg:grid-cols-[minmax(0,14rem)_2.5rem_minmax(0,1fr)_2.5rem]">
        <span className="hidden @lg:block" />
        <span />
        <span className="flex justify-between gap-2">
          <span className="truncate">← {names[0]}</span>
          <span className="truncate">{names[n - 1]} →</span>
        </span>
        <span />
      </div>
      <ul className="space-y-2.5 @lg:space-y-1.5">
        {rows.map(({ item, shares, neg, pos, left, right }) => (
          <li
            key={item.field.id}
            className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-x-2 gap-y-1 @lg:grid-cols-[minmax(0,14rem)_2.5rem_minmax(0,1fr)_2.5rem]"
          >
            <span
              className="col-span-3 line-clamp-2 text-xs @lg:col-span-1"
              title={item.field.label}
            >
              {item.field.label}
            </span>
            <span className="text-right text-[11px] tabular-nums text-muted-foreground">
              {Math.round(neg * 100)}%
            </span>
            <div className="relative h-5">
              <span
                aria-hidden
                className="absolute inset-y-0 left-1/2 w-px"
                style={{ background: "var(--viz-grid)" }}
              />
              <div
                className="absolute inset-y-0.5 flex gap-0.5"
                style={{
                  left: `${50 - (left / maxSide) * 50}%`,
                  width: `${((left + right) / maxSide) * 50}%`,
                }}
              >
                {shares.map((share, i) =>
                  item.counts[i] === 0 ? null : (
                    <ChartTip
                      key={i}
                      value={`${item.counts[i]} · ${Math.round(share * 100)}%`}
                      label={names[i]}
                      className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
                      style={{ flex: `${share} 1 0`, background: colors[i] }}
                    />
                  ),
                )}
              </div>
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {Math.round(pos * 100)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Shares of each statement&apos;s answers; the outer numbers sum each side.
        {items.length === 1 && <> Mean {formatNumber(items[0].mean)}.</>}
        {items.some((i) => i.unknown > 0) &&
          ` ${plural(
            items.reduce((a, i) => a + i.unknown, 0),
            "answer is",
            "answers are",
          )} outside the scale.`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numbers: summary tiles + histogram + values worth a look
// ---------------------------------------------------------------------------

function Columns({
  points,
  labelFor,
  valueFor,
}: {
  points: { count: number }[];
  labelFor: (i: number) => string;
  valueFor?: (i: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div className="flex h-28 items-end gap-0.5 border-b" style={{ borderColor: "var(--viz-grid)" }}>
      {points.map((p, i) => (
        <ChartTip
          key={i}
          value={valueFor?.(i) ?? p.count.toLocaleString()}
          label={labelFor(i)}
          className="flex h-full min-w-0 flex-1 items-end justify-center"
        >
          <span
            className="w-full max-w-6 rounded-t-[4px]"
            style={{
              height: `${(p.count / max) * 100}%`,
              minHeight: p.count ? 2 : 0,
              background: BAR,
            }}
          />
        </ChartTip>
      ))}
    </div>
  );
}

const range = (from: number, to: number) =>
  from === to ? formatNumber(from) : `${formatNumber(from)}–${formatNumber(to)}`;

export function NumericChart({
  stats,
  actions,
}: {
  stats: NumericStats;
  /** Controls for an outlier (fix / clear) */
  actions?: (outlier: NumericOutlier) => ReactNode;
}) {
  if (stats.count === 0 && stats.invalidCount === 0) {
    return <EmptyChart>No answers yet.</EmptyChart>;
  }
  const flagged = stats.outliers.slice(0, 5);

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-3">
        <Tile label="Mean" value={formatNumber(stats.mean)} />
        <Tile label="Median" value={formatNumber(stats.median)} />
        <Tile
          label="Range"
          value={stats.min === null ? "–" : range(stats.min, stats.max!)}
        />
      </dl>
      {stats.bins.length > 0 && (
        <div>
          <Columns
            points={stats.bins}
            labelFor={(i) => range(stats.bins[i].from, stats.bins[i].to)}
            valueFor={(i) => plural(stats.bins[i].count, "answer", "answers")}
          />
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{formatNumber(stats.bins[0].from)}</span>
            <span>{formatNumber(stats.bins[stats.bins.length - 1].to)}</span>
          </div>
        </div>
      )}
      {(flagged.length > 0 || stats.invalidCount > 0) && (
        <div className="space-y-1 rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
          <p className="font-medium">Worth a look</p>
          <ul className="space-y-0.5">
            {flagged.map((o) => (
              <li key={o.rowId} className="flex items-center justify-between gap-2">
                <span>
                  <span className="tabular-nums">{formatNumber(o.value)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    —{" "}
                    {o.reason === "out-of-range"
                      ? "outside the field's range"
                      : "far from the other answers"}
                  </span>
                </span>
                {actions?.(o)}
              </li>
            ))}
            {stats.invalidCount > 0 && (
              <li className="text-muted-foreground">
                {plural(stats.invalidCount, "answer isn't", "answers aren't")} a number
              </li>
            )}
          </ul>
          {stats.outOfRange + stats.extreme > flagged.length && (
            <p className="text-[11px] text-muted-foreground">
              +{stats.outOfRange + stats.extreme - flagged.length} more
            </p>
          )}
        </div>
      )}
      <AnsweredNote answered={stats.answered} empty={stats.empty} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Over time
// ---------------------------------------------------------------------------

const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function TimelineChart({ stats }: { stats: TimelineStats }) {
  if (stats.points.length === 0) return <EmptyChart>No responses yet.</EmptyChart>;
  const first = stats.points[0].start;
  const last = stats.points[stats.points.length - 1].start;
  return (
    <div className="space-y-1">
      <Columns
        points={stats.points}
        labelFor={(i) =>
          stats.bucket === "week"
            ? `Week of ${dateLabel(stats.points[i].start)}`
            : dateLabel(stats.points[i].start)
        }
        valueFor={(i) => plural(stats.points[i].count, "response", "responses")}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{dateLabel(first)}</span>
        <span>{stats.bucket === "week" ? "per week" : "per day"}</span>
        <span>{dateLabel(last)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cross-tab: a one-hue heatmap
// ---------------------------------------------------------------------------

export function CrosstabChart({
  stats,
  rowLabel,
  colLabel,
}: {
  stats: CrosstabStats;
  rowLabel: string;
  colLabel: string;
}) {
  if (stats.total === 0) {
    return <EmptyChart>No response answers both questions yet.</EmptyChart>;
  }
  return (
    <div className="space-y-2 overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th className="text-left text-[11px] font-normal text-muted-foreground">
              {rowLabel} ↓ · {colLabel} →
            </th>
            {stats.cols.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="max-w-24 truncate px-1 text-center text-[11px] font-normal text-muted-foreground"
                title={c.label}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.rows.map((r, ri) => (
            <tr key={r.key}>
              <th scope="row" className="max-w-40 truncate pr-2 text-left font-normal" title={r.label}>
                {r.label}
              </th>
              {stats.cols.map((c, ci) => {
                const count = stats.cells[ri][ci];
                const strength = count ? 12 + 78 * (count / Math.max(1, stats.max)) : 0;
                return (
                  <td key={c.key} className="p-0">
                    <ChartTip
                      value={plural(count, "response", "responses")}
                      label={`${r.label} × ${c.label}`}
                      className="flex h-8 min-w-10 items-center justify-center tabular-nums"
                      style={{
                        background: count
                          ? `color-mix(in oklab, var(--viz-bar) ${strength}%, var(--card))`
                          : "var(--muted)",
                        color: strength > 55 ? "white" : undefined,
                      }}
                    >
                      {count || ""}
                    </ChartTip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground">
        {plural(stats.total, "response answers", "responses answer")} both
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text answers
// ---------------------------------------------------------------------------

export function TextAnswers({ stats }: { stats: TextStats }) {
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  if (stats.answered === 0) return <EmptyChart>No answers yet.</EmptyChart>;
  const shown = expanded ? stats.samples : stats.samples.slice(0, 5);
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {shown.map((s) => (
          <li key={s.rowId} className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
            <p className="line-clamp-3 whitespace-pre-line">{s.text}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatRelativeTime(s.submittedAt, now)}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <AnsweredNote answered={stats.answered} empty={stats.empty} />
        {stats.samples.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {expanded ? "Show fewer" : `Show ${stats.samples.length - 5} more`}
          </button>
        )}
      </div>
    </div>
  );
}
