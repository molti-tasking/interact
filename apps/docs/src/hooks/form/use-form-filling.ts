"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import type {
  FillingStatus,
  FillingQueueItem,
  FillingConfig,
  FieldAIState,
} from "@/lib/form-filling-types";
import { DEFAULT_FILLING_CONFIG } from "@/lib/form-filling-types";

export interface UseFormFillingProps<TFieldValues extends Record<string, unknown> = Record<string, unknown>> {
  /** React Hook Form instance */
  form: UseFormReturn<TFieldValues>;
  /** Configuration for filling behavior */
  config?: Partial<FillingConfig>;
  /** Callback when a field starts filling */
  onFieldFillStart?: (item: FillingQueueItem) => void;
  /** Callback when a field finishes filling */
  onFieldFillComplete?: (item: FillingQueueItem) => void;
  /** Callback when filling sequence completes */
  onFillingComplete?: () => void;
}

export interface UseFormFillingReturn {
  // State
  fillingStatus: FillingStatus;
  currentFillingIndex: number;
  highlightedField: string | null;
  filledFields: Set<string>;

  // Actions
  startFilling: (queue: FillingQueueItem[]) => void;
  pauseFilling: () => void;
  resumeFilling: () => void;
  stopFilling: () => void;
  resetFilling: () => void;

  // Field utilities
  getFieldState: (fieldKey: string) => FieldAIState;
  isFieldClickable: (fieldKey: string) => boolean;
}

/**
 * Hook for managing sequential AI-powered form filling
 *
 * Handles the state machine for filling form fields one at a time with
 * animations, delays, and user interaction capabilities.
 *
 * @example
 * ```tsx
 * const filling = useFormFilling({
 *   form,
 *   config: { highlightDuration: 2000, fieldDelay: 600 },
 * });
 *
 * // Start filling
 * filling.startFilling(queue);
 *
 * // Pause/resume
 * filling.pauseFilling();
 * filling.resumeFilling();
 * ```
 */
export function useFormFilling<TFieldValues extends Record<string, unknown> = Record<string, unknown>>({
  form,
  config: userConfig,
  onFieldFillStart,
  onFieldFillComplete,
  onFillingComplete,
}: UseFormFillingProps<TFieldValues>): UseFormFillingReturn {
  // Memoize config to prevent recreating on every render
  const config = useMemo(
    () => ({ ...DEFAULT_FILLING_CONFIG, ...userConfig }),
    [userConfig],
  );

  // State
  const [fillingStatus, setFillingStatus] = useState<FillingStatus>("idle");
  const [fillingQueue, setFillingQueue] = useState<FillingQueueItem[]>([]);
  const [currentFillingIndex, setCurrentFillingIndex] = useState(-1);
  const [highlightedField, setHighlightedField] = useState<string | null>(null);
  const [filledFields, setFilledFields] = useState<Set<string>>(new Set());

  // Refs for timers
  const fillingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sequential filling effect
  useEffect(() => {
    if (fillingStatus !== "filling" || currentFillingIndex < 0) {
      return;
    }

    if (currentFillingIndex >= fillingQueue.length) {
      // Filling complete - schedule state updates for next tick
      setTimeout(() => {
        setFillingStatus("complete");
        setHighlightedField(null);
        toast.success("All fields filled successfully!");
        onFillingComplete?.();
      }, 0);
      return;
    }

    const currentItem = fillingQueue[currentFillingIndex];

    // Scroll to field
    const scrollToField = () => {
      const fieldElement = document.querySelector(
        `[data-field-key="${currentItem.key}"]`,
      );
      if (fieldElement) {
        fieldElement.scrollIntoView({
          behavior: config.scrollBehavior,
          block: config.scrollBlock,
        });
      }
    };

    // Fill the field with animation
    const fillField = () => {
      // Callback: field fill started
      onFieldFillStart?.(currentItem);

      // Set highlight
      setHighlightedField(currentItem.key);

      // Scroll to field
      scrollToField();

      // Set the value in the form
      form.setValue(currentItem.key as any, currentItem.value as any);

      // Add to filled fields
      setFilledFields((prev) => new Set([...prev, currentItem.key]));

      // Schedule highlight removal and move to next field
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedField(null);

        // Callback: field fill complete
        onFieldFillComplete?.(currentItem);

        // Move to next field after delay
        fillingTimerRef.current = setTimeout(() => {
          setCurrentFillingIndex((prev) => prev + 1);
        }, config.fieldDelay);
      }, config.highlightDuration);
    };

    fillField();

    return () => {
      if (fillingTimerRef.current) clearTimeout(fillingTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [
    fillingStatus,
    currentFillingIndex,
    fillingQueue,
    form,
    config,
    onFieldFillStart,
    onFieldFillComplete,
    onFillingComplete,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fillingTimerRef.current) clearTimeout(fillingTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // Actions
  const startFilling = (queue: FillingQueueItem[]) => {
    if (queue.length === 0) {
      toast.info("No fields to fill");
      return;
    }

    setFillingQueue(queue);
    setCurrentFillingIndex(0);
    setFillingStatus("filling");
    setFilledFields(new Set());
    setHighlightedField(null);
  };

  const pauseFilling = () => {
    if (fillingStatus === "filling") {
      setFillingStatus("paused");
      if (fillingTimerRef.current) clearTimeout(fillingTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightedField(null);
    }
  };

  const resumeFilling = () => {
    if (fillingStatus === "paused") {
      setFillingStatus("filling");
    }
  };

  const stopFilling = () => {
    setFillingStatus("idle");
    setCurrentFillingIndex(-1);
    setHighlightedField(null);
    if (fillingTimerRef.current) clearTimeout(fillingTimerRef.current);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  };

  const resetFilling = () => {
    stopFilling();
    setFilledFields(new Set());
    setFillingQueue([]);
  };

  // Field utilities
  const getFieldState = (fieldKey: string): FieldAIState => {
    if (highlightedField === fieldKey) return "filling";
    if (filledFields.has(fieldKey)) return "filled";
    return "empty";
  };

  const isFieldClickable = (fieldKey: string): boolean => {
    return (
      filledFields.has(fieldKey) ||
      highlightedField === fieldKey ||
      fillingStatus === "complete"
    );
  };

  return {
    // State
    fillingStatus,
    currentFillingIndex,
    highlightedField,
    filledFields,

    // Actions
    startFilling,
    pauseFilling,
    resumeFilling,
    stopFilling,
    resetFilling,

    // Utilities
    getFieldState,
    isFieldClickable,
  };
}
