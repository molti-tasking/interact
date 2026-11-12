"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OwnAnswerDialog } from "@/components/workspace/OwnAnswerDialog";
import { useStudyLog } from "@/context/study-context";
import {
  patchSize,
  previewSchemaChange,
  summarizeChange,
  type PatchSummary,
} from "interact/forms/probe-preview";
import { applyProbeOption, describeSchemaChange } from "interact/forms/guards";
import type {
  DesignProbe,
  DesignProbeOption,
  PortfolioSchema,
  ProbeOptionPreview,
  ProbePriority,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { BarChart3, ChevronRight, Info, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useProbePreviewActions,
  type ProbePreview,
} from "./deck-canvas-context";
import {
  impactDetail,
  impactText,
  useResponseImpact,
} from "./collected-responses-context";

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
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: none)").matches;

/**
 * What choosing an answer did: "applied" (it was committed), "preview" (its
 * preview is now on the card — choosing it again applies it), or "none".
 */
export type AnswerOutcome = "applied" | "preview" | "none";

/** Why a tile asks to be chosen a second time. */
type Armed = { value: string; why: "touch" | "preview" };

interface ProbeCardProps {
  probe: DesignProbe;
  expanded: boolean;
  onExpand: () => void;
  /** An answer to this probe is being applied */
  busy: boolean;
  /** Current schema — previews are diffed against it */
  schema: PortfolioSchema;
  validTargetIds: string[];
  /**
   * An answer was chosen (its value; a typed one is "custom:<text>").
   * `previewShown`: what it changes was on the card at that moment — only
   * then may it be applied.
   */
  onSelect: (
    value: string,
    context: { previewShown: boolean },
  ) => Promise<AnswerOutcome> | AnswerOutcome;
  /** The creator's typed answer, once its preview is worked out */
  ownAnswer?: (DesignProbeOption & { preview: ProbeOptionPreview }) | null;
  /** The typed answer's preview is being worked out */
  ownAnswerPending?: boolean;
  /** A typed answer to preview (nothing is applied yet) */
  onOwnAnswer: (text: string) => void;
  onDismiss: () => void;
  onRetryPreview: () => void;
}

/**
 * An elicitation question in the deck. Collapsed, it is a one-line row;
 * expanded, its answers show what each would change. Hovering (or focusing)
 * an answer previews it on the canvas; clicking applies it. On touch screens
 * the first tap previews and the second applies.
 *
 * No answer is applied before its preview was on the card: one chosen while
 * its preview is still being worked out waits for it, shows it, and is
 * applied by choosing it again. A typed answer is previewed the same way.
 * The answers are listed in their stored order, none marked or selected.
 */
