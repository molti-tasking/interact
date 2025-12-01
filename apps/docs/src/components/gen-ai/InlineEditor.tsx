"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, Loader2, X } from "lucide-react";
import { useDirectEditContext } from "./DirectEditContext";

interface InlineEditorProps {
  placeholder?: string;
  className?: string;
  maxLength?: number;
}

export function InlineEditor({
  placeholder,
  className,
  maxLength,
}: InlineEditorProps) {
  const {
    isEditing,
    isSaving,
    error,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    commonProps,
    multiline,
    value,
    disabled,
  } = useDirectEditContext();
  // In edit mode
  if (isEditing) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            {multiline ? (
              <Textarea
                {...commonProps}
                maxLength={maxLength}
                rows={3}
                className={cn(
                  commonProps.className,
                  "min-h-[80px] resize-vertical"
                )}
              />
            ) : (
              <Input {...commonProps} />
            )}
          </div>

          {/* Save/Cancel buttons */}
          <div className="flex items-center gap-1 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveEdit}
              disabled={isSaving}
              className="h-8 w-8 p-0"
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelEdit}
              disabled={isSaving}
              className="h-8 w-8 p-0"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Error message */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Help text */}
        {!error && (
          <p className="text-xs text-muted-foreground">
            {multiline
              ? "Ctrl+Enter to save, Escape to cancel"
              : "Enter to save, Escape to cancel"}
          </p>
        )}
      </div>
    );
  }

  // Display mode
  return (
    <div
      className={cn(
        "relative",
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      )}
    >
      <div
        onClick={() => {
          if (!disabled) {
            handleStartEdit();
          }
        }}
        className={cn(
          // "cursor-pointer rounded px-2 py-1 -mx-2 -my-1 transition-all duration-150 group",
          // "hover:bg-primary/5 hover:ring-1 hover:ring-primary/20",
          disabled && "cursor-not-allowed opacity-60",
          className
        )}
      >
        <span className={cn("block w-full")}>
          {value || placeholder || `No value set`}
        </span>
      </div>
    </div>
  );
}

// Validation helpers
export const validators = {
  required: (value: string) =>
    value.trim() ? undefined : "This field is required",
  minLength: (min: number) => (value: string) =>
    value.length >= min ? undefined : `Must be at least ${min} characters`,
  maxLength: (max: number) => (value: string) =>
    value.length <= max ? undefined : `Must be no more than ${max} characters`,
  noHtml: (value: string) =>
    /<[^>]*>/g.test(value) ? "HTML tags are not allowed" : undefined,
  combine:
    (...validators: ((value: string) => string | undefined)[]) =>
    (value: string) => {
      for (const validator of validators) {
        const error = validator(value);
        if (error) return error;
      }
      return undefined;
    },
};
