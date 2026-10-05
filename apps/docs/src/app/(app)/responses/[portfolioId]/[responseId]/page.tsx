"use client";

import { PortfolioHeader } from "@/components/portfolio-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useResponse, useUpdateResponse } from "@/hooks/query/responses-new";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import { ResponseValue } from "@/lib/form-renderer/ResponseValue";
import { mergeEditedResponse, orphanKeys } from "@/lib/form-renderer/values";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { QueryError } from "../_components/query-error";

export default function ResponseDetailPage() {
  const { portfolioId, responseId } = useParams<{
    portfolioId: string;
    responseId: string;
  }>();

  return (
    <div className="space-y-6">
      <PortfolioHeader portfolioId={portfolioId} />
      <ResponseDetail portfolioId={portfolioId} responseId={responseId} />
    </div>
  );
}

function BackLink({ portfolioId }: { portfolioId: string }) {
  return (
    <Button variant="link" asChild className="mt-2">
      <Link href={`/responses/${portfolioId}`}>Back to responses</Link>
    </Button>
  );
}

function ResponseDetail({
  portfolioId,
  responseId,
}: {
  portfolioId: string;
  responseId: string;
}) {
  const responseQuery = useResponse(responseId);
  const response = responseQuery.data;

  // Rows shown in a derived table may belong to the parent form; edit them
  // with the form they were submitted to so no parent data is dropped.
  const ownerId = response?.portfolioId ?? portfolioId;
  const portfolioQuery = usePortfolio(ownerId);
  const portfolio = portfolioQuery.data;
  const isFromOtherForm = !!response && response.portfolioId !== portfolioId;

  const updateResponse = useUpdateResponse();

  if (responseQuery.isLoading || portfolioQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2
          className="h-8 w-8 animate-spin text-muted-foreground"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (responseQuery.isError || portfolioQuery.isError) {
    const failed = responseQuery.isError ? responseQuery : portfolioQuery;
    return (
      <QueryError
        title={
          responseQuery.isError
            ? "Couldn't load this response"
            : "Couldn't load the form"
        }
        error={failed.error}
        onRetry={() => failed.refetch()}
      >
        <BackLink portfolioId={portfolioId} />
      </QueryError>
    );
  }

  if (!portfolio || !response) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold">Response not found</h2>
        <BackLink portfolioId={portfolioId} />
      </div>
    );
  }

  const schema = portfolio.schema;
  const orphans = orphanKeys(response.data, schema);

  const handleSubmit = async (data: Record<string, unknown>) => {
    try {
      const updated = await updateResponse.mutateAsync({
        id: response.id,
        portfolioId: response.portfolioId,
        // Replace the form's fields, keep data the form doesn't show
        data: mergeEditedResponse(response.data, data, schema),
      });
      toast.success("Response updated successfully");
      return updated.data;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Failed to update response: ${err.message}`
          : "Failed to update response",
      );
      throw err;
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/responses/${portfolioId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" aria-hidden />
            Back
          </Link>
        </Button>
        <div>
          <h2 className="text-xl tracking-tight">Edit response</h2>
          <p className="text-sm text-muted-foreground">
            Submitted {new Date(response.submittedAt).toLocaleString()}
          </p>
        </div>
      </div>

      {isFromOtherForm && (
        <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
          This response was submitted to &ldquo;{portfolio.title}&rdquo; and is
          edited with that form.
        </p>
      )}

      <Card className="p-6">
        <FormRenderer
          schema={schema}
          mode="live"
          defaultValues={response.data}
          onSubmit={handleSubmit}
        />
      </Card>

      {orphans.length > 0 && (
        <Card className="p-6 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Other data</h2>
            <p className="text-xs text-muted-foreground">
              Stored on this response under names the current form doesn&apos;t
              use (for example renamed or removed fields). It is kept when you
              save.
            </p>
          </div>
          <dl className="space-y-2">
            {orphans.map((key) => (
              <div key={key} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 text-sm">
                <dt className="truncate font-mono text-xs text-muted-foreground">
                  {key}
                </dt>
                <dd>
                  <ResponseValue value={response.data[key]} />
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}
