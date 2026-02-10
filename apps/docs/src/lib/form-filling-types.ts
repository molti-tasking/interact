/**
 * Type definitions for AI-powered form filling
 */

export type FillingStatus = "idle" | "filling" | "paused" | "complete";

export type FieldAIState = "empty" | "filling" | "filled" | "reviewing";

export interface FillingQueueItem {
  key: string;
  value: unknown;
  previousValue?: unknown;
  explanation: string;
  isNewField: boolean;
}

export interface FillingConfig {
  /** Duration to highlight each field (ms). Default: 2000 */
  highlightDuration?: number;
  /** Delay between filling each field (ms). Default: 600 */
  fieldDelay?: number;
  /** Scroll behavior when focusing fields. Default: "smooth" */
  scrollBehavior?: ScrollBehavior;
  /** Block position when scrolling. Default: "center" */
  scrollBlock?: ScrollLogicalPosition;
}

export const DEFAULT_FILLING_CONFIG: Required<FillingConfig> = {
  highlightDuration: 2000,
  fieldDelay: 600,
  scrollBehavior: "smooth",
  scrollBlock: "center",
};
