/**
 * Route helpers for the app shell (sidebar active state, header breadcrumbs).
 * Pure functions so they can be unit-tested without a router.
 */

const PORTFOLIO_SCOPED_ROUTE = /^\/(portfolios|responses|forms)\/([^/?#]+)(?:\/([^?#]*))?/;

/**
 * The portfolio a route belongs to: `/portfolios/[id]/*`, `/responses/[id]/*`
 * and `/forms/[id]/*`. Returns null elsewhere (incl. `/portfolios/new`).
 */
export function activePortfolioIdFromPath(
  pathname: string | null | undefined,
): string | null {
  if (!pathname) return null;
  const match = pathname.match(PORTFOLIO_SCOPED_ROUTE);
  if (!match) return null;
  const [, section, id] = match;
  if (section === "portfolios" && id === "new") return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export type PrimaryNavKey = "portfolios" | "new" | "record" | "evaluation";

/** Whether a primary sidebar entry is the current page. */
export function isPrimaryNavActive(
  key: PrimaryNavKey,
  pathname: string | null | undefined,
): boolean {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/";
  switch (key) {
    case "portfolios":
      return path === "/portfolios";
    case "new":
      return path === "/portfolios/new";
    case "record":
      return path === "/record" || path.startsWith("/record/");
    case "evaluation":
      return path === "/evaluation" || path.startsWith("/evaluation/");
  }
}

export interface Crumb {
  label: string;
  /** Omitted for the current page. */
  href?: string;
}

const PORTFOLIO_SUBPAGES: Record<string, string> = {
  provenance: "History",
  dashboard: "Dashboard",
  derive: "Derive a view",
  record: "Record",
};

/**
 * Header breadcrumbs for a route. `titleOf` resolves a portfolio id to its
 * title (falls back to "Portfolio" while loading / unknown).
 */
export function buildBreadcrumbs(
  pathname: string | null | undefined,
  titleOf: (id: string) => string | undefined = () => undefined,
): Crumb[] {
  const path = (pathname ?? "/").replace(/\/+$/, "") || "/";
  const crumbs: Crumb[] = [];

  if (path === "/") return [{ label: "Overview" }];
  if (path === "/evaluation" || path.startsWith("/evaluation/"))
    return [{ label: "Evaluation" }];
  if (path === "/record") return [{ label: "Record mode" }];

  if (path === "/portfolios") return [{ label: "Portfolios" }];
  if (path === "/portfolios/new")
    return [{ label: "Portfolios", href: "/portfolios" }, { label: "New portfolio" }];

  const id = activePortfolioIdFromPath(path);
  if (!id) return [{ label: "Malleable Forms" }];

  const title = titleOf(id) || "Portfolio";
  const designHref = `/portfolios/${encodeURIComponent(id)}`;
  const [, section, , rest = ""] =
    path.match(PORTFOLIO_SCOPED_ROUTE) ?? [];
  const sub = rest.split("/").filter(Boolean);

  crumbs.push({ label: "Portfolios", href: "/portfolios" });

  if (section === "portfolios") {
    if (sub.length === 0) {
      crumbs.push({ label: title });
    } else {
      crumbs.push({ label: title, href: designHref });
      crumbs.push({
        label: PORTFOLIO_SUBPAGES[sub[0]] ?? sentenceCaseSegment(sub[0]),
      });
    }
  } else if (section === "responses") {
    crumbs.push({ label: title, href: designHref });
    if (sub.length === 0) {
      crumbs.push({ label: "Responses" });
    } else {
      crumbs.push({
        label: "Responses",
        href: `/responses/${encodeURIComponent(id)}`,
      });
      crumbs.push({ label: "Response" });
    }
  } else if (section === "forms") {
    crumbs.push({ label: title, href: designHref });
    crumbs.push({ label: "Form" });
  }

  return crumbs;
}

function sentenceCaseSegment(segment: string): string {
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : segment;
}
