"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DesignProbeDetailDialog } from "@/components/workspace/DesignProbeDetailDialog";
import {
  patchSize,
  previewSchemaChange,
  summarizeChange,
  type PatchSummary,
} from "@/lib/engine/probe-preview";
import { applySchemaPatch } from "@/lib/engine/schema-patch";
import type { DesignProbe, PortfolioSchema, ProbePriority } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronRight, Info, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  useProbePreviewActions,
  type ProbePreview,
} from "./deck-canvas-context";

const priorityStyles: Record<ProbePriority, { dot: string; label: string }> = {
  1: { dot: "bg-rose-500", label: "High impact" },
  2: { dot: "bg-amber-400", label: "Medium impact" },
  3: { dot: "bg-muted-foreground/35", label: "Low impact" },
};

function PriorityDot({
  priority,
  className,
}: {
  priority: ProbePriority;
  className?: string;
}) {
  const style = priorityStyles[priority];
  return (
    <span
      title={style.label}
      className={cn(
        "relative h-2 w-2 shrink-0 rounded-full",
        style.dot,
        className,
      )}
    >
      <span className="sr-only">{style.label}</span>
    </span>
  );
}

/** Previews are still being worked out in the background. */
function previewsPending(probe: DesignProbe): boolean {
  return (
    probe.source !== "standard" &&
    probe.previewStatus !== "ready" &&
    probe.previewStatus !== "failed"
  );
}

const isTouchOnly = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

interface ProbeCardProps {
  probe: DesignProbe;
  expanded: boolean;
  onExpand: () => void;
  /** An answer to this probe is being applied */
  busy: boolean;
  /** Current schema — previews are diffed against it */
  schema: PortfolioSchema;
  validTargetIds: string[];
  /** Option value, or "custom:<text>" */
  onSelect: (value: string) => void;
  onDismiss: () => void;
  onRetryPreview: () => void;
}

/**
 * A design probe in the deck. Collapsed, it is a one-line row; expanded, its
 * options show what each answer would change. Hovering (or focusing) an
 * option previews it on the canvas; clicking applies it. On touch screens
 * the first tap previews and the second applies.
 */
