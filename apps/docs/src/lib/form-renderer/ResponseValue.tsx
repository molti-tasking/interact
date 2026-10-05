"use client";

import type { Field } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Paperclip } from "lucide-react";
import { formatValue, isStoredFile, type StoredFile } from "./values";

function FileLink({ file }: { file: StoredFile }) {
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
    >
      <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{file.name}</span>
    </a>
  );
}

/**
 * Read-only rendering of a stored response value: uploaded files become
 * links, references show their label, everything else its text.
 */
export function ResponseValue({
  value,
  field,
  className,
  emptyLabel,
}: {
  value: unknown;
  field?: Field;
  className?: string;
  /** Shown for empty values (default: nothing) */
  emptyLabel?: string;
}) {
  if (isStoredFile(value)) return <FileLink file={value} />;
  if (Array.isArray(value) && value.length > 0 && value.every(isStoredFile)) {
    return (
      <span className={cn("flex flex-col gap-0.5", className)}>
        {value.map((f) => (
          <FileLink key={f.path} file={f} />
        ))}
      </span>
    );
  }

  const text = formatValue(value, field);
  if (!text) {
    return emptyLabel ? (
      <span className={cn("text-muted-foreground italic", className)}>
        {emptyLabel}
      </span>
    ) : null;
  }
  return (
    <span className={cn("line-clamp-3 break-words", className)} title={text}>
      {text}
    </span>
  );
}
