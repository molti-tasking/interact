"use client";

import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface InlineEditableTitleProps {
  value: string;
  onSave: (title: string) => void;
  className?: string;
}

/** Page title that turns into an input on click / Enter. */
export function InlineEditableTitle({
  value,
  onSave,
  className,
}: InlineEditableTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const trimmed = draft?.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setDraft(null);
  };

  const textClass = cn("text-2xl tracking-tight text-primary", className);

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="Portfolio title"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        className={cn(
          textClass,
          "w-full max-w-2xl bg-transparent border-b border-dashed border-muted-foreground/40 outline-none px-0 py-0 font-display",
        )}
        autoFocus
      />
    );
  }

  return (
    <h1 className={cn(textClass, "min-w-0")}>
      <button
        type="button"
        onClick={() => setDraft(value)}
        title="Rename"
        className="group inline-flex max-w-full items-center gap-2 rounded-md text-left transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{value}</span>
        <Pencil
          className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
        <span className="sr-only">(rename)</span>
      </button>
    </h1>
  );
}