export function ProbeCard({
  probe,
  expanded,
  onExpand,
  busy,
  schema,
  validTargetIds,
  onSelect,
  onDismiss,
  onRetryPreview,
}: ProbeCardProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const pending = previewsPending(probe);
  const disabled = probe.status !== "pending" || busy;

  const previews = useMemo(
    () =>
      new Map(
        probe.options.map((option) => {
          const preview = option.preview;
          if (!preview) return [option.value, null];
          return [
            option.value,
            {
              ownerId: probe.id,
              optionValue: option.value,
              label: option.label,
              summary: preview.summary,
              apply: (s: PortfolioSchema) =>
                applySchemaPatch(s, preview.schemaPatch, { validTargetIds })
                  .schema,
            } satisfies ProbePreview,
          ];
        }),
      ),
    [probe.id, probe.options, validTargetIds],
  );

  if (!expanded) {
    return (
      <CollapsedRow
        testId={`deck-card-${probe.id}`}
        status={probe.status}
        leading={<PriorityDot priority={probe.priority} />}
        title={probe.text}
        pending={pending}
        onExpand={onExpand}
      />
    );
  }

  return (
    <div
      data-testid={`deck-card-${probe.id}`}
      data-status={probe.status}
      data-expanded="true"
      aria-busy={busy || undefined}
      className="rounded-xl border bg-card shadow-sm"
    >
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <PriorityDot priority={probe.priority} className="mt-1.5" />
        <h4 className="flex-1 text-sm font-medium leading-snug">
          {probe.text}
        </h4>
        {probe.explanation && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Why this question?"
                className="mt-0.5 rounded text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64">
              {probe.explanation}
            </TooltipContent>
          </Tooltip>
        )}
        <DismissButton
          label={`Skip: ${probe.text}`}
          title="Skip this question"
          disabled={disabled}
          onClick={onDismiss}
        />
      </div>

      <div className="grid gap-1.5 p-2.5">
        {probe.options.map((option) => (
          <OptionTile
            key={option.value}
            value={option.value}
            label={option.label}
            preview={previews.get(option.value) ?? null}
            schema={schema}
            pending={pending}
            disabled={disabled}
            armed={armed === option.value}
            onArm={() => setArmed(option.value)}
            onApply={() => {
              setArmed(null);
              onSelect(option.value);
            }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 px-3.5 pb-2.5 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          disabled={disabled}
          className="cursor-pointer rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Other answer…
        </button>
        <CardStatus
          busy={busy}
          failed={probe.previewStatus === "failed"}
          onRetry={onRetryPreview}
        />
      </div>

      <DesignProbeDetailDialog
        item={{
          ...probe,
          onSelect,
          onDismiss,
        }}
        open={customOpen}
        onOpenChange={setCustomOpen}
        busy={busy}
        startWithCustom
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks shared with ConflictCard
// ---------------------------------------------------------------------------

/** A collapsed deck card: one line that opens the card. */
export function CollapsedRow({
  testId,
  status,
  leading,
  title,
  pending,
  onExpand,
}: {
  testId: string;
  status?: string;
  leading: React.ReactNode;
  title: string;
  /** Previews are still being prepared */
  pending: boolean;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-status={status}
      aria-expanded={false}
      onClick={onExpand}
      className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-foreground/75 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {leading}
      <span className="flex-1 truncate">{title}</span>
      {pending && (
        <Loader2
          className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/50"
          aria-label="Preparing previews"
        />
      )}
      <ChevronRight
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

export function DismissButton({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className="mt-0.5 cursor-pointer rounded text-muted-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** "Applying…" while busy, or a retry link when previews failed. */
export function CardStatus({
  busy,
  failed,
  onRetry,
}: {
  busy: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (busy) {
    return (
      <span role="status" className="flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Applying…
      </span>
    );
  }
  if (!failed) return null;
  return (
    <button
      type="button"
      onClick={onRetry}
      className="cursor-pointer rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Retry previews
    </button>
  );
}

/**
 * One answer or fix. Shows what it would change (once its preview is ready),
 * previews it on the canvas while hovered or focused, and applies it on
 * click — on touch screens the first tap previews, the second applies.
 */
export function OptionTile({
  value,
  label,
  preview,
  schema,
  pending,
  disabled,
  armed,
  onArm,
  onApply,
}: {
  value: string;
  label: string;
  preview: ProbePreview | null;
  schema: PortfolioSchema;
  pending: boolean;
  disabled: boolean;
  armed: boolean;
  onArm: () => void;
  onApply: () => void;
}) {
  const { show, hide, clear } = useProbePreviewActions();

  const summary = useMemo(
    () =>
      preview
        ? summarizeChange(previewSchemaChange(schema, preview.apply(schema)))
        : null,
    [schema, preview],
  );

  const startPreview = () => {
    if (preview && !disabled) show(preview);
  };
  const stopPreview = () => {
    if (preview) hide(preview.ownerId, preview.optionValue);
  };

  // Applied or unmounted while hovered: don't leave the canvas previewing
  const ownerId = preview?.ownerId;
  const optionValue = preview?.optionValue;
  useEffect(
    () => () => {
      if (ownerId && optionValue) hide(ownerId, optionValue);
    },
    [hide, ownerId, optionValue],
  );

  const handleClick = () => {
    if (preview && !armed && isTouchOnly()) {
      onArm();
      startPreview();
      return;
    }
    clear();
    onApply();
  };

  return (
    <button
      type="button"
      data-testid={`deck-option-${value}`}
      disabled={disabled}
      onPointerEnter={(e) => e.pointerType !== "touch" && startPreview()}
      onPointerLeave={(e) => e.pointerType !== "touch" && stopPreview()}
      onFocus={startPreview}
      onBlur={stopPreview}
      onClick={handleClick}
      className={cn(
        "w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors",
        "hover:border-primary/40 hover:bg-primary/5",
        "focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        armed && "border-primary/50 bg-primary/5",
      )}
    >
      <span
        data-testid="option-label"
        className="block text-[13px] font-medium leading-snug"
      >
        {label}
      </span>
      {summary ? (
        <PatchDiffLine summary={summary} />
      ) : pending ? (
        <span className="mt-1 block h-3 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none">
          <span className="sr-only">Preparing preview…</span>
        </span>
      ) : null}
      {armed && (
        <span className="mt-0.5 block text-[11px] text-primary">
          Tap again to apply
        </span>
      )}
    </button>
  );
}

const MAX_DIFF_ITEMS = 3;

/** e.g. "+ Session length  + Goal  − Notes  +1 more" */
function PatchDiffLine({ summary }: { summary: PatchSummary }) {
  if (patchSize(summary) === 0) {
    return (
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        No form change
      </span>
    );
  }

  const items = [
    ...summary.added.map((label) => ({ label, kind: "added" as const })),
    ...summary.updated.map((label) => ({ label, kind: "updated" as const })),
    ...summary.removed.map((label) => ({ label, kind: "removed" as const })),
  ];
  const shown = items.slice(0, MAX_DIFF_ITEMS);
  const more = items.length - shown.length;

  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] leading-4 text-muted-foreground">
      {shown.map(({ label, kind }, i) => (
        <span key={`${kind}-${i}`} className="inline-flex min-w-0 gap-0.5">
          <span className="sr-only">
            {kind === "added"
              ? "Adds"
              : kind === "updated"
                ? "Changes"
                : "Removes"}
          </span>
          <span
            aria-hidden
            className={cn(
              "font-semibold",
              kind === "added" && "text-emerald-600 dark:text-emerald-400",
              kind === "updated" && "text-amber-600 dark:text-amber-400",
              kind === "removed" && "text-red-600 dark:text-red-400",
            )}
          >
            {kind === "added" ? "+" : kind === "updated" ? "~" : "−"}
          </span>
          <span
            className={cn(
              "max-w-36 truncate",
              kind === "removed" && "line-through",
            )}
          >
            {label}
          </span>
        </span>
      ))}
      {more > 0 && <span>+{more} more</span>}
    </span>
  );
}
