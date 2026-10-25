"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCapabilities } from "@/context/capabilities-context";
import { useStudy } from "@/context/study-context";
import { useDesignProbes, useSendFindingToDeck } from "@/hooks/query/design-probes";
import { useResponses } from "@/hooks/query/responses-new";
import { detectFindings } from "@/lib/engine/findings";
import { buildFieldStats, type FieldStats } from "@/lib/engine/response-stats";
import { FieldInsightsProvider, type FieldInsight } from "@/lib/form-renderer/field-insights";
import { ResponseValue } from "@/lib/form-renderer/ResponseValue";
import { formatValue, isEmptyValue, orphanKeys } from "@/lib/form-renderer/values";
import type { Field, FormResponse, Portfolio } from "@/lib/types";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GalleryHorizontal,
  Loader2,
  MessageSquareText,
  Table2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DesignView } from "./create-view";
import { useCoachTour } from "./use-coach-tour";

const NO_RESPONSES: FormResponse[] = [];

/**
 * Refine: the participant's own form in the same design workspace as in
 * Create, now with the answers it received. The answers feed the authoring
 * interaction itself — as a table or one respondent at a time, on the form
 * (hover a field to see its answers), and as design probes when they show a
 * pattern (an option nobody picks, a question everyone answers the same way).
 * There is no separate dashboard.
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
  const rows = responses.data ?? NO_RESPONSES;

  const stats = useMemo(
    () => buildFieldStats(portfolio.schema, rows),
    [portfolio.schema, rows],
  );
  useFindingsAsProbes(portfolio, rows, stats, responses.isSuccess);
  const insights = useMemo(
    () => answerInsights(portfolio.schema.fields, rows, stats),
    [portfolio.schema.fields, rows, stats],
  );

  useCoachTour({
    tour: "review",
    participantId: state.participant.id,
    ready: responses.isSuccess,
    replay: replayTour,
  });

  return (
    <div className="space-y-5 py-2">
      <RefineGuide count={rows.length} />
      {responses.isPending ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : responses.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the answers: {responses.error.message}
        </p>
      ) : (
        <AnswersPanel portfolio={portfolio} responses={rows} />
      )}
      <FieldInsightsProvider value={insights}>
        <DesignView portfolio={portfolio} />
      </FieldInsightsProvider>
    </div>
  );
}

/** What this phase is for, in three steps. */
function RefineGuide({ count }: { count: number }) {
  const steps = [
    {
      title: "Look at the answers",
      text: "As a table or one person at a time. Did you get what you wanted to know?",
    },
    {
      title: "Spot what to change",
      text: "Hover a question on your form to see its answers. Design questions marked “From responses” point at patterns in them.",
    },
    {
      title: "Improve the form",
      text: "Answer design questions, click a question to edit it, or update the intent. You don't have to answer every design question.",
    },
  ];
  return (
    <section aria-labelledby="refine-guide-heading" className="space-y-3" data-testid="refine-guide">
      <div className="space-y-1">
        <h1 id="refine-guide-heading" className="text-2xl tracking-tight">
          {count === 1 ? "1 person has" : `${count} people have`} answered your form
        </h1>
        <p className="text-muted-foreground">
          Now make the form better with what you learned from their answers.
        </p>
      </div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3 rounded-xl border bg-card p-3">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            >
              {i + 1}
            </span>
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Answers → design probes
// ---------------------------------------------------------------------------

/**
 * Patterns in the answers (options nobody picks, one answer everyone gives,
 * an optional question everyone skips) become design probes in the deck, so
 * the creator meets them where they author the form. Each finding is sent
 * once; a probe the creator skipped is not sent again.
 */
function useFindingsAsProbes(
  portfolio: Portfolio,
  rows: readonly FormResponse[],
  stats: ReadonlyMap<string, FieldStats>,
  loaded: boolean,
) {
  const { log } = useStudy()!;
  const { findingsThresholds } = useCapabilities();
  const { data: probes, isSuccess: probesLoaded } = useDesignProbes(portfolio.id);
  const { mutateAsync: send } = useSendFindingToDeck(portfolio.id);
  const sent = useRef(new Set<string>());
  const schema = portfolio.schema;

  const findings = useMemo(
    () =>
      rows.length >= findingsThresholds.minResponses
        ? detectFindings(schema, stats, findingsThresholds)
        : [],
    [rows.length, schema, stats, findingsThresholds],
  );

  useEffect(() => {
    if (!loaded || !probesLoaded) return;
    const fresh = findings.filter(
      (f) =>
        !sent.current.has(f.key) &&
        !(probes ?? []).some((p) => p.source === "data" && p.dimensionId === f.key),
    );
    if (fresh.length === 0) return;
    for (const f of fresh) sent.current.add(f.key);
    log("findings_to_deck", { keys: fresh.map((f) => f.key) });
    void (async () => {
      for (const finding of fresh) {
        try {
          await send({ finding, schema });
        } catch (err) {
          console.warn("[Refine] Couldn't add a probe from the answers:", err);
        }
      }
    })();
  }, [findings, probes, probesLoaded, loaded, schema, send, log]);
}

// ---------------------------------------------------------------------------
// Answers on the form (hover a field)
// ---------------------------------------------------------------------------

const MAX_TEXT_SAMPLES = 6;

function answerInsights(
  fields: readonly Field[],
  rows: readonly FormResponse[],
  stats: ReadonlyMap<string, FieldStats>,
): Record<string, FieldInsight> {
  if (rows.length === 0) return {};
  const result: Record<string, FieldInsight> = {};
  for (const field of fields) {
    const answered = rows.filter((r) => !isEmptyValue(r.data[field.name])).length;
    result[field.id] = {
      label: `${answered} ${answered === 1 ? "answer" : "answers"}`,
      share: answered / rows.length,
      content: (
        <FieldAnswers field={field} rows={rows} entry={stats.get(field.id)} answered={answered} />
      ),
    };
  }
  return result;
}

function FieldAnswers({
  field,
  rows,
  entry,
  answered,
}: {
  field: Field;
  rows: readonly FormResponse[];
  entry: FieldStats | undefined;
  answered: number;
}) {
  const skipped = rows.length - answered;
  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium text-foreground">
        {answered} of {rows.length} answered
        {skipped > 0 && <span className="font-normal text-muted-foreground"> · {skipped} left it empty</span>}
      </p>
      {entry?.kind === "category" ? (
        <ul className="space-y-1">
          {entry.stats.buckets.map((bucket) => (
            <li key={bucket.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
              <span className={bucket.count === 0 ? "truncate text-muted-foreground" : "truncate"}>
                {bucket.label}
                {!bucket.known && <span className="text-muted-foreground"> (not an option)</span>}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {bucket.count === 0 ? "nobody" : bucket.count}
              </span>
              <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-primary/60"
                  style={{ width: `${(bucket.count / Math.max(1, answered)) * 100}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : entry?.kind === "numeric" && entry.stats.count > 0 ? (
        <p className="text-muted-foreground">
          From {entry.stats.min} to {entry.stats.max}, median {entry.stats.median}
        </p>
      ) : (
        <TextSamples field={field} rows={rows} />
      )}
    </div>
  );
}

function TextSamples({ field, rows }: { field: Field; rows: readonly FormResponse[] }) {
  const values = rows
    .map((r) => r.data[field.name])
    .filter((v) => !isEmptyValue(v))
    .map((v) => formatValue(v, field));
  if (values.length === 0) return <p className="text-muted-foreground">No answers yet.</p>;
  const shown = values.slice(0, MAX_TEXT_SAMPLES);
  return (
    <ul className="space-y-1">
      {shown.map((text, i) => (
        <li key={i} className="line-clamp-2 border-l-2 border-muted pl-2">
          {text}
        </li>
      ))}
      {values.length > shown.length && (
        <li className="text-muted-foreground">+{values.length - shown.length} more in the table above</li>
      )}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Answers panel: table or one respondent at a time
// ---------------------------------------------------------------------------

type AnswersMode = "table" | "cards";

function AnswersPanel({
  portfolio,
  responses,
}: {
  portfolio: Portfolio;
  responses: readonly FormResponse[];
}) {
  const { log } = useStudy()!;
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<AnswersMode>("table");

  const ordered = useMemo(
    () => [...responses].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    [responses],
  );
  const count = ordered.length;

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
          <Tabs
            value={mode}
            onValueChange={(next) => {
              log("answers_mode", { mode: next });
              setMode(next as AnswersMode);
            }}
          >
            <TabsList aria-label="Show answers as">
              <TabsTrigger value="table" data-testid="answers-mode-table">
                <Table2 className="h-3.5 w-3.5" aria-hidden />
                Table
              </TabsTrigger>
              <TabsTrigger value="cards" data-testid="answers-mode-cards">
                <GalleryHorizontal className="h-3.5 w-3.5" aria-hidden />
                One by one
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {open && (
        <div id="answers-panel-body" className="border-t">
          {count === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">No answers yet.</p>
          ) : mode === "table" ? (
            <AnswersTable portfolio={portfolio} responses={ordered} />
          ) : (
            <AnswerCards portfolio={portfolio} responses={ordered} />
          )}
        </div>
      )}
    </Card>
  );
}

/** All answers at once: one row per respondent, one column per question. */
function AnswersTable({
  portfolio,
  responses,
}: {
  portfolio: Portfolio;
  responses: readonly FormResponse[];
}) {
  const fields = portfolio.schema.fields;
  return (
    <div className="max-h-[50vh] overflow-auto" data-testid="answers-table">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th scope="col" className="w-10 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              #
            </th>
            {fields.map((field) => (
              <th
                key={field.id}
                scope="col"
                className="min-w-40 max-w-72 px-3 py-2 text-left align-bottom text-xs font-medium"
              >
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {responses.map((response, i) => (
            <tr key={response.id} className="border-t align-top">
              <th scope="row" className="px-3 py-2 text-left text-xs font-normal tabular-nums text-muted-foreground">
                {i + 1}
              </th>
              {fields.map((field) => (
                <td key={field.id} className="max-w-72 break-words px-3 py-2">
                  <ResponseValue value={response.data[field.name]} field={field} emptyLabel="—" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One respondent's answers at a time, oldest first. */
function AnswerCards({
  portfolio,
  responses,
}: {
  portfolio: Portfolio;
  responses: readonly FormResponse[];
}) {
  const { log } = useStudy()!;
  const [index, setIndex] = useState(0);
  const count = responses.length;
  const position = Math.min(index, count - 1);
  const current = responses[position];

  // Dwell time per response
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId) return;
    const started = Date.now();
    log("response_viewed", { responseId: currentId, index: position });
    return () => {
      log("response_left", { responseId: currentId, dwellMs: Date.now() - started });
    };
  }, [currentId, position, log]);

  if (!current) return null;
  const fields = portfolio.schema.fields;
  const orphans = orphanKeys(current.data, portfolio.schema);

  return (
    <div className="space-y-3 px-4 py-4">
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
      <dl
        className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="answer-detail"
      >
        {fields.map((field) => (
          <div key={field.name} className="min-w-0 space-y-0.5">
            <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
            <dd className="break-words text-sm">
              <ResponseValue value={current.data[field.name]} field={field} emptyLabel="—" />
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
    </div>
  );
}
