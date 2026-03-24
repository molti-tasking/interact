"use client";

import { useEffect, useRef, useState } from "react";

interface InlineEditableTitleProps {
  value: string;
  onSave: (title: string) => void;
}

export function InlineEditableTitle({
  value,
  onSave,
}: InlineEditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="text-xl font-bold tracking-tight bg-transparent border-b border-dashed border-muted-foreground/40 outline-none px-0 py-0"
        autoFocus
      />
    );
  }

  return (
    <h1
      className="text-xl font-bold tracking-tight cursor-pointer hover:text-muted-foreground transition-colors"
      onClick={() => setEditing(true)}
      title="Click to edit title"
    >
      {value}
    </h1>
  );
}
