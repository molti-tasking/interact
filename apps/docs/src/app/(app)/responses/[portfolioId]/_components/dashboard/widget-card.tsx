"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DASHBOARD_WIDGET_KINDS,
  type DashboardWidget,
  type DashboardWidgetKind,
  type Field,
  type PortfolioSchema,
} from "@/lib/types";
import {
  resolveWidget,
  WIDGET_KIND_INFO,
  widgetData,
  widgetFits,
  widgetSize,
} from "@/lib/engine/dashboard";
import type {
  CategoryBucket,
  NumericOutlier,
  StatsRow,
} from "@/lib/engine/response-stats";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  Info,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import {
  CategoryBars,
  CrosstabChart,
  KpiTiles,
  LikertChart,
  NumericChart,
  TextAnswers,
  TimelineChart,
} from "./charts";

export interface WidgetEditHandlers {
  onChange: (next: DashboardWidget) => void;
  onRemove: () => void;
  onMove?: (delta: -1 | 1) => void;
  /** Opens "Ask AI to change this chart" */
  onAsk: () => void;
}

interface WidgetCardProps {
  widget: DashboardWidget;
  schema: PortfolioSchema;
  rows: readonly StatsRow[];
  /** Edit mode: menu for kind, size, order, removal and AI changes */
  edit?: WidgetEditHandlers;
  /** The AI is reworking this widget */
  busy?: boolean;
  /** Recoding controls for a category of a field */
  categoryActions?: (field: Field, bucket: CategoryBucket) => ReactNode;
  /** Fix/clear controls for a flagged number */
  outlierActions?: (field: Field, outlier: NumericOutlier) => ReactNode;
}

export function WidgetCard({
  widget,
  schema,
  rows,
  edit,
  busy,
  categoryActions,
  outlierActions,
}: WidgetCardProps) {
  const resolved = useMemo(() => resolveWidget(widget, schema), [widget, schema]);
  const data = useMemo(
    () => widgetData(resolved, schema, rows),
    [resolved, schema, rows],
  );

  return (
    <section
      data-testid={`widget-${widget.id}`}
      aria-busy={busy || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 transition-opacity",
        widgetSize(widget) === "full" && "@3xl:col-span-2",
        busy && "opacity-60",
      )}
    >
      <header className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-medium leading-snug">
          {widget.title}
        </h3>
        {widget.rationale && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Why this chart?"
                className="mt-0.5 rounded text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64">
              {widget.rationale}
            </TooltipContent>
          </Tooltip>
        )}
        {busy && (
          <Loader2
            className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground"
            aria-label="Updating"
          />
        )}
        {edit && (
          <WidgetMenu widget={widget} fields={resolved.fields} edit={edit} />
        )}
      </header>

      {!data ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          {resolved.missing > 0
            ? "A field this chart used was removed from the form."
            : "These fields can't be charted this way."}
          {edit && " Change or remove the chart."}
        </p>
      ) : (
        <WidgetBody
          data={data}
          categoryActions={categoryActions}
          outlierActions={outlierActions}
        />
      )}
    </section>
  );
}

function WidgetBody({
  data,
  categoryActions,
  outlierActions,
}: {
  data: NonNullable<ReturnType<typeof widgetData>>;
  categoryActions?: WidgetCardProps["categoryActions"];
  outlierActions?: WidgetCardProps["outlierActions"];
}) {
  switch (data.kind) {
    case "kpi":
      return <KpiTiles stats={data.stats} />;
    case "distribution": {
      const field = data.stats.field;
      return (
        <CategoryBars
          stats={data.stats}
          actions={categoryActions && ((b) => categoryActions(field, b))}
        />
      );
    }
    case "likert":
      return <LikertChart stats={data.stats} />;
    case "numeric": {
      const field = data.stats.field;
      return (
        <NumericChart
          stats={data.stats}
          actions={outlierActions && ((o) => outlierActions(field, o))}
        />
      );
    }
    case "timeline":
      return <TimelineChart stats={data.stats} />;
    case "crosstab":
      return (
        <CrosstabChart
          stats={data.stats}
          rowLabel={data.rowField.label}
          colLabel={data.colField.label}
        />
      );
    case "text":
      return <TextAnswers stats={data.stats} />;
  }
}

function WidgetMenu({
  widget,
  fields,
  edit,
}: {
  widget: DashboardWidget;
  fields: Field[];
  edit: WidgetEditHandlers;
}) {
  const kinds = DASHBOARD_WIDGET_KINDS.filter((k) => widgetFits(k, fields));
  const size = widgetSize(widget);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mr-1.5 -mt-1 h-7 w-7 text-muted-foreground"
          aria-label={`Edit chart: ${widget.title}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={edit.onAsk}>
          <Sparkles aria-hidden />
          Ask AI to change…
        </DropdownMenuItem>
        {kinds.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Chart as</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={widget.kind}
                onValueChange={(kind) =>
                  edit.onChange({ ...widget, kind: kind as DashboardWidgetKind })
                }
              >
                {kinds.map((kind) => (
                  <DropdownMenuRadioItem key={kind} value={kind}>
                    {WIDGET_KIND_INFO[kind].label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem
          onSelect={() =>
            edit.onChange({ ...widget, size: size === "full" ? "half" : "full" })
          }
        >
          {size === "full" ? "Make narrow" : "Make wide"}
        </DropdownMenuItem>
        {edit.onMove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Order
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => edit.onMove?.(-1)}>
              <ArrowUp aria-hidden />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => edit.onMove?.(1)}>
              <ArrowDown aria-hidden />
              Move down
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={edit.onRemove}>
          <Trash2 aria-hidden />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
