"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  likertPoints,
  scaleChoices,
  type ScaleChoice,
} from "@/lib/engine/scale";
import type { Field } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useId, type CSSProperties } from "react";
import type { ControllerRenderProps } from "react-hook-form";
import { FieldLabel, FieldLegend, FieldStatement } from "./FieldLabel";

interface ScaleFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

/** Scales with at most this many steps render as a row of radio buttons. */
const MAX_RADIO_STEPS = 11;

function toScaleNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Sets `--points` for the column templates below. */
function pointsStyle(count: number): CSSProperties {
  return { "--points": count } as CSSProperties;
}

/** Statement column + one column per point; shared by grid header and rows. */
const LIKERT_GRID_COLUMNS =
  "@lg:grid-cols-[minmax(0,1.6fr)_repeat(var(--points),minmax(0,1fr))]";

/** "Strongly agree", or "5 – Strongly agree" for an end of a numeric scale. */
function choiceName({ label, hint }: ScaleChoice): string {
  return hint ? `${label} – ${hint}` : label;
}

/** Column headings of a scale grid (wide forms only; rows label themselves otherwise). */
export function LikertGridHeader({ choices }: { choices: ScaleChoice[] }) {
  return (
    <div
      aria-hidden
      style={pointsStyle(choices.length)}
      className={cn(
        "hidden items-end gap-x-1 px-1 pb-1.5 text-center text-[11px] leading-tight text-muted-foreground @lg:grid",
        LIKERT_GRID_COLUMNS,
      )}
    >
      <span />
      {choices.map((choice) => (
        <span key={choice.value} className="px-0.5">
          {choice.label}
          {choice.hint && (
            <span className="block text-[10px] text-muted-foreground/80">
              {choice.hint}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * One statement of a scale grid. On wide forms its radios sit under the
 * grid's column headings; on narrow ones each point is a labelled pill.
 */
export function LikertRow({ field, formField }: ScaleFieldProps) {
  const statementId = useId();
  const choices = scaleChoices(field.type);
  if (!choices) return <ScaleField field={field} formField={formField} />;

  const { ref, name, onBlur, onChange, disabled, value } = formField;
  const current = toScaleNumber(value);

  return (
    <FormItem className="gap-1">
      <FormControl>
        <div
          role="radiogroup"
          aria-labelledby={statementId}
          aria-required={field.required || undefined}
          style={pointsStyle(choices.length)}
          className={cn(
            "grid gap-2 px-1 py-2 @lg:items-center @lg:gap-x-1 @lg:py-1.5",
            LIKERT_GRID_COLUMNS,
          )}
        >
          <FieldStatement field={field} id={statementId} />
          <div className="flex flex-wrap gap-1.5 @lg:contents">
            {choices.map((choice, i) => (
              <label
                key={choice.value}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted",
                  "has-checked:border-primary has-checked:bg-primary/10 has-focus-visible:ring-2 has-focus-visible:ring-ring",
                  "@lg:justify-center @lg:self-stretch @lg:border-transparent @lg:px-0",
                )}
              >
                <input
                  type="radio"
                  className="size-4 shrink-0 cursor-pointer accent-primary"
                  ref={i === 0 ? ref : undefined}
                  name={name}
                  value={choice.value}
                  checked={current === choice.value}
                  disabled={disabled}
                  onBlur={onBlur}
                  onChange={() => onChange(choice.value)}
                />
                <span className="@lg:sr-only">{choiceName(choice)}</span>
              </label>
            ))}
          </div>
        </div>
      </FormControl>
      <FormMessage className="px-1" />
    </FormItem>
  );
}

/** A Likert item on its own: the statement, then its labelled points. */
function LikertField({
  field,
  formField,
  min,
  points,
}: ScaleFieldProps & { min: number; points: string[] }) {
  const { ref, name, onBlur, onChange, disabled, value } = formField;
  const current = toScaleNumber(value);

  return (
    <FormItem>
      <FormControl>
        <fieldset className="grid gap-2">
          <FieldLegend field={field} className="mb-2" />
          <div
            style={pointsStyle(points.length)}
            className="grid gap-1.5 @md:grid-cols-[repeat(var(--points),minmax(0,1fr))]"
          >
            {points.map((point, i) => {
              const v = min + i;
              return (
                <label
                  key={v}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm leading-snug transition-colors hover:bg-muted",
                    "has-checked:border-primary has-checked:bg-primary/10 has-focus-visible:ring-2 has-focus-visible:ring-ring",
                    "@md:flex-col @md:gap-1.5 @md:px-1.5 @md:text-center @md:text-xs",
                  )}
                >
                  <input
                    type="radio"
                    className="size-4 shrink-0 cursor-pointer accent-primary"
                    ref={i === 0 ? ref : undefined}
                    name={name}
                    value={v}
                    checked={current === v}
                    disabled={disabled}
                    onBlur={onBlur}
                    onChange={() => onChange(v)}
                  />
                  {point}
                </label>
              );
            })}
          </div>
        </fieldset>
      </FormControl>
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}

export function ScaleField({ field, formField }: ScaleFieldProps) {
  const scaleType = field.type.kind === "scale" ? field.type : null;
  if (!scaleType) return null;

  const points = likertPoints(scaleType);
  if (points) {
    return (
      <LikertField
        field={field}
        formField={formField}
        min={scaleType.min}
        points={points}
      />
    );
  }

  const { min, max, labels } = scaleType;
  const { ref, name, onBlur, onChange, disabled, value } = formField;
  const current = toScaleNumber(value);
  const steps = max - min + 1;

  if (Number.isInteger(min) && Number.isInteger(max) && steps > 0 && steps <= MAX_RADIO_STEPS) {
    const values = Array.from({ length: steps }, (_, i) => min + i);
    return (
      <FormItem>
        <FormControl>
          <fieldset className="grid gap-2">
            <FieldLegend field={field} className="mb-2" />
            <div className="flex flex-wrap gap-1.5">
              {values.map((v, i) => {
                const checked = current === v;
                return (
                  <label
                    key={v}
                    className={cn(
                      "relative inline-flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border px-2 text-sm transition-colors",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      ref={i === 0 ? ref : undefined}
                      name={name}
                      value={v}
                      checked={checked}
                      disabled={disabled}
                      onBlur={onBlur}
                      onChange={() => onChange(v)}
                    />
                    {v}
                  </label>
                );
              })}
            </div>
            {labels && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {min} = {labels.low}
                </span>
                <span>
                  {max} = {labels.high}
                </span>
              </div>
            )}
          </fieldset>
        </FormControl>
        {field.description && (
          <FormDescription>{field.description}</FormDescription>
        )}
        <FormMessage />
      </FormItem>
    );
  }

  // Wide scales: a slider. Until the respondent moves it the value stays
  // unanswered (shown dimmed with "Not answered") instead of claiming `min`.
  return (
    <FormItem>
      <FieldLabel field={field} />
      <FormControl>
        <Input
          type="range"
          min={min}
          max={max}
          name={name}
          ref={ref}
          onBlur={onBlur}
          disabled={disabled}
          aria-required={field.required || undefined}
          aria-valuetext={current === undefined ? "Not answered" : String(current)}
          value={current ?? min}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn("w-full", current === undefined && "opacity-50")}
        />
      </FormControl>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{labels?.low ?? min}</span>
        <span className="font-medium text-foreground" aria-live="polite">
          {current ?? "Not answered"}
        </span>
        <span>{labels?.high ?? max}</span>
      </div>
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
