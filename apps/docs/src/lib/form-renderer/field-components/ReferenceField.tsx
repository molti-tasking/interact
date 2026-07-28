"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
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
import { FieldTooltip } from "./FieldTooltip";

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
  const current = isReferenceValue(formField.value) ? formField.value : null;
  const items =
    current && !candidates.some((c) => c.responseId === current.responseId)
      ? [{ responseId: current.responseId, label: current.label }, ...candidates]
      : candidates;

  return (
    <FormItem>
      <FormLabel>
        {field.label}
        {field.tooltip && <FieldTooltip text={field.tooltip} />}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </FormLabel>
      <FormControl>
        <Select
          value={current?.responseId ?? ""}
          onValueChange={(responseId) => {
            const chosen = items.find((c) => c.responseId === responseId);
            if (chosen) {
              formField.onChange({
                responseId: chosen.responseId,
                label: chosen.label,
              });
            }
          }}
        >
          <SelectTrigger className="min-w-40 w-full">
            <SelectValue
              placeholder={
                target ? `Select from "${target.title}"` : "Select a linked entry"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {items.map((c) => (
              <SelectItem key={`${field.id}-${c.responseId}`} value={c.responseId}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormControl>
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
