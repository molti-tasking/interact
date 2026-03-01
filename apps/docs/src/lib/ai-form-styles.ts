import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { FieldAIState } from "./form-filling-types";

/**
 * Utility function to merge class names with Tailwind CSS
 * (Same as the cn() utility used throughout the app)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * CSS class constants for AI field states
 */
export const AI_FIELD_CLASSES = {
  base: "transition-all duration-300",
  filling:
    "ring-2 ring-blue-500 ring-offset-2 shadow-lg shadow-blue-500/50 animate-pulse",
  filled: "ring-1 ring-blue-400/30",
  reviewing: "ring-2 ring-amber-500 ring-offset-2",
  clickable: "cursor-pointer",
} as const;

/**
 * Get computed CSS classes for a form field based on its AI state
 */
export function getFieldAIClasses(
  state: FieldAIState,
  isClickable: boolean = false,
): string {
  return cn(
    AI_FIELD_CLASSES.base,
    state === "filling" && AI_FIELD_CLASSES.filling,
    state === "filled" && AI_FIELD_CLASSES.filled,
    state === "reviewing" && AI_FIELD_CLASSES.reviewing,
    isClickable && AI_FIELD_CLASSES.clickable,
  );
}

/**
 * Alternative: Get field AI classes using individual booleans
 * (For backward compatibility with existing code)
 */
export function getFieldAIClassesByFlags({
  isHighlighted,
  isFilled,
  isReviewing = false,
  isClickable,
}: {
  isHighlighted: boolean;
  isFilled: boolean;
  isReviewing?: boolean;
  isClickable: boolean;
}): string {
  let state: FieldAIState = "empty";

  if (isHighlighted) {
    state = "filling";
  } else if (isReviewing) {
    state = "reviewing";
  } else if (isFilled) {
    state = "filled";
  }

  return getFieldAIClasses(state, isClickable);
}
