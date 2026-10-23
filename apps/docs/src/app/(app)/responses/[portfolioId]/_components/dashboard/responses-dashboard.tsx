"use client";

import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/context/capabilities-context";
import { useCurrentUser } from "@/context/user-context";
import {
  useReviseWidget,
  useSaveDashboard,
  useSuggestDashboard,
} from "@/hooks/query/dashboard";
import { useIntentBackpropagation } from "@/hooks/query/intent-backpropagation";
import { useRecode } from "@/hooks/query/recode";
import { useUndoToast } from "@/hooks/query/undo";
import { useNow } from "@/hooks/use-now";
import { defaultDashboard } from "@/lib/engine/dashboard";
import type { RecodeOp } from "@/lib/engine/recode";
import type { ResponseRowLike } from "@/lib/form-renderer/response-rows";
import { formatActor } from "@/lib/mock-users";
import { formatRelativeTime } from "@/lib/provenance-format";
import type {
  CategoryBucket,
  NumericOutlier,
} from "@/lib/engine/response-stats";
import type {
  DashboardSpec,
  DashboardWidget,
  Field,
  Portfolio,
} from "@/lib/types";
import { Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChartDialog } from "./chart-dialogs";
import { FindingsPanel } from "./findings-panel";
import { BucketMenu, RecodeDialog, type RecodeTarget } from "./recode-dialog";
import { WidgetCard, type WidgetEditHandlers } from "./widget-card";

/** Portfolios whose dashboard was suggested in this tab (never re-run on its own). */
const suggestionsStarted = new Set<string>();

interface Draft {
  /** The saved dashboard the edit started from (merge base) */
  base: DashboardSpec | undefined;
  spec: DashboardSpec;
}

/**
 * The response dashboard: suggested once from the intent, then the
 * creator's to edit. Edits happen on a draft and are saved together — one
 * History entry, one Undo.
 */
