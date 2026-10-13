"use client";

import { Form, FormField } from "@/components/ui/form";
import type { FieldAnnotation } from "@/lib/engine/probe-preview";
import { groupLikertRuns, scaleChoices } from "@/lib/engine/scale";
import { schemaToZod } from "@/lib/engine/schema-ops";
import type { Field, PortfolioSchema } from "@/lib/types";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dices, Pencil, TriangleAlert } from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";
import { useForm, useFormState } from "react-hook-form";
import { renderFieldComponent } from "./field-components";
import {
  LikertGridHeader,
  LikertRow,
} from "./field-components/ScaleField";
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
  /**
   * Preview of a pending change: field id → how it changes. Annotated
   * fields are highlighted; removed fields are shown struck through.
   */
  fieldAnnotations?: Record<string, FieldAnnotation>;
  /** Field id → an issue to point out on the field (e.g. a schema conflict) */
  fieldMarks?: Record<string, FieldMark>;
  className?: string;
}

export interface FieldMark {
  tone: "error" | "warning" | "info";
  /** Short badge text, e.g. "Overlapping fields" */
  label: string;
  /** Longer explanation, shown on hover */
  title?: string;
  /** Draw attention to this issue (e.g. it's the one being looked at) */
  emphasized?: boolean;
  onClick?: () => void;
}

const markStyles: Record<
  FieldMark["tone"],
  { strong: string; subtle: string; badge: string }
> = {
  error: {
    strong: "rounded-md bg-red-500/6 outline-2 outline-offset-4 outline-red-500/70",
    subtle: "rounded-md outline-1 outline-dashed outline-offset-4 outline-red-500/45",
    badge: "bg-red-600 text-white",
  },
  warning: {
    strong: "rounded-md bg-amber-500/6 outline-2 outline-offset-4 outline-amber-500/70",
    subtle: "rounded-md outline-1 outline-dashed outline-offset-4 outline-amber-500/50",
    badge: "bg-amber-500 text-white",
  },
  info: {
    strong: "rounded-md bg-sky-500/6 outline-2 outline-offset-4 outline-sky-500/70",
    subtle: "rounded-md outline-1 outline-dashed outline-offset-4 outline-sky-500/45",
    badge: "bg-sky-600 text-white",
  },
};

const annotationStyles: Record<
  FieldAnnotation,
  { wrapper: string; badge: string; label: string }
> = {
  added: {
    wrapper:
      "rounded-md bg-emerald-500/8 outline-2 outline-offset-4 outline-emerald-500/60",
    badge: "bg-emerald-600 text-white",
    label: "New",
  },
  updated: {
    wrapper:
      "rounded-md bg-amber-500/8 outline-2 outline-offset-4 outline-amber-500/60",
    badge: "bg-amber-500 text-white",
    label: "Changed",
  },
  removed: {
    wrapper:
      "pointer-events-none rounded-md opacity-45 outline-2 outline-dashed outline-offset-4 outline-red-500/50 [&_label]:line-through",
    badge: "bg-red-600 text-white",
    label: "Removed",
  },
};

/**
 * Wrapper of one field: change annotations, conflict marks and, in the
 * workspace preview, the click-to-edit overlay.
 */
function FieldShell({
  field,
  onEdit,
  annotation,
  mark: markProp,
  className,
  children,
}: {
  field: Field;
  onEdit?: () => void;
  annotation?: FieldAnnotation;
  mark?: FieldMark;
  className?: string;
  children: ReactNode;
}) {
  // A pending change takes precedence over pointing out an issue
  const mark = annotation ? undefined : markProp;
  return (
    <div
      data-testid={`form-field-${field.name}`}
      data-annotation={annotation}
      className={cn(
        className,
        onEdit && "group relative",
        annotation && "relative",
        annotation && annotationStyles[annotation].wrapper,
        mark && "relative",
        mark &&
          (mark.emphasized
            ? markStyles[mark.tone].strong
            : markStyles[mark.tone].subtle),
      )}
    >
      {mark && (
        <button
          type="button"
          onClick={mark.onClick}
          disabled={!mark.onClick}
          title={mark.title}
          data-testid="field-conflict-mark"
          className={cn(
            "absolute -top-3 right-0 z-20 flex max-w-[60%] cursor-pointer items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium leading-4 shadow-sm transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
            markStyles[mark.tone].badge,
            !mark.emphasized && "opacity-80 hover:opacity-100",
          )}
        >
          <TriangleAlert className="h-2.5 w-2.5 shrink-0" aria-hidden />
          <span className="truncate">{mark.label}</span>
        </button>
      )}
      {annotation && (
        <span
          className={cn(
            "absolute -top-3 right-0 z-10 rounded-full px-1.5 py-px text-[10px] font-medium leading-4",
            annotationStyles[annotation].badge,
          )}
        >
          {annotationStyles[annotation].label}
        </span>
      )}
      {/* Clickable edit overlay in preview mode */}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
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
      {children}
    </div>
  );
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
  fieldAnnotations,
  fieldMarks,
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
        // A container, so fields lay out by the form's width, not the screen's
        className={cn("@container", className ?? "space-y-6")}
      >
        {groupLikertRuns(schema.fields).map((block) => {
          const shell = (field: Field, className?: string) => ({
            field,
            onEdit:
              mode === "preview" && onFieldClick
                ? () => onFieldClick(field)
                : undefined,
            annotation: fieldAnnotations?.[field.id],
            mark: fieldMarks?.[field.id],
            className,
          });

          if (!Array.isArray(block)) {
            return (
              <FieldShell key={block.id} {...shell(block)}>
                <FormField
                  control={form.control}
                  name={block.name}
                  render={({ field: formField }) =>
                    renderFieldComponent(block, formField, form.control)
                  }
                />
              </FieldShell>
            );
          }

          // Items on the same scale: one grid, a row per statement
          return (
            <div key={block[0].id} data-testid="likert-grid">
              <LikertGridHeader choices={scaleChoices(block[0].type) ?? []} />
              <div className="flex flex-col gap-1">
                {block.map((field, i) => (
                  <FieldShell
                    key={field.id}
                    {...shell(field, cn("rounded-md", i % 2 === 1 && "@lg:bg-muted/40"))}
                  >
                    <FormField
                      control={form.control}
                      name={field.name}
                      render={({ field: formField }) => (
                        <LikertRow field={field} formField={formField} />
                      )}
                    />
                  </FieldShell>
                ))}
              </div>
            </div>
          );
        })}

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
