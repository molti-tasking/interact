"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useStudy } from "@/context/study-context";
import { useResponses } from "@/hooks/query/responses-new";
import { ResponseValue } from "@/lib/form-renderer/ResponseValue";
import { orphanKeys } from "@/lib/form-renderer/values";
import type { FormResponse, Portfolio } from "@/lib/types";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquareText,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DesignView } from "./create-view";
import { useCoachTour } from "./use-coach-tour";

/**
 * Refine: the participant's own form in the same design workspace as in
 * Create, with the answers it received as plain, read-only responses — one
 * respondent at a time. Nothing interprets the answers (no dashboard, no
 * answer-based suggestions): what to change, and how, is up to the creator.
 */
export function RefineView({
  portfolio,
  replayTour,
}: {
  portfolio: Portfolio;
  replayTour: number;
}) {
  const { state } = useStudy()!;
  // Late answers (grace window) still arrive at the start of the phase
  const responses = useResponses(portfolio.id, { refetchInterval: 10_000 });

  useCoachTour({
    tour: "review",
    participantId: state.participant.id,
    ready: responses.isSuccess,
    replay: replayTour,
  });

  return (
    <div className="space-y-5 py-2">
      {responses.isPending ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : responses.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the answers: {responses.error.message}
        </p>
      ) : (
        <AnswersPanel portfolio={portfolio} responses={responses.data} />
      )}
      <DesignView portfolio={portfolio} />
    </div>
  );
}

/** One respondent's answers at a time, oldest first, read-only. */
function AnswersPanel({
  portfolio,
  responses,
}: {
  portfolio: Portfolio;
  responses: FormResponse[];
}) {
  const { log } = useStudy()!;
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);

  const ordered = useMemo(
    () =>
      [...responses].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    [responses],
  );
  const count = ordered.length;
  const current = ordered[Math.min(index, Math.max(count - 1, 0))];
  const position = current ? ordered.indexOf(current) : -1;

  // Dwell time per response while the panel is open
  const currentId = open ? current?.id : undefined;
  useEffect(() => {
    if (!currentId) return;
    const started = Date.now();
    log("response_viewed", { responseId: currentId, index: position });
    return () => {
      log("response_left", {
        responseId: currentId,
        dwellMs: Date.now() - started,
      });
    };
  }, [currentId, position, log]);

  const fields = portfolio.schema.fields;
  const orphans = current ? orphanKeys(current.data, portfolio.schema) : [];

  return (
    <Card className="gap-0 p-0" data-testid="answers-panel" data-tour="answers-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          className="flex items-center gap-2 rounded-sm text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls="answers-panel-body"
          onClick={() => {
            log("answers_panel", { open: !open });
            setOpen(!open);
          }}
        >
          <MessageSquareText className="h-4 w-4 text-muted-foreground" aria-hidden />
          Answers to your form ({count})
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
        </button>
        {open && count > 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous answer"
              disabled={position <= 0}
              onClick={() => setIndex(position - 1)}
              data-testid="answers-prev"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-28 text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">
              Answer {position + 1} of {count}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next answer"
              disabled={position >= count - 1}
              onClick={() => setIndex(position + 1)}
              data-testid="answers-next"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div id="answers-panel-body" className="border-t px-4 py-4">
          {!current ? (
            <p className="text-sm text-muted-foreground">No answers yet.</p>
          ) : (
            <dl
              className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3"
              data-testid="answer-detail"
            >
              {fields.map((field) => (
                <div key={field.name} className="min-w-0 space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
                  <dd className="break-words text-sm">
                    <ResponseValue
                      value={current.data[field.name]}
                      field={field}
                      emptyLabel="—"
                    />
                  </dd>
                </div>
              ))}
              {orphans.map((key) => (
                <div key={key} className="min-w-0 space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {key} <span className="font-normal">(no longer in the form)</span>
                  </dt>
                  <dd className="break-words text-sm">
                    <ResponseValue value={current.data[key]} emptyLabel="—" />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </Card>
  );
}
