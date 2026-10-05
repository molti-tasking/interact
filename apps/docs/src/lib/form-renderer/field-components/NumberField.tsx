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
import { labelIncludesUnit } from "../values";
import { FieldLabel } from "./FieldLabel";

interface NumberFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function NumberField({ field, formField }: NumberFieldProps) {
  const fieldType = field.type;
  const min = fieldType.kind === "number" ? fieldType.min : undefined;
  const max = fieldType.kind === "number" ? fieldType.max : undefined;
  const unit = fieldType.kind === "number" ? fieldType.unit : undefined;
  const showUnit = !!unit && !labelIncludesUnit(field.label, unit);

  return (
    <FormItem>
      <FieldLabel
        field={field}
        suffix={
          showUnit && (
            <span className="text-muted-foreground ml-1">({unit})</span>
          )
        }
      />
      <FormControl>
        <Input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          {...formField}
          aria-required={field.required || undefined}
          value={(formField.value as number | string | undefined) ?? ""}
        />
      </FormControl>
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
