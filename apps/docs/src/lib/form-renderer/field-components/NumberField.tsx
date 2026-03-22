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

interface NumberFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function NumberField({ field, formField }: NumberFieldProps) {
  const fieldType = field.type;
  const min = fieldType.kind === "number" ? fieldType.min : undefined;
  const max = fieldType.kind === "number" ? fieldType.max : undefined;
  const unit = fieldType.kind === "number" ? fieldType.unit : undefined;

  return (
    <FormItem>
      <FormLabel>
        {field.label}
        {unit && <span className="text-muted-foreground ml-1">({unit})</span>}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </FormLabel>
      <FormControl>
        <Input
          type="number"
          placeholder={field.description}
          min={min}
          max={max}
          {...formField}
          value={(formField.value as number) ?? ""}
        />
      </FormControl>
      {field.description && <FormDescription>{field.description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}
