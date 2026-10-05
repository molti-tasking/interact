"use client";

import { Form, FormField } from "@/components/ui/form";
import { schemaToZod } from "@/lib/engine/schema-ops";
import type { Field, PortfolioSchema } from "@/lib/types";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dices, Pencil } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useForm, useFormState } from "react-hook-form";
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
  /**
   * Persist a validated submission. To signal failure, show your own error
   * toast and **throw** — the form then keeps the respondent's values and
   * shows an inline "not submitted" note. Optionally resolve with the
   * persisted data (e.g. with uploaded file references); edit forms
   * (`defaultValues` set) reset to it. New-entry forms reset to empty.
   */
  onSubmit?: (
    data: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | void>;
  onFieldClick?: (field: Field) => void;
  className?: string;
}

/** Inline note after a failed submit (the page shows the detailed toast). */
function SubmitError() {
  const { errors } = useFormState();
  const message = (errors.root as { submit?: { message?: string } } | undefined)
    ?.submit?.message;
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
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
    const fill = (fields: Field[], prefix: string) => {
      for (const field of fields) {
        const path = prefix ? `${prefix}.${field.name}` : field.name;
        if (field.type.kind === "group") {
          fill(field.type.fields, path);
          continue;
        }
        const val = randomValueForField(field);
        if (val !== undefined) {
          form.setValue(path, val, {
            shouldValidate: true,
            shouldDirty: true,
          });
        }
      }
    };
    fill(schema.fields, "");
  }, [schema.fields, form]);

  const handleSubmit = async (data: Record<string, unknown>) => {
    let saved: Record<string, unknown> | void;
    try {
      saved = await onSubmit?.(data);
    } catch {
      // The caller reported the error; keep everything the respondent typed.
      form.setError("root.submit", {
        type: "submit",
        message: "Not submitted — your answers are still here. Please try again.",
      });
      return;
    }
    if (defaultValues) {
      form.reset(saved ?? data);
    } else if (mode === "live") {
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
        noValidate
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
                aria-label={`Edit field ${field.label}`}
                className={cn(
                  "absolute -top-1 -bottom-1 -left-1 -right-1 z-10 flex cursor-pointer items-center justify-end rounded-lg border border-transparent pr-3 opacity-0 transition-all",
                  "group-hover:opacity-100 group-hover:border-primary/30 group-hover:bg-primary/5",
                  "focus-visible:opacity-100 focus-visible:border-primary/50 focus-visible:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  // Touch screens have no hover: keep the pencil visible.
                  "[@media(hover:none)]:opacity-100",
                )}
              >
                <Pencil className="h-3.5 w-3.5 text-primary/60" aria-hidden />
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

        <SubmitError />

        {mode === "live" && onSubmit && (
          <div className="flex gap-2 pt-4">
            <FormSaveButton />
            <button
              type="button"
              onClick={fillRandom}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              <Dices className="h-3.5 w-3.5" aria-hidden />
              Random
            </button>
          </div>
        )}
      </form>
    </Form>
  );
}
