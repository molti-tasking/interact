/**
 * I6 on the card: an answer that removes, retypes or rewords a field says how
 * many collected responses it affects before it is chosen. The same tile is
 * used for conflict fixes, so this covers both.
 */
import { CollectedResponsesProvider } from "@/components/workspace/collected-responses-context";
import { ProbeCard } from "@/components/workspace/ProbeCard";
import type { DesignProbe, Field, FormResponse, PortfolioSchema } from "@/lib/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const responses: FormResponse[] = [
  { id: "r1", portfolioId: "p1", submittedAt: "2026-01-02", data: { name: "A", notes: "late" } },
  { id: "r2", portfolioId: "p1", submittedAt: "2026-01-03", data: { name: "B", notes: "" } },
  { id: "r3", portfolioId: "p1", submittedAt: "2026-01-04", data: { name: "C", notes: "ok" } },
];

vi.mock("@/hooks/query/responses-new", () => ({
  useCollectedResponses: () => ({ data: responses }),
}));

const field = (name: string, label = name): Field => ({
  id: `f-${name}`,
  name,
  label,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
});
const schema: PortfolioSchema = {
  fields: [field("name", "Name"), field("notes", "Notes")],
  groups: [],
  version: 1,
};

const question: DesignProbe = {
  id: "q1",
  portfolioId: "p1",
  text: "Keep the notes field?",
  layer: "dimensions",
  source: "llm",
  options: [
    {
      value: "dropNotes",
      label: "Drop it",
      preview: {
        summary: "Removes notes",
        schemaPatch: { removeFieldKeys: ["notes"] },
        scope: { added: [], updated: [], removed: ["notes"] },
      },
    },
    {
      value: "addPhone",
      label: "Ask for a phone number instead",
      preview: {
        summary: "Adds phone",
        schemaPatch: { addFields: [{ key: "phone", label: "Phone", type: "string", required: false }] },
        scope: { added: ["phone"], updated: [], removed: [] },
      },
    },
  ],
  selectedOption: null,
  status: "pending",
  priority: 2,
  previewStatus: "ready",
  createdAt: "2026-01-01T00:00:00.000Z",
  editCount: 0,
};

function renderCard(withResponses: boolean) {
  const card = (
    <ProbeCard
      probe={question}
      expanded
      onExpand={vi.fn()}
      busy={false}
      schema={schema}
      validTargetIds={[]}
      onSelect={vi.fn(() => "applied" as const)}
      onOwnAnswer={vi.fn()}
      onDismiss={vi.fn()}
      onRetryPreview={vi.fn()}
    />
  );
  return render(
    withResponses ? (
      <CollectedResponsesProvider portfolioId="p1">{card}</CollectedResponsesProvider>
    ) : (
      card
    ),
  );
}

describe("I6: a preview says how many collected responses it affects", () => {
  it("counts the non-empty answers to a field the answer removes", () => {
    renderCard(true);
    const tile = screen.getByTestId("deck-option-dropNotes");
    const impact = within(tile).getByTestId("option-impact");
    expect(impact).toHaveTextContent("Affects 2 collected responses");
    expect(impact).toHaveAttribute("title", "Notes: 2 answers");
  });

  it("says nothing for an answer that only adds a field", () => {
    renderCard(true);
    const tile = screen.getByTestId("deck-option-addPhone");
    expect(within(tile).queryByTestId("option-impact")).toBeNull();
  });

  it("says nothing where the responses aren't known", () => {
    renderCard(false);
    expect(screen.queryByTestId("option-impact")).toBeNull();
  });
});
