"use server";

import { withTracing } from "@/lib/telemetry";
import type { PortfolioSchema } from "@/lib/types";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export interface SyncIntentResponse {
  success: boolean;
  updatedIntent?: string;
  error?: string;
}

/**
 * Synchronize intent description after a direct schema edit.
 * Updates the intent to reflect field modifications or removals.
 */
export async function syncIntentAfterSchemaEdit(
  currentIntent: string,
  editDescription: string,
  currentSchema: PortfolioSchema,
): Promise<SyncIntentResponse> {
  try {
    const fieldsList = currentSchema.fields
      .map(
        (f) =>
          `- ${f.label} (${f.name}): ${f.type.kind}${f.required ? " [required]" : ""}`,
      )
      .join("\n");

    const prompt = `You are updating a natural language intent description to reflect a direct edit made to a form schema. Keep the intent description accurate and consistent with the schema. Only modify the parts relevant to the edit. Preserve the existing writing style and level of detail.

Current intent description:
${currentIntent}

Schema edit made by user:
${editDescription}

Current form fields after the edit:
${fieldsList}

Return ONLY the updated intent description as plain text. Do NOT wrap it in JSON or markdown. The intent uses markdown formatting — preserve and use markdown (headings, lists, bold, etc.) in the updated version.

Rules:
- Preserve the overall structure and tone of the original intent
- Update only the parts affected by the edit
- Be concise — don't add unnecessary detail
- Keep markdown formatting consistent with the original
- If a field was removed, remove its mention from the intent
- If a field was modified, update its description to match the new configuration`;

    const result = await withTracing({ tags: ["intent", "sync"] }, () =>
      generateText({
        model: anthropic("claude-haiku-4-5-20251001"),
        prompt,
        temperature: 0.2,
        experimental_telemetry: { isEnabled: true },
      }),
    );

    const updatedIntent = result.text.trim();

    if (!updatedIntent) {
      return {
        success: false,
        error: "LLM returned empty intent",
      };
    }

    return {
      success: true,
      updatedIntent,
    };
  } catch (error) {
    console.error("Intent sync error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
