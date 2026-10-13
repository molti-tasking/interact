import { scaleFromSpec } from "@/lib/engine/scale";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { Field, PortfolioSchema } from "@/lib/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const AGREEMENT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];

function statement(name: string, label: string): Field {
  return {
    id: `id-${name}`,
    name,
    label,
    type: scaleFromSpec({ points: AGREEMENT }),
    required: true,
    constraints: [],
    origin: "system",
    tags: [],
  };
}

const schema: PortfolioSchema = {
  fields: [
    statement("frequentUse", "I would like to use this often"),
    statement("complex", "I found it unnecessarily complex"),
    statement("easy", "I thought it was easy to use"),
  ],
  groups: [],
  version: 1,
};

describe("Likert grid", () => {
  it("renders consecutive items as one grid of labelled radio groups", () => {
    render(<FormRenderer schema={schema} mode="live" />);

    expect(screen.getAllByTestId("likert-grid")).toHaveLength(1);
    const rows = screen.getAllByRole("radiogroup");
    expect(rows).toHaveLength(3);

    const complex = screen.getByRole("radiogroup", {
      name: /unnecessarily complex/,
    });
    const agree = within(complex).getByRole("radio", { name: "Agree" });
    fireEvent.click(agree);
    expect(agree).toBeChecked();
    // Other statements are independent
    const easy = screen.getByRole("radiogroup", { name: /easy to use/ });
    expect(within(easy).getByRole("radio", { name: "Agree" })).not.toBeChecked();
  });

  it("keeps the click-to-edit overlay per statement in the workspace preview", () => {
    const onFieldClick = vi.fn();
    render(
      <FormRenderer schema={schema} mode="preview" onFieldClick={onFieldClick} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit field I thought it was easy to use" }),
    );
    expect(onFieldClick).toHaveBeenCalledWith(schema.fields[2]);
  });

  it("renders a single Likert item with its labelled points", () => {
    render(
      <FormRenderer
        schema={{ ...schema, fields: [schema.fields[0]] }}
        mode="live"
      />,
    );
    expect(screen.queryByTestId("likert-grid")).toBeNull();
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(AGREEMENT);
  });
});
