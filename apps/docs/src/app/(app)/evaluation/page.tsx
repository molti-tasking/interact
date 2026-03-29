"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  Cpu,
  FlaskConical,
  Loader2,
  Scale,
  Users,
  Video,
} from "lucide-react";
import { Fragment, useState } from "react";

// ── Types ──

interface CDNDimensionMeta {
  id: string;
  name: string;
  lowerIsBetter: boolean;
}

interface OlsenCriterionMeta {
  id: string;
  name: string;
}

interface RunMeta {
  evalType?: string;
  startedAt: string;
  baseUrl?: string;
  simModel?: string;
  judgeModel?: string;
  judgeModels?: string[];
  judgeHost?: string;
  judgeRuns?: number;
  headed?: boolean;
  personas?: string[];
  scenarios?: string[];
  criteria?: string[];
  modelsCompleted?: number;
  modelsFailed?: number;
  wallClockMs?: number;
}

interface RunSummary {
  id: string;
  meta: RunMeta | null;
}

interface SessionArtifact {
  persona: {
    name: string;
    role: string;
    skillLevel: string;
    description: string;
  };
  scenario: { name: string };
  initialIntent: string;
  finalIntent: string;
  designProbes: { text: string; selectedLabel: string; status: string }[];
  fieldCount: number;
  schemaDescription: string;
  provenanceEntries: number;
  provenanceSummary: string;
  interactionLog?: { elapsed: number; event: string; detail: string }[];
  videoPath?: string;
}

interface OlsenModelRun {
  model: string;
  role: string;
  criteria: {
    criterionId: string;
    criterionName: string;
    score: number;
    observations: string[];
    justification: string;
    limitations?: string[];
    error?: string;
  }[];
}

interface RunDetail {
  id: string;
  meta: RunMeta;
  scores: Record<string, Record<string, number>> | null;
  rawScores: unknown[];
  artifacts: Record<string, SessionArtifact>;
  dimensions: CDNDimensionMeta[];
  olsenCriteria: OlsenCriterionMeta[];
  olsenScores: Record<string, number> | null;
  olsenRaw: OlsenModelRun[] | null;
  olsenPerModel: Record<string, Record<string, number>> | null;
  olsenPerRole: Record<string, Record<string, number>> | null;
  olsenLimitations: Record<string, string[]> | null;
  olsenBaselines: Record<string, Record<string, number>> | null;
  olsenMetrics: {
    totalLatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCalls: number;
    avgLatencyMs: number;
  } | null;
  humanScores: Record<string, Record<string, number>> | null;
  agreement: { alphas: Record<string, number>; overallAlpha: number; raters: number } | null;
  videos: string[];
}

// ── Data fetching ──

function useEvaluationRuns() {
  return useQuery<{ runs: RunSummary[]; dimensions: CDNDimensionMeta[]; olsenCriteria: OlsenCriterionMeta[] }>({
    queryKey: ["evaluation-runs"],
    queryFn: async () => {
      const res = await fetch("/api/evaluation");
      if (!res.ok) throw new Error("Failed to fetch runs");
      return res.json();
    },
  });
}

function useEvaluationRun(runId: string | null) {
  return useQuery<RunDetail>({
    queryKey: ["evaluation-run", runId],
    queryFn: async () => {
      const res = await fetch(`/api/evaluation?run=${runId}`);
      if (!res.ok) throw new Error("Failed to fetch run");
      return res.json();
    },
    enabled: !!runId,
  });
}

// ── Helpers ──

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function scoreColor(score: number, lowerIsBetter: boolean): string {
  if (score <= 0) return "text-muted-foreground";
  const normalized = lowerIsBetter ? 6 - score : score;
  if (normalized >= 4) return "text-green-700 bg-green-50";
  if (normalized >= 3) return "text-yellow-700 bg-yellow-50";
  return "text-red-700 bg-red-50";
}

function scoreColorHigherBetter(score: number): string {
  if (score <= 0) return "text-muted-foreground";
  if (score >= 4) return "text-green-700 bg-green-50";
  if (score >= 3) return "text-yellow-700 bg-yellow-50";
  return "text-red-700 bg-red-50";
}

function skillBadgeVariant(level: string) {
  switch (level) {
    case "novice":
      return "secondary";
    case "intermediate":
      return "default";
    case "expert":
      return "outline";
    default:
      return "secondary";
  }
}

