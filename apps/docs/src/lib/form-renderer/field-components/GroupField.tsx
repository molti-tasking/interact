"use client";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import type { Field } from "@/lib/types";
import type { Control } from "react-hook-form";
import { FieldLegend } from "./FieldLabel";
import { renderFieldComponent } from "./index";

interface GroupFieldProps {
  field: Field;
  control: Control;
  /** Form path of the group itself; nested fields live at `${name}.${child}` */
  name: string;
}

export function GroupField({ field, control, name }: GroupFieldProps) {
  if (field.type.kind !== "group") return null;

  return (
    <FormItem>
      <FormControl>
        <fieldset className="grid gap-2">
          <FieldLegend field={field} className="mb-2 text-base font-semibold" />
          {field.description && (
            <FormDescription>{field.description}</FormDescription>
          )}
          <div className="space-y-4 rounded-lg border p-4">
            {field.type.fields.map((nestedField) => (
              <FormField
                key={nestedField.id}
                control={control}
                name={`${name}.${nestedField.name}`}
                render={({ field: formField }) =>
                  renderFieldComponent(nestedField, formField, control)
                }
              />
            ))}
          </div>
        </fieldset>
      </FormControl>
      {/* Group-level errors (nested errors show next to their fields) */}
      <FormMessage />
    </FormItem>
  );
}
