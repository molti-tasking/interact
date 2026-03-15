"use client";

import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { forwardRef, useCallback } from "react";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const MarkdownEditor = forwardRef<HTMLDivElement, MarkdownEditorProps>(
  ({ value, onChange, placeholder, className, disabled }, ref) => {
    const handleChange = useCallback(
      (val?: string) => {
        onChange(val ?? "");
      },
      [onChange],
    );

    return (
      <div
        ref={ref}
        data-color-mode="light"
        className={cn("relative", className)}
      >
        <MDEditor
          value={value}
          onChange={handleChange}
          preview="edit"
          hideToolbar={false}
          height="auto"
          minHeight={120}
          style={{
            borderRadius: "1rem",
            border: "none",
            boxShadow: "none",
            background: "transparent",
          }}
          textareaProps={{
            disabled,
            placeholder,
          }}
        />
      </div>
    );
  },
);

MarkdownEditor.displayName = "MarkdownEditor";
