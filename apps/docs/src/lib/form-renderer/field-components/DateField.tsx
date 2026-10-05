"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { Field } from "@/lib/types";
import type { ControllerRenderProps } from "react-hook-form";
import { FieldLabel } from "./FieldLabel";

interface DateFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function DateField({ field, formField }: DateFieldProps) {
  const range = field.type.kind === "date" ? field.type.range : undefined;

  return (
    <FormItem>
      <FieldLabel field={field} />
      <FormControl>
        <Input
          type="date"
          min={range?.min}
          max={range?.max}
          {...formField}
          aria-required={field.required || undefined}
          value={(formField.value as string) ?? ""}
        />
      </FormControl>
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
