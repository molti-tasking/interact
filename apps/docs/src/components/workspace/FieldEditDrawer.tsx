"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Field, PortfolioSchema } from "@/lib/types";
import { sectionOf } from "interact/forms/sections";
import { FieldEditForm } from "./FieldEditForm";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FieldEditDrawerProps {
  field: Field | null;
  /** The form, for the field's section */
  schema?: PortfolioSchema;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    fieldId: string,
    updates: Partial<Field>,
    section?: string | null,
  ) => void;
  onRemove: (fieldId: string) => void;
}

// ---------------------------------------------------------------------------
// Drawer wrapper
// ---------------------------------------------------------------------------

export function FieldEditDrawer({
  field,
  schema,
  open,
  onOpenChange,
  onSave,
  onRemove,
}: FieldEditDrawerProps) {
  if (!field) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit field</SheetTitle>
        </SheetHeader>

        <FieldEditForm
          key={field.id}
          field={field}
          sections={schema?.groups.map((g) => g.label)}
          section={schema ? sectionOf(schema, field.id)?.label : undefined}
          onSave={onSave}
          onRemove={onRemove}
          onClose={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
