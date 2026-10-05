"use client";

import { PortfolioHeader } from "@/components/portfolio-header";
import { Badge } from "@/components/ui/badge";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useResponses } from "@/hooks/query/responses-new";
import { useResponsesWithParent } from "@/hooks/query/responses-lineage";
import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { QueryError } from "./_components/query-error";
import { ResponsesDataTable } from "./_components/responses-data-table";

function Spinner() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <Loader2
        className="h-8 w-8 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    </div>
  );
}

export default function ResponsesPage() {
  const { portfolioId } = useParams<{ portfolioId: string }>();

  return (
    <div className="space-y-6">
      <PortfolioHeader portfolioId={portfolioId} />
      <ResponsesContent portfolioId={portfolioId} />
    </div>
  );
}

function ResponsesContent({ portfolioId }: { portfolioId: string }) {
  const portfolioQuery = usePortfolio(portfolioId);
  const portfolio = portfolioQuery.data;
  const isDerived = !!portfolio?.base_id;

  // Lineage-aware hook for derived portfolios, plain hook otherwise
  const ownQuery = useResponses(
    portfolio && !isDerived ? portfolioId : undefined,
  );
  const lineageQuery = useResponsesWithParent(
    isDerived ? portfolio : undefined,
  );
  const responsesQuery = isDerived ? lineageQuery : ownQuery;

  if (portfolioQuery.isLoading) return <Spinner />;
  if (portfolioQuery.isError) {
    return (
      <QueryError
        title="Couldn't load this form"
        error={portfolioQuery.error}
        onRetry={() => portfolioQuery.refetch()}
      />
    );
  }
  if (!portfolio) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold">Form not found</h2>
      </div>
    );
  }
  if (responsesQuery.isError) {
    return (
      <QueryError
        title="Couldn't load the responses"
        error={responsesQuery.error}
        onRetry={() => responsesQuery.refetch()}
      />
    );
  }
  if (responsesQuery.isPending) return <Spinner />;

  const responses = responsesQuery.data ?? [];
  const parentCount = isDerived
    ? lineageQuery.data?.filter((r) => r.origin === "parent").length ?? 0
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl tracking-tight">Responses</h2>
        <div className="flex items-center gap-2">
          <p data-testid="response-count" className="text-muted-foreground">
            {responses.length} response
            {responses.length !== 1 ? "s" : ""} collected.
          </p>
          {isDerived && parentCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {parentCount} from parent
            </Badge>
          )}
        </div>
      </div>

      <ResponsesDataTable portfolio={portfolio} responses={responses} />
    </div>
  );
}
