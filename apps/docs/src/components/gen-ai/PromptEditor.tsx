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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { INTERACTION_MODE_MAP } from "@/lib/interaction-mode-config";
import { cn } from "@/lib/utils";
import { INTERACTION_MODE_META } from "interact";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface PromptEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType:
    | "report"
    | "story"
    | "visualization"
    | "visualization-idea"
    | "research-question";
  onPromptSubmit: (prompt: string) => Promise<void>;
}

export function PromptEditor({
  open,
  onOpenChange,
  entityType,
  onPromptSubmit,
}: PromptEditorProps) {
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const entityDisplayName = {
    report: "Report",
    story: "Story",
    visualization: "Visualization",
    "visualization-idea": "Visualization Idea",
    "research-question": "Research Question",
  }[entityType];

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    setIsSubmitting(true);
    try {
      await onPromptSubmit(prompt);
      setPrompt("");
      onOpenChange(false);
      toast.success(`${entityDisplayName} started`);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : `Failed to edit ${entityDisplayName.toLowerCase()}`;
      toast.error("Operation failed", { description: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };
  const { title } = INTERACTION_MODE_META["prompt"];
  const promptMode = INTERACTION_MODE_MAP["prompt"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <div className={cn("h-5 w-5", promptMode.color)}>
              <promptMode.icon />
            </div>
            <span className={cn(promptMode.color)}>{title}</span>
          </DialogTitle>
          <DialogDescription>
            Describe how you&apos;d like to modify this{" "}
            {entityDisplayName.toLowerCase()}. The AI will understand your
            intent and apply the changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prompt Input */}
          <div className="space-y-2">
            <Label htmlFor="prompt">Modification Prompt</Label>
            <Textarea
              id="prompt"
              placeholder={`Example: "Instead go into the direction of subject A", "Recreate the question about problems related to XYZ"...`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="resize-vertical"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleSubmit()}
            disabled={isSubmitting || !prompt.trim()}
            type="submit"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>Submit</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