export function ProbeCard({
  probe,
  expanded,
  onExpand,
  busy,
  schema,
  validTargetIds,
  onSelect,
  ownAnswer = null,
  ownAnswerPending = false,
  onOwnAnswer,
  onDismiss,
  onRetryPreview,
}: ProbeCardProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [armed, setArmed] = useState<Armed | null>(null);
  /** The answer whose preview is being waited for */
  const [waiting, setWaiting] = useState<string | null>(null);
  const pending = previewsPending(probe);
  const disabled = probe.status !== "pending" || busy;
  // The typed answer is the last tile, after the suggested ones
  const answers = useMemo(
    () => (ownAnswer ? [...probe.options, ownAnswer] : probe.options),
    [probe.options, ownAnswer],
  );

  const choose = async (value: string, previewShown: boolean) => {
    setArmed(null);
    setWaiting(value);
    try {
      const outcome = await onSelect(value, { previewShown });
      if (outcome === "preview") setArmed({ value, why: "preview" });
    } finally {
      setWaiting(null);
    }
  };

  // A typed answer arrives with its preview: it is shown, not applied
  const ownValue = ownAnswer?.value ?? null;
  useEffect(() => {
    if (ownValue) setArmed({ value: ownValue, why: "preview" });
  }, [ownValue]);

  const previews = useMemo(
    () =>
      new Map(
        answers.map((option) => {
          const preview = option.preview;
          if (!preview) return [option.value, null];
          return [
            option.value,
            {
              ownerId: probe.id,
              optionValue: option.value,
              label: option.label,
              summary: preview.summary,
              // Same scoping + lock rules as the commit, so the preview
              // shows exactly what applying it does
              apply: (s: PortfolioSchema) =>
                applyProbeOption(s, preview, { validTargetIds }).schema,
            } satisfies ProbePreview,
          ];
        }),
      ),
    [probe.id, answers, validTargetIds],
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
          {probe.source === "data" && (
            <span className="mb-1 flex w-fit items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">
              <BarChart3 className="h-2.5 w-2.5" aria-hidden />
              From responses
            </span>
          )}
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
        {answers.map((option) => {
          const own = option === ownAnswer;
          return (
            <OptionTile
              key={option.value}
              testId={own ? "deck-option-own" : undefined}
              value={option.value}
              label={option.label}
              caption={own ? "Your answer" : undefined}
              preview={previews.get(option.value) ?? null}
              schema={schema}
              pending={pending && !own}
              unavailable={!pending && !option.preview && probe.source !== "standard"}
              waiting={waiting === option.value}
              disabled={disabled || (waiting !== null && waiting !== option.value)}
              armed={armed?.value === option.value ? armed.why : null}
              onArm={() => setArmed({ value: option.value, why: "touch" })}
              onApply={(previewShown) => void choose(option.value, previewShown)}
            />
          );
        })}
        {ownAnswerPending && (
          <p
            role="status"
            data-testid="own-answer-pending"
            className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Working out what your answer changes…
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3.5 pb-2.5 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          disabled={disabled || ownAnswerPending}
          data-testid="own-answer-open"
          className="cursor-pointer rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {ownAnswer ? "Change your answer…" : "Write your own answer…"}
        </button>
        <CardStatus
          busy={busy}
          failed={probe.previewStatus === "failed"}
          onRetry={onRetryPreview}
        />
      </div>

      <OwnAnswerDialog
        question={probe.text}
        explanation={probe.explanation}
        open={customOpen}
        onOpenChange={setCustomOpen}
        disabled={disabled}
        onSubmit={onOwnAnswer}
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
 * Every tile looks the same: none is marked as suggested or selected.
 */
export function OptionTile({
  testId,
  value,
  label,
  caption,
  preview,
  schema,
  pending,
  unavailable = false,
  waiting = false,
  disabled,
  armed,
  onArm,
  onApply,
}: {
  testId?: string;
  value: string;
  label: string;
  /** A line above the label, e.g. "Your answer" */
  caption?: string;
  preview: ProbePreview | null;
  schema: PortfolioSchema;
  pending: boolean;
  /** No preview and none coming (it failed) */
  unavailable?: boolean;
  /** Chosen before its preview was ready: waiting for it */
  waiting?: boolean;
  disabled: boolean;
  /** Asks to be chosen again: after a first tap, or once its preview is shown */
  armed: "touch" | "preview" | null;
  onArm: () => void;
  /** `previewShown`: what the answer changes was on the tile when chosen */
  onApply: (previewShown: boolean) => void;
}) {
  const { show, hide, clear } = useProbePreviewActions();
  const log = useStudyLog();
  const previewStartedAt = useRef<number | null>(null);

  const next = useMemo(() => (preview ? preview.apply(schema) : null), [schema, preview]);
  const summary = useMemo(() => {
    if (!next) return null;
    const change = previewSchemaChange(schema, next);
    return { ...summarizeChange(change), items: diffItems(change, schema, next) };
  }, [schema, next]);
  // Collected answers to fields this answer removes, retypes or rewords (I6)
  const impact = useResponseImpact(schema, next);

  const startPreview = () => {
    if (preview && !disabled) {
      show(preview);
      previewStartedAt.current ??= Date.now();
    }
  };
  // Study log: previews looked at (not just brushed past), with dwell time.
  // Also when the look ends in a click — the tile is gone before the
  // pointer leaves it.
  const logLook = () => {
    const started = previewStartedAt.current;
    previewStartedAt.current = null;
    if (preview && started !== null && Date.now() - started >= 300) {
      log("option_previewed", {
        ownerId: preview.ownerId,
        option: value,
        ms: Date.now() - started,
        // The count the tile showed (absent where responses aren't known)
        ...(impact ? { affectedResponses: impact.responses } : {}),
      });
    }
  };
  const stopPreview = () => {
    if (preview) hide(preview.ownerId, preview.optionValue);
    logLook();
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

  // Its preview was shown because the creator chose it: show it on the
  // canvas too, as hovering would
  const revealed = armed === "preview";
  useEffect(() => {
    if (revealed && preview && !disabled) {
      show(preview);
      previewStartedAt.current ??= Date.now();
    }
  }, [revealed, preview, disabled, show]);

  const handleClick = () => {
    if (preview && !armed && isTouchOnly()) {
      onArm();
      startPreview();
      return;
    }
    logLook();
    clear();
    onApply(summary !== null);
  };

  return (
    <button
      type="button"
      data-testid={testId ?? `deck-option-${value}`}
      data-preview={summary ? "ready" : waiting ? "waiting" : pending ? "pending" : "none"}
      data-armed={armed ?? undefined}
      aria-busy={waiting || undefined}
      disabled={disabled || waiting}
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
      {caption && (
        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
          {caption}
        </span>
      )}
      <span
        data-testid="option-label"
        className="block text-[13px] font-medium leading-snug"
      >
        {label}
      </span>
      {summary ? (
        <>
          <PatchDiffLine summary={summary} />
          {impact && impact.responses > 0 && (
            <span
              data-testid="option-impact"
              title={impactDetail(impact)}
              className="mt-0.5 block text-[11px] font-medium text-amber-700 dark:text-amber-400"
            >
              {impactText(impact.responses).replace(/^a/, "A")}
            </span>
          )}
        </>
      ) : waiting ? (
        <span role="status" className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Preparing the preview…
        </span>
      ) : pending ? (
        <span className="mt-1 block h-3 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none">
          <span className="sr-only">Preparing preview…</span>
        </span>
      ) : unavailable ? (
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          No preview yet — retry the previews below
        </span>
      ) : null}
      {armed && summary && (
        <span className="mt-0.5 block text-[11px] text-primary">
          {armed === "touch"
            ? "Tap again to apply"
            : "This is what it changes. Choose it again to apply."}
        </span>
      )}
    </button>
  );
}

/** Added fields shown before "+N more"; changes to existing fields always show. */
const MAX_ADDED_ITEMS = 2;

interface DiffItem {
  label: string;
  kind: "added" | "updated" | "removed";
  /** For updates: what changes, e.g. "type text → choice" */
  note?: string;
}

/**
 * The change as a list, existing fields first: a change to something the
 * creator already has (an update or removal) is what the pilot showed people
 * missed, so it is listed with what changes and never folded into "+N more".
 */
function diffItems(
  change: ReturnType<typeof previewSchemaChange>,
  before: PortfolioSchema,
  after: PortfolioSchema,
): DiffItem[] {
  const notes = describeSchemaChange(before, after);
  const items: DiffItem[] = [];
  for (const kind of ["updated", "removed", "added"] as const) {
    for (const field of change.schema.fields) {
      if (change.annotations[field.id] !== kind) continue;
      items.push({
        label: field.label,
        kind,
        note: kind === "updated" ? notes[field.id]?.join(", ") : undefined,
      });
    }
  }
  return items;
}

/** e.g. "~ Age (now required)  − Notes  + Session length  +1 more" */
function PatchDiffLine({ summary }: { summary: PatchSummary & { items: DiffItem[] } }) {
  if (patchSize(summary) === 0) {
    return (
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        No form change
      </span>
    );
  }

  const existing = summary.items.filter((i) => i.kind !== "added");
  const added = summary.items.filter((i) => i.kind === "added");
  const shown = [...existing, ...added.slice(0, MAX_ADDED_ITEMS)];
  const more = added.length - Math.min(added.length, MAX_ADDED_ITEMS);

  return (
    <span
      data-testid="option-diff"
      className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] leading-4 text-muted-foreground"
    >
      {shown.map(({ label, kind, note }, i) => (
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
              kind !== "added" && "text-foreground/80",
            )}
            title={note ? `${label}: ${note}` : label}
          >
            {label}
            {note && <span className="text-muted-foreground"> ({note})</span>}
          </span>
        </span>
      ))}
      {more > 0 && <span>+{more} more</span>}
    </span>
  );
}
