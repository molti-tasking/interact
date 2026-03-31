"use client";

import { Badge } from "@/components/ui/badge";
import { usePortfolioLineage } from "@/hooks/query/lineage";
import type { Portfolio, PortfolioSchema } from "@/lib/types";
import { GitBranch, Network } from "lucide-react";
import Link from "next/link";

interface DerivationBannerProps {
  portfolio: Portfolio;
}

export function DerivationBanner({ portfolio }: DerivationBannerProps) {
  const { data: lineage } = usePortfolioLineage(portfolio);

  const isDerived = !!portfolio.base_id;
  const hasChildren = (lineage?.children.length ?? 0) > 0;

  // Nothing to show for standalone portfolios with no children
  if (!isDerived && !hasChildren) return null;

  const parent = lineage?.parent;
  const children = lineage?.children ?? [];
  const projection = portfolio.projection;

  const parentFieldCount = parent
    ? (parent.schema as unknown as PortfolioSchema).fields.length
    : null;
  const ownFieldCount = (portfolio.schema as unknown as PortfolioSchema).fields
    .length;

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm">
      {isDerived && parent && (
        <div className="flex items-center gap-2 flex-wrap">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Derived from</span>
          <Link
            href={`/portfolios/${parent.id}`}
            className="font-medium hover:underline underline-offset-2"
          >
            {parent.title}
          </Link>
          <span className="text-muted-foreground">
            ({parentFieldCount} fields)
          </span>
          {projection && (
            <Badge variant="outline" className="text-[10px]">
              {projection.type === "sub"
                ? `subset — ${ownFieldCount} of ${parentFieldCount} fields`
                : projection.type === "super"
                  ? `superset — ${ownFieldCount} fields (+${(ownFieldCount ?? 0) - (parentFieldCount ?? 0)} added)`
                  : `mixed — ${projection.includedFieldIds.length} kept, ${projection.additionalFields.length} added`}
            </Badge>
          )}
        </div>
      )}

      {isDerived && !parent && (
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">
            Derived from another portfolio
          </span>
        </div>
      )}

      {hasChildren && (
        <div
          className={isDerived && parent ? "mt-2 pt-2 border-t border-dashed" : ""}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Network className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">
              {children.length} derived view{children.length !== 1 ? "s" : ""}:
            </span>
            {children.map((child, i) => (
              <span key={child.id} className="inline-flex items-center gap-1">
                <Link
                  href={`/portfolios/${child.id}`}
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
