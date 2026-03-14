"use server";

import type { DimensionObject } from "@/lib/dimension-types";
import type { SchemaMetadata, SerializedSchema } from "@/lib/schema-manager";
import { initializeSerializedSchema } from "@/lib/schema-manager";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { createStreamableValue } from "ai/rsc";

/**
 * Streams opinion surfaces as A2UI JSONL messages.
 *
 * The LLM is instructed to design each opinion as a unique, visually rich
 * A2UI surface — choosing from the full component catalog (ChoicePicker,
 * Tabs, Sliders, Icons, Dividers, etc.) based on what fits the question.
 * This produces UIs that look meaningfully different from each other and
 * from the classic card+button layout.
 */
export async function streamOpinionSurfacesAction(
  basePrompt: string,
  maxOpinions: number = 5,
  dimensions?: DimensionObject[],
) {
  const stream = createStreamableValue<string>("");

  const acceptedDims = dimensions?.filter(
    (d) => (d.status === "accepted" || d.status === "edited") && d.isActive,
  );

  const dimensionContext =
    acceptedDims && acceptedDims.length > 0
      ? `\n\nConfirmed domain dimensions:\n${acceptedDims.map((d) => `- "${d.name}" [${d.scope}]: ${d.description}. Why it matters: ${d.importance}`).join("\n")}\n\nScope each question to a specific dimension — make concrete field-level decisions. Include "dimensionName" in the resolve action context matching a dimension name above.`
      : "";

  const prompt = `You are an AI agent that designs interactive opinion cards using the A2UI protocol. Your goal is to create VISUALLY DISTINCT, rich UIs — not generic card+button layouts.

User's form description: ${basePrompt}${dimensionContext}

Generate ${Math.min(maxOpinions, 3)}-${maxOpinions} opinion questions about form design choices. Each opinion MUST use a DIFFERENT layout pattern from the catalog below.

## Available A2UI Components

Display: Text (variants: h1, h2, h3, h4, h5, caption, body), Icon (lucide names: "settings", "zap", "shield", "palette", "layout", "database", "users", "globe", "lock", "sparkles"), Divider
Layout: Card (wraps a single child), Column (vertical stack), Row (horizontal), List, Tabs (tabbed views)
Interactive: Button, ChoicePicker (variant: "mutuallyExclusive" or "multipleSelection"), Slider (min/max/value), CheckBox, TextField

## Layout Patterns — use a DIFFERENT one for each opinion:

**Pattern A – ChoicePicker card**: Best for 3-5 short options (e.g. detail level, field count). Use a ChoicePicker with mutuallyExclusive variant. Bind value to data model. Use a Button to confirm.

**Pattern B – Tabbed exploration**: Best for 2-3 options that need description. Each Tab shows a Column with descriptive Text. Use action button inside each tab.

**Pattern C – Slider scale**: Best for numeric/scale questions (e.g. "how many fields?", "how strict?"). Slider + descriptive Text + confirm Button.

**Pattern D – Icon row**: Best for categorical choices. A Row of Cards, each with Icon + Text + action Button. Visual and scannable.

**Pattern E – Stacked list**: A vertical List of Rows, each Row has a Text label and a Button. Clean, minimal.

## Output Format

For each opinion, output A2UI JSONL (one JSON object per line):

Line 1: {"createSurface":{"surfaceId":"opinion-<N>","catalogId":"standard"}}
Line 2+: {"updateComponents":{"surfaceId":"opinion-<N>","components":[...]}}
Optional: {"updateDataModel":{"surfaceId":"opinion-<N>","path":"/","value":{...}}}

## Action Convention

Every actionable Button MUST have:
{"action":{"name":"resolve","context":{"interactionIndex":<N>,"selectedValue":"<value>","selectedLabel":"<human label>","questionText":"<the question>","dimensionName":"<dim or null>"}}}

For ChoicePicker patterns, the confirm Button should read the bound data model path in its context:
{"action":{"name":"resolve","context":{"interactionIndex":<N>,"selectedValue":{"path":"/choice"},"selectedLabel":"User selection","questionText":"...","dimensionName":"..."}}}

## Rules
- Output ONLY valid JSONL, no markdown, no explanation, no blank lines between surfaces
- Each line must be a complete valid JSON object
- Use different layout patterns across opinions — do NOT repeat the same pattern
- Every surface must have at least one Button with a "resolve" action
- Component IDs must be unique within each surface (prefix with surface index)
- Design questions about: field types, validation strictness, grouping, UX layout, data granularity, optional vs required fields`;

  (async () => {
    try {
      const result = streamText({
        model: anthropic("claude-haiku-4-5-20251001"),
        prompt,
        temperature: 0.5,
      });

      for await (const chunk of (await result).textStream) {
        stream.update(chunk);
      }
      stream.done();
    } catch (error) {
      stream.error(
        error instanceof Error ? error : new Error("Stream failed"),
      );
    }
  })();

  return { stream: stream.value };
}

