"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useStudy } from "@/context/study-context";
import { usePortfolio } from "@/hooks/query/portfolios";
import {
  useAdvanceStudyStep,
  useDeclineStudy,
  useMyQuestionnaire,
  useSubmitQuestionnaire,
} from "@/hooks/query/study";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import { BRIEFS } from "@/lib/study/briefs";
import {
  BRIEFS_INSTRUMENT,
  BRIEFS_QUESTIONNAIRE,
  buildQuiz,
  quizInstrument,
  type QuizAnswer,
  type QuizItem,
} from "@/lib/study/instruments";
import { seededShuffle, type StudyTask } from "@/lib/study/types";
import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BriefImage } from "./brief-image";

/** Seconds a situation stays on screen before "start" is offered */
const MIN_READ_SECONDS = 20;

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl space-y-6 py-6">{children}</div>;
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}

/** "Continue": moves this participant on from `step`. */
function useNext(step: string) {
  const { state } = useStudy()!;
  const advance = useAdvanceStudyStep(state.session.id);
  const next = () =>
    advance.mutate(
      { from: step },
      { onError: (err) => toast.error(err.message) },
    );
  return { next, pending: advance.isPending };
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export function ConsentView() {
  const { state } = useStudy()!;
  const { settings } = state.session;
  const { next, pending } = useNext("consent");
  const decline = useDeclineStudy(state.session.id);
  const [agreed, setAgreed] = useState(false);
  const { contact } = settings;
  const minutes = Math.round((settings.taskSeconds * state.tasks!.length) / 60) + 11;

  return (
    <Page>
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">Before you start</h1>
        <p className="text-muted-foreground">
          Please read this information and decide whether you want to take part.
        </p>
      </div>
      <Card className="space-y-4 p-6 text-sm leading-relaxed">
        <section className="space-y-1">
          <h2 className="font-medium">What the study is about</h2>
          <p>
            We study how people create online forms with the help of an AI tool.
            You will read two short situations and build a form for each of
            them, then answer a questionnaire. This takes about {minutes}{" "}
            minutes. You need a desktop or laptop computer.
          </p>
        </section>
        <section className="space-y-1">
          <h2 className="font-medium">What we record</h2>
          <p>
            The forms you build, what you type into the tool, what you click and
            when, and your questionnaire answers. We store your Prolific ID to
            pay you; it is kept apart from the study data and deleted when
            payment is settled. We do not ask for your name or contact details.
            Please do not type personal information about yourself or others
            into the tool.
          </p>
        </section>
        <section className="space-y-1">
          <h2 className="font-medium">How the data is used</h2>
          <p>
            What you type is sent to an AI language model to produce the form.
            The data is stored on servers in the European Union and analysed
            for research. Results are published without anything that
            identifies you; anonymised data may be shared with other
            researchers.
          </p>
        </section>
        <section className="space-y-1">
          <h2 className="font-medium">Your choice</h2>
          <p>
            Taking part is voluntary. You can stop at any time by closing this
            window and returning your submission on Prolific; data from an
            unfinished session is not analysed.
            {contact.email && (
              <>
                {" "}
                To have your data removed later, or with any question, write to{" "}
                {contact.name || "the research team"}
                {contact.institution && `, ${contact.institution}`} at{" "}
                <span className="font-medium">{contact.email}</span>.
              </>
            )}
          </p>
        </section>
        <div className="flex items-start gap-2 border-t pt-4">
          <Checkbox
            id="consent-agree"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
          />
          <Label htmlFor="consent-agree" className="font-normal leading-snug">
            I am 18 or older, I have read the information above, and I agree to
            take part.
          </Label>
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={next} disabled={!agreed || pending} data-testid="consent-continue">
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          I agree — continue
        </Button>
        <Button
          variant="ghost"
          disabled={pending || decline.isPending}
          onClick={() => decline.mutate(undefined, { onError: (err) => toast.error(err.message) })}
        >
          I don&apos;t want to take part
        </Button>
      </div>
    </Page>
  );
}

export function DeclinedView() {
  return (
    <Page>
      <Card className="space-y-2 p-6 text-center">
        <h1 className="text-xl tracking-tight">You chose not to take part</h1>
        <p className="text-sm text-muted-foreground">
          Nothing was recorded. Please return your submission on Prolific, then
          close this window.
        </p>
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Intro
// ---------------------------------------------------------------------------

export function IntroView() {
  const { state } = useStudy()!;
  const { next, pending } = useNext("intro");
  const count = state.tasks!.length;
  const minutes = Math.round(state.session.settings.taskSeconds / 60);

  return (
    <Page>
      <h1 className="text-3xl tracking-tight text-primary">How it works</h1>
      <Card className="p-6">
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
          <li>
            You read a short <span className="font-medium">situation</span>: someone needs an
            online form. It is shown as a picture, so you describe it to the tool
            in your own words.
          </li>
          <li>
            You <span className="font-medium">build the form</span> with the tool so that it
            collects what the people in the situation need. You have up to {minutes}{" "}
            minutes; finish earlier when you think the form is ready. You can look at the
            situation again at any time.
          </li>
          <li>You answer a few quick questions about the form you built.</li>
          <li>
            {count === 2 ? "Then the same again for a second situation" : `This repeats for ${count} situations`},
            followed by a short questionnaire.
          </li>
        </ol>
      </Card>
      <p className="text-sm text-muted-foreground">
        Please stay in this window and work on your own — without other tools.
        There are no trick questions; we are interested in how the tool works for
        you.
      </p>
      <Button onClick={next} disabled={pending} data-testid="intro-continue">
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Show the first situation
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

export function BriefView({ task, total }: { task: StudyTask; total: number }) {
  const { log } = useStudy()!;
  const step = `brief:${task.position}`;
  const { next, pending } = useNext(step);
  const shownAt = useRef(0);
  const [wait, setWait] = useState(MIN_READ_SECONDS);

  useEffect(() => {
    shownAt.current = Date.now();
    const timer = setInterval(() => setWait((s) => Math.max(0, s - 1)), 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 py-6">
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">
          Situation {task.position} of {total}
        </h1>
        <p className="text-muted-foreground">
          Read it carefully. Next, you build the form these people need. You can
          open the situation again while you work.
        </p>
      </div>
      <BriefImage briefKey={task.brief} />
      <div className="flex items-center gap-3">
        <Button
          disabled={wait > 0 || pending}
          data-testid="brief-continue"
          onClick={() => {
            log("brief_read", { brief: task.brief, ms: Date.now() - shownAt.current });
            next();
          }}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Start building the form
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
        {wait > 0 && (
          <span className="text-sm text-muted-foreground" role="status">
            Take your time to read ({wait} s)
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz: what does your form ask for?
// ---------------------------------------------------------------------------

const QUIZ_OPTIONS: { value: QuizAnswer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

export function QuizView({ task }: { task: StudyTask }) {
  const { state, log } = useStudy()!;
  const { session, participant } = state;
  const step = `quiz:${task.position}`;
  const instrument = quizInstrument(task.position);
  const advance = useAdvanceStudyStep(session.id);
  const existing = useMyQuestionnaire(participant.id, instrument);
  const submit = useSubmitQuestionnaire();
  const portfolio = usePortfolio(task.portfolio_id ?? undefined);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const openedAt = useRef(0);

  // The quiz is about the form as the task left it: load it afresh (an edit
  // may have landed in the task's last second, after the cached copy), then
  // keep the items fixed so answers can't be orphaned by a later refetch.
  const { refetch } = portfolio;
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const fields =
    portfolio.isFetchedAfterMount && !portfolio.isFetching
      ? portfolio.data?.schema.fields
      : undefined;
  const [items, setItems] = useState<QuizItem[] | null>(null);
  if (!items && fields) {
    // adjusting state while rendering
    setItems(
      buildQuiz(
        fields.map((f) => ({ id: f.id, label: f.label })),
        BRIEFS[task.brief]?.foils ?? [],
        `${participant.id}:${task.position}`,
        seededShuffle,
      ),
    );
  }

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  // Answered already (reload after submitting), or nothing to ask: move on
  const skip = existing.isSuccess && (!!existing.data || items?.length === 0);
  const { mutate: advanceStep } = advance;
  useEffect(() => {
    if (skip) advanceStep({ from: step });
  }, [skip, advanceStep, step]);

  if (existing.isLoading || !items || skip) return <Spinner />;

  const complete = items.every((item) => answers[item.id]);
  const busy = submit.isPending || advance.isPending;

  const handleSubmit = async () => {
    try {
      await submit.mutateAsync({
        sessionId: session.id,
        participantId: participant.id,
        instrument,
        answers: { brief: task.brief, items, answers, ms: Date.now() - openedAt.current },
      });
      log("quiz_submitted", { position: task.position, items: items.length });
      await advance.mutateAsync({ from: step });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your answers");
    }
  };

  return (
    <Page>
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">About the form you just built</h1>
        <p className="text-muted-foreground">
          From memory: does your form ask for each of these? The form is hidden
          on purpose.
        </p>
      </div>
      <Card className="divide-y p-0">
        {items.map((item) => (
          <fieldset
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <legend className="float-left text-sm">{item.label}</legend>
            <div className="flex gap-1" role="radiogroup" aria-label={item.label}>
              {QUIZ_OPTIONS.map((option) => {
                const selected = answers[item.id] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: option.value }))}
                    className={
                      selected
                        ? "rounded-md border border-primary bg-primary/10 px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "rounded-md border bg-background px-3 py-1 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </Card>
      <Button onClick={() => void handleSubmit()} disabled={!complete || busy} data-testid="quiz-continue">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Continue
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Final questionnaire
// ---------------------------------------------------------------------------

export function FinalQuestionnaireView() {
  const { state, log } = useStudy()!;
  const { session, participant } = state;
  const advance = useAdvanceStudyStep(session.id);
  const existing = useMyQuestionnaire(participant.id, BRIEFS_INSTRUMENT);
  const submit = useSubmitQuestionnaire();
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const submitted = !!existing.data;
  const { mutate: advanceStep } = advance;
  useEffect(() => {
    if (submitted) advanceStep({ from: "questionnaire" });
  }, [submitted, advanceStep]);

  if (existing.isLoading || submitted) return <Spinner />;

  return (
    <Page>
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">Almost done</h1>
        <p className="text-muted-foreground">
          A few questions about the tool. There are no right or wrong answers.
        </p>
      </div>
      <Card className="p-6 md:p-8">
        <FormRenderer
          schema={BRIEFS_QUESTIONNAIRE}
          mode="live"
          randomFill={false}
          onSubmit={async (answers) => {
            try {
              await submit.mutateAsync({
                sessionId: session.id,
                participantId: participant.id,
                instrument: BRIEFS_INSTRUMENT,
                answers,
              });
              log("questionnaire_submitted", {
                instrument: BRIEFS_INSTRUMENT,
                ms: Date.now() - openedAt.current,
              });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save your answers");
              throw err;
            }
          }}
        />
      </Card>
    </Page>
  );
}
