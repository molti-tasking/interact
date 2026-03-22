"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Field, SelectOption } from "@/lib/types";
import type { ControllerRenderProps } from "react-hook-form";

interface SelectFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function SelectField({ field, formField }: SelectFieldProps) {
  const options: SelectOption[] =
    field.type.kind === "select" ? field.type.options : [];
  const multiple = field.type.kind === "select" ? field.type.multiple : false;

  if (multiple) {
    const selectedValues = (formField.value as string[]) ?? [];
    return (
      <FormItem>
        <FormLabel>
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </FormLabel>
        <div className="space-y-2">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={selectedValues.includes(option.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selectedValues, option.value]
                    : selectedValues.filter((v) => v !== option.value);
                  formField.onChange(next);
                }}
                className="h-4 w-4"
              />
              {option.label}
            </label>
          ))}
        </div>
        {field.description && (
          <FormDescription>{field.description}</FormDescription>
        )}
        <FormMessage />
      </FormItem>
    );
  }

  return (
    <FormItem>
      <FormLabel>
        {field.label}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </FormLabel>
      <FormControl>
        <Select
          onValueChange={formField.onChange}
          value={formField.value as string}
        >
          <SelectTrigger>
            <SelectValue placeholder={`Select ${field.label}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem
                key={`${field.id}-${option.value}`}
                value={option.value}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormControl>
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
