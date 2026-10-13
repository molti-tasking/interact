import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { Field, PortfolioSchema } from "@/lib/types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const field = (name: string, label: string, required = false): Field => ({
  id: `id-${name}`,
  name,
  label,
  type: { kind: "text" },
  required,
  constraints: [],
  origin: "system",
  tags: [],
});

const schema: PortfolioSchema = {
  fields: [field("name", "Your name", true), field("feedback", "Feedback")],
  groups: [
    { id: "s1", label: "About you", fieldIds: ["id-name"] },
    { id: "s2", label: "Your thoughts", description: "Be honest.", fieldIds: ["id-feedback"] },
  ],
  version: 1,
};

describe("form sections", () => {
  it("shows every section with its heading and intro on one page by default", () => {
    render(<FormRenderer schema={schema} mode="live" onSubmit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "About you" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your thoughts" })).toBeInTheDocument();
    expect(screen.getByText("Be honest.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Your thoughts" })).toContainElement(
      screen.getByLabelText("Feedback"),
    );
    expect(screen.queryByTestId("page-progress")).toBeNull();
  });

  it("pages through sections, validating each page before moving on", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <FormRenderer schema={{ ...schema, layout: "paged" }} mode="live" onSubmit={onSubmit} />,
    );
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Feedback")).toBeNull();
    expect(screen.queryByRole("button", { name: /save|submit/i })).toBeNull();

    // The required name blocks the next page
    await act(async () => fireEvent.click(screen.getByTestId("page-next")));
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Ada" } });
    await act(async () => fireEvent.click(screen.getByTestId("page-next")));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());
    expect(screen.getByLabelText("Feedback")).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByTestId("page-back")));
    // The answer survives the page turn
    expect(screen.getByLabelText(/Your name/)).toHaveValue("Ada");
  });

  it("keeps everything on one page when asked to, and in the workspace preview", () => {
    const onSectionClick = vi.fn();
    render(
      <FormRenderer
        schema={{ ...schema, layout: "paged" }}
        mode="preview"
        onSectionClick={onSectionClick}
      />,
    );
    expect(screen.getByLabelText("Feedback")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Page break" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit section Your thoughts" }));
    expect(onSectionClick).toHaveBeenCalledWith(schema.groups[1]);
  });
});
