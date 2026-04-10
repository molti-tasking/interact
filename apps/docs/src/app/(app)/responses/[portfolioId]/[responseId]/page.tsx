"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useResponse, useUpdateResponse } from "@/hooks/query/responses-new";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { PortfolioSchema } from "@/lib/types";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";

export default function ResponseDetailPage() {
  const { portfolioId, responseId } = useParams<{
    portfolioId: string;
    responseId: string;
  }>();

  const { data: portfolio, isLoading: portfolioLoading } =
    usePortfolio(portfolioId);
  const { data: response, isLoading: responseLoading } =
    useResponse(responseId);
  const updateResponse = useUpdateResponse();

  const isLoading = portfolioLoading || responseLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!portfolio || !response) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold">Response not found</h2>
        <Button variant="link" asChild className="mt-2">
          <Link href={`/responses/${portfolioId}`}>Back to responses</Link>
        </Button>
      </div>
    );
  }

  const schema = portfolio.schema as unknown as PortfolioSchema;

  const handleSubmit = async (data: Record<string, unknown>) => {
    try {
      await updateResponse.mutateAsync({
        id: response.id,
        portfolioId: response.portfolioId,
        // TODO there may be a problem here about the updating of data that was inserted already before; we do not overwrite the pre-existing data
        data: { ...response, ...data },
      });
      toast.success("Response updated successfully");
    } catch {
      toast.error("Failed to update response");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/responses/${portfolioId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Response</h1>
          <p className="text-sm text-muted-foreground">
            Submitted {new Date(response.submittedAt).toLocaleString()}
          </p>
        </div>
      </div>

      <Card className="p-6">
        <FormRenderer
          schema={schema}
          mode="live"
          defaultValues={response.data}
          onSubmit={handleSubmit}
        />
      </Card>
    </div>
  );
}
