"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePortfolios } from "@/hooks/query/portfolios";
import type { Portfolio, PortfolioSchema } from "@/lib/types";
import { CornerDownRight, FileText, Plus } from "lucide-react";
import Link from "next/link";

export default function PortfoliosPage() {
  const { data: portfolios, isLoading } = usePortfolios();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl tracking-tight text-primary">Portfolios</h1>
          <p className="text-sm text-muted-foreground font-sans">
            Your intent portfolios and form schemas.
          </p>
        </div>
        <Button asChild className="btn-brand font-sans">
          <Link href="/portfolios/new">
            <Plus className="h-4 w-4 mr-2" />
            New Portfolio
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-6 animate-pulse">
              <div className="h-4 bg-muted rounded w-2/3 mb-2" />
              <div className="h-3 bg-muted rounded w-full" />
            </Card>
          ))}
        </div>
      ) : portfolios && portfolios.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {buildLineageTree(portfolios).map((node) => (
            <div key={node.portfolio.id} className="flex flex-col gap-2">
              <PortfolioCard portfolio={node.portfolio} />
              {node.children.map((child) => (
                <div key={child.id} className="flex items-start gap-1.5 pl-3">
                  <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground/50 mt-5 shrink-0" />
                  <div className="flex-1">
                    <PortfolioCard portfolio={child} isDerived />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No portfolios yet</h3>
          <p className="text-muted-foreground mb-4">
            Create your first intent portfolio to start designing forms.
          </p>
          <Button asChild>
            <Link href="/portfolios/new">
              <Plus className="h-4 w-4 mr-2" />
              Create Portfolio
            </Link>
          </Button>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LineageNode {
  portfolio: Portfolio;
  children: Portfolio[];
}

/** Group portfolios into a tree: roots (no base_id) with their derived children nested underneath. */
function buildLineageTree(portfolios: Portfolio[]): LineageNode[] {
  const childrenByParent = new Map<string, Portfolio[]>();
  const childIds = new Set<string>();

  for (const p of portfolios) {
    if (p.base_id) {
      childIds.add(p.id);
      const siblings = childrenByParent.get(p.base_id) ?? [];
      siblings.push(p);
      childrenByParent.set(p.base_id, siblings);
    }
  }

  // Roots: portfolios that are not children of another portfolio in this list
  const roots = portfolios.filter((p) => !childIds.has(p.id));

  return roots.map((root) => ({
    portfolio: root,
    children: childrenByParent.get(root.id) ?? [],
  }));
}

function PortfolioCard({
  portfolio,
  isDerived,
}: {
  portfolio: Portfolio;
  isDerived?: boolean;
}) {
  const fieldCount = (portfolio.schema as unknown as PortfolioSchema).fields
    .length;

  return (
    <Link href={`/portfolios/${portfolio.id}`}>
      <Card className="p-5 hover:border-primary/40 card-hover-lift cursor-pointer">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold truncate">{portfolio.title}</h3>
          <Badge
            variant={
              portfolio.status === "published" ? "default" : "secondary"
            }
          >
            {portfolio.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {portfolio.intent.purpose.content || "No intent defined yet"}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3 w-3" />
          <span>
            {fieldCount} field{fieldCount !== 1 ? "s" : ""}
          </span>
          {isDerived && portfolio.projection && (
            <Badge variant="outline" className="text-[10px]">
              {portfolio.projection.type}
            </Badge>
          )}
        </div>
      </Card>
    </Link>
  );
}
