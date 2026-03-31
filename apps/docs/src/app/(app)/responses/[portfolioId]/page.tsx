"use client";

import { Badge } from "@/components/ui/badge";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useResponses } from "@/hooks/query/responses-new";
import { useResponsesWithParent } from "@/hooks/query/responses-lineage";
import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { ResponsesDataTable } from "./_components/responses-data-table";

export default function ResponsesPage() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const { data: portfolio, isLoading: portfolioLoading } =
    usePortfolio(portfolioId);

  const isDerived = !!portfolio?.base_id;

  // Use lineage-aware hook for derived portfolios, plain hook otherwise
  const { data: ownResponses, isLoading: ownLoading } = useResponses(
    isDerived ? undefined : portfolioId,
  );
  const { data: lineageResponses, isLoading: lineageLoading } =
    useResponsesWithParent(isDerived ? portfolio : undefined);

  const responses = isDerived ? lineageResponses : ownResponses;
  const responsesLoading = isDerived ? lineageLoading : ownLoading;

  const parentCount = isDerived
    ? (lineageResponses ?? []).filter((r) => r.origin === "parent").length
    : 0;

  if (portfolioLoading || responsesLoading || !portfolio) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Responses: {portfolio.title}
        </h1>
        <div className="flex items-center gap-2">
          <p data-testid="response-count" className="text-muted-foreground">
            {responses?.length ?? 0} response
            {responses?.length !== 1 ? "s" : ""} collected.
          </p>
          {isDerived && parentCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {parentCount} from parent
            </Badge>
          )}
        </div>
      </div>

      <ResponsesDataTable portfolio={portfolio} responses={responses ?? []} />
    </div>
  );
}
