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
  Users,
} from "lucide-react";
import { useState } from "react";

// ── Types ──

interface CDNDimensionMeta {
  id: string;
  name: string;
  lowerIsBetter: boolean;
}

interface RunMeta {
  startedAt: string;
  baseUrl: string;
  simModel: string;
  judgeModel: string;
  judgeHost?: string;
  judgeRuns: number;
  headed: boolean;
  personas: string[];
  scenarios: string[];
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
}

interface RunDetail {
  id: string;
  meta: RunMeta;
  scores: Record<string, Record<string, number>> | null;
  rawScores: unknown[];
  artifacts: Record<string, SessionArtifact>;
  dimensions: CDNDimensionMeta[];
}

// ── Data fetching ──

function useEvaluationRuns() {
  return useQuery<{ runs: RunSummary[]; dimensions: CDNDimensionMeta[] }>({
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
  // Normalize: 1-5 → good/bad based on direction
  const normalized = lowerIsBetter ? 6 - score : score; // 5 = best in both cases
  if (normalized >= 4) return "text-green-700 bg-green-50";
  if (normalized >= 3) return "text-yellow-700 bg-yellow-50";
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

// ── Components ──

function RunCard({ run, onClick }: { run: RunSummary; onClick: () => void }) {
  const m = run.meta;
  return (
    <Card
      className="cursor-pointer transition-colors hover:border-primary/40"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">{run.id}</CardTitle>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
        {m && <CardDescription>{formatDate(m.startedAt)}</CardDescription>}
      </CardHeader>
      {m && (
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1">
              <Cpu className="h-3 w-3" />
              {m.simModel}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <FlaskConical className="h-3 w-3" />
              {m.judgeModel}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Users className="h-3 w-3" />
              {m.personas.length}p × {m.scenarios.length}s
            </Badge>
            {m.headed && <Badge variant="secondary">headed</Badge>}
            {m.judgeRuns > 1 && (
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
}: {
  scores: Record<string, Record<string, number>>;
  dimensions: CDNDimensionMeta[];
  scenarios: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">CDN Scores</CardTitle>
        <CardDescription>
          Mean scores across personas (1-5 scale). Color indicates quality
          relative to dimension direction.
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
              {artifact.designProbes?.length}
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
          <h2 className="text-lg font-semibold">{run.id}</h2>
          {run.meta && (
            <p className="text-sm text-muted-foreground">
              {formatDate(run.meta.startedAt)} · {run.meta.baseUrl}
            </p>
          )}
        </div>
      </div>

      {/* Run config badges */}
      {run.meta && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1">
            <Cpu className="h-3 w-3" />
            Sim: {run.meta.simModel}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <FlaskConical className="h-3 w-3" />
            Judge: {run.meta.judgeModel}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Calendar className="h-3 w-3" />
            {run.meta.judgeRuns} judge run{run.meta.judgeRuns !== 1 ? "s" : ""}
          </Badge>
          {run.meta.headed && <Badge variant="secondary">headed</Badge>}
        </div>
      )}

      {/* CDN Scores Table */}
      {run.scores && (
        <CDNScoresTable
          scores={run.scores}
          dimensions={run.dimensions}
          scenarios={scenarios}
        />
      )}

      {/* Session Artifacts */}
      <div>
        <h3 className="text-base font-semibold mb-3">Session Artifacts</h3>
        {Object.keys(run.artifacts).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No artifacts found for this run.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(run.artifacts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, artifact]) => (
                <ArtifactCard key={key} artifact={artifact} />
              ))}
          </div>
        )}
      </div>
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
          CDN rubric evaluation results from automated persona simulations.
        </p>
      </div>

      {runs.length === 0 ? (
        <Card className="p-12 text-center">
          <FlaskConical className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No evaluation runs yet</h3>
          <p className="text-muted-foreground text-sm">
            Run{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              pnpm eval
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
