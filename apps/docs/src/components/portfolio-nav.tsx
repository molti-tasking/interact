"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePortfolioActivity } from "@/lib/workspace-activity";
import {
  BarChart3,
  ClipboardList,
  ExternalLink,
  History,
  Loader2,
  Mic,
  Pencil,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Per-portfolio section tabs. Rendered by the portfolio layout and by the
 * responses page (which lives outside the /portfolios/[id] segment).
 */
export function PortfolioNav({
  portfolioId,
  className,
}: {
  portfolioId: string;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  const base = `/portfolios/${portfolioId}`;

  const tabs = [
    { href: base, label: "Design", icon: Pencil, exact: true },
    { href: `/responses/${portfolioId}`, label: "Responses", icon: ClipboardList },
    { href: `${base}/dashboard`, label: "Dashboard", icon: BarChart3 },
    { href: `${base}/provenance`, label: "History", icon: History },
  ];

  const isActive = (href: string, exact?: boolean) =>
    exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    // wrap-reverse: on narrow screens the actions wrap *above* the tabs so
    // the tabs stay attached to the bottom border.
    <nav
      aria-label="Portfolio sections"
      className={cn(
        "flex flex-wrap-reverse items-end justify-between gap-x-4 gap-y-2 border-b border-border/60",
        className,
      )}
    >
      <ul className="-mb-px flex min-w-0 max-w-full items-center overflow-x-auto">
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3",
                  active
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="ml-auto flex items-center gap-1.5 pb-1.5">
        <AiActivityIndicator portfolioId={portfolioId} />
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link
            href={`/forms/${portfolioId}`}
            target="_blank"
            rel="noopener"
            prefetch={false}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Open form
            <span className="sr-only">(opens in a new tab)</span>
          </Link>
        </Button>
        <Button asChild size="sm" className="btn-brand">
          <Link href={`${base}/record`} prefetch={false}>
            <Mic className="h-3.5 w-3.5" aria-hidden />
            Record
          </Link>
        </Button>
      </div>
    </nav>
  );
}

/**
 * Global "AI working…" state for a portfolio — visible on every tab, so
 * long-running generation keeps being visible after switching sections.
 */
function AiActivityIndicator({ portfolioId }: { portfolioId: string }) {
  const labels = usePortfolioActivity(portfolioId);
  const busy = labels.length > 0;
  const summary = busy
    ? labels.length === 1
      ? labels[0]
      : `${labels[0]} +${labels.length - 1} more`
    : "";

  return (
    <span role="status" aria-live="polite" className="contents">
      {busy && (
        <span
          className="inline-flex max-w-56 items-center gap-1.5 rounded-full border border-brand-accent/30 bg-brand-accent/10 px-2.5 py-1 text-xs text-brand-accent"
          title={labels.join("\n")}
        >
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
          <span className="truncate">
            <span className="sr-only">AI working: </span>
            <span aria-hidden className="hidden sm:inline">AI · </span>
            {summary}
          </span>
        </span>
      )}
    </span>
  );
}
