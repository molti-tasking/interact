"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { usePublishedForm, useSubmitResponse } from "@/hooks/query/public-form";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import { AlertTriangle, FileText, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PublishedFormViewProps {
  formId: string;
  /** After a successful submission (the response id) */
  onSubmitted?: (responseId: string) => void;
  /** Offer the "Random" fill button (off for workshop respondents) */
  randomFill?: boolean;
  /** Shown when the form can't be loaded or doesn't accept responses */
  notFoundMessage?: string;
}

/**
 * A form as respondents see it: loads it via `get_published_form` and
 * submits via `submit_response`. Used by the public `/forms/<id>` page and
 * by workshop participants answering their peers' forms.
 */
export function PublishedFormView({
  formId,
  onSubmitted,
  randomFill = true,
  notFoundMessage = "This form doesn't exist or isn't accepting responses.",
}: PublishedFormViewProps) {
  const { data: portfolio, isLoading, isError, error, refetch } =
    usePublishedForm(formId);
  const submitResponse = useSubmitResponse();

  const handleSubmit = async (data: Record<string, unknown>) => {
    if (!portfolio) throw new Error("Form not loaded");

    try {
      // Uploads file values first, then submits (see useSubmitResponse)
      const id = await submitResponse.mutateAsync({
        portfolioId: portfolio.id,
        data,
      });
      toast.success("Response submitted successfully!");
      onSubmitted?.(id);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Failed to submit response: ${err.message}`
          : "Failed to submit response",
      );
      throw err; // FormRenderer keeps the answers
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2
          className="h-8 w-8 animate-spin text-muted-foreground"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="text-center py-12">
        <AlertTriangle
          className="mx-auto mb-3 h-8 w-8 text-destructive"
          aria-hidden
        />
        <h2 className="text-lg font-semibold">Couldn&apos;t load this form</h2>
        {error instanceof Error && (
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold">Form not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">{notFoundMessage}</p>
      </div>
    );
  }

  const portfolioSchema = portfolio.schema;
  const fieldCount = portfolioSchema.fields.length;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Hero header */}
      <div className="text-center space-y-3 mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-2">
          <FileText className="h-7 w-7 text-primary" aria-hidden />
        </div>
        <h1 className="text-3xl tracking-tight">{portfolio.title}</h1>

        <div className="flex items-center justify-center gap-2 pt-1">
          <Badge variant="secondary" className="text-xs">
            {fieldCount} field{fieldCount !== 1 ? "s" : ""}
          </Badge>
          {portfolio.purpose && (
            <Dialog>
              <DialogTrigger asChild>
                <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  <Info className="h-3 w-3" aria-hidden />
                  About
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>About this form</DialogTitle>
                  <DialogDescription>
                    {portfolio.purpose}
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Form card */}
      <Card className="p-6 md:p-8">
        <FormRenderer
          schema={portfolioSchema}
          mode="live"
          onSubmit={handleSubmit}
          randomFill={randomFill}
        />
      </Card>
    </div>
  );
}
