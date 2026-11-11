/**
 * G2 and G3 on the card itself.
 *
 * G3: an answer chosen before its preview is ready is not applied — the card
 * waits for the preview, shows it, and applies the answer only when it is
 * chosen again with the preview on screen.
 * G2: the answers are listed in their stored order, none emphasised,
 * selected or focused, with the free-text answer last.
 */
import { ProbeCard, type AnswerOutcome } from "@/components/workspace/ProbeCard";
import type { DesignProbe, DesignProbeOption, Field, PortfolioSchema } from "@/lib/types";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { prepareProbeOptions, seededRandom } from "interact/forms/probe-options";
import { describe, expect, it, vi } from "vitest";

const field = (name: string): Field => ({
  id: `f-${name}`,
  name,
  label: name,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
});
const schema: PortfolioSchema = { fields: [field("name")], groups: [], version: 1 };

const withPreview = (option: DesignProbeOption, key: string): DesignProbeOption => ({
  ...option,
  preview: {
    summary: `Adds ${key}`,
    schemaPatch: { addFields: [{ key, label: key, type: "string", required: false }] },
    scope: { added: [key], updated: [], removed: [] },
  },
});

function probe(overrides: Partial<DesignProbe> = {}): DesignProbe {
  return {
    id: "q1",
    portfolioId: "p1",
    text: "Ask for a phone number?",
    layer: "dimensions",
    source: "llm",
    options: prepareProbeOptions(
      [
        { value: "askPhone", label: "Yes, ask for it" },
        { value: "askBoth", label: "Phone and email" },
      ],
      { random: seededRandom("card") },
    ),
    selectedOption: null,
    status: "pending",
    priority: 2,
    previewStatus: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    editCount: 0,
    ...overrides,
  };
}

/** The same question once its previews arrived. */
const ready = (p: DesignProbe): DesignProbe => ({
  ...p,
  previewStatus: "ready",
  options: p.options.map((o) => (o.unchanged ? o : withPreview(o, `${o.value}Field`))),
});

function card(p: DesignProbe, onSelect: (value: string, c: { previewShown: boolean }) => Promise<AnswerOutcome> | AnswerOutcome, extra: Partial<React.ComponentProps<typeof ProbeCard>> = {}) {
  return (
    <ProbeCard
      probe={p}
      expanded
      onExpand={vi.fn()}
      busy={false}
      schema={schema}
      validTargetIds={[]}
      onSelect={onSelect}
      onOwnAnswer={vi.fn()}
      onDismiss={vi.fn()}
      onRetryPreview={vi.fn()}
      {...extra}
    />
  );
}

