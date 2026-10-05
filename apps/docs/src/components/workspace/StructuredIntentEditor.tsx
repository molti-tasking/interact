"use client";

import type { SectionKey, StructuredIntent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { useId, useState } from "react";

const SECTIONS: {
  key: SectionKey;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    key: "purpose",
    label: "Purpose",
    hint: "What is this form for?",
    placeholder:
      "Describe what this form is for and what you need to collect — a sentence is enough to start.",
  },
  {
    key: "audience",
    label: "Audience",
    hint: "Who fills it out?",
    placeholder: "e.g. Parents registering children aged 6–16",
  },
  {
    key: "exclusions",
    label: "Exclusions",
    hint: "What should it not ask?",
    placeholder: "e.g. No social security numbers, no payment details",
  },
  {
    key: "constraints",
    label: "Constraints",
    hint: "Rules, compliance, limits",
    placeholder: "e.g. Must follow GDPR; date of birth is mandatory",
  },
];

/**
 * Editor for the structured intent: one labelled text area per section
 * instead of a markdown document with `##` headings. Purpose is always
 * visible; the optional sections are revealed on demand (or when they
 * already have content) to keep the starting point a single sentence.
 */
export function StructuredIntentEditor({
  value,
  onChange,
  disabled,
  className,
}: {
  value: StructuredIntent;
  onChange: (next: StructuredIntent) => void;
  disabled?: boolean;
  className?: string;
}) {
  const baseId = useId();
  const [revealed, setRevealed] = useState<Set<SectionKey>>(new Set());

  const isVisible = (key: SectionKey) =>
    key === "purpose" || revealed.has(key) || !!value[key]?.content.trim();

  const hidden = SECTIONS.filter((s) => !isVisible(s.key));

  const update = (key: SectionKey, content: string) =>
    onChange({
      ...value,
      [key]: { content, updatedAt: new Date().toISOString() },
    });

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-sm divide-y divide-border/60 transition-shadow focus-within:shadow-md focus-within:border-ring/30",
        disabled && "opacity-70",
        className,
      )}
    >
      {SECTIONS.filter((s) => isVisible(s.key)).map((section) => {
        const id = `${baseId}-${section.key}`;
        return (
          <div key={section.key} className="px-4 py-3">
            <label
              htmlFor={id}
              className="flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground"
            >
              <span className="uppercase tracking-wide">{section.label}</span>
              <span className="font-normal text-muted-foreground/70">
                {section.hint}
              </span>
            </label>
            <textarea
              id={id}
              data-section={section.key}
              value={value[section.key]?.content ?? ""}
              onChange={(e) => update(section.key, e.target.value)}
              placeholder={section.placeholder}
              disabled={disabled}
              rows={section.key === "purpose" ? 4 : 2}
              className="mt-1 block w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50 field-sizing-content disabled:cursor-not-allowed"
            />
          </div>
        );
      })}

      {hidden.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <span className="text-xs text-muted-foreground/70">Add</span>
          {hidden.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={disabled}
              onClick={() => {
                setRevealed((prev) => new Set(prev).add(s.key));
                requestAnimationFrame(() =>
                  document.getElementById(`${baseId}-${s.key}`)?.focus(),
                );
              }}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Plus className="h-3 w-3" aria-hidden />
              {s.label.toLowerCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
