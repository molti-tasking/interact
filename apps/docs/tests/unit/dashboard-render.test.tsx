import { WidgetCard } from "@/app/(app)/responses/[portfolioId]/_components/dashboard/widget-card";
import { scaleFromSpec } from "@/lib/engine/scale";
import type { Field, FieldType, PortfolioSchema } from "@/lib/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function field(name: string, type: FieldType, label = name): Field {
  return { id: `id-${name}`, name, label, type, required: false, constraints: [], origin: "system", tags: [] };
}

const role = field(
  "role",
  {
    kind: "select",
    multiple: false,
    options: [
      { label: "Student", value: "student" },
      { label: "Staff", value: "staff" },
    ],
  },
  "Role",
);
const ease = field("ease", scaleFromSpec({ points: ["Disagree", "Neutral", "Agree"] }), "Easy to use");
const schema: PortfolioSchema = { fields: [role, ease], groups: [], version: 1 };

const rows = [
  { id: "r1", data: { role: "staff", ease: 3 }, submittedAt: "2026-10-01T00:00:00Z" },
  { id: "r2", data: { role: "staff", ease: 1 }, submittedAt: "2026-10-01T00:00:00Z" },
  { id: "r3", data: { role: "teacher", ease: 3 }, submittedAt: "2026-10-02T00:00:00Z" },
  { id: "r4", data: {}, submittedAt: "2026-10-02T00:00:00Z" },
];

describe("dashboard widgets", () => {
  it("shows answer counts per option, flags values the form doesn't offer, and offers recoding", () => {
    const actions = vi.fn(() => <button type="button">recode</button>);
    render(
      <WidgetCard
        widget={{ id: "w", kind: "distribution", title: "Roles", fieldIds: ["id-role"] }}
        schema={schema}
        rows={rows}
        categoryActions={actions}
      />,
    );
    expect(screen.getByRole("heading", { name: "Roles" })).toBeInTheDocument();
    const staff = screen.getByTestId("bucket-staff");
    expect(within(staff).getByText("Staff")).toBeInTheDocument();
    expect(staff).toHaveTextContent("2 · 67%");
    expect(screen.getByTestId("bucket-student")).toHaveTextContent("0 · 0%");
    expect(screen.getByTestId("bucket-teacher")).toHaveTextContent("teacher");
    expect(screen.getByText(/aren't options/)).toBeInTheDocument();
    expect(actions).toHaveBeenCalledTimes(3);
    expect(screen.getByText("3 answers · 1 skipped", { exact: false })).toBeInTheDocument();
  });

  it("shows a Likert statement as a diverging bar with a legend", () => {
    render(
      <WidgetCard
        widget={{ id: "w", kind: "likert", title: "Usability", fieldIds: ["id-ease"] }}
        schema={schema}
        rows={rows}
      />,
    );
    for (const point of ["Disagree", "Neutral", "Agree"]) {
      expect(screen.getAllByText(point, { exact: false }).length).toBeGreaterThan(0);
    }
    // 1 of 3 disagree, 2 of 3 agree
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("explains a chart whose field was removed", () => {
    render(
      <WidgetCard
        widget={{ id: "w", kind: "distribution", title: "Gone", fieldIds: ["id-gone"] }}
        schema={schema}
        rows={rows}
      />,
    );
    expect(screen.getByText(/was removed from the form/)).toBeInTheDocument();
  });
});
