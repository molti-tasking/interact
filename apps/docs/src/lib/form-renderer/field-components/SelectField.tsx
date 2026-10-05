"use client";

import {
  FormControl,
  FormDescription,
  FormItem,
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
import { FieldLabel, FieldLegend } from "./FieldLabel";

interface SelectFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

export function SelectField({ field, formField }: SelectFieldProps) {
  const options: SelectOption[] =
    field.type.kind === "select" ? field.type.options : [];
  const multiple = field.type.kind === "select" ? field.type.multiple : false;
  const { ref, name, onBlur, onChange, disabled, value } = formField;

  if (multiple) {
    const selectedValues = Array.isArray(value) ? (value as string[]) : [];
    return (
      <FormItem>
        <FormControl>
          <fieldset className="grid gap-2">
            <FieldLegend field={field} className="mb-2" />
            {options.map((option, i) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  ref={i === 0 ? ref : undefined}
                  name={name}
                  value={option.value}
                  checked={selectedValues.includes(option.value)}
                  onBlur={onBlur}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter((v) => v !== option.value);
                    onChange(next);
                  }}
                  className="h-4 w-4"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        </FormControl>
        {field.description && (
          <FormDescription>{field.description}</FormDescription>
        )}
        <FormMessage />
      </FormItem>
    );
  }

  return (
    <FormItem>
      <FieldLabel field={field} />
      <Select
        name={name}
        disabled={disabled}
        onValueChange={onChange}
        value={(value as string | undefined) ?? ""}
      >
        <FormControl>
          <SelectTrigger
            ref={ref}
            onBlur={onBlur}
            aria-required={field.required || undefined}
            className="min-w-40 w-full"
          >
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
        </FormControl>
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
      {field.description && (
        <FormDescription>{field.description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
