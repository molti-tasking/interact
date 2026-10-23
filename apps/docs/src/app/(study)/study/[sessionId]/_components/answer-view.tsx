"use client";

import { PublishedFormView } from "@/components/form/PublishedFormView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useStudy } from "@/context/study-context";
import {
  useInvalidateStudyForms,
  useStudyForms,
  type StudyFormCard,
} from "@/hooks/query/study";
import { seededShuffle } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

/** Wall clock for answer durations (event handlers only). */
const clock = () => Date.now();

/**
 * Answer every peer form. The order is shuffled per participant (stable
 * across reloads) so the same forms don't always get the freshest — or the
 * most tired — respondents.
 */
export function AnswerView() {
  const { state, log } = useStudy()!;
  const { session, participant } = state;
  const forms = useStudyForms(session.id);
  const invalidateForms = useInvalidateStudyForms();
  const [openId, setOpenId] = useState<string | null>(null);
  const openedAt = useRef(0);

  const ordered = useMemo(
    () => seededShuffle(forms.data ?? [], participant.id),
    [forms.data, participant.id],
  );
  const answered = ordered.filter((f) => f.answeredByMe).length;

  const open = (form: StudyFormCard) => {
    openedAt.current = clock();
    log("peer_form_opened", { owner: form.ownerName }, form.portfolioId);
    setOpenId(form.portfolioId);
    window.scrollTo({ top: 0 });
  };

  const close = (submitted: boolean) => {
    if (!openId) return;
    if (!submitted) {
      log("peer_form_left", { ms: clock() - openedAt.current }, openId);
    }
    setOpenId(null);
  };

  if (openId) {
    return (
      <div className="space-y-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => close(false)}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All forms
        </Button>
        <PublishedFormView
          formId={openId}
          randomFill={false}
          notFoundMessage="This form isn't open for answers right now."
          onSubmitted={() => {
            log(
              "peer_form_submitted",
              { ms: clock() - openedAt.current },
              openId,
            );
            invalidateForms(session.id);
            close(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl tracking-tight">Answer the others&apos; forms</h1>
          <p className="text-muted-foreground">
            Answer as yourself, as honestly as you can. Each form can be sent
            once.
          </p>
        </div>
        <p className="text-sm font-medium tabular-nums" aria-live="polite">
          {answered} of {ordered.length} answered
        </p>
      </div>

      {forms.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : forms.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the forms: {forms.error.message}
        </p>
      ) : ordered.length === 0 ? (
        <p className="text-muted-foreground">Nobody else has joined yet.</p>
      ) : (
        <>
          {answered === ordered.length && (
            <Card className="border-primary/30 bg-primary/5 p-4 text-sm">
              You&apos;ve answered every form — thank you! Wait for the
              facilitator to start the next phase.
            </Card>
          )}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((form) => {
              const empty = form.fieldCount === 0;
              return (
                <li key={form.portfolioId}>
                  <button
                    type="button"
                    onClick={() => open(form)}
                    disabled={form.answeredByMe || empty}
                    data-testid="peer-form-card"
                    className={cn(
                      "flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors",
                      "hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:cursor-default disabled:hover:border-border disabled:hover:bg-card",
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-medium leading-snug">{form.title}</span>
                      {form.answeredByMe ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-label="Answered" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" aria-hidden />
                      )}
                    </span>
                    <span className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
                      by {form.ownerName}
                      <Badge variant="secondary" className="text-[10px]">
                        {empty
                          ? "No questions yet"
                          : `${form.fieldCount} question${form.fieldCount === 1 ? "" : "s"}`}
                      </Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
