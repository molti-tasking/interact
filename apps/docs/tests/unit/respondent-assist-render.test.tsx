import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { PrefillResult } from "@/lib/form-renderer/prefill";
import type { Field, PortfolioSchema } from "@/lib/types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const field = (name: string, label: string): Field => ({
  id: `id-${name}`,
  name,
  label,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
});

const schema: PortfolioSchema = {
  fields: [field("name", "Your name"), field("city", "City")],
  groups: [],
  version: 1,
};

describe("respondent assist in the form", () => {
  it("offers nothing unless the caller passes it, and never in the preview", () => {
    const { unmount } = render(<FormRenderer schema={schema} mode="live" onSubmit={vi.fn()} />);
    expect(screen.queryByTestId("field-explain")).toBeNull();
    expect(screen.queryByTestId("prefill-open")).toBeNull();
    unmount();

    render(
      <FormRenderer
        schema={schema}
        mode="preview"
        assist={{ explain: vi.fn(), prefill: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId("field-explain")).toBeNull();
    expect(screen.queryByTestId("prefill-open")).toBeNull();
  });

  it("explains a question once per session", async () => {
    const explain = vi.fn().mockResolvedValue("What people call you.");
    render(<FormRenderer schema={schema} mode="live" onSubmit={vi.fn()} assist={{ explain }} />);

    const ask = () => screen.getAllByTestId("field-explain")[0];
    await act(async () => fireEvent.click(ask()));
    await waitFor(() =>
      expect(screen.getByTestId("field-explanation")).toHaveTextContent("What people call you."),
    );
    expect(explain).toHaveBeenCalledWith("id-name");

    // Hidden and asked again: answered from the cache
    fireEvent.click(screen.getByRole("button", { name: /Hide the explanation/ }));
    await act(async () => fireEvent.click(ask()));
    await waitFor(() => expect(screen.getByTestId("field-explanation")).toBeInTheDocument());
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it("fills in from a text, marks the answers for review, and submits nothing", async () => {
    const result: PrefillResult = {
      filled: [{ key: "name", path: ["name"], label: "Your name", value: "Kim" }],
      issues: [{ field: "city", label: "City", value: "??", reason: "unparsed" }],
      missingRequired: [],
    };
    const prefill = vi.fn().mockResolvedValue(result);
    const onSubmit = vi.fn();
    render(<FormRenderer schema={schema} mode="live" onSubmit={onSubmit} assist={{ prefill }} />);

    fireEvent.click(screen.getByTestId("prefill-open"));
    // The respondent is told where the text goes
    expect(screen.getByText(/sent to an AI service/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("prefill-text"), { target: { value: "I'm Kim" } });
    await act(async () => fireEvent.click(screen.getByTestId("prefill-run")));

    await waitFor(() => expect(screen.getByLabelText("Your name")).toHaveValue("Kim"));
    expect(prefill).toHaveBeenCalledWith("I'm Kim");
    expect(screen.getAllByTestId("field-prefilled")).toHaveLength(1);
    expect(screen.getByTestId("prefill-result")).toHaveTextContent("City: couldn't use");
    expect(onSubmit).not.toHaveBeenCalled();

    // Editing the answer counts as having checked it
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Kim L." } });
    await waitFor(() => expect(screen.queryByTestId("field-prefilled")).toBeNull());
  });
});
