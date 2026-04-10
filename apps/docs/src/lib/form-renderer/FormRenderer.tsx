"use client";

import { Form, FormField } from "@/components/ui/form";
import { schemaToZod } from "@/lib/engine/schema-ops";
import type { Field, PortfolioSchema } from "@/lib/types";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dices, Pencil } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { renderFieldComponent } from "./field-components";
import { FormSaveButton } from "./FormSaveButton";

function randomValueForField(field: Field): unknown {
  const { type } = field;
  switch (type.kind) {
    case "text": {
      const samples = [
        "Alice",
        "Acme Corp",
        "Lorem ipsum",
        "42B",
        "hello@example.com",
        "New York",
      ];
      return samples[Math.floor(Math.random() * samples.length)];
    }
    case "number": {
      const min = type.min ?? 0;
      const max = type.max ?? 100;
      return Math.round((min + Math.random() * (max - min)) * 100) / 100;
    }
    case "select": {
      if (type.options.length === 0) return type.multiple ? [] : "";
      if (type.multiple) {
        const count = Math.floor(Math.random() * type.options.length) + 1;
        const shuffled = [...type.options].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count).map((o) => o.value);
      }
      return type.options[Math.floor(Math.random() * type.options.length)]
        .value;
    }
    case "date": {
      const start = type.range
        ? new Date(type.range.min).getTime()
        : Date.now() - 365 * 86400000;
      const end = type.range ? new Date(type.range.max).getTime() : Date.now();
      return new Date(start + Math.random() * (end - start))
        .toISOString()
        .slice(0, 10);
    }
    case "boolean":
      return Math.random() > 0.5;
    case "scale":
      return Math.floor(type.min + Math.random() * (type.max - type.min + 1));
    case "file":
      return undefined;
    case "group":
      return undefined;
    default:
      return undefined;
  }
}

interface FormRendererProps {
  schema: PortfolioSchema;
  mode: "preview" | "live";
  defaultValues?: Record<string, unknown>;
  onSubmit?: (data: Record<string, unknown>) => Promise<void>;
  onFieldClick?: (field: Field) => void;
  className?: string;
}

export function FormRenderer({
  schema,
  mode,
  defaultValues,
  onSubmit,
  onFieldClick,
  className,
}: FormRendererProps) {
  const zodSchema = useMemo(() => schemaToZod(schema), [schema]);

  const form = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues: defaultValues ?? {},
  });

  const fillRandom = useCallback(() => {
    for (const field of schema.fields) {
      const val = randomValueForField(field);
      if (val !== undefined) {
        form.setValue(field.name, val, {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    }
  }, [schema.fields, form]);

  const handleSubmit = async (data: Record<string, unknown>) => {
    await onSubmit?.(data);
    if (defaultValues) {
      form.reset(data);
    }
    if (mode === "live" && !defaultValues) {
      form.reset(undefined, { keepTouched: false });
    }
  };

  if (schema.fields.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed p-8 text-muted-foreground">
        No fields yet. Start by describing your form intent.
      </div>
    );
  }

  return (
    <Form {...form}>
      <form
        data-testid="form-renderer"
        onSubmit={form.handleSubmit(handleSubmit)}
        className={className ?? "space-y-6"}
      >
        {schema.fields.map((field) => (
          <div
            key={field.id}
            data-testid={`form-field-${field.name}`}
            className={cn(
              mode === "preview" && onFieldClick && "group relative",
            )}
          >
            {/* Clickable edit overlay in preview mode */}
            {mode === "preview" && onFieldClick && (
              <button
                type="button"
                onClick={() => onFieldClick(field)}
                className="absolute -top-1 -bottom-1 -left-1 -right-1 z-10 rounded-lg border border-transparent opacity-0 group-hover:opacity-100 group-hover:border-primary/30 group-hover:bg-primary/5 transition-all cursor-pointer flex items-center justify-end pr-3"
              >
                <Pencil className="h-3.5 w-3.5 text-primary/60" />
              </button>
            )}
            <FormField
              control={form.control}
              name={field.name}
              render={({ field: formField }) =>
                renderFieldComponent(field, formField, form.control)
              }
            />
          </div>
        ))}

        {mode === "live" && onSubmit && (
          <div className="flex gap-2 pt-4">
            <FormSaveButton />
            <button
              type="button"
              onClick={fillRandom}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              <Dices className="h-3.5 w-3.5" />
              Random
            </button>
          </div>
        )}
      </form>
    </Form>
  );
}
