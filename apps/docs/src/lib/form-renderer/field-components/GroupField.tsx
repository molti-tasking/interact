"use client";

import {
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import type { Field } from "@/lib/types";
import type { Control } from "react-hook-form";
import { FieldTooltip } from "./FieldTooltip";
import { renderFieldComponent } from "./index";

interface GroupFieldProps {
  field: Field;
  control: Control;
}

export function GroupField({ field, control }: GroupFieldProps) {
  if (field.type.kind !== "group") return null;

  return (
    <FormItem>
      <FormLabel className="text-base font-semibold">
        {field.label}
        {field.tooltip && <FieldTooltip text={field.tooltip} />}
      </FormLabel>
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <div className="space-y-4 rounded-lg border p-4">
        {field.type.fields.map((nestedField) => (
          <FormField
            key={nestedField.id}
            control={control}
            name={nestedField.name}
            render={({ field: formField }) =>
              renderFieldComponent(nestedField, formField, control)
            }
          />
        ))}
      </div>
    </FormItem>
  );
}
