"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/context/capabilities-context";
import { useStudyLog } from "@/context/study-context";
import {
  useDesignProbes,
  useSendFindingToDeck,
} from "@/hooks/query/design-probes";
import { useFindAnswerThemes } from "@/hooks/query/answer-themes";
import {
  detectFindings,
  findingApplies,
  themeCandidates,
  type Finding,
} from "interact/forms/findings";
import { buildFieldStats, type FieldStats } from "interact/forms/response-stats";
import type { ResponseRowLike } from "interact/forms/response-rows";
import type { Portfolio } from "@/lib/types";
import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { RecodeTarget } from "./recode-dialog";

/** Where a finding stands in the Design deck. */
function deckStatus(
  probes: ReturnType<typeof useDesignProbes>["data"],
  key: string,
): "open" | "answered" | "skipped" | null {
  const matching = (probes ?? []).filter(
    (p) => p.source === "data" && p.dimensionId === key,
  );
  if (matching.some((p) => p.status === "pending" || p.status === "loading")) return "open";
  if (matching.some((p) => p.status === "resolved")) return "answered";
  if (matching.some((p) => p.status === "dismissed")) return "skipped";
  return null;
}

/** The data fix a finding offers, if any (opens the recode dialog). */
function fixFor(finding: Finding, stats: ReadonlyMap<string, FieldStats>): RecodeTarget | null {
  const entry = stats.get(finding.fieldId);
  if (finding.kind === "unknown-values" && entry?.kind === "category") {
    const bucket = entry.stats.buckets.find((b) => !b.known && b.count > 0);
    if (bucket) return { kind: "unknown", field: entry.stats.field, bucket, mode: "map" };
  }
  if (finding.kind === "out-of-range" && entry?.kind === "numeric") {
    const outlier = entry.stats.outliers.find((o) => o.reason === "out-of-range");
    if (outlier) return { kind: "number", field: entry.stats.field, outlier, mode: "range" };
  }
  return null;
}

/**
 * What the responses suggest about the form — each finding can fix the data
 * or become a design probe in the Design workspace.
 */
export function FindingsPanel({
  portfolio,
  rows,
  onFixData,
}: {
  portfolio: Portfolio;
  rows: readonly ResponseRowLike[];
  /** Omitted: no "Fix data" (recoding isn't offered) */
  onFixData?: (target: RecodeTarget) => void;
}) {
  const router = useRouter();
  const {
    findingsThresholds: thresholds,
    workspaceHref,
    designProbes: canAskInDesign,
    answerThemes,
  } = useCapabilities();
  const log = useStudyLog();
  const schema = portfolio.schema;
  const stats = useMemo(() => buildFieldStats(schema, rows), [schema, rows]);
  const counted = useMemo(
    () => detectFindings(schema, stats, thresholds),
    [schema, stats, thresholds],
  );
  const { data: probes } = useDesignProbes(portfolio.id);
  const send = useSendFindingToDeck(portfolio.id);

  // Themes in text answers: looked for on request only — it costs a model
  // call and sends respondents' answers to the model
  const themeSearch = useFindAnswerThemes();
  const candidates = useMemo(
    () => (canAskInDesign && answerThemes ? themeCandidates(schema, stats, rows) : []),
    [canAskInDesign, answerThemes, schema, stats, rows],
  );
  const [themes, setThemes] = useState<Finding[]>([]);
  const [searched, setSearched] = useState(false);
  const findings = useMemo(() => {
    const keys = new Set(counted.map((f) => f.key));
    return [
      ...counted,
      // Dropped once the form changed so that they no longer apply
      ...themes.filter((f) => !keys.has(f.key) && findingApplies(f.key, schema)),
    ];
  }, [counted, themes, schema]);

  const lookForThemes = () => {
    log("themes_requested", { fields: candidates.map((c) => c.field.name) });
    themeSearch.mutate(candidates, {
      onSuccess: ({ findings: found, failed }) => {
        setThemes(found);
        setSearched(true);
        log("themes_found", { keys: found.map((f) => f.key) });
        if (failed > 0) {
          toast.warning(
            `Couldn't look at ${failed} question${failed === 1 ? "" : "s"} — try again.`,
          );
        }
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Couldn't look for themes"),
    });
  };

  // Study log: which suggestions the responses produced (once per set)
  const shownKeys =
    rows.length >= thresholds.minResponses
      ? findings.map((f) => f.key).join("|")
      : "";
  useEffect(() => {
    if (shownKeys) log("findings_shown", { keys: shownKeys.split("|") });
  }, [shownKeys, log]);

  if (rows.length < thresholds.minResponses) {
    return (
      <p className="text-xs text-muted-foreground">
        Suggestions for the form appear once there are{" "}
        {thresholds.minResponses} responses.
      </p>
    );
  }
  if (findings.length === 0 && candidates.length === 0) return null;

  const sendToDesign = (finding: Finding) => {
    log("finding_sent_to_design", { key: finding.key, text: finding.text });
    send.mutate(
      { finding, schema },
      {
        onSuccess: ({ alreadyOpen }) =>
          toast.success(alreadyOpen ? "Already open in Design" : "Sent to Design", {
            description: finding.text,
            action: {
              label: "Open",
              onClick: () => router.push(workspaceHref(portfolio.id)),
            },
          }),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Couldn't send it to Design"),
      },
    );
  };

  return (
    <section
      data-testid="findings-panel"
      aria-labelledby="findings-heading"
      className="rounded-xl border bg-card p-4"
    >
      <h3 id="findings-heading" className="flex items-center gap-1.5 text-sm font-medium">
        <Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden />
        What the responses suggest
      </h3>
      <ul className="mt-2 divide-y" hidden={findings.length === 0}>
        {findings.map((finding) => {
          const status = deckStatus(probes, finding.key);
          const fix = fixFor(finding, stats);
          const sending = send.isPending && send.variables?.finding.key === finding.key;
          return (
            <li
              key={finding.key}
              data-testid={`finding-${finding.kind}`}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <p>{finding.text}</p>
                <p className="text-xs text-muted-foreground">{finding.evidence}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {fix && onFixData && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onFixData(fix)}>
                    Fix data
                  </Button>
                )}
                {status === "open" ? (
                  <Badge variant="secondary">In Design</Badge>
                ) : status === "answered" ? (
                  <Badge variant="outline">Answered</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={sending}
                    onClick={() => sendToDesign(finding)}
                  >
                    {sending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    {status === "skipped" ? "Ask again in Design" : "Ask in Design"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {findings.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          The answer counts show nothing to change.
        </p>
      )}
      {candidates.length > 0 && (
        <div
          data-testid="theme-search"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-3"
        >
          <p className="min-w-0 max-w-prose text-xs text-muted-foreground">
            {searched && themes.length === 0
              ? "No common themes found. "
              : ""}
            Looking for themes sends the answers to{" "}
            {candidates.map((c) => `“${c.field.label}”`).join(", ")} (up to 150
            each, no other fields) to the AI model, which groups them. The
            counts are computed from its grouping.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={themeSearch.isPending}
            onClick={lookForThemes}
          >
            {themeSearch.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3 w-3" aria-hidden />
            )}
            {searched ? "Look again" : "Look for themes in text answers"}
          </Button>
        </div>
      )}
    </section>
  );
}
