"use server";

import type { DetectedStandard } from "@/lib/domain-standards";
import { detectStandards } from "@/lib/standards";

export interface DetectStandardsResponse {
  success: boolean;
  detectedStandards?: DetectedStandard[];
  error?: string;
}

/**
 * Server action that detects which domain standards are relevant to a prompt.
 * Uses keyword matching against the standard registry — no LLM call needed.
 */
export async function detectDomainStandardsAction(
  prompt: string,
): Promise<DetectStandardsResponse> {
  try {
    const detectedStandards = detectStandards(prompt);
    return { success: true, detectedStandards };
  } catch (error) {
    console.error("Standard detection error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
