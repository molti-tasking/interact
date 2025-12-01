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
import { INTERACTION_MODE_MAP } from "@/lib/interaction-mode-config";
import { cn } from "@/lib/utils";
import { INTERACTION_MODE_META } from "interact";
import { AlertCircle, Sparkles } from "lucide-react";
import { useState } from "react";

interface ContextEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType?: "report" | "story" | "visualization";
  onConfirm: () => Promise<void>;
}

export function ContextEditDialog({
  open,
  onOpenChange,
  entityType = "visualization",
  onConfirm,
}: ContextEditDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  // Format the entity type for display
  const entityTypeDisplay =
    entityType.charAt(0).toUpperCase() + entityType.slice(1);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to process context update:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const contextMode = INTERACTION_MODE_MAP["context"];
  const { title } = INTERACTION_MODE_META["context"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <div className={cn("h-5 w-5", contextMode.color)}>
              <contextMode.icon />
            </div>
            <span className={cn(contextMode.color)}>{title}</span>
          </DialogTitle>
          <DialogDescription className="pt-3 space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            </div>

            <div className="bg-muted/50 rounded-lg p-3 mt-4">
              <p className="text-sm">
                <span className="font-medium">What will happen:</span>
              </p>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1 ml-4">
                <li className="list-disc">
                  The AI will analyze all previous edits and modifications
                </li>
                <li className="list-disc">
                  It will update the entire {entityType} to maintain consistency
                </li>
                <li className="list-disc">
                  Your previous changes will guide the regeneration
                </li>
              </ul>
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isProcessing}
            className={cn("gap-2")}
          >
            {isProcessing ? (
              <>Processing...</>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Update {entityTypeDisplay}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
