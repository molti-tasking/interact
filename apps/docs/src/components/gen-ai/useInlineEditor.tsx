"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type UseInlineEditorProps = {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxLength?: number;
  validateValue?: (value: string) => string | undefined; // Returns error message if invalid
};

export type InlineEditorReturnType = ReturnType<typeof useInlineEditor>;

export const useInlineEditor = ({
  value,
  onSave,
  multiline = false,
  placeholder,
  className,
  disabled = false,
  maxLength,
  validateValue,
}: UseInlineEditorProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Reset edit value when prop value changes
  useEffect(() => {
    setEditValue(value);
  }, [value]);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      // Select all text for easy replacement
      if ("select" in inputRef.current) {
        inputRef.current.select();
      }
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    if (disabled) return;
    setIsEditing(true);
    setError(undefined);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue(value); // Reset to original value
    setError(undefined);
  };

  const handleSaveEdit = async () => {
    if (editValue === value) {
      // No changes, just exit edit mode
      setIsEditing(false);
      return;
    }

    // Validate if validator provided
    if (validateValue) {
      const validationError = validateValue(editValue);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setIsSaving(true);
    try {
      await onSave(editValue);
      setIsEditing(false);
      setError(undefined);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save";
      setError(errorMessage);
      toast.error("Save failed", { description: errorMessage });
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancelEdit();
    } else if (e.key === "Enter" && !multiline && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Enter" && multiline && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveEdit();
    }
  };

  const commonProps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ref: inputRef as any,
    value: editValue,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      setEditValue(e.target.value);
      setError(undefined);
    },
    onKeyDown: handleKeyDown,
    className: cn(
      "border-primary/50 focus:border-primary",
      error && "border-destructive focus:border-destructive",
      className
    ),
    placeholder,
    maxLength,
    disabled: isSaving,
  };

  return {
    value,
    isEditing,
    isSaving,
    error,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    setIsEditing, // Expose setter to programmatically control edit mode
    multiline,
    placeholder,
    className,
    disabled,
    maxLength,
    commonProps,
  };
};
