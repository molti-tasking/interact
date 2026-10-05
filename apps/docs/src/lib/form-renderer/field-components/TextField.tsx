"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Field } from "@/lib/types";
import type { ControllerRenderProps } from "react-hook-form";
import { FieldLabel } from "./FieldLabel";

interface TextFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function TextField({ field, formField }: TextFieldProps) {
  const maxLength =
    field.type.kind === "text" ? field.type.maxLength : undefined;
  const useTextarea = maxLength && maxLength > 200;

  return (
    <FormItem>
      <FieldLabel field={field} />
      <FormControl>
        {useTextarea ? (
          <Textarea
            {...formField}
            aria-required={field.required || undefined}
            value={(formField.value as string) ?? ""}
          />
        ) : (
          <Input
            type="text"
            {...formField}
            aria-required={field.required || undefined}
            value={(formField.value as string) ?? ""}
          />
        )}
      </FormControl>
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
