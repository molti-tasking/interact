"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FieldGroup } from "@/lib/types";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";

export type SectionEdit =
  | { kind: "update"; label: string; description: string }
  | { kind: "move"; delta: -1 | 1 }
  | { kind: "remove" };

/** Rename, describe, reorder or dissolve a section of the form. */
export function SectionDialog({
  section,
  index,
  count,
  onOpenChange,
  onEdit,
}: {
  section: FieldGroup | null;
  /** Position among the sections, for the move buttons */
  index: number;
  count: number;
  onOpenChange: (open: boolean) => void;
  onEdit: (edit: SectionEdit) => void;
}) {
  return (
    <Dialog open={section !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {section && (
          <SectionForm
            key={section.id}
            section={section}
            index={index}
            count={count}
            onEdit={onEdit}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectionForm({
  section,
  index,
  count,
  onEdit,
  onCancel,
}: {
  section: FieldGroup;
  index: number;
  count: number;
  onEdit: (edit: SectionEdit) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(section.label);
  const [description, setDescription] = useState(section.description ?? "");
  const changed =
    label.trim() !== section.label || description.trim() !== (section.description ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (label.trim() && changed) onEdit({ kind: "update", label, description });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Edit section</DialogTitle>
        <DialogDescription>
          Respondents see the title and intro above the section&apos;s questions.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="section-title">Title</Label>
        <Input id="section-title" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="section-intro">Intro (optional)</Label>
        <Textarea
          id="section-intro"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Please rate how much you agree with each statement."
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={index <= 0}
          onClick={() => onEdit({ kind: "move", delta: -1 })}
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          Move up
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={index >= count - 1}
          onClick={() => onEdit({ kind: "move", delta: 1 })}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          Move down
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={() => onEdit({ kind: "remove" })}
          title="The questions stay in the form, outside any section"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove section
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!label.trim() || !changed}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
