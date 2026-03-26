"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { Field } from "@/lib/types";
import type { ControllerRenderProps } from "react-hook-form";
import { FieldTooltip } from "./FieldTooltip";

interface ScaleFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function ScaleField({ field, formField }: ScaleFieldProps) {
  const scaleType = field.type.kind === "scale" ? field.type : null;
  if (!scaleType) return null;

  return (
    <FormItem>
      <FormLabel>
        {field.label}
        {field.tooltip && <FieldTooltip text={field.tooltip} />}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </FormLabel>
      <FormControl>
        <div className="space-y-2">
          <Input
            type="range"
            min={scaleType.min}
            max={scaleType.max}
            {...formField}
            value={(formField.value as number) ?? scaleType.min}
            className="w-full"
          />
          {scaleType.labels && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{scaleType.labels.low}</span>
              <span className="font-medium text-foreground">
                {(formField.value as number) ?? scaleType.min}
              </span>
              <span>{scaleType.labels.high}</span>
            </div>
          )}
        </div>
      </FormControl>
      {field.description && <FormDescription>{field.description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}
