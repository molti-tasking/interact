"use client";

import { PortfolioNav } from "@/components/portfolio-nav";
import { InlineEditableTitle } from "@/components/ui/inline-editable-title";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortfolio, useUpdatePortfolio } from "@/hooks/query/portfolios";
import { toast } from "sonner";

/**
 * Renamable portfolio title + section tabs. Shared by the /portfolios/[id]
 * layout and the responses pages (which live outside that segment).
 */
export function PortfolioHeader({ portfolioId }: { portfolioId: string }) {
  const { data: portfolio } = usePortfolio(portfolioId);
  const updatePortfolio = useUpdatePortfolio();

  return (
    <div className="space-y-3">
      {portfolio ? (
        <InlineEditableTitle
          value={portfolio.title}
          onSave={(title) =>
            updatePortfolio.mutate(
              { id: portfolio.id, title },
              {
                onError: (err) =>
                  toast.error(
                    err instanceof Error ? err.message : "Failed to rename",
                  ),
              },
            )
          }
        />
      ) : (
        <Skeleton className="h-8 w-64 max-w-full" />
      )}
      <PortfolioNav portfolioId={portfolioId} />
    </div>
  );
}
