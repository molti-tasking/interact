"use client";

import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { InfoIcon } from "lucide-react";

interface FieldValueReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldKey: string;
  fieldLabel: string;
  previousValue: unknown;
  newValue: unknown;
  aiExplanation: string;
  onAccept: (editedValue: unknown, userNotes?: string) => void;
  onDecline: () => void;
}

export function FieldValueReviewDialog({
  open,
  onOpenChange,
  fieldKey,
  fieldLabel,
  previousValue,
  newValue,
  aiExplanation,
  onAccept,
  onDecline,
}: FieldValueReviewDialogProps) {
  const [editedValue, setEditedValue] = useState<string>(
    String(newValue ?? ""),
  );
  const [userNotes, setUserNotes] = useState("");

  const handleAccept = () => {
    onAccept(editedValue, userNotes);
    setEditedValue("");
    setUserNotes("");
  };

  const handleDecline = () => {
    onDecline();
    setEditedValue("");
    setUserNotes("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setEditedValue("");
      setUserNotes("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Review Field Value
            <Badge variant="secondary">{fieldKey}</Badge>
          </DialogTitle>
          <DialogDescription>
            The AI has suggested a value for &quot;{fieldLabel}&quot;. You can review,
            edit, and accept or decline this suggestion.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* AI Explanation */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-4 border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-2">
              <InfoIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  AI Reasoning
                </p>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {aiExplanation}
                </p>
              </div>
            </div>
          </div>

          {/* Previous Value */}
          {previousValue !== undefined && previousValue !== null && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Previous Value</Label>
              <div className="rounded-md bg-muted p-3 font-mono text-sm">
                {String(previousValue)}
              </div>
            </div>
          )}

          {/* New/Edited Value */}
          <div className="space-y-2">
            <Label htmlFor="edited-value">
              New Value{" "}
              <span className="text-muted-foreground font-normal">
                (editable)
              </span>
            </Label>
            <Textarea
              id="edited-value"
              value={editedValue}
              onChange={(e) => setEditedValue(e.target.value)}
              rows={3}
              className="font-mono text-sm"
              placeholder="Edit the value if needed..."
            />
          </div>

          {/* User Notes */}
          <div className="space-y-2">
            <Label htmlFor="user-notes">
              Notes{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="user-notes"
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="Add notes or context about this change..."
              className="text-sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleDecline}>
            Decline & Skip
          </Button>
          <Button variant="default" onClick={handleAccept}>
            Accept Value
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
