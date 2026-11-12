import type { DeriveSchemaResponse } from "@/app/actions/derive-actions";
import type { DerivationRecord } from "@/hooks/query/portfolios";
import {
  type DerivationSpec,
  emptyStructuredIntent,
  type Portfolio,
  type PortfolioInsert,
  type PortfolioSchema,
} from "./types";

type DeriveResult = NonNullable<DeriveSchemaResponse["result"]>;

/**
 * The derived portfolio to create from a derivation the model proposed: the
 * schema it assembled, the projection (type, included base field ids, new
 * fields), the link to its base, and the first entry of its trail.
 *
 * Used by the derive page and by the evaluation harness, so both create a
 * derived form the same way.
 */
export function derivedPortfolio(
  base: Pick<Portfolio, "id" | "title" | "space_id">,
  parentSchema: PortfolioSchema,
  result: DeriveResult,
  scenario: string,
  actor: string,
  now: Date = new Date(),
): PortfolioInsert & { derivation: DerivationRecord } {
  const scenarioText = scenario.trim();
  const projection: DerivationSpec = {
    type: result.derivationType,
    scenarioIntent: scenarioText,
    includedFieldIds: parentSchema.fields
      .filter((f) => result.includedFieldKeys.includes(f.name))
      .map((f) => f.id),
    additionalFields: JSON.parse(JSON.stringify(result.additionalFields)),
    fieldMappings: {},
  };

  return {
    title: `${base.title} — ${scenarioText.slice(0, 50)}`,
    // Inherits the parent's exclusions + constraints (from the action)
    intent: result.derivedIntent ?? {
      ...emptyStructuredIntent(),
      purpose: { content: result.derivedPurpose, updatedAt: now.toISOString() },
    },
    schema: result.schema,
    base_id: base.id,
    // Keep derived views in the base's space (lists, reference siblings)
    space_id: base.space_id,
    projection: projection as unknown as PortfolioInsert["projection"],
    status: "draft",
    derivation: {
      actor,
      rationale: `Derived from "${base.title}" for: ${scenarioText}`,
    },
  };
}
