"use client";

import { Form, FormField } from "@/components/ui/form";
import { schemaToZod } from "@/lib/engine/schema-ops";
import type { Field, PortfolioSchema } from "@/lib/types";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { renderFieldComponent } from "./field-components";
import { FormSaveButton } from "./FormSaveButton";

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

  const handleSubmit = async (data: Record<string, unknown>) => {
    await onSubmit?.(data);
    if (defaultValues) {
      form.reset(data);
    }
    if (mode === "live" && !defaultValues) {
      form.reset();
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
        onSubmit={form.handleSubmit(handleSubmit)}
        className={className ?? "space-y-6"}
      >
        {schema.fields.map((field) => (
          <div
            key={field.id}
            className={cn(
              mode === "preview" && onFieldClick && "group relative",
            )}
          >
            {/* Clickable edit overlay in preview mode */}
            {mode === "preview" && onFieldClick && (
              <button
                type="button"
                onClick={() => onFieldClick(field)}
                className="absolute inset-0 z-10 rounded-lg border border-transparent opacity-0 group-hover:opacity-100 group-hover:border-primary/30 group-hover:bg-primary/5 transition-all cursor-pointer flex items-center justify-end pr-3"
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
          </div>
        )}
      </form>
    </Form>
  );
}