export function ResponsesDashboard({
  portfolio,
  responses,
  refetchRows,
}: {
  portfolio: Portfolio;
  responses: readonly ResponseRowLike[];
  /** Fresh rows for recoding (re-planned on them before writing) */
  refetchRows: () => Promise<readonly ResponseRowLike[]>;
}) {
  const { recode: canRecode } = useCapabilities();
  const schema = portfolio.schema;
  const saved = schema.dashboard;
  const fallback = useMemo(() => defaultDashboard(schema), [schema]);
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);
  const notifyUndo = useUndoToast();
  const now = useNow();

  const suggest = useSuggestDashboard(portfolio.id);
  const save = useSaveDashboard(portfolio.id);
  const revise = useReviseWidget(portfolio.id);

  // No dashboard yet: suggest one from the intent, once
  const latest = useRef({ portfolio, count: responses.length });
  useEffect(() => {
    latest.current = { portfolio, count: responses.length };
  });
  const { mutate: suggestMutate } = suggest;
  const hasFields = schema.fields.length > 0;
  useEffect(() => {
    if (saved || !hasFields || suggestionsStarted.has(portfolio.id)) return;
    suggestionsStarted.add(portfolio.id);
    suggestMutate({
      portfolio: latest.current.portfolio,
      responseCount: latest.current.count,
    });
  }, [saved, hasFields, portfolio.id, suggestMutate]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const spec = draft?.spec ?? saved ?? fallback;
  const editing = draft !== null;

  const startDraft = (): Draft => draft ?? { base: saved, spec: saved ?? fallback };
  const updateWidgets = (fn: (widgets: DashboardWidget[]) => DashboardWidget[]) =>
    setDraft((d) => {
      const current = d ?? { base: saved, spec: saved ?? fallback };
      return { ...current, spec: { ...current.spec, widgets: fn(current.spec.widgets) } };
    });

  const saveSpec = async (base: DashboardSpec | undefined, next: DashboardSpec) => {
    try {
      const commit = await save.mutateAsync({ base, next, actor });
      setDraft(null);
      notifyUndo(commit, "Dashboard saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the dashboard");
    }
  };

  // "Ask AI to change…" (a widget) or "Add a chart" (none)
  const [dialog, setDialog] = useState<{ widget?: DashboardWidget } | null>(null);
  const [revisingId, setRevisingId] = useState<string | null>(null);
  const describe = async (instruction: string, target?: DashboardWidget) => {
    setRevisingId(target?.id ?? "new");
    try {
      const widget = await revise.mutateAsync({ portfolio, widget: target, instruction });
      updateWidgets((widgets) =>
        target
          ? widgets.map((w) => (w.id === target.id ? widget : w))
          : [...widgets, widget],
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't make that chart");
    } finally {
      setRevisingId(null);
    }
  };

  const handlersFor = (widget: DashboardWidget, index: number): WidgetEditHandlers => ({
    onChange: (next) => updateWidgets((ws) => ws.map((w) => (w.id === widget.id ? next : w))),
    onRemove: () => updateWidgets((ws) => ws.filter((w) => w.id !== widget.id)),
    onMove: (delta) =>
      updateWidgets((ws) => {
        const to = index + delta;
        if (to < 0 || to >= ws.length) return ws;
        const next = [...ws];
        [next[index], next[to]] = [next[to], next[index]];
        return next;
      }),
    onAsk: () => setDialog({ widget }),
  });

  // Recoding: from a chart back into the stored answers (and the form)
  const recode = useRecode(portfolio, refetchRows);
  const { scheduleSync } = useIntentBackpropagation(portfolio);
  const [recodeTarget, setRecodeTarget] = useState<RecodeTarget | null>(null);
  const applyRecode = async (op: RecodeOp) => {
    try {
      const plan = await recode.apply.mutateAsync({ op, actor });
      setRecodeTarget(null);
      if (plan.schemaChange) scheduleSync(plan.summary);
      toast.success(plan.summary, {
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await recode.undo.mutateAsync({ plan, actor });
              if (plan.schemaChange) scheduleSync(`Undid: ${plan.summary}`);
              toast("Recode undone");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't undo the recode");
            }
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't recode the responses");
    }
  };
  const widgetExtras = !canRecode ? {} : {
    categoryActions: (field: Field, bucket: CategoryBucket) => (
      <BucketMenu field={field} bucket={bucket} onPick={setRecodeTarget} />
    ),
    outlierActions: (field: Field, outlier: NumericOutlier) => (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[11px]"
        onClick={() => setRecodeTarget({ kind: "number", field, outlier, mode: "fix" })}
      >
        Fix…
      </Button>
    ),
  };

  if (!hasFields) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        The form has no fields yet — design it first, then its responses show up here.
      </p>
    );
  }

  let status: ReactNode;
  if (editing) {
    status = "Editing — add, change, reorder or remove charts, then save.";
  } else if (suggest.isPending) {
    status = (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Suggesting charts for this form&apos;s purpose…
      </span>
    );
  } else if (!saved && suggest.isError) {
    status = (
      <span className="inline-flex flex-wrap items-center gap-x-2">
        Showing a default layout — no suggestion: {suggest.error.message}
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() =>
            suggestMutate({ portfolio, responseCount: responses.length })
          }
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Try again
        </Button>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => saveSpec(undefined, fallback)}
        >
          Keep this layout
        </Button>
      </span>
    );
  } else if (saved?.updatedAt) {
    status = `Edited ${formatRelativeTime(saved.updatedAt, now)}`;
  } else if (saved?.suggestedAt) {
    status = "Suggested from the form's purpose — edit it to make it yours.";
  }

  return (
    <div data-testid="responses-dashboard" className="@container space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" role="status">
          {status}
        </p>
        <div className="flex items-center gap-1.5">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog({})}
                disabled={revisingId !== null}
              >
                {revisingId === "new" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                )}
                Add chart
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                data-testid="save-dashboard"
                disabled={save.isPending || revisingId !== null}
                onClick={() => draft && saveSpec(draft.base, draft.spec)}
              >
                {save.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                )}
                Save
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              data-testid="edit-dashboard"
              disabled={suggest.isPending}
              onClick={() => setDraft(startDraft())}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit dashboard
            </Button>
          )}
        </div>
      </div>

      {!editing && (
        <FindingsPanel
          portfolio={portfolio}
          rows={responses}
          onFixData={canRecode ? setRecodeTarget : undefined}
        />
      )}

      <div className="grid gap-4 @3xl:grid-cols-2">
        {spec.widgets.map((widget, index) => (
          <WidgetCard
            key={widget.id}
            widget={widget}
            schema={schema}
            rows={responses}
            busy={revisingId === widget.id}
            edit={editing ? handlersFor(widget, index) : undefined}
            {...widgetExtras}
          />
        ))}
      </div>
      {spec.widgets.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No charts. Add one to see the responses at a glance.
        </p>
      )}

      <RecodeDialog
        target={recodeTarget}
        onClose={() => setRecodeTarget(null)}
        portfolio={portfolio}
        rows={responses}
        applying={recode.apply.isPending}
        onApply={applyRecode}
      />

      <ChartDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        widget={dialog?.widget}
        schema={schema}
        onDescribe={(instruction) => describe(instruction, dialog?.widget)}
        onPick={(widget) => updateWidgets((ws) => [...ws, widget])}
      />
    </div>
  );
}
