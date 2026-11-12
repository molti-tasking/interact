"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStudy } from "@/context/study-context";
import { usePortfolio } from "@/hooks/query/portfolios";
import {
  useAdvanceStudyStep,
  useMyQuestionnaire,
  useSubmitQuestionnaire,
} from "@/hooks/query/study";
import {
  RATING_ITEMS,
  RECALL_SOFT_LIMIT_SECONDS,
  ratingsInstrument,
  recallInstrument,
  recallLines,
  whyInstrument,
  type RatingName,
} from "@/lib/study/instruments";
import { seededShuffle, type StudyTask } from "@/lib/study/types";
import { chooseWhyFields, type WhyItem } from "@/lib/study/why-fields";
import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Page, Spinner } from "./steps";

/**
 * The measures after a task (sessions with post-task measures), with the
 * form hidden: self-ratings → free recall → "why" items, then the quiz.
 * Each is stored as a questionnaire response of its own (`ratings:n`,
 * `recall:n`, `why:n`) with the time it was on screen; the server's step
 * events time them too.
 */

/** Submit `answers` under `instrument`, then move on from `step`. */
function useSubmitStep(step: string, instrument: string) {
  const { state, log } = useStudy()!;
  const { session, participant } = state;
  const advance = useAdvanceStudyStep(session.id);
  const existing = useMyQuestionnaire(participant.id, instrument);
  const submit = useSubmitQuestionnaire();
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  // Answered already (a reload after submitting): move on
  const done = existing.isSuccess && !!existing.data;
  const { mutate: advanceStep } = advance;
  useEffect(() => {
    if (done) advanceStep({ from: step });
  }, [done, advanceStep, step]);

  const send = async (answers: Record<string, unknown>) => {
    const ms = Date.now() - openedAt.current;
    try {
      await submit.mutateAsync({
        sessionId: session.id,
        participantId: participant.id,
        instrument,
        answers: { ...answers, ms },
      });
      log(`${instrument.split(":")[0]}_submitted`, { instrument, ms });
      await advance.mutateAsync({ from: step });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your answers");
    }
  };

  return {
    loading: existing.isLoading || done,
    busy: submit.isPending || advance.isPending,
    send,
    skip: () => advanceStep({ from: step }),
    openedAt,
  };
}

