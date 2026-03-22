"use client";

import { usePortfolio } from "@/hooks/query/portfolios";
import { useResponses } from "@/hooks/query/responses-new";
import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { ResponsesDataTable } from "./_components/responses-data-table";

export default function ResponsesPage() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const { data: portfolio, isLoading: portfolioLoading } =
    usePortfolio(portfolioId);
  const { data: responses, isLoading: responsesLoading } =
    useResponses(portfolioId);

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
        <p className="text-muted-foreground">
          {responses?.length ?? 0} response
          {responses?.length !== 1 ? "s" : ""} collected.
        </p>
      </div>

      <ResponsesDataTable
        portfolio={portfolio}
        responses={responses ?? []}
      />
    </div>
  );
}
