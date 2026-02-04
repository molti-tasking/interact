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
import {
  initializeSerializedSchema,
  saveSchema,
  type SchemaMetadata,
} from "@/lib/schema-manager";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface CreateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFormCreated: () => void;
}

export function CreateFormDialog({
  open,
  onOpenChange,
  onFormCreated,
}: CreateFormDialogProps) {
  const router = useRouter();
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = () => {
    if (!formName.trim()) {
      toast.error("Please enter a form name");
      return;
    }

    setIsCreating(true);

    try {
      // Create a minimal schema with a single name field
      const metadata: SchemaMetadata = {
        name: formName,
        description: formDescription || `A dynamic form for ${formName}`,
        fields: {
          name: {
            label: "Name",
            description: "Your name",
            type: "string",
            required: true,
          },
        },
      };

      const newSchema = initializeSerializedSchema(metadata);
      saveSchema(newSchema);

      toast.success("Form created successfully!");
      onFormCreated();
      setFormName("");
      setFormDescription("");
      onOpenChange(false);

      // Navigate to the new form
      router.push(`/malleable-form/${newSchema.slug}`);
    } catch (error) {
      toast.error("Failed to create form");
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Form</DialogTitle>
          <DialogDescription>
            Create a new malleable form. You can add and modify fields after
            creation using AI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Form Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Customer Feedback, Job Application"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              disabled={isCreating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Describe what this form is for..."
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              disabled={isCreating}
              rows={3}
            />
          </div>

          <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
            <strong>Note:</strong> Your form will start with a single
            &quot;Name&quot; field. You can add more fields and customize the
            structure using the AI-powered form builder.
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? "Creating..." : "Create Form"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