/**
 * Resolves an opinion interaction from an A2UI action event.
 * Returns updated schemas and optional follow-up A2UI opinions.
 */
export async function resolveA2UIOpinionAction(request: {
  basePrompt: string;
  currentSchema: SerializedSchema;
  questionText: string;
  selectedLabel: string;
  maxFollowUps?: number;
}) {
  const {
    basePrompt,
    currentSchema,
    questionText,
    selectedLabel,
    maxFollowUps = 3,
  } = request;

  const { generateText } = await import("ai");

  const prompt = `You are a form design assistant. The user is refining a form through interactive opinion choices.

Current form description: ${basePrompt}

Current form schema:
${JSON.stringify(currentSchema, null, 2)}

The user was asked: "${questionText}"
They chose: "${selectedLabel}"

Based on this choice:
1. Rewrite the base prompt to incorporate this decision
2. Update the form schemas
3. Generate 0-${maxFollowUps} follow-up questions${maxFollowUps === 0 ? " (none)" : ""}

RULES:
- Field types: "string", "number", "boolean", "date", "email", "select"
- Select fields need validation.options array
- Field keys: camelCase
- Return ONLY valid JSON

{
  "basePrompt": "...",
  "artifactFormSchema": { "name": "...", "description": "...", "fields": { "key": { "label": "...", "type": "...", "required": true } } },
  "configuratorFormSchema": { "name": "...", "description": "...", "fields": {} },
  "configuratorFormValues": {},
  "followUpInteractions": [{ "text": "...", "options": [{ "value": "...", "label": "..." }] }]
}`;

  const result = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    prompt,
    temperature: 0.3,
  });

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No valid JSON in response");

  const parsed = JSON.parse(jsonMatch[0]) as {
    basePrompt: string;
    artifactFormSchema: SchemaMetadata;
    configuratorFormSchema: SchemaMetadata;
    configuratorFormValues: Record<string, string | number | boolean>;
    followUpInteractions?: {
      text: string;
      options: { value: string; label: string }[];
    }[];
  };

  const artifactSchema = initializeSerializedSchema(
    parsed.artifactFormSchema,
  );
  const configuratorSchema = initializeSerializedSchema(
    parsed.configuratorFormSchema,
  );

  return {
    basePrompt: parsed.basePrompt,
    artifactFormSchema: artifactSchema.schema,
    configuratorFormSchema: configuratorSchema.schema,
    configuratorFormValues: parsed.configuratorFormValues ?? {},
    followUpInteractions: (parsed.followUpInteractions ?? [])
      .slice(0, maxFollowUps)
      .map((i, idx) => ({
        id: `opinion-${Date.now()}-followup-${idx}`,
        text: i.text,
        source: "llm" as const,
        options: i.options,
        selectedOption: null,
        status: "pending" as const,
        dimensionId: null,
        dimensionName: null,
      })),
  };
}