function ContinueButton({
  disabled,
  busy,
  onClick,
  testId,
}: {
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Button onClick={onClick} disabled={disabled || busy} data-testid={testId}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      Continue
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Self-ratings
// ---------------------------------------------------------------------------

const POINTS = [1, 2, 3, 4, 5, 6, 7];

export function RatingsView({ task }: { task: StudyTask }) {
  const step = `ratings:${task.position}`;
  const { loading, busy, send } = useSubmitStep(step, ratingsInstrument(task.position));
  const [values, setValues] = useState<Partial<Record<RatingName, number>>>({});

  if (loading) return <Spinner />;
  const complete = RATING_ITEMS.every((item) => values[item.name] !== undefined);

  return (
    <Page>
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">Your form</h1>
        <p className="text-muted-foreground">
          The form is hidden now. Two quick questions about the form you just built.
        </p>
      </div>
      <Card className="space-y-6 p-6">
        {RATING_ITEMS.map((item) => (
          <fieldset key={item.name} className="space-y-2" data-testid={`rating-${item.name}`}>
            <legend className="text-sm font-medium">{item.label}</legend>
            <div className="flex gap-1" role="radiogroup" aria-label={item.label}>
              {POINTS.map((point) => {
                const selected = values[item.name] === point;
                return (
                  <button
                    key={point}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${point}${point === 1 ? ` (${item.low})` : point === 7 ? ` (${item.high})` : ""}`}
                    onClick={() => setValues((prev) => ({ ...prev, [item.name]: point }))}
                    className={
                      selected
                        ? "h-10 flex-1 rounded-md border border-primary bg-primary/10 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "h-10 flex-1 rounded-md border bg-background text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    }
                  >
                    {point}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 = {item.low}</span>
              <span>7 = {item.high}</span>
            </div>
          </fieldset>
        ))}
      </Card>
      <ContinueButton
        disabled={!complete}
        busy={busy}
        testId="ratings-continue"
        onClick={() => void send({ brief: task.brief, ...values })}
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Free recall
// ---------------------------------------------------------------------------

export function RecallView({ task }: { task: StudyTask }) {
  const { log } = useStudy()!;
  const step = `recall:${task.position}`;
  const { loading, busy, send } = useSubmitStep(step, recallInstrument(task.position));
  const [text, setText] = useState("");
  const [overTime, setOverTime] = useState(false);

  // A gentle notice after the soft limit; nothing is cut off
  useEffect(() => {
    const timer = setTimeout(() => {
      setOverTime(true);
      log("recall_soft_limit", { position: task.position });
    }, RECALL_SOFT_LIMIT_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [log, task.position]);

  if (loading) return <Spinner />;
  const lines = recallLines(text);

  return (
    <Page>
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">What your form asks</h1>
        <p className="text-muted-foreground">
          From memory: list everything your form asks, one per line. The form stays hidden.
        </p>
      </div>
      <Card className="space-y-2 p-6">
        <Label htmlFor="recall-lines">List everything your form asks, one per line.</Label>
        <Textarea
          id="recall-lines"
          data-testid="recall-input"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="bg-background"
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {lines.length === 0 ? "At least one line." : `${lines.length} line${lines.length === 1 ? "" : "s"}`}
        </p>
      </Card>
      {overTime && (
        <p role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          You have spent about three minutes here. Add anything else that comes
          to mind, then continue.
        </p>
      )}
      <ContinueButton
        disabled={lines.length === 0}
        busy={busy}
        testId="recall-continue"
        onClick={() => void send({ brief: task.brief, lines, softLimitShown: overTime })}
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Why does your form ask this?
// ---------------------------------------------------------------------------

export function WhyView({ task }: { task: StudyTask }) {
  const { state } = useStudy()!;
  const step = `why:${task.position}`;
  const { loading, busy, send, skip } = useSubmitStep(step, whyInstrument(task.position));
  const portfolio = usePortfolio(task.portfolio_id ?? undefined);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // The form as the task left it: load it afresh, then keep the items fixed
  const { refetch } = portfolio;
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const fields =
    portfolio.isFetchedAfterMount && !portfolio.isFetching
      ? portfolio.data?.schema.fields
      : undefined;
  const [items, setItems] = useState<WhyItem[] | null>(null);
  if (!items && fields) {
    // adjusting state while rendering
    setItems(
      chooseWhyFields(fields, {
        seed: `${state.participant.id}:${task.position}`,
        shuffle: seededShuffle,
      }),
    );
  }

  // Nothing to ask about (a task that timed out with an empty form)
  const empty = !loading && items?.length === 0;
  useEffect(() => {
    if (empty) skip();
    // `skip` is stable enough: it advances from this step once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty]);

  if (loading || !items || empty) return <Spinner />;
  const complete = items.every((item) => answers[item.fieldId]?.trim());

  return (
    <Page>
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">Why your form asks this</h1>
        <p className="text-muted-foreground">
          These are questions from your form. For each, say in a sentence or
          two why your form asks it.
        </p>
      </div>
      <Card className="divide-y p-0">
        {items.map((item, i) => (
          <div key={item.fieldId} className="space-y-2 px-5 py-4" data-testid="why-item">
            <p className="text-sm font-medium">“{item.label}”</p>
            <Label htmlFor={`why-${i}`} className="font-normal text-muted-foreground">
              Why does your form ask this?
            </Label>
            <Textarea
              id={`why-${i}`}
              rows={2}
              value={answers[item.fieldId] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [item.fieldId]: e.target.value }))}
              className="bg-background"
            />
          </div>
        ))}
      </Card>
      <ContinueButton
        disabled={!complete}
        busy={busy}
        testId="why-continue"
        onClick={() =>
          void send({
            brief: task.brief,
            items: items.map((item) => ({ ...item, answer: answers[item.fieldId].trim() })),
          })
        }
      />
    </Page>
  );
}
