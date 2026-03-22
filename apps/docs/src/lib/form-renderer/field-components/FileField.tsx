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

interface FileFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function FileField({ field, formField }: FileFieldProps) {
  const accept =
    field.type.kind === "file" ? field.type.accept.join(",") : undefined;

  return (
    <FormItem>
      <FormLabel>
        {field.label}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </FormLabel>
      <FormControl>
        <Input
          type="file"
          accept={accept}
          onChange={(e) => {
            const files = e.target.files;
            formField.onChange(files?.[0] ?? null);
          }}
        />
      </FormControl>
      {field.description && <FormDescription>{field.description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}
