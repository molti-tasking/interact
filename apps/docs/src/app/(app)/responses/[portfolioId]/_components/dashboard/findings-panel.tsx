"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useDesignProbes,
  useSendFindingToDeck,
} from "@/hooks/query/design-probes";
import {
  detectFindings,
  FINDING_THRESHOLDS,
  type Finding,
} from "@/lib/engine/findings";
import { buildFieldStats, type FieldStats } from "@/lib/engine/response-stats";
import type { ResponseRowLike } from "@/lib/form-renderer/response-rows";
import type { Portfolio } from "@/lib/types";
import { Lightbulb, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
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
  onFixData: (target: RecodeTarget) => void;
}) {
  const router = useRouter();
  const schema = portfolio.schema;
  const stats = useMemo(() => buildFieldStats(schema, rows), [schema, rows]);
  const findings = useMemo(() => detectFindings(schema, stats), [schema, stats]);
  const { data: probes } = useDesignProbes(portfolio.id);
  const send = useSendFindingToDeck(portfolio.id);

  if (rows.length < FINDING_THRESHOLDS.minResponses) {
    return (
      <p className="text-xs text-muted-foreground">
        Suggestions for the form appear once there are{" "}
        {FINDING_THRESHOLDS.minResponses} responses.
      </p>
    );
  }
  if (findings.length === 0) return null;

  const sendToDesign = (finding: Finding) =>
    send.mutate(
      { finding, schema },
      {
        onSuccess: ({ alreadyOpen }) =>
          toast.success(alreadyOpen ? "Already open in Design" : "Sent to Design", {
            description: finding.text,
            action: {
              label: "Open",
              onClick: () => router.push(`/portfolios/${portfolio.id}`),
            },
          }),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Couldn't send it to Design"),
      },
    );

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
      <ul className="mt-2 divide-y">
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
                {fix && (
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
    </section>
  );
}
