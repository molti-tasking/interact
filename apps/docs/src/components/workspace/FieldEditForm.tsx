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
import { useState } from "react";
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

/** Kinds the drawer can display but not convert to/from (structure would be lost). */
const LOCKED_KINDS: Record<string, string> = {
  reference: "Reference (link to another table)",
  group: "Group",
};

const optionalNumber = z
  .string()
  .refine((v) => v.trim() === "" || Number.isFinite(Number(v)), "Enter a number");

const fieldEditSchema = z
  .object({
    label: z.string().trim().min(1, "Label is required"),
    kind: z.string(),
    required: z.boolean(),
    description: z.string(),
    tooltip: z.string(),
    options: z.string(),
    multiple: z.boolean(),
    min: optionalNumber,
    max: optionalNumber,
    unit: z.string(),
    lowLabel: z.string(),
    highLabel: z.string(),
  })
  .refine(
    (data) =>
      data.kind !== "select" ||
      data.options.split("\n").some((o) => o.trim().length > 0),
    { message: "Provide at least one option", path: ["options"] },
  )
  .refine(
    (data) =>
      data.min.trim() === "" ||
      data.max.trim() === "" ||
      Number(data.min) <= Number(data.max),
    { message: "Minimum must not exceed maximum", path: ["max"] },
  );

type FieldEditFormValues = z.infer<typeof fieldEditSchema>;

/** Form fields that only affect the field's `type`. */
const TYPE_KEYS = [
  "kind",
  "options",
  "multiple",
  "min",
  "max",
  "unit",
  "lowLabel",
  "highLabel",
] as const;

