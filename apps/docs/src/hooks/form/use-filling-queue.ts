"use client";

import type { SerializedSchema } from "@/lib/schema-manager";
import type { FillingQueueItem } from "@/lib/form-filling-types";
import type { UseFormReturn } from "react-hook-form";

export interface UseFillingQueueProps<TFieldValues extends Record<string, unknown> = Record<string, unknown>> {
  schema: SerializedSchema;
  form: UseFormReturn<TFieldValues>;
}

export interface UseFillingQueueReturn {
  /**
   * Build a queue of fields to fill from parsed AI data
   */
  buildQueue: (
    parsedData: Record<string, unknown>,
    extraFields: Array<{ key: string; value: unknown }>,
    explanations: Record<string, string>,
  ) => FillingQueueItem[];
}

/**
 * Hook for managing the form filling queue
 * Provides utilities to build and validate queue items from AI-parsed data
 */
export function useFillingQueue<TFieldValues extends Record<string, unknown> = Record<string, unknown>>({
  schema,
  form,
}: UseFillingQueueProps<TFieldValues>): UseFillingQueueReturn {
  const buildQueue = (
    parsedData: Record<string, unknown>,
    extraFields: Array<{ key: string; value: unknown }>,
    explanations: Record<string, string>,
  ): FillingQueueItem[] => {
    const queue: FillingQueueItem[] = [];

    // Add matched fields from existing schema
    Object.entries(parsedData).forEach(([key, value]) => {
      const fieldExists = schema.fields.some((f) => f.key === key);
      if (fieldExists) {
        const previousValue = form.getValues(key as any);
        queue.push({
          key,
          value,
          previousValue,
          explanation: explanations[key] || "Value extracted from provided data",
          isNewField: false,
        });
      }
    });

    // Add extra fields (new fields not in current schema)
    extraFields.forEach((field) => {
      queue.push({
        key: field.key,
        value: field.value,
        previousValue: undefined,
        explanation:
          explanations[field.key] ||
          "New field detected from your data and added to schema",
        isNewField: true,
      });
    });

    return queue;
  };

  return {
    buildQueue,
  };
}