describe("G3: wait for the preview, show it, then apply", () => {
  it("does not apply an answer chosen before its preview is ready", async () => {
    const pending = probe();
    // The deck's part: wait for the preview, then report that it is shown
    let previewArrived!: () => void;
    const onSelect = vi.fn(
      (_value: string, { previewShown }: { previewShown: boolean }) =>
        previewShown
          ? ("applied" as const)
          : new Promise<AnswerOutcome>((resolve) => (previewArrived = () => resolve("preview"))),
    );
    const view = render(card(pending, onSelect));

    const tile = () => screen.getByTestId("deck-option-askPhone");
    expect(tile()).toHaveAttribute("data-preview", "pending");

    fireEvent.click(tile());
    expect(onSelect).toHaveBeenLastCalledWith("askPhone", { previewShown: false });
    // Waiting is visible, and nothing else can be chosen meanwhile
    expect(tile()).toHaveAttribute("data-preview", "waiting");
    expect(within(tile()).getByRole("status")).toHaveTextContent("Preparing the preview");
    expect(screen.getByTestId("deck-option-askBoth")).toBeDisabled();

    // The preview arrives: it is shown, and the answer asks to be chosen again
    view.rerender(card(ready(pending), onSelect));
    await act(async () => previewArrived());
    expect(tile()).toHaveAttribute("data-preview", "ready");
    expect(tile()).toHaveAttribute("data-armed", "preview");
    expect(within(tile()).getByTestId("option-diff")).toHaveTextContent("askPhoneField");
    expect(tile()).toHaveTextContent("Choose it again to apply");
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Chosen again, with the preview on the tile: now it may be applied
    await act(async () => {
      fireEvent.click(tile());
    });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith("askPhone", { previewShown: true });
  });

  it("applies in one click when the preview was already on the tile", async () => {
    const onSelect = vi.fn(() => "applied" as const);
    render(card(ready(probe()), onSelect));
    await act(async () => {
      fireEvent.click(screen.getByTestId("deck-option-askBoth"));
    });
    expect(onSelect).toHaveBeenCalledWith("askBoth", { previewShown: true });
  });

  it("says so when a preview failed, and reports the click as unpreviewed", async () => {
    const failed = probe({ previewStatus: "failed" });
    const onSelect = vi.fn(() => "none" as const);
    render(card(failed, onSelect));
    const tile = screen.getByTestId("deck-option-askPhone");
    expect(tile).toHaveTextContent("No preview yet");
    await act(async () => {
      fireEvent.click(tile);
    });
    expect(onSelect).toHaveBeenCalledWith("askPhone", { previewShown: false });
    expect(tile).not.toHaveAttribute("data-armed");
  });

  it("shows a typed answer with its preview instead of applying it", async () => {
    const onSelect = vi.fn(() => "applied" as const);
    const onOwnAnswer = vi.fn();
    const p = ready(probe());
    const view = render(card(p, onSelect, { onOwnAnswer }));

    fireEvent.click(screen.getByTestId("own-answer-open"));
    fireEvent.change(screen.getByTestId("own-answer-input"), {
      target: { value: "Only a mobile number" },
    });
    fireEvent.click(screen.getByTestId("own-answer-preview"));
    expect(onOwnAnswer).toHaveBeenCalledWith("Only a mobile number");
    expect(onSelect).not.toHaveBeenCalled();

    // While it is worked out, then with its preview: the last tile
    view.rerender(card(p, onSelect, { onOwnAnswer, ownAnswerPending: true }));
    expect(screen.getByTestId("own-answer-pending")).toBeInTheDocument();
    const own = withPreview({ value: "custom:Only a mobile number", label: "Only a mobile number" }, "mobile");
    view.rerender(
      card(p, onSelect, { onOwnAnswer, ownAnswer: own as React.ComponentProps<typeof ProbeCard>["ownAnswer"] }),
    );
    const tile = screen.getByTestId("deck-option-own");
    expect(tile).toHaveAttribute("data-armed", "preview");
    expect(within(tile).getByTestId("option-diff")).toHaveTextContent("mobile");
    const tiles = screen.getAllByTestId(/^deck-option-/);
    expect(tiles.at(-1)).toBe(tile);

    await act(async () => {
      fireEvent.click(tile);
    });
    expect(onSelect).toHaveBeenCalledWith("custom:Only a mobile number", { previewShown: true });
  });
});

describe("G2: alternatives, none recommended", () => {
  it("lists the answers in their stored order, with one that keeps the form", () => {
    const p = ready(probe());
    render(card(p, vi.fn()));
    const shown = screen
      .getAllByTestId(/^deck-option-/)
      .map((el) => el.getAttribute("data-testid")!.replace("deck-option-", ""));
    expect(shown).toEqual(p.options.map((o) => o.value));
    expect(p.options.filter((o) => o.unchanged)).toHaveLength(1);
    const keep = p.options.find((o) => o.unchanged)!;
    expect(screen.getByTestId(`deck-option-${keep.value}`)).toHaveTextContent("No form change");
  });

  it("always offers the free-text answer, after the suggested ones", () => {
    render(card(ready(probe()), vi.fn()));
    const own = screen.getByTestId("own-answer-open");
    const lastTile = screen.getAllByTestId(/^deck-option-/).at(-1)!;
    expect(lastTile.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(own).toBeEnabled();
  });

  it("emphasises, selects and focuses no answer", () => {
    render(card(ready(probe()), vi.fn()));
    const tiles = screen.getAllByTestId(/^deck-option-/);
    // Same classes on every tile, the unchanged answer included
    expect(new Set(tiles.map((t) => t.className)).size).toBe(1);
    for (const tile of tiles) {
      expect(tile).not.toHaveAttribute("data-armed");
      expect(tile).not.toHaveAttribute("aria-pressed");
      expect(tile).not.toHaveAttribute("aria-checked");
      expect(tile).not.toHaveAttribute("autofocus");
    }
    expect(tiles).not.toContain(document.activeElement);
    expect(screen.queryByText(/recommended|suggested|default/i)).toBeNull();
  });
});
