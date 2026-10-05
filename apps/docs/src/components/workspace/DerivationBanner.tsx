"use client";

import { Badge } from "@/components/ui/badge";
import { usePortfolioLineage } from "@/hooks/query/lineage";
import type { Portfolio } from "@/lib/types";
import { GitBranch, Network } from "lucide-react";
import Link from "next/link";

interface DerivationBannerProps {
  portfolio: Portfolio;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function DerivationBanner({ portfolio }: DerivationBannerProps) {
  const { data: lineage } = usePortfolioLineage(portfolio);

  const isDerived = !!portfolio.base_id;
  const children = lineage?.children ?? [];
  const hasChildren = children.length > 0;

  // Nothing to show for standalone portfolios with no children
  if (!isDerived && !hasChildren) return null;

  const parent = lineage?.parent ?? null;
  const projection = portfolio.projection;
  const parentFieldCount = parent?.fieldCount ?? null;
  const ownFieldCount = portfolio.schema?.fields?.length ?? 0;

  const projectionLabel = (() => {
    if (!projection) return null;
    switch (projection.type) {
      case "sub":
        return parentFieldCount !== null
          ? `subset — ${ownFieldCount} of ${parentFieldCount} fields`
          : "subset";
      case "super": {
        if (parentFieldCount === null) return "superset";
        const extra = ownFieldCount - parentFieldCount;
        return `superset — ${plural(ownFieldCount, "field")}${extra > 0 ? ` (+${extra} added)` : ""}`;
      }
      default:
        return `mixed — ${projection.includedFieldIds?.length ?? 0} kept, ${projection.additionalFields?.length ?? 0} added`;
    }
  })();

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm">
      {isDerived && parent && (
        <div className="flex items-center gap-2 flex-wrap">
          <GitBranch
            className="h-3.5 w-3.5 text-muted-foreground shrink-0"
            aria-hidden
          />
          <span className="text-muted-foreground">Derived from</span>
          <Link
            href={`/portfolios/${parent.id}`}
            className="font-medium hover:underline underline-offset-2"
          >
            {parent.title}
          </Link>
          <span className="text-muted-foreground">
            ({plural(parent.fieldCount, "field")})
          </span>
          {projectionLabel && <Badge variant="outline">{projectionLabel}</Badge>}
        </div>
      )}

      {isDerived && !parent && (
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">
            Derived from another portfolio
          </span>
        </div>
      )}

      {hasChildren && (
        <div
          className={
            isDerived ? "mt-2 pt-2 border-t border-dashed" : ""
          }
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Network
              className="h-3.5 w-3.5 text-muted-foreground shrink-0"
              aria-hidden
            />
            <span className="text-muted-foreground">
              {plural(children.length, "derived view")}:
            </span>
            {children.map((child, i) => (
              <span key={child.id} className="inline-flex items-center gap-1">
                <Link
                  href={`/portfolios/${child.id}`}
                  title={plural(child.fieldCount, "field")}
                  className="font-medium hover:underline underline-offset-2"
                >
                  {child.title}
                </Link>
                {i < children.length - 1 && (
                  <span className="text-muted-foreground">,</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
