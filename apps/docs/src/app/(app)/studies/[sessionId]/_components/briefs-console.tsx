"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAdvanceStudyPhase,
  useCompletionUrl,
  useOpenBriefsSession,
  useServerRunSettings,
  useStudyProgress,
  type ProgressEntry,
} from "@/hooks/query/study";
import { useNow } from "@/hooks/use-now";
import {
  briefOrder,
  type StartKind,
  type StudyPhase,
  type StudySession,
} from "@/lib/study/types";
import { formatRelativeTime } from "@/lib/provenance-format";
import { Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ExportCard } from "./export-card";
import { SettingsCard } from "./settings-card";

/** A seat counts as active while its browser was seen this recently (as in the database). */
const ACTIVE_MS = 15 * 60_000;

const STATUS: Record<string, { label: string; hint: string }> = {
  lobby: {
    label: "Not open",
    hint: "The study link doesn't let anyone in. People who already started can finish.",
  },
  create: { label: "Open", hint: "The study link lets new participants in." },
  done: {
    label: "Closed",
    hint: "Nobody can start or continue. Finished participants still reach their completion link.",
  },
};

const START_LABEL: Record<StartKind, string> = {
  portfolio: "Form with intent and decisions",
  form: "Form only",
};

function status(entry: ProgressEntry, now: number): "completed" | "declined" | "active" | "abandoned" {
  if (entry.outcome === "completed") return "completed";
  if (entry.outcome === "declined") return "declined";
  return now - new Date(entry.lastSeenAt).getTime() < ACTIVE_MS ? "active" : "abandoned";
}

