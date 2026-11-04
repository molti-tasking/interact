import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { Field, PortfolioSchema } from "@/lib/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const field = (name: string, label: string, extra: Partial<Field> = {}): Field => ({
  id: `id-${name}`,
  name,
  label,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
  ...extra,
});

const schema: PortfolioSchema = {
  fields: [field("name", "Your name", { locked: true }), field("age", "Age")],
  groups: [],
  version: 1,
};

describe("canvas editing affordances", () => {
  it("moves a field with the arrow keys on its handle", () => {
    const onFieldMove = vi.fn();
    render(
      <FormRenderer
        schema={schema}
        mode="preview"
        onFieldClick={vi.fn()}
        onFieldMove={onFieldMove}
      />,
    );
    const handle = screen.getByRole("button", { name: /Move field Age/ });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onFieldMove).toHaveBeenCalledWith({ fieldId: "id-age", delta: -1 });
  });

  it("offers no move handle without a move handler or outside the preview", () => {
    render(<FormRenderer schema={schema} mode="preview" onFieldClick={vi.fn()} />);
    expect(screen.queryByTestId("field-move-handle")).toBeNull();
  });

  it("marks locked fields and says what a pending change does", () => {
    render(
      <FormRenderer
        schema={schema}
        mode="preview"
        onFieldClick={vi.fn()}
        fieldAnnotations={{ "id-age": "updated" }}
        fieldChangeNotes={{ "id-age": ["type text → number", "now required"] }}
      />,
    );
    expect(screen.getAllByTestId("field-locked")).toHaveLength(1);
    expect(screen.getByTestId("field-annotation")).toHaveTextContent(
      "type text → number · now required",
    );
  });
});
