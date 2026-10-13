"use server";

import {
  dashboardSuggestionSchema,
  MAX_WIDGETS,
  WIDGET_KIND_GUIDE,
  widgetRevisionSchema,
  widgetsFromProposals,
} from "@/lib/engine/dashboard";
import {
  serializeForLLM,
  serializeSchemaForLLM,
} from "@/lib/engine/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
import { fastModel, model, withLlmRetry } from "@/lib/model";
import { telemetry, withTracing } from "@/lib/telemetry";
import type {
  DashboardWidget,
  PortfolioSchema,
  StructuredIntent,
} from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

/**
 * Response dashboards: the LLM picks which charts answer the questions the
 * form's intent is about. It never sees response data (only how many there
 * are) — every number is computed on the client.
 */

const SYSTEM = `You design response dashboards for forms: a few charts that answer the questions the form's creator is collecting the data for.

Widget kinds (and the fields each takes):
${WIDGET_KIND_GUIDE}`;

const CHART_RULES = `- Use field keys exactly as listed.
- A battery of rating statements on the same scale is ONE "likert" widget with all their keys.
- Comparisons the purpose cares about (e.g. satisfaction by role) are a "crosstab" of two categorical fields.
- Don't chart contact details or identifiers (names, emails, phone numbers) — they're no insight.
- "size": "full" for the overview, timelines, likert batteries and crosstabs; "half" otherwise.`;

// ---------------------------------------------------------------------------
// Suggest a whole dashboard
// ---------------------------------------------------------------------------

export interface SuggestDashboardRequest {
  intent: StructuredIntent;
  schema: PortfolioSchema;
  responseCount: number;
}

export interface SuggestDashboardResponse {
  success: boolean;
  widgets?: DashboardWidget[];
  error?: string;
}

export async function suggestDashboardAction(
  request: SuggestDashboardRequest,
): Promise<SuggestDashboardResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "suggestDashboardAction",
      request,
      () => suggestDashboardReal(request),
      { prompt: serializeForLLM(request.intent) },
    );
  }
  return suggestDashboardReal(request);
}

async function suggestDashboardReal({
  intent,
  schema,
  responseCount,
}: SuggestDashboardRequest): Promise<SuggestDashboardResponse> {
  try {
    const basePrompt = serializeForLLM(intent);
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(schema.fields, LIMITS.document, "Schema");
    if (schema.fields.length === 0) return { success: true, widgets: [] };
    await guardLlmRequest();

    const prompt = `Form description:
${basePrompt || "(none)"}

Form fields:
${serializeSchemaForLLM(schema)}

Responses so far: ${responseCount}

Propose a dashboard of 4-${MAX_WIDGETS} widgets, most important first. Start with a "kpi" overview; add a "timeline" only when timing matters (e.g. ongoing collection). Then chart what the purpose says the data is for.

RULES:
${CHART_RULES}
- Each widget answers a different question.`;

    const result = await withLlmRetry("suggest-dashboard", (abortSignal) =>
      withTracing({ tags: ["dashboard", "suggest"] }, () =>
        generateText({
          model,
          system: SYSTEM,
          prompt,
          output: Output.object({ schema: dashboardSuggestionSchema }),
          temperature: 0.3,
          abortSignal,
          maxRetries: 0,
          experimental_telemetry: telemetry("suggest-dashboard"),
        }),
      ),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }
    return {
      success: true,
      widgets: widgetsFromProposals(result.output.widgets, schema),
    };
  } catch (error) {
    console.error("Dashboard suggestion error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Change one widget, or add one, from a description
// ---------------------------------------------------------------------------

export interface ReviseWidgetRequest {
  intent: StructuredIntent;
  schema: PortfolioSchema;
  /** The widget to change; omitted to add a new one */
  widget?: DashboardWidget;
  instruction: string;
}

export interface ReviseWidgetResponse {
  success: boolean;
  widget?: DashboardWidget;
  /** Why it can't be done (e.g. the form doesn't collect what's asked) */
  error?: string;
}

/** Feasibility first: the model decides before it writes a widget. */
const reviseSchema = z.object({
  possible: z
    .boolean()
    .describe("false when the form's fields can't answer the request"),
  reason: z
    .string()
    .describe(
      "When not possible: what the form would need to collect, in one sentence; otherwise empty",
    ),
  widget: widgetRevisionSchema.shape.widget,
});

export async function reviseWidgetAction(
  request: ReviseWidgetRequest,
): Promise<ReviseWidgetResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "reviseWidgetAction",
      request,
      () => reviseWidgetReal(request),
      { prompt: request.instruction },
    );
  }
  return reviseWidgetReal(request);
}

async function reviseWidgetReal({
  intent,
  schema,
  widget,
  instruction,
}: ReviseWidgetRequest): Promise<ReviseWidgetResponse> {
  try {
    const basePrompt = serializeForLLM(intent);
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(schema.fields, LIMITS.document, "Schema");
    capText(instruction, LIMITS.prompt, "Request");
    capJson(widget, LIMITS.shortText, "Widget");
    await guardLlmRequest();

    const names = new Map(schema.fields.map((f) => [f.id, f.name]));
    const current = widget
      ? `The chart to change: "${widget.title}" — kind "${widget.kind}", fields [${widget.fieldIds.map((id) => names.get(id) ?? "(removed)").join(", ")}].`
      : "Add a new chart.";

    const prompt = `Form description:
${basePrompt || "(none)"}

Form fields:
${serializeSchemaForLLM(schema)}

${current}
The creator asks: "${instruction}"

Return the ${widget ? "changed" : "new"} widget. Keep what the request doesn't change. If the form's fields can't answer the request, set "possible" to false and say in "reason" what the form would need to collect.

RULES:
${CHART_RULES}`;

    const result = await withLlmRetry("revise-widget", (abortSignal) =>
      withTracing({ tags: ["dashboard", "revise"] }, () =>
        generateText({
          model: fastModel,
          system: SYSTEM,
          prompt,
          output: Output.object({ schema: reviseSchema }),
          temperature: 0.2,
          abortSignal,
          maxRetries: 0,
          experimental_telemetry: telemetry("revise-widget"),
        }),
      ),
      { timeoutMs: 30_000 },
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }
    if (!result.output.possible) {
      return {
        success: false,
        error: result.output.reason || "The form's fields can't answer that.",
      };
    }
    const [revised] = widgetsFromProposals([result.output.widget], schema, {
      keepId: widget?.id,
      prompt: instruction,
    });
    if (!revised) {
      return { success: false, error: "That can't be charted with this form's fields." };
    }
    return { success: true, widget: revised };
  } catch (error) {
    console.error("Widget revision error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
