import { describe, expect, it } from "vitest";
import {
  activePortfolioIdFromPath,
  buildBreadcrumbs,
  isPrimaryNavActive,
} from "@/lib/app-nav";

describe("activePortfolioIdFromPath", () => {
  it.each([
    ["/portfolios/abc", "abc"],
    ["/portfolios/abc/provenance", "abc"],
    ["/portfolios/abc/record", "abc"],
    ["/responses/abc", "abc"],
    ["/responses/abc/resp-1", "abc"],
    ["/forms/abc", "abc"],
  ])("%s → %s", (path, id) => {
    expect(activePortfolioIdFromPath(path)).toBe(id);
  });

  it.each(["/", "/portfolios", "/portfolios/new", "/record", "/evaluation", ""])(
    "%s → null",
    (path) => {
      expect(activePortfolioIdFromPath(path)).toBeNull();
    },
  );
});

describe("isPrimaryNavActive", () => {
  it("matches the portfolio list only exactly", () => {
    expect(isPrimaryNavActive("portfolios", "/portfolios")).toBe(true);
    expect(isPrimaryNavActive("portfolios", "/portfolios/")).toBe(true);
    expect(isPrimaryNavActive("portfolios", "/portfolios/new")).toBe(false);
    expect(isPrimaryNavActive("portfolios", "/portfolios/abc")).toBe(false);
  });

  it("matches new, record and evaluation", () => {
    expect(isPrimaryNavActive("new", "/portfolios/new")).toBe(true);
    expect(isPrimaryNavActive("record", "/record")).toBe(true);
    expect(isPrimaryNavActive("record", "/portfolios/abc/record")).toBe(false);
    expect(isPrimaryNavActive("evaluation", "/evaluation")).toBe(true);
  });
});

describe("buildBreadcrumbs", () => {
  const titleOf = (id: string) => (id === "abc" ? "Soccer signup" : undefined);

  it("labels top-level pages", () => {
    expect(buildBreadcrumbs("/portfolios")).toEqual([{ label: "Portfolios" }]);
    expect(buildBreadcrumbs("/evaluation")).toEqual([{ label: "Evaluation" }]);
    expect(buildBreadcrumbs("/record")).toEqual([{ label: "Record mode" }]);
    expect(buildBreadcrumbs("/portfolios/new")).toEqual([
      { label: "Portfolios", href: "/portfolios" },
      { label: "New portfolio" },
    ]);
  });

  it("uses the portfolio title on the design page", () => {
    expect(buildBreadcrumbs("/portfolios/abc", titleOf)).toEqual([
      { label: "Portfolios", href: "/portfolios" },
      { label: "Soccer signup" },
    ]);
  });

  it("names portfolio sub pages", () => {
    expect(buildBreadcrumbs("/portfolios/abc/provenance", titleOf).at(-1)).toEqual({
      label: "History",
    });
    expect(buildBreadcrumbs("/portfolios/abc/dashboard", titleOf)[1]).toEqual({
      label: "Soccer signup",
      href: "/portfolios/abc",
    });
    expect(buildBreadcrumbs("/responses/abc", titleOf).at(-1)).toEqual({
      label: "Responses",
    });
    expect(buildBreadcrumbs("/responses/abc/r1", titleOf).slice(-2)).toEqual([
      { label: "Responses", href: "/responses/abc" },
      { label: "Response" },
    ]);
    expect(buildBreadcrumbs("/forms/abc", titleOf).at(-1)).toEqual({ label: "Form" });
  });

  it("falls back to a generic label while the title is unknown", () => {
    expect(buildBreadcrumbs("/portfolios/zzz").at(-1)).toEqual({ label: "Portfolio" });
  });
});