function detectEvalType(run: RunSummary): string {
  if (run.meta?.evalType) return run.meta.evalType;
  if (run.id.startsWith("olsen-run-")) return "olsen";
  if (run.id.startsWith("cdn-run-")) return "cdn-evidence";
  return "cdn";
}

function evalTypeBadge(type: string) {
  switch (type) {
    case "olsen":
      return (
        <Badge className="bg-blue-100 text-blue-700 border-blue-200">
          Olsen
        </Badge>
      );
    case "cdn-evidence":
      return (
        <Badge className="bg-purple-100 text-purple-700 border-purple-200">
          CDN Evidence
        </Badge>
      );
    default:
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-200">
          CDN LLM Judge
        </Badge>
      );
  }
}

// ── Components ──

function RunCard({ run, onClick }: { run: RunSummary; onClick: () => void }) {
  const m = run.meta;
  const evalType = detectEvalType(run);

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-primary/40"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-medium">{run.id}</CardTitle>
            {evalTypeBadge(evalType)}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
        {m && <CardDescription>{formatDate(m.startedAt)}</CardDescription>}
      </CardHeader>
      {m && (
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            {m.judgeModels && m.judgeModels.length > 1 ? (
              <Badge variant="outline" className="gap-1">
                <FlaskConical className="h-3 w-3" />
                {m.judgeModels.length} judge models
              </Badge>
            ) : m.judgeModel ? (
              <Badge variant="outline" className="gap-1">
                <FlaskConical className="h-3 w-3" />
                {m.judgeModel}
              </Badge>
            ) : null}
            {m.simModel && (
              <Badge variant="outline" className="gap-1">
                <Cpu className="h-3 w-3" />
                {m.simModel}
              </Badge>
            )}
            {m.personas && m.scenarios && (
              <Badge variant="outline" className="gap-1">
                <Users className="h-3 w-3" />
                {m.personas.length}p x {m.scenarios.length}s
              </Badge>
            )}
            {m.criteria && (
              <Badge variant="outline" className="gap-1">
                <Scale className="h-3 w-3" />
                {m.criteria.length} criteria
              </Badge>
            )}
            {m.headed && <Badge variant="secondary">headed</Badge>}
            {m.judgeRuns && m.judgeRuns > 1 && (
              <Badge variant="secondary">{m.judgeRuns} judge runs</Badge>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function CDNScoresTable({
  scores,
  dimensions,
  scenarios,
  title,
  description,
}: {
  scores: Record<string, Record<string, number>>;
  dimensions: CDNDimensionMeta[];
  scenarios: string[];
  title?: string;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title ?? "CDN Scores"}</CardTitle>
        <CardDescription>
          {description ??
            "Mean scores across personas (1-5 scale). Color indicates quality relative to dimension direction."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Dimension</TableHead>
              {scenarios.map((s) => (
                <TableHead key={s} className="text-center capitalize">
                  {s}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {dimensions.map((dim) => (
              <TableRow key={dim.id}>
                <TableCell className="font-medium">
                  {dim.name}{" "}
                  <span className="text-muted-foreground text-xs">
                    {dim.lowerIsBetter ? "↓" : "↑"}
                  </span>
                </TableCell>
                {scenarios.map((s) => {
                  const score = scores[s]?.[dim.id] ?? -1;
                  return (
                    <TableCell
                      key={s}
                      className={`text-center font-mono ${scoreColor(score, dim.lowerIsBetter)}`}
                    >
                      {score > 0 ? score.toFixed(1) : "--"}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function shortModelName(m: string | undefined) {
  if (!m) return "unknown";
  const parts = m.split("/");
  return parts[parts.length - 1]
    .replace(/-preview.*/, "")
    .replace(/-latest/, "")
    .replace(/-20\d{6}/, "");
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  neutral: { label: "N", color: "bg-slate-100 text-slate-700" },
  skeptical: { label: "S", color: "bg-red-100 text-red-700" },
  comparative: { label: "C", color: "bg-blue-100 text-blue-700" },
};

function OlsenScoresTable({
  scores,
  perRole,
  baselines,
  limitations,
  criteria,
  raw,
}: {
  scores: Record<string, number>;
  perRole: Record<string, Record<string, number>> | null;
  baselines: Record<string, Record<string, number>> | null;
  limitations: Record<string, string[]> | null;
  criteria: OlsenCriterionMeta[];
  raw: OlsenModelRun[] | null;
}) {
  const [expandedCriterion, setExpandedCriterion] = useState<string | null>(
    null,
  );

  const hasRoles = perRole && Object.values(perRole).some((r) => Object.keys(r).length > 1);
  const hasBaselines = baselines && Object.keys(baselines).length > 0;
  const roles = hasRoles ? ["neutral", "skeptical", "comparative"] : [];

  return (
    <div className="space-y-4">
      {/* Main scores table: roles + baselines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Olsen Criteria Scores</CardTitle>
          <CardDescription>
            {hasRoles
              ? "Scored by 10 LLM judges under 3 roles: Neutral (N), Skeptical (S), Comparative (C). Click a row for per-model reasoning."
              : "Mean scores across judge runs (1-5, higher is better). Click a row for details."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Criterion</TableHead>
                {roles.map((r) => (
                  <TableHead key={r} className="text-center w-[50px]">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${ROLE_LABELS[r]?.color}`}
                    >
                      {ROLE_LABELS[r]?.label}
                    </Badge>
                  </TableHead>
                ))}
                <TableHead className="text-center font-bold w-[60px]">
                  Mean
                </TableHead>
                {hasBaselines && (
                  <>
                    <TableHead className="text-center text-xs w-[60px]">
                      G. Forms
                    </TableHead>
                    <TableHead className="text-center text-xs w-[60px]">
                      Airtable
                    </TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {criteria.map((c) => {
                const mean = scores[c.id] ?? -1;
                const isExpanded = expandedCriterion === c.id;
                const colSpan =
                  1 + roles.length + 1 + (hasBaselines ? 2 : 0);
                return (
                  <Fragment key={c.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        setExpandedCriterion(isExpanded ? null : c.id)
                      }
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1">
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                          {c.name}
                        </div>
                      </TableCell>
                      {roles.map((r) => {
                        const s = perRole?.[c.id]?.[r] ?? -1;
                        return (
                          <TableCell
                            key={r}
                            className={`text-center font-mono text-xs ${scoreColorHigherBetter(s)}`}
                          >
                            {s > 0 ? s.toFixed(1) : "--"}
                          </TableCell>
                        );
                      })}
                      <TableCell
                        className={`text-center font-mono font-bold ${scoreColorHigherBetter(mean)}`}
                      >
                        {mean > 0 ? mean.toFixed(1) : "--"}
                      </TableCell>
                      {hasBaselines && (
                        <>
                          <TableCell
                            className={`text-center font-mono text-xs ${scoreColorHigherBetter(baselines?.["google-forms"]?.[c.id] ?? -1)}`}
                          >
                            {(baselines?.["google-forms"]?.[c.id] ?? -1) > 0
                              ? baselines!["google-forms"][c.id].toFixed(1)
                              : "--"}
                          </TableCell>
                          <TableCell
                            className={`text-center font-mono text-xs ${scoreColorHigherBetter(baselines?.["airtable"]?.[c.id] ?? -1)}`}
                          >
                            {(baselines?.["airtable"]?.[c.id] ?? -1) > 0
                              ? baselines!["airtable"][c.id].toFixed(1)
                              : "--"}
                          </TableCell>
                        </>
                      )}
                    </TableRow>

                    {/* Expanded: per-model reasoning grouped by role */}
                    {isExpanded && (
                      <TableRow>
                        <TableCell
                          colSpan={colSpan}
                          className="bg-muted/30 p-0"
                        >
                          <div className="p-3 space-y-4 max-h-[500px] overflow-y-auto">
                            {/* Limitations */}
                            {limitations?.[c.id] &&
                              limitations[c.id].length > 0 && (
                                <div className="border rounded p-3 bg-amber-50 text-xs">
                                  <div className="font-medium text-amber-800 mb-1">
                                    Identified Limitations:
                                  </div>
                                  <ul className="list-disc list-inside space-y-0.5 text-amber-700">
                                    {limitations[c.id].map((lim, i) => (
                                      <li key={i}>{lim}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                            {/* Per-model reasoning */}
                            {raw &&
                              (hasRoles
                                ? ["neutral", "skeptical", "comparative"]
                                : [undefined]
                              ).map((roleFilter) => {
                                const filtered = roleFilter
                                  ? raw.filter((r) => r.role === roleFilter)
                                  : raw;
                                if (filtered.length === 0) return null;
                                return (
                                  <div key={roleFilter ?? "all"}>
                                    {roleFilter && (
                                      <div className="flex items-center gap-2 mb-2">
                                        <Badge
                                          variant="outline"
                                          className={`text-[10px] ${ROLE_LABELS[roleFilter]?.color}`}
                                        >
                                          {ROLE_LABELS[roleFilter]?.label}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                          {roleFilter === "neutral"
                                            ? "Neutral Evaluators"
                                            : roleFilter === "skeptical"
                                              ? "Skeptical Reviewers"
                                              : "Comparative (vs. existing tools)"}
                                        </span>
                                      </div>
                                    )}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      {filtered.map((run) => {
                                        const dim = run.criteria.find(
                                          (d) => d.criterionId === c.id,
                                        );
                                        if (!dim) return null;
                                        return (
                                          <div
                                            key={`${run.model}-${run.role}`}
                                            className="text-xs border rounded p-2.5 bg-background"
                                          >
                                            <div className="flex items-center justify-between mb-1.5">
                                              <span className="font-medium truncate mr-2">
                                                {shortModelName(run.model)}
                                              </span>
                                              <Badge
                                                variant={
                                                  dim.score > 0
                                                    ? "outline"
                                                    : "destructive"
                                                }
                                                className="font-mono shrink-0"
                                              >
                                                {dim.score > 0
                                                  ? `${dim.score}/5`
                                                  : "FAIL"}
                                              </Badge>
                                            </div>
                                            {dim.error && (
                                              <div className="text-red-600 bg-red-50 rounded p-1.5 mb-1.5 text-[10px] font-mono">
                                                {dim.error}
                                              </div>
                                            )}
                                            {dim.justification && (
                                              <p className="text-muted-foreground italic mb-1">
                                                {dim.justification}
                                              </p>
                                            )}
                                            {dim.observations.length > 0 && (
                                              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                                                {dim.observations.map(
                                                  (obs, i) => (
                                                    <li key={i}>{obs}</li>
                                                  ),
                                                )}
                                              </ul>
                                            )}
                                            {dim.limitations &&
                                              dim.limitations.length > 0 && (
                                                <div className="mt-1.5 pt-1.5 border-t">
                                                  <span className="text-amber-600 font-medium">
                                                    Limitations:{" "}
                                                  </span>
                                                  <span className="text-muted-foreground">
                                                    {dim.limitations.join(
                                                      "; ",
                                                    )}
                                                  </span>
                                                </div>
                                              )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AgreementCard({
  agreement,
  dimensions,
}: {
  agreement: { alphas: Record<string, number>; overallAlpha: number; raters: number };
  dimensions: CDNDimensionMeta[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Inter-Rater Agreement</CardTitle>
        <CardDescription>
          Krippendorff&apos;s alpha ({agreement.raters} raters).
          {" "}Alpha &ge; 0.8 = good, &ge; 0.667 = acceptable.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 text-sm">
          Overall alpha:{" "}
          <span className="font-mono font-bold">
            {agreement.overallAlpha.toFixed(3)}
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dimension</TableHead>
              <TableHead className="text-center">Alpha</TableHead>
              <TableHead className="text-center">Quality</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dimensions.map((dim) => {
              const alpha = agreement.alphas[dim.id] ?? 0;
              const quality =
                alpha >= 0.8
                  ? "good"
                  : alpha >= 0.667
                    ? "acceptable"
                    : "low";
              const qualityColor =
                quality === "good"
                  ? "text-green-700"
                  : quality === "acceptable"
                    ? "text-yellow-700"
                    : "text-red-700";
              return (
                <TableRow key={dim.id}>
                  <TableCell className="font-medium">{dim.name}</TableCell>
                  <TableCell className="text-center font-mono">
                    {alpha.toFixed(3)}
                  </TableCell>
                  <TableCell className={`text-center ${qualityColor}`}>
                    {quality}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ArtifactCard({ artifact }: { artifact: SessionArtifact }) {
  const [expanded, setExpanded] = useState(false);
  const p = artifact.persona;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            {p.name} — {artifact.scenario.name}
          </CardTitle>
          <Badge
            variant={
              skillBadgeVariant(p.skillLevel) as
                | "default"
                | "secondary"
                | "outline"
            }
          >
            {p.skillLevel}
          </Badge>
        </div>
        <CardDescription className="text-xs">{p.role}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-lg font-bold">{artifact.fieldCount}</div>
            <div className="text-muted-foreground">Fields</div>
          </div>
          <div>
            <div className="text-lg font-bold">
              {artifact.designProbes?.length ?? 0}
            </div>
            <div className="text-muted-foreground">Probes</div>
          </div>
          <div>
            <div className="text-lg font-bold">
              {artifact.provenanceEntries}
            </div>
            <div className="text-muted-foreground">Provenance</div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 mr-1" />
          ) : (
            <ChevronRight className="h-3 w-3 mr-1" />
          )}
          Details
        </Button>

        {expanded && (
          <div className="space-y-3 text-xs">
            {artifact.interactionLog && artifact.interactionLog.length > 0 && (
              <div>
                <div className="font-medium mb-1">Interaction Log</div>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {artifact.interactionLog.map((entry, i) => (
                    <div
                      key={i}
                      className="text-muted-foreground bg-muted p-1.5 rounded flex gap-2"
                    >
                      <span className="font-mono text-[10px] shrink-0">
                        {entry.elapsed.toFixed(1)}s
                      </span>
                      <span className="font-medium text-foreground">
                        {entry.event}
                      </span>
                      <span className="truncate">{entry.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="font-medium mb-1">Initial Intent</div>
              <pre className="whitespace-pre-wrap text-muted-foreground bg-muted p-2 rounded max-h-40 overflow-y-auto">
                {artifact.initialIntent}
              </pre>
            </div>
            <div>
              <div className="font-medium mb-1">Schema</div>
              <p className="text-muted-foreground bg-muted p-2 rounded">
                {artifact.schemaDescription}
              </p>
            </div>
            {artifact.designProbes?.length > 0 && (
              <div>
                <div className="font-medium mb-1">Design Probes</div>
                <ul className="space-y-1">
                  {artifact.designProbes?.map((probe, i) => (
                    <li
                      key={i}
                      className="text-muted-foreground bg-muted p-2 rounded"
                    >
                      <span className="font-medium text-foreground">
                        {probe.text}
                      </span>
                      {" → "}
                      <Badge variant="outline" className="text-[10px]">
                        {probe.selectedLabel}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <div className="font-medium mb-1">Provenance Summary</div>
              <p className="text-muted-foreground bg-muted p-2 rounded">
                {artifact.provenanceSummary}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunDetailView({
  runId,
  onBack,
}: {
  runId: string;
  onBack: () => void;
}) {
  const { data: run, isLoading } = useEvaluationRun(runId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!run) {
    return <p className="text-muted-foreground">Run not found.</p>;
  }

  const evalType = run.meta?.evalType ?? (run.id.startsWith("olsen-") ? "olsen" : "cdn");
  const scenarios = run.meta?.scenarios ?? Object.keys(run.scores ?? {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          All Runs
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{run.id}</h2>
            {evalTypeBadge(evalType)}
          </div>
          {run.meta && (
            <p className="text-sm text-muted-foreground">
              {formatDate(run.meta.startedAt)}
              {run.meta.baseUrl ? ` · ${run.meta.baseUrl}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Run config badges */}
      {run.meta && (
        <div className="flex flex-wrap gap-2">
          {run.meta.judgeModel && (
            <Badge variant="outline" className="gap-1">
              <FlaskConical className="h-3 w-3" />
              Judge: {run.meta.judgeModel}
            </Badge>
          )}
          {run.meta.simModel && (
            <Badge variant="outline" className="gap-1">
              <Cpu className="h-3 w-3" />
              Sim: {run.meta.simModel}
            </Badge>
          )}
          {run.meta.judgeRuns && (
            <Badge variant="outline" className="gap-1">
              <Calendar className="h-3 w-3" />
              {run.meta.judgeRuns} judge run
              {run.meta.judgeRuns !== 1 ? "s" : ""}
            </Badge>
          )}
          {run.meta.headed && <Badge variant="secondary">headed</Badge>}
        </div>
      )}

      {/* Olsen Scores */}
      {evalType === "olsen" && run.olsenScores && (
        <OlsenScoresTable
          scores={run.olsenScores}
          perRole={run.olsenPerRole}
          baselines={run.olsenBaselines}
          limitations={run.olsenLimitations}
          criteria={run.olsenCriteria}
          raw={run.olsenRaw}
        />
      )}

      {/* Olsen Metrics */}
      {evalType === "olsen" && run.olsenMetrics && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Run Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
              <div>
                <div className="text-lg font-bold">
                  {run.olsenMetrics.totalCalls}
                </div>
                <div className="text-xs text-muted-foreground">LLM Calls</div>
              </div>
              <div>
                <div className="text-lg font-bold">
                  {(run.olsenMetrics.totalLatencyMs / 60000).toFixed(1)}m
                </div>
                <div className="text-xs text-muted-foreground">
                  Total Runtime
                </div>
              </div>
              <div>
                <div className="text-lg font-bold">
                  {(run.olsenMetrics.avgLatencyMs / 1000).toFixed(1)}s
                </div>
                <div className="text-xs text-muted-foreground">
                  Avg Latency
                </div>
              </div>
              <div>
                <div className="text-lg font-bold">
                  {(run.olsenMetrics.totalInputTokens / 1000).toFixed(0)}k
                </div>
                <div className="text-xs text-muted-foreground">
                  Input Tokens
                </div>
              </div>
              <div>
                <div className="text-lg font-bold">
                  {(run.olsenMetrics.totalOutputTokens / 1000).toFixed(0)}k
                </div>
                <div className="text-xs text-muted-foreground">
                  Output Tokens
                </div>
              </div>
              <div>
                <div className="text-lg font-bold">
                  {(run.olsenMetrics.totalTokens / 1000).toFixed(0)}k
                </div>
                <div className="text-xs text-muted-foreground">
                  Total Tokens
                </div>
              </div>
            </div>
            {run.meta?.wallClockMs && (
              <div className="mt-3 text-xs text-muted-foreground text-center">
                Wall clock: {(run.meta.wallClockMs / 60000).toFixed(1)} minutes
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* CDN Scores (LLM judge) */}
      {evalType === "cdn" && run.scores && (
        <CDNScoresTable
          scores={run.scores}
          dimensions={run.dimensions}
          scenarios={scenarios}
          title="CDN Scores (LLM Judge)"
          description="Mean scores across personas and judge runs (1-5 scale). These are preliminary LLM-judged scores."
        />
      )}

      {/* CDN Human Scores + Agreement */}
      {run.humanScores && (
        <CDNScoresTable
          scores={run.humanScores}
          dimensions={run.dimensions}
          scenarios={scenarios}
          title="CDN Scores (Human Raters)"
          description="Mean scores across human raters (1-5 scale)."
        />
      )}
      {run.agreement && (
        <AgreementCard
          agreement={run.agreement}
          dimensions={run.dimensions}
        />
      )}

      {/* Videos */}
      {run.videos && run.videos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session Videos</CardTitle>
            <CardDescription>
              {run.videos.length} recorded sessions for CDN inspection.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {run.videos.sort().map((v) => (
                <div
                  key={v}
                  className="flex items-center gap-2 p-2 bg-muted rounded text-sm"
                >
                  <Video className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{v}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session Artifacts */}
      {Object.keys(run.artifacts).length > 0 && (
        <div>
          <h3 className="text-base font-semibold mb-3">Session Artifacts</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(run.artifacts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, artifact]) => (
                <ArtifactCard key={key} artifact={artifact} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──

export default function EvaluationPage() {
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const { data, isLoading } = useEvaluationRuns();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (selectedRun) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <RunDetailView
          runId={selectedRun}
          onBack={() => setSelectedRun(null)}
        />
      </div>
    );
  }

  const runs = data?.runs ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Evaluation Runs</h1>
        <p className="text-sm text-muted-foreground">
          Olsen criteria and CDN rubric evaluation results.
        </p>
      </div>

      {runs.length === 0 ? (
        <Card className="p-12 text-center">
          <FlaskConical className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No evaluation runs yet</h3>
          <p className="text-muted-foreground text-sm">
            Run{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              pnpm eval:olsen
            </code>{" "}
            or{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              pnpm eval:cdn-evidence
            </code>{" "}
            to generate results.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              onClick={() => setSelectedRun(run.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
