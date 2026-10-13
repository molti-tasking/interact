"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CSSProperties, ReactNode } from "react";

/** Whole-number percentage of `part` in `whole` (0 when there's nothing). */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** 1,284 → "1.3K" for big values; up to 2 decimals otherwise. */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return Math.abs(n) >= 10_000 ? compact.format(n) : plain.format(n);
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * The hover/focus layer of a mark: the value leads, the label follows.
 * The trigger is the mark's whole hit area, not just its painted pixels.
 */
export function ChartTip({
  value,
  label,
  children,
  className,
  style,
}: {
  value: ReactNode;
  label: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          style={style}
          className={cn(
            "rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        <span className="block font-semibold tabular-nums">{value}</span>
        <span className="block opacity-80">{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Legend for two or more series: a rect swatch per entry, text in ink. */
export function Legend({
  items,
  className,
}: {
  items: { label: string; color: string }[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** "38 answered · 4 skipped" under a chart. */
export function AnsweredNote({
  answered,
  empty,
  extra,
}: {
  answered: number;
  empty: number;
  extra?: ReactNode;
}) {
  return (
    <p className="text-[11px] text-muted-foreground">
      {plural(answered, "answer", "answers")}
      {empty > 0 && <> · {empty.toLocaleString()} skipped</>}
      {extra}
    </p>
  );
}

export function EmptyChart({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}
