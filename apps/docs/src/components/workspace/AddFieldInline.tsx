"use client";

import { addFieldFromPromptAction } from "@/app/actions/add-field-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Field, PortfolioSchema } from "@/lib/types";
import { Loader2, Plus, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface AddFieldInlineProps {
  schema: PortfolioSchema;
  onFieldsAdded: (fields: Field[]) => void;
}

export function AddFieldInline({ schema, onFieldsAdded }: AddFieldInlineProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    setOpen(true);
    setError(null);
    // Focus after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setPrompt("");
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const result = await addFieldFromPromptAction(trimmed, schema);
      if (result.success && result.newFields?.length) {
        onFieldsAdded(result.newFields);
        setPrompt("");
        setOpen(false);
      } else {
        setError(result.error ?? "No fields generated");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add field");
    } finally {
      setLoading(false);
    }
  }, [prompt, schema, onFieldsAdded]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 py-2 text-xs text-muted-foreground/60 hover:border-primary/30 hover:text-primary/60 hover:bg-primary/5 transition-all"
      >
        <Plus className="h-3.5 w-3.5" />
        Add field
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) handleSubmit();
            if (e.key === "Escape") handleClose();
          }}
          placeholder='e.g. "Add a phone number field" or "Rating from 1-10"'
          disabled={loading}
          className="text-sm h-8"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={loading || !prompt.trim()}
          className="h-8 px-3"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleClose}
          disabled={loading}
          className="h-8 px-2"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
