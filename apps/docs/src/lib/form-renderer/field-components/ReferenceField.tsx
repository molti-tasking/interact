"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useResponses } from "@/hooks/query/responses-new";
import { isReferenceValue, type Field } from "@/lib/types";
import {
  referenceLabelFor,
  type ReferenceCandidate,
} from "@/lib/voice/reference-resolution";
import type { ControllerRenderProps } from "react-hook-form";
import { FieldLabel } from "./FieldLabel";

interface ReferenceFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

/**
 * A link to a row of another portfolio in the same space: rendered as a
 * select over the target's entries, stored as { responseId, label }.
 */
export function ReferenceField({ field, formField }: ReferenceFieldProps) {
  const ref = field.type.kind === "reference" ? field.type : undefined;
  const { data: target } = usePortfolio(ref?.targetPortfolioId);
  const { data: rows } = useResponses(ref?.targetPortfolioId);

  const candidates: ReferenceCandidate[] = (rows ?? [])
    .map((r) => {
      const label = target
        ? referenceLabelFor(target.schema, r.data, ref?.displayFieldName)
        : null;
      return label ? { responseId: r.id, label } : null;
    })
    .filter((c): c is ReferenceCandidate => c !== null);

  // Keep a stored value selectable even if its row hasn't loaded or was
  // removed from the target table.
  const { ref: controlRef, name, onBlur, onChange, disabled, value } =
    formField;
  const current = isReferenceValue(value) ? value : null;
  const items =
    current && !candidates.some((c) => c.responseId === current.responseId)
      ? [{ responseId: current.responseId, label: current.label }, ...candidates]
      : candidates;

  return (
    <FormItem>
      <FieldLabel field={field} />
      <Select
        name={name}
        disabled={disabled}
        value={current?.responseId ?? ""}
        onValueChange={(responseId) => {
          const chosen = items.find((c) => c.responseId === responseId);
          if (chosen) {
            onChange({
              responseId: chosen.responseId,
              label: chosen.label,
            });
          }
        }}
      >
        <FormControl>
          <SelectTrigger
            ref={controlRef}
            onBlur={onBlur}
            aria-required={field.required || undefined}
            className="min-w-40 w-full"
          >
            <SelectValue
              placeholder={
                target ? `Select from "${target.title}"` : "Select a linked entry"
              }
            />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {items.map((c) => (
            <SelectItem key={`${field.id}-${c.responseId}`} value={c.responseId}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {typeof value === "string" && value.trim() && (
        <p className="text-xs text-muted-foreground">
          Currently &ldquo;{value}&rdquo; (not linked to an entry)
        </p>
      )}
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