function valuesFromField(field: Field): FieldEditFormValues {
  const t = field.type;
  return {
    label: field.label,
    kind: t.kind,
    required: field.required,
    description: field.description ?? "",
    tooltip: field.tooltip ?? "",
    options: t.kind === "select" ? t.options.map((o) => o.label).join("\n") : "",
    multiple: t.kind === "select" ? t.multiple : false,
    min:
      t.kind === "number" || t.kind === "scale" ? String(t.min ?? "") : "",
    max:
      t.kind === "number" || t.kind === "scale" ? String(t.max ?? "") : "",
    unit: t.kind === "number" ? (t.unit ?? "") : "",
    lowLabel: t.kind === "scale" ? (t.labels?.low ?? "") : "",
    highLabel: t.kind === "scale" ? (t.labels?.high ?? "") : "",
  };
}

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
  /** Receives only the properties the user actually changed. */
  onSave: (fieldId: string, updates: Partial<Field>) => void;
  onRemove: (fieldId: string) => void;
  onClose: () => void;
}) {
  const form = useForm<FieldEditFormValues>({
    resolver: zodResolver(fieldEditSchema),
    defaultValues: valuesFromField(field),
  });
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const watchKind = useWatch({ control: form.control, name: "kind" });
  const lockedKind = LOCKED_KINDS[field.type.kind];

  const handleSubmit = (values: FieldEditFormValues) => {
    const dirty = form.formState.dirtyFields;
    const updates: Partial<Field> = {};
    if (dirty.label) updates.label = values.label.trim();
    if (dirty.required) updates.required = values.required;
    if (dirty.description) updates.description = values.description || undefined;
    if (dirty.tooltip) updates.tooltip = values.tooltip || undefined;
    if (!lockedKind && TYPE_KEYS.some((k) => dirty[k])) {
      updates.type = buildFieldType(values, field.type);
    }
    if (Object.keys(updates).length > 0) onSave(field.id, updates);
    onClose();
  };

  const handleRemove = () => {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    onRemove(field.id);
    onClose();
  };

  const kindInputs = (
    <>
      {watchKind === "select" && (
        <>
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
          <CheckboxField form={form} name="multiple" label="Allow multiple answers" />
        </>
      )}

      {(watchKind === "number" || watchKind === "scale") && (
        <div className="grid grid-cols-2 gap-3">
          <NumberInput form={form} name="min" label="Minimum" />
          <NumberInput form={form} name="max" label="Maximum" />
        </div>
      )}

      {watchKind === "number" && (
        <FormField
          control={form.control}
          name="unit"
          render={({ field: f }) => (
            <FormItem>
              <FormLabel>Unit</FormLabel>
              <FormControl>
                <Input {...f} placeholder="e.g. kg, %, USD" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {watchKind === "scale" && (
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="lowLabel"
            render={({ field: f }) => (
              <FormItem>
                <FormLabel>Low end label</FormLabel>
                <FormControl>
                  <Input {...f} placeholder="e.g. Not at all" />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="highLabel"
            render={({ field: f }) => (
              <FormItem>
                <FormLabel>High end label</FormLabel>
                <FormControl>
                  <Input {...f} placeholder="e.g. Extremely" />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      )}
    </>
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex flex-col h-full min-h-0"
      >
        <div className="space-y-4 p-4 flex-1 overflow-y-auto">
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

          {lockedKind ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">Type</p>
              <p className="text-sm text-muted-foreground">{lockedKind}</p>
            </div>
          ) : (
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
                  {f.value !== field.type.kind && (
                    <FormDescription>
                      Existing answers for this field may no longer fit the
                      new type.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {!lockedKind && kindInputs}

          <FormField
            control={form.control}
            name="description"
            render={({ field: f }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Input {...f} placeholder="Help text shown below the field" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tooltip"
            render={({ field: f }) => (
              <FormItem>
                <FormLabel>Tooltip</FormLabel>
                <FormControl>
                  <Input {...f} placeholder="Extra guidance shown on hover" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <CheckboxField form={form} name="required" label="Required" />
        </div>

        <SheetFooter className="flex-row items-center justify-between gap-2 border-t">
          <Button
            type="button"
            variant="destructiveSoft"
            size="sm"
            onClick={handleRemove}
            onBlur={() => setConfirmingRemove(false)}
          >
            <Trash2 className="h-4 w-4 mr-1" aria-hidden />
            {confirmingRemove ? "Click again to remove" : "Remove field"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!form.formState.isDirty}>
              Save
            </Button>
          </div>
        </SheetFooter>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Small inputs
// ---------------------------------------------------------------------------

type FormApi = ReturnType<typeof useForm<FieldEditFormValues>>;

function CheckboxField({
  form,
  name,
  label,
}: {
  form: FormApi;
  name: "required" | "multiple";
  label: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
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
            <FormLabel className="font-normal">{label}</FormLabel>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function NumberInput({
  form,
  name,
  label,
}: {
  form: FormApi;
  name: "min" | "max";
  label: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...f} inputMode="decimal" placeholder="—" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Helper: build FieldType from form values, preserving what the form can't
// express (option values, text maxLength, date range, file accept/maxSize)
// ---------------------------------------------------------------------------

function toNumber(v: string): number | undefined {
  return v.trim() === "" ? undefined : Number(v);
}

export function buildFieldType(
  values: Pick<FieldEditFormValues, (typeof TYPE_KEYS)[number]>,
  existing: FieldType,
): FieldType {
  switch (values.kind) {
    case "select": {
      // Keep stored values for options whose label survived so existing
      // responses still match.
      const valueByLabel = new Map(
        existing.kind === "select"
          ? existing.options.map((o) => [o.label.trim().toLowerCase(), o.value])
          : [],
      );
      const options = values.options
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean)
        .map((label) => ({
          label,
          value:
            valueByLabel.get(label.toLowerCase()) ??
            label.toLowerCase().replace(/\s+/g, "_"),
        }));
      return { kind: "select", options, multiple: values.multiple };
    }
    case "number":
      return {
        kind: "number",
        min: toNumber(values.min),
        max: toNumber(values.max),
        unit: values.unit.trim() || undefined,
      };
    case "scale": {
      const low = values.lowLabel.trim();
      const high = values.highLabel.trim();
      return {
        kind: "scale",
        min: toNumber(values.min) ?? 1,
        max: toNumber(values.max) ?? 5,
        labels: low || high ? { low, high } : undefined,
      };
    }
    case "date":
      return existing.kind === "date" ? existing : { kind: "date" };
    case "boolean":
      return { kind: "boolean" };
    case "file":
      return existing.kind === "file" ? existing : { kind: "file", accept: [] };
    default:
      return existing.kind === "text" ? existing : { kind: "text" };
  }
}
