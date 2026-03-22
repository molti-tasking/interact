"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SheetFooter } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Field, FieldType } from "@/lib/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const FIELD_KINDS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes/No" },
  { value: "scale", label: "Scale" },
  { value: "file", label: "File Upload" },
] as const;

const fieldKindValues = FIELD_KINDS.map((k) => k.value);

const fieldEditSchema = z
  .object({
    label: z.string().min(1, "Label is required"),
    kind: z.enum(fieldKindValues as unknown as [string, ...string[]]),
    required: z.boolean(),
    description: z.string(),
    options: z.string(),
  })
  .refine(
    (data) => {
      if (data.kind !== "select") return true;
      const opts = data.options
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean);
      return opts.length >= 1;
    },
    {
      message: "Provide at least one option",
      path: ["options"],
    },
  );

type FieldEditFormValues = z.infer<typeof fieldEditSchema>;

// ---------------------------------------------------------------------------
// Sub-component: the form itself
// ---------------------------------------------------------------------------

export function FieldEditForm({
  field,
  onSave,
  onRemove,
  onClose,
}: {
  field: Field;
  onSave: (fieldId: string, updates: Partial<Field>) => void;
  onRemove: (fieldId: string) => void;
  onClose: () => void;
}) {
  const form = useForm<FieldEditFormValues>({
    resolver: zodResolver(fieldEditSchema),
    defaultValues: {
      label: field.label,
      kind: field.type.kind,
      required: field.required,
      description: field.description ?? "",
      options:
        field.type.kind === "select"
          ? field.type.options.map((o) => o.label).join("\n")
          : "",
    },
  });

  // Reset form values when the field prop changes
  useEffect(() => {
    form.reset({
      label: field.label,
      kind: field.type.kind,
      required: field.required,
      description: field.description ?? "",
      options:
        field.type.kind === "select"
          ? field.type.options.map((o) => o.label).join("\n")
          : "",
    });
  }, [field, form]);

  const watchKind = useWatch({ control: form.control, name: "kind" });

  const handleSubmit = (values: FieldEditFormValues) => {
    const newType = buildFieldType(values.kind, values.options);
    onSave(field.id, {
      label: values.label,
      type: newType,
      required: values.required,
      description: values.description || undefined,
    });
    onClose();
  };

  const handleRemove = () => {
    onRemove(field.id);
    onClose();
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex flex-col h-full"
      >
        <div className="space-y-4 p-4 flex-1">
          <FormField
            control={form.control}
            name="label"
            render={({ field: f }) => (
              <FormItem>
                <FormLabel>Label</FormLabel>
                <FormControl>
                  <Input {...f} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="kind"
            render={({ field: f }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select value={f.value} onValueChange={f.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {FIELD_KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {watchKind === "select" && (
            <FormField
              control={form.control}
              name="options"
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Options (one per line)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...f}
                      rows={4}
                      placeholder={"Option A\nOption B\nOption C"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="description"
            render={({ field: f }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Input {...f} placeholder="Help text shown below the field" />
                </FormControl>
                <FormDescription />
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="required"
            render={({ field: f }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <input
                      type="checkbox"
                      checked={f.value}
                      onChange={f.onChange}
                      onBlur={f.onBlur}
                      name={f.name}
                      ref={f.ref}
                      className="h-4 w-4"
                    />
                  </FormControl>
                  <Label htmlFor={f.name}>Required</Label>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <SheetFooter className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleRemove}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Remove
          </Button>
          <Button type="submit">Save</Button>
        </SheetFooter>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Helper: build FieldType from form values
// ---------------------------------------------------------------------------

function buildFieldType(kind: string, optionsText: string): FieldType {
  switch (kind) {
    case "select": {
      const opts = optionsText
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => ({
          label: o,
          value: o.toLowerCase().replace(/\s+/g, "_"),
        }));
      return { kind: "select", options: opts, multiple: false };
    }
    case "number":
      return { kind: "number" };
    case "date":
      return { kind: "date" };
    case "boolean":
      return { kind: "boolean" };
    case "scale":
      return { kind: "scale", min: 1, max: 10 };
    case "file":
      return { kind: "file", accept: [] };
    default:
      return { kind: "text" };
  }
}
