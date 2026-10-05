"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import type { Field } from "@/lib/types";
import type { ControllerRenderProps } from "react-hook-form";
import { FieldLabel } from "./FieldLabel";

interface BooleanFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function BooleanField({ field, formField }: BooleanFieldProps) {
  const { ref, name, onBlur, onChange, disabled, value } = formField;
  return (
    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
      <FormControl>
        <input
          type="checkbox"
          className="h-4 w-4 mt-1"
          name={name}
          ref={ref}
          onBlur={onBlur}
          disabled={disabled}
          aria-required={field.required || undefined}
          checked={(value as boolean) ?? false}
          onChange={(e) => onChange(e.target.checked)}
        />
      </FormControl>
      <div className="space-y-1 leading-none">
        <FieldLabel field={field} />
        {field.description && (
          <FormDescription>{field.description}</FormDescription>
        )}
        <FormMessage />
      </div>
    </FormItem>
  );
}
