"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useStudyLog } from "@/context/study-context";
import {
  useDesignProbes,
  useSendPretestIssueToDeck,
} from "@/hooks/query/design-probes";
import { useRunPretest } from "@/hooks/query/pretest";
import type { PretestIssue } from "interact/forms/pretest";
import type { Portfolio } from "@/lib/types";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

const RESPONDENTS = 12;

/** Where an issue stands in the question deck. */
function deckStatus(
  probes: ReturnType<typeof useDesignProbes>["data"],
  key: string,
): "open" | "answered" | null {
  const matching = (probes ?? []).filter(
    (p) => p.source === "pretest" && p.dimensionId === key,
  );
  if (matching.some((p) => p.status === "pending" || p.status === "loading")) return "open";
  if (matching.some((p) => p.status === "resolved")) return "answered";
  return null;
}

/**
 * Pretest the draft with simulated respondents: a model plays a varied set
 * of people filling in the form; where they got stuck is listed here and
 * can be sent to the question deck. Nothing is saved as a response.
 */
export function PretestDialog({ portfolio }: { portfolio: Portfolio }) {
  const pretest = useRunPretest(portfolio.id);
  const send = useSendPretestIssueToDeck(portfolio.id);
  const { data: probes } = useDesignProbes(portfolio.id);
  const log = useStudyLog();

  const result = pretest.data;
  const stale = !!result && result.schemaVersion !== portfolio.schema.version;

  const run = () =>
    pretest.mutate(
      { intent: portfolio.intent, schema: portfolio.schema, count: RESPONDENTS },
      {
        onSuccess: (r) =>
          log("pretest_run", {
            respondents: r.respondents,
            issues: r.issues.map((i) => i.key),
          }),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "The pretest failed"),
      },
    );

  const sendToDeck = (issue: PretestIssue) => {
    log("pretest_issue_sent", { key: issue.key, text: issue.text });
    send.mutate(issue, {
      onSuccess: ({ alreadyOpen }) =>
        toast.success(alreadyOpen ? "Already in your questions" : "Added to your questions", {
          description: issue.probe.text,
        }),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Couldn't add the question"),
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="pretest-open"
          className="text-muted-foreground h-7 text-xs"
          title="Try the form on simulated respondents before real people see it"
        >
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          Pretest
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Pretest
            <Badge variant="secondary">Simulated respondents</Badge>
          </DialogTitle>
          <DialogDescription>
            An AI model plays {RESPONDENTS} different people filling in your
            draft and notes where they get stuck. These are made-up
            respondents, not real answers — nothing is saved to your
            responses. Use it to spot problems early, not as evidence of what
            people think.
          </DialogDescription>
        </DialogHeader>

        {pretest.isPending ? (
          <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {RESPONDENTS} simulated respondents are filling in the form…
          </p>
        ) : result ? (
          <div data-testid="pretest-result" className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {result.respondents} simulated respondent
              {result.respondents === 1 ? "" : "s"}
              {result.respondents < result.requested
                ? ` (${result.requested} were asked for)`
                : ""}
              , e.g. {result.personas.slice(0, 3).join("; ")}.
            </p>
            {stale && (
              <p role="status" className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
                The form changed since this pretest. Run it again to check the
                current version.
              </p>
            )}
            {result.issues.length === 0 ? (
              <p className="py-4 text-sm">
                None of them got stuck. That doesn&apos;t prove the form is
                fine — real respondents may still surprise you.
              </p>
            ) : (
              <ul className="mt-2 max-h-[50vh] divide-y overflow-y-auto">
                {result.issues.map((issue) => {
                  const status = deckStatus(probes, issue.key);
                  const sending = send.isPending && send.variables?.key === issue.key;
                  return (
                    <li
                      key={issue.key}
                      data-testid={`pretest-issue-${issue.kind}`}
                      className="flex items-start justify-between gap-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p>{issue.text}</p>
                        {issue.examples.map((example, i) => (
                          <p key={i} className="text-xs text-muted-foreground">
                            <span className="font-medium">{example.persona}:</span>{" "}
                            {example.note}
                          </p>
                        ))}
                      </div>
                      {status === "open" ? (
                        <Badge variant="secondary" className="shrink-0">In questions</Badge>
                      ) : status === "answered" ? (
                        <Badge variant="outline" className="shrink-0">Answered</Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 text-xs"
                          disabled={sending || stale}
                          onClick={() => sendToDeck(issue)}
                        >
                          {sending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                          Send to questions
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            size="sm"
            variant={result ? "outline" : "default"}
            data-testid="pretest-run"
            disabled={pretest.isPending || portfolio.schema.fields.length === 0}
            onClick={run}
          >
            {result ? "Run again" : "Run pretest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
