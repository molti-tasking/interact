"use server";

import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { createStreamableValue } from "ai/rsc";

/**
 * Streams A2UI JSONL messages that progressively build a form preview.
 * Fields appear one by one as the LLM generates them.
 *
 * The LLM designs the form layout natively in A2UI — using Cards for
 * field groups, Dividers between sections, descriptive Text, etc.
 * This is not a 1:1 mapping of SerializedSchema fields; the LLM
 * chooses the best A2UI layout for the form's purpose.
 */
export async function streamFormPreviewAction(userPrompt: string) {
  const stream = createStreamableValue<string>("");

  const prompt = `You are an AI agent that designs forms using the A2UI protocol. Design a visually polished, well-structured form for the user's request.

User request: ${userPrompt}

## Available Components

**Layout**: Column (vertical stack, props: children, align, justify), Row (horizontal, props: children, align, justify), Card (wrapper, props: child), List (scrollable, props: children, direction)
**Display**: Text (props: text, variant: h1|h2|h3|h4|h5|caption|body), Divider (props: axis: horizontal|vertical), Icon (props: name — lucide icon names)
**Interactive** (these are the form fields):
- TextField: {label, value: {path: "/key"}, variant: "shortText"|"longText"|"number"|"obscured"}
- CheckBox: {label, value: {path: "/key"}}
- ChoicePicker: {label, variant: "mutuallyExclusive"|"multipleSelection", options: [{label, value}], value: {path: "/key"}}
- Slider: {label, min, max, value: {path: "/key"}}
- DateTimeInput: {label, value: {path: "/key"}, enableDate: true, enableTime: false}

## Design Guidelines

1. **Group related fields** into Cards with a section header (Text h4) and Divider
2. **Use appropriate field types**: ChoicePicker for enums, Slider for bounded numbers, CheckBox for toggles, DateTimeInput for dates, TextField for everything else
3. **Add helper text**: Use Text with "caption" variant below complex fields
4. **Visual hierarchy**: Title (h2) → description (body) → sections (h4) → fields → submit area
5. **Progressive output**: Each updateComponents message should add ONE section (a Card or field group), so the form builds up visually section-by-section

## Output Format

Output JSONL. Each line is one complete JSON object.

Line 1 — Create surface:
{"createSurface":{"surfaceId":"form-preview","catalogId":"standard"}}

Line 2 — Title and root structure:
{"updateComponents":{"surfaceId":"form-preview","components":[{"id":"root","component":"Column","children":["title","desc"],"align":"stretch"},{"id":"title","component":"Text","text":"<Form Name>","variant":"h2"},{"id":"desc","component":"Text","text":"<description>","variant":"caption"}]}}

Then for each section/field group — a NEW updateComponents that adds the section AND updates root's children:
{"updateComponents":{"surfaceId":"form-preview","components":[{"id":"root","component":"Column","children":["title","desc","divider-1","section-1"],"align":"stretch"},{"id":"divider-1","component":"Divider"},{"id":"section-1","component":"Card","child":"section-1-col"},{"id":"section-1-col","component":"Column","children":["section-1-header","field1","field2"],"align":"stretch"},{"id":"section-1-header","component":"Text","text":"<Section Name>","variant":"h4"},{"id":"field1","component":"TextField","label":"...","value":{"path":"/field1"},"variant":"shortText"},{"id":"field2","component":"CheckBox","label":"...","value":{"path":"/field2"}}]}}

After all fields — set initial data model:
{"updateDataModel":{"surfaceId":"form-preview","path":"/","value":{<defaults for all field paths>}}}

Finally — metadata for storage:
{"__metadata":{"name":"<Form Name>","description":"<Form description>"}}

## Rules
- Output ONLY valid JSONL, no markdown
- Field IDs must be camelCase
- Design 4-12 fields organized into 2-4 sections
- Each updateComponents must include the root Column with its updated children array
- Use Cards to group related fields visually
- Add Dividers between sections`;

  (async () => {
    try {
      const result = streamText({
        model: anthropic("claude-haiku-4-5-20251001"),
        prompt,
        temperature: 0.4,
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
