"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { Field } from "@/lib/types";
import type { ControllerRenderProps } from "react-hook-form";
import { FieldTooltip } from "./FieldTooltip";

interface BooleanFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function BooleanField({ field, formField }: BooleanFieldProps) {
  return (
    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
      <FormControl>
        <input
          type="checkbox"
          className="h-4 w-4 mt-1"
          checked={(formField.value as boolean) ?? false}
          onChange={(e) => formField.onChange(e.target.checked)}
        />
      </FormControl>
      <div className="space-y-1 leading-none">
        <FormLabel>
          {field.label}
          {field.tooltip && <FieldTooltip text={field.tooltip} />}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </FormLabel>
        {field.description && (
          <FormDescription>{field.description}</FormDescription>
        )}
        <FormMessage />
      </div>
    </FormItem>
  );
}
