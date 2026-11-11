"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useStudyExport, type StudyExport } from "@/hooks/query/study";
import {
  cdnCodebookCsv,
  eventsCsv,
  formsCsv,
  questionnaireCsv,
} from "@/lib/study/export";
import {
  codingFieldsCsv,
  codingFormsMarkdown,
  codingKeyCsv,
  codingRequirementsCsv,
  formDiversityCsv,
  formDiversityPairsCsv,
  participantsCsv,
  questionAnswersCsv,
  sessionRun,
  withRunColumns,
  withRunLine,
} from "@/lib/study/coding";
import type { BriefDefinition } from "@/lib/study/briefs.server";
import type { StudySession } from "@/lib/study/types";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type Briefs = Record<string, BriefDefinition>;

interface ExportFile {
  key: string;
  label: string;
  file: (code: string, day: string) => string;
  build: (data: StudyExport, briefs: Briefs) => string;
  type: string;
}

/** Stories and requirement lists: admins only, never bundled for the browser. */
async function fetchBriefs(): Promise<Briefs> {
  const res = await fetch("/api/study/briefs");
  if (!res.ok) throw new Error("Couldn't load the requirement lists");
  return (await res.json()) as Briefs;
}

/** Briefs sessions: sheets for the two raters (no condition, no participant). */
const RATER_FILES: ExportFile[] = [
  {
    key: "coding-forms",
    label: "Forms to code (Markdown)",
    file: (code, day) => `study-${code}-${day}-coding-forms.md`,
    build: codingFormsMarkdown,
    type: "text/markdown",
  },
  {
    key: "coding-requirements",
    label: "Requirement sheet (CSV)",
    file: (code, day) => `study-${code}-${day}-coding-requirements.csv`,
    build: codingRequirementsCsv,
    type: "text/csv",
  },
  {
    key: "coding-fields",
    label: "Field sheet (CSV)",
    file: (code, day) => `study-${code}-${day}-coding-fields.csv`,
    build: (data) => codingFieldsCsv(data),
    type: "text/csv",
  },
];

/** Briefs sessions: for the analyst only — they unblind the form codes. */
const ANALYST_FILES: ExportFile[] = [
  {
    key: "coding-key",
    label: "Key: form code → condition (CSV)",
    file: (code, day) => `study-${code}-${day}-coding-key.csv`,
    build: (data) => codingKeyCsv(data),
    type: "text/csv",
  },
  {
    key: "participants",
    label: "Participants and questionnaire (CSV)",
    file: (code, day) => `study-${code}-${day}-participants.csv`,
    build: (data) => participantsCsv(data),
    type: "text/csv",
  },
  {
    key: "question-answers",
    label: "Answered elicitation questions (CSV)",
    file: (code, day) => `study-${code}-${day}-question-answers.csv`,
    build: (data) => questionAnswersCsv(data),
    type: "text/csv",
  },
  {
    key: "form-diversity",
    label: "Form diversity per situation and condition (CSV)",
    file: (code, day) => `study-${code}-${day}-form-diversity.csv`,
    build: (data) => formDiversityCsv(data),
    type: "text/csv",
  },
  {
    key: "form-diversity-pairs",
    label: "Form diversity, every pair (CSV)",
    file: (code, day) => `study-${code}-${day}-form-diversity-pairs.csv`,
    build: (data) => formDiversityPairsCsv(data),
    type: "text/csv",
  },
];

const FILES: ExportFile[] = [
  {
    key: "json",
    label: "Everything (JSON)",
    file: (code, day) => `study-${code}-${day}.json`,
    // `run` first: what the session ran with (also in session.settings.run)
    build: (data) => JSON.stringify({ run: sessionRun(data), ...data }, null, 2),
    type: "application/json",
  },
  {
    key: "events",
    label: "Interaction log (CSV)",
    file: (code, day) => `study-${code}-${day}-events.csv`,
    build: eventsCsv,
    type: "text/csv",
  },
  {
    key: "questionnaires",
    label: "Questionnaires (CSV)",
    file: (code, day) => `study-${code}-${day}-questionnaires.csv`,
    build: questionnaireCsv,
    type: "text/csv",
  },
  {
    key: "forms",
    label: "Forms over time (CSV)",
    file: (code, day) => `study-${code}-${day}-forms.csv`,
    build: formsCsv,
    type: "text/csv",
  },
  {
    key: "codebook",
    label: "CDN codebook (CSV)",
    file: () => "cdn-codebook.csv",
    build: () => cdnCodebookCsv(),
    type: "text/csv",
  },
];

/** Download everything recorded in the session, for analysis. */
export function ExportCard({ session }: { session: StudySession }) {
  const exportSession = useStudyExport();

  const briefsMode = session.settings.mode === "briefs";

  const handle = async (entry: ExportFile) => {
    try {
      const [data, briefs] = await Promise.all([
        exportSession.mutateAsync(session.id),
        briefsMode ? fetchBriefs() : Promise.resolve({}),
      ]);
      const day = data.exportedAt.slice(0, 10);
      let content = entry.build(data, briefs);
      // Every file of a briefs session says what the session ran with
      if (briefsMode) {
        const run = sessionRun(data);
        if (entry.type === "text/csv") content = withRunColumns(content, run);
        if (entry.type === "text/markdown") content = withRunLine(content, run);
      }
      download(entry.file(session.join_code, day), content, entry.type);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <Card className="space-y-3 p-4 sm:p-6">
      <h2 className="text-lg font-medium">Export</h2>
      <p className="text-sm text-muted-foreground">
        {briefsMode
          ? "Everything recorded: forms (final and when each task ended), design history, elicitation questions, the interaction log, questionnaires and Prolific ids. The JSON file contains the ids — treat it as personal data."
          : "Forms (final and at each phase boundary), answers with who gave them, design history, elicitation questions, the interaction log and questionnaires. Facilitator test answers carry your account id — filter them out."}
      </p>
      <FileButtons
        files={briefsMode ? FILES.filter((f) => f.key === "json" || f.key === "events") : FILES}
        pending={exportSession.isPending}
        onPick={handle}
      />
      {briefsMode && (
        <>
          <h3 className="pt-2 text-sm font-medium">For the two raters</h3>
          <p className="text-sm text-muted-foreground">
            Finished forms under a code, without participant or condition. Each
            rater fills in both sheets on their own; compare them with{" "}
            <code>pnpm study:agreement</code>.
          </p>
          <FileButtons files={RATER_FILES} pending={exportSession.isPending} onPick={handle} />
          <h3 className="pt-2 text-sm font-medium">For the analysis</h3>
          <p className="text-sm text-muted-foreground">
            The key unblinds the form codes — keep it away from the raters.
            Every file carries the model, the question strategy and the
            committee size the session ran with.
          </p>
          <FileButtons files={ANALYST_FILES} pending={exportSession.isPending} onPick={handle} />
        </>
      )}
    </Card>
  );
}

function FileButtons({
  files,
  pending,
  onPick,
}: {
  files: ExportFile[];
  pending: boolean;
  onPick: (file: ExportFile) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((entry) => (
        <Button
          key={entry.key}
          variant={entry.key === "json" ? "default" : "outline"}
          size="sm"
          disabled={pending}
          onClick={() => void onPick(entry)}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          {entry.label}
        </Button>
      ))}
    </div>
  );
}
