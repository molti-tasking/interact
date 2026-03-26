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

interface DateFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function DateField({ field, formField }: DateFieldProps) {
  const range = field.type.kind === "date" ? field.type.range : undefined;

  return (
    <FormItem>
      <FormLabel>
        {field.label}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </FormLabel>
      <FormControl>
        <Input
          type="date"
          // placeholder={field.description}
          min={range?.min}
          max={range?.max}
          {...formField}
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
