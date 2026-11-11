"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePublishedForm, useSubmitResponse } from "@/hooks/query/public-form";
import {
  explainFieldAction,
  prefillFromTextAction,
} from "@/app/actions/respondent-assist-actions";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { FormAssist } from "@/lib/form-renderer/RespondentAssist";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import { useMemo } from "react";
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

  // AI help, only where the creator turned it on. The server checks the
  // stored form again — these flags just decide what is shown.
  const explainOn = portfolio?.schema.assist?.explain === true;
  const prefillOn = portfolio?.schema.assist?.prefill === true;
  const assist = useMemo<FormAssist | undefined>(() => {
    if (!explainOn && !prefillOn) return undefined;
    return {
      explain: explainOn
        ? async (fieldId) => {
            const res = await explainFieldAction(formId, fieldId);
            if (!res.success || !res.explanation) {
              throw new Error(res.error ?? "Couldn't explain this question.");
            }
            return res.explanation;
          }
        : undefined,
      prefill: prefillOn
        ? async (text) => {
            const res = await prefillFromTextAction(formId, text);
            if (!res.success || !res.result) {
              throw new Error(res.error ?? "Couldn't read the text.");
            }
            return res.result;
          }
        : undefined,
    };
  }, [formId, explainOn, prefillOn]);

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

        {portfolio.purpose && (
          <p
            data-testid="form-about"
            className="mx-auto max-w-xl whitespace-pre-line text-base leading-relaxed text-muted-foreground"
          >
            {portfolio.purpose}
          </p>
        )}

        <div className="flex items-center justify-center gap-2 pt-1">
          <Badge variant="secondary" className="text-xs">
            {fieldCount} field{fieldCount !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Form card */}
      <Card className="p-6 md:p-8">
        <FormRenderer
          schema={portfolioSchema}
          mode="live"
          onSubmit={handleSubmit}
          randomFill={randomFill}
          assist={assist}
        />
      </Card>
    </div>
  );
}
