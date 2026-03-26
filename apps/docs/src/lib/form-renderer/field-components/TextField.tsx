"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Field } from "@/lib/types";
import type { ControllerRenderProps } from "react-hook-form";

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
      <FormLabel>
        {field.label}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </FormLabel>
      <FormControl>
        {useTextarea ? (
          <Textarea
            // placeholder={field.description}
            {...formField}
            value={(formField.value as string) ?? ""}
          />
        ) : (
          <Input
            type="text"
            // placeholder={field.description}
            {...formField}
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
