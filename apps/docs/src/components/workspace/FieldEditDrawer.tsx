"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Field } from "@/lib/types";
import { FieldEditForm } from "./FieldEditForm";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FieldEditDrawerProps {
  field: Field | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (fieldId: string, updates: Partial<Field>) => void;
  onRemove: (fieldId: string) => void;
}

// ---------------------------------------------------------------------------
// Drawer wrapper
// ---------------------------------------------------------------------------

export function FieldEditDrawer({
  field,
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
          <SheetDescription>
            Changes are saved to the form when you click Save, and the intent
            is updated to match.
          </SheetDescription>
        </SheetHeader>

        <FieldEditForm
          key={field.id}
          field={field}
          onSave={onSave}
          onRemove={onRemove}
          onClose={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