function minutes(from: string | null, to: string | null): string {
  if (!from || !to) return "";
  const s = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Researcher's console for a self-paced briefs session (the panel study). */
export function BriefsConsole({ session }: { session: StudySession }) {
  const progress = useStudyProgress(session.id);
  const completionUrl = useCompletionUrl(session.id);
  const advance = useAdvanceStudyPhase();
  const open = useOpenBriefsSession();
  const server = useServerRunSettings(session.id);
  const now = useNow(10_000);
  const [target, setTarget] = useState<StudyPhase | null>(null);
  // What the dialog asks about: kept while it closes, so its text doesn't change
  const [asked, setAsked] = useState<StudyPhase>("create");
  const ask = (phase: StudyPhase) => {
    setAsked(phase);
    setTarget(phase);
  };
  const entries = progress.data ?? [];
  const { settings } = session;

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const studyLink =
    `${origin}/join?code=${session.join_code}` +
    "&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}";

  // What it ran with once opened; else what the server would record now
  const run = settings.run ?? server.data?.run ?? null;
  const missing = settings.run ? [] : (server.data?.missing ?? []);
  const handoff = settings.handoff;
  const withoutSources = handoff
    ? settings.briefs.filter((brief) => !(handoff.sources[brief]?.length))
    : [];

  const problems = [
    settings.briefs.length === 0 && "No situations selected.",
    missing.length > 0 &&
      `Not set on the server: ${missing.join(", ")}. The study can't be opened until the model, the question strategy and the committee size are set explicitly.`,
    withoutSources.length > 0 &&
      `No forms to start from for: ${withoutSources.join(", ")}. Choose them in the settings.`,
    !handoff &&
      settings.conditions.length < 2 &&
      "Fewer than two conditions: everyone gets the same tool.",
    !completionUrl.isLoading && !completionUrl.data && "No completion URL: participants can't confirm their submission on Prolific.",
    !settings.contact.email && "No contact email on the consent page.",
  ].filter((p): p is string => !!p);

  const conditions = settings.conditions.length > 0 ? settings.conditions : [null];
  const orders = settings.briefs.map((_, i) => i);
  // Wave 2: the starting point is a factor too
  const starts: (StartKind | null)[] = handoff ? handoff.starts : [null];
  const startOf = (e: ProgressEntry) => e.tasks[0]?.startKind ?? null;
  const count = (condition: string | null, order: number, start: StartKind | null, what: string) =>
    entries.filter(
      (e) =>
        (e.condition ?? null) === condition &&
        e.taskOrder === order &&
        startOf(e) === start &&
        status(e, now) === what,
    ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl tracking-tight text-primary">{session.name}</h1>
          <Badge variant={session.phase === "create" ? "default" : "outline"}>
            {STATUS[session.phase]?.label ?? session.phase}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Self-paced study{handoff ? " (wave 2: participants adapt a finished form)" : ""}:{" "}
          {settings.briefs.length} situations, up to {Math.round(settings.taskSeconds / 60)}{" "}
          minutes each.
        </p>
        <p className="text-sm text-muted-foreground" data-testid="run-settings">
          {run ? (
            <>
              {settings.run ? "Runs with" : "Will run with"}{" "}
              <span className="font-medium text-foreground">{run.model}</span>
              {run.fastModel !== run.model ? ` (and ${run.fastModel} for background checks)` : ""},{" "}
              {run.questionStrategy === "committee"
                ? `questions chosen by a committee of ${run.committeeSize} drafts`
                : "questions asked for directly (prompted)"}
              {settings.run ? ` — recorded ${formatRelativeTime(settings.run.recordedAt, now)}` : ""}.
            </>
          ) : (
            "Model and question settings: not set on the server."
          )}
        </p>
      </div>

      <Card className="space-y-4 p-4 sm:p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Study link for Prolific</h2>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border bg-muted/40 px-2 py-1 text-xs">
              {studyLink}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigator.clipboard
                  .writeText(studyLink)
                  .then(() => toast.success("Study link copied"))
                  .catch(() => toast.error("Couldn't copy the link"))
              }
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            In Prolific choose “I&apos;ll use URL parameters”. To try it yourself, open the
            link in a private window with a made-up PROLIFIC_PID.
          </p>
        </div>

        {problems.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {problems.map((problem) => (
              <li key={problem} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                {problem}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {session.phase !== "create" && (
            <Button onClick={() => ask("create")} data-testid="open-study">
              {session.phase === "done" ? "Reopen the study" : "Open the study"}
            </Button>
          )}
          {session.phase === "create" && (
            <Button variant="outline" onClick={() => ask("lobby")}>
              Pause new starts
            </Button>
          )}
          {session.phase !== "done" && (
            <Button variant="ghost" onClick={() => ask("done")}>
              Close the study
            </Button>
          )}
          <span className="text-sm text-muted-foreground">{STATUS[session.phase]?.hint}</span>
        </div>
      </Card>

      <section aria-labelledby="cells-heading" className="space-y-2">
        <h2 id="cells-heading" className="text-lg font-medium">
          Conditions{" "}
          <span className="text-muted-foreground tabular-nums">
            ({entries.filter((e) => e.outcome === "completed").length} completed of{" "}
            {entries.length} started)
          </span>
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Condition</TableHead>
                {handoff && <TableHead>Starts from</TableHead>}
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Working</TableHead>
                <TableHead className="text-right">Abandoned</TableHead>
                <TableHead className="text-right">Declined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conditions.flatMap((condition) =>
                starts.flatMap((start) =>
                  orders.map((order) => (
                    <TableRow key={`${condition}:${start}:${order}`}>
                      <TableCell className="font-medium">{condition ?? "full"}</TableCell>
                      {handoff && <TableCell>{START_LABEL[start ?? "form"]}</TableCell>}
                      <TableCell>{briefOrder(settings.briefs, order).join(" → ")}</TableCell>
                      {(["completed", "active", "abandoned", "declined"] as const).map((what) => (
                        <TableCell key={what} className="text-right tabular-nums">
                          {count(condition, order, start, what)}
                        </TableCell>
                      ))}
                    </TableRow>
                  )),
                ),
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          A new participant goes to the row with the fewest completed and working
          seats. Abandoned: not seen for 15 minutes; such seats are refilled.
        </p>
      </section>

      <section aria-labelledby="participants-heading" className="space-y-2">
        <h2 id="participants-heading" className="text-lg font-medium">Participants</h2>
        {progress.isError ? (
          <p role="alert" className="text-sm text-destructive">{progress.error.message}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has started yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Step</TableHead>
                  {orders.map((i) => (
                    <TableHead key={i}>Form {i + 1} (time · fields)</TableHead>
                  ))}
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.participantId}>
                    <TableCell className="font-medium">{entry.displayName}</TableCell>
                    <TableCell>{entry.condition ?? "full"}</TableCell>
                    <TableCell>{status(entry, now)}</TableCell>
                    <TableCell>{entry.step}</TableCell>
                    {orders.map((i) => {
                      const task = entry.tasks.find((t) => t.position === i + 1);
                      return (
                        <TableCell key={i} className="tabular-nums">
                          {task?.startedAt
                            ? `${task.brief}: ${minutes(task.startedAt, task.finishedAt) || "…"} · ${task.fieldCount}${task.finishedBy === "timeout" ? " (time up)" : ""}`
                            : task?.brief}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelativeTime(entry.lastSeenAt, now)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <SettingsCard session={session} />
        <ExportCard session={session} />
      </div>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={
          asked === "create"
            ? "Open the study?"
            : asked === "done"
              ? "Close the study?"
              : "Pause new starts?"
        }
        description={STATUS[asked]?.hint}
        confirmLabel={asked === "create" ? "Open" : asked === "done" ? "Close" : "Pause"}
        destructive={asked === "done"}
        onConfirm={async () => {
          if (!target) return;
          try {
            // Opening goes through the server: it records what the study
            // runs with, and refuses when that isn't set
            if (target === "create") await open.mutateAsync(session.id);
            else await advance.mutateAsync({ sessionId: session.id, phase: target });
            setTarget(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't change the status");
            throw err;
          }
        }}
      />
    </div>
  );
}
