"use client";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { Field } from "@/lib/types";
import { FileIcon, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ControllerRenderProps } from "react-hook-form";
import {
  formatBytes,
  isFile,
  isStoredFile,
  maxSizeBytes,
} from "../values";
import { FieldLabel } from "./FieldLabel";

interface FileFieldProps {
  field: Field;
  formField: ControllerRenderProps;
}

/**
 * Holds a `File` until submit; the submit path uploads it to storage and
 * stores a `StoredFile` reference ({ path, name, size, type, url }).
 */
export function FileField({ field, formField }: FileFieldProps) {
  const fileType = field.type.kind === "file" ? field.type : null;
  const accept = fileType?.accept.length ? fileType.accept.join(",") : undefined;
  const limit = maxSizeBytes(fileType?.maxSize);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { ref, name, onBlur, onChange, disabled } = formField;
  const value: unknown = formField.value;
  const hasValue = isFile(value) || isStoredFile(value);

  // The native input is uncontrolled; clear its selection when the form
  // value is cleared (reset after submit, "Remove").
  useEffect(() => {
    if (!hasValue && inputRef.current) inputRef.current.value = "";
  }, [hasValue]);

  const hint = [
    fileType?.accept.length ? `Accepted: ${fileType.accept.join(", ")}` : null,
    limit !== undefined ? `max ${formatBytes(limit)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <FormItem>
      <FieldLabel field={field} />
      <FormControl>
        <Input
          type="file"
          accept={accept}
          name={name}
          disabled={disabled}
          onBlur={onBlur}
          aria-required={(field.required && !hasValue) || undefined}
          ref={(el) => {
            inputRef.current = el;
            ref(el);
          }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            onChange(file ?? null);
          }}
        />
      </FormControl>
      {hasValue && (
        <div className="flex items-center gap-2 text-sm">
          <FileIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {isStoredFile(value) ? (
            <a
              href={value.url}
              target="_blank"
              rel="noreferrer"
              className="truncate underline underline-offset-2"
            >
              {value.name}
            </a>
          ) : (
            <span className="truncate">{(value as File).name}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatBytes((value as { size: number }).size)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label={`Remove ${(value as { name: string }).name}`}
            onClick={() => onChange(null)}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      )}
      {(field.description || hint) && (
        <FormDescription>
          {field.description}
          {field.description && hint ? " " : null}
          {hint && <span className="text-xs">({hint})</span>}
        </FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}
