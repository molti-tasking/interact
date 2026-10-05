"use client";

import { FormLabel, useFormField } from "@/components/ui/form";
import type { Field } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { FieldTooltip } from "./FieldTooltip";

function RequiredMark() {
  // The control carries aria-required; the asterisk is visual only.
  return (
    <span aria-hidden className="text-destructive ml-1">
      *
    </span>
  );
}

/**
 * Label row for a field: `<label>` linked to the control, plus the tooltip
 * button *outside* the label so its text doesn't leak into the control's
 * accessible name.
 */
export function FieldLabel({
  field,
  suffix,
  className,
}: {
  field: Field;
  suffix?: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <FormLabel className={className}>
        {field.label}
        {suffix}
        {field.required && <RequiredMark />}
      </FormLabel>
      {field.tooltip && (
        <FieldTooltip text={field.tooltip} label={field.label} />
      )}
    </div>
  );
}

/** `<legend>` counterpart of FieldLabel for fieldsets (groups, option lists). */
export function FieldLegend({
  field,
  className,
}: {
  field: Field;
  className?: string;
}) {
  const { error } = useFormField();
  const hasOwnError = !!error?.message;

  return (
    <legend
      data-error={hasOwnError}
      className={cn(
        "flex items-center gap-1 text-sm leading-none font-medium select-none data-[error=true]:text-destructive",
        className,
      )}
    >
      <span>
        {field.label}
        {field.required && (
          <>
            <RequiredMark />
            <span className="sr-only"> (required)</span>
          </>
        )}
      </span>
      {field.tooltip && (
        <FieldTooltip text={field.tooltip} label={field.label} />
      )}
    </legend>
  );
}
