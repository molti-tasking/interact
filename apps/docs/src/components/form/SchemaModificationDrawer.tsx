"use client";

import { regenerateSchemaAction } from "@/app/actions/schema-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { SerializedSchema } from "@/lib/schema-manager";
import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface SchemaModificationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSchema: SerializedSchema;
  fieldContext: string; // field key or "new"
  onSchemaGenerated: (newSchema: SerializedSchema) => void;
}

export function SchemaModificationDrawer({
  open,
  onOpenChange,
  currentSchema,
  fieldContext,
  onSchemaGenerated,
}: SchemaModificationDrawerProps) {
  const [prompt, setPrompt] = useState("");
  const [isPending, startTransition] = useTransition();

  const field = currentSchema.fields.find((f) => f.key === fieldContext);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("Please enter a modification request");
      return;
    }

    startTransition(async () => {
      const result = await regenerateSchemaAction({
        currentSchema,
        fieldContext,
        userPrompt: prompt,
      });
      console.log(result);
      if (result.success && result.newSchema) {
        toast.success("Schema updated successfully");
        onSchemaGenerated(result.newSchema);
        setPrompt("");
        onOpenChange(false);
      } else {
        toast.error(result.error || "Failed to generate schema");
      }
    });
  };

  const getSuggestions = () => {
    if (fieldContext === "new") {
      return [
        "Add a dietary restrictions field as a multi-select",
        "Add a phone number field",
        "Add an accessibility needs text field",
        "Add a T-shirt size select field",
      ];
    }

    if (!field) return [];

    const suggestions: string[] = [];

    if (field.type === "string") {
      suggestions.push("Change this to a number field");
      suggestions.push("Make this field optional");
    }

    if (field.type === "select") {
      suggestions.push("Add a new option to the select");
    }

    if (field.required) {
      suggestions.push("Make this field optional");
    } else {
      suggestions.push("Make this field required");
    }

    return suggestions;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {fieldContext === "new"
              ? "Add New Field"
              : `Modify: ${field?.label}`}
          </SheetTitle>
          <SheetDescription>
            {fieldContext === "new"
              ? "Describe the new field you want to add to the form"
              : "Describe how you want to modify this field"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4">
          {field && (
            <div className="space-y-2 rounded-lg border p-3 bg-muted/50">
              <div className="text-sm font-medium">Current Field</div>
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Type:</span>{" "}
                  {field.type}
                </div>
                <div>
                  <span className="text-muted-foreground">Required:</span>{" "}
                  {field.required ? "Yes" : "No"}
                </div>
                {field.validation?.options && (
                  <div>
                    <span className="text-muted-foreground">Options:</span>{" "}
                    {field.validation.options.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="prompt">Your Request</Label>
            <Textarea
              id="prompt"
              placeholder={
                fieldContext === "new"
                  ? "E.g., Add a field for dietary restrictions with options for vegetarian, vegan, gluten-free, and none"
                  : "E.g., Add an option for 'pescatarian' to the select"
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              disabled={isPending}
            />
          </div>

          {getSuggestions().length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Quick suggestions:
              </Label>
              <div className="flex flex-wrap gap-2">
                {getSuggestions().map((suggestion, i) => (
                  <Button
                    key={i}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPrompt(suggestion)}
                    disabled={isPending}
                    className="text-xs"
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleGenerate} disabled={isPending}>
            {isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            Generate Schema
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
