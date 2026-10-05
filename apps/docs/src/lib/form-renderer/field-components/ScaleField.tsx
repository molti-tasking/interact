"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { Field } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ControllerRenderProps } from "react-hook-form";
import { FieldLabel, FieldLegend } from "./FieldLabel";

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

export function ScaleField({ field, formField }: ScaleFieldProps) {
  const scaleType = field.type.kind === "scale" ? field.type : null;
  if (!scaleType) return null;

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
