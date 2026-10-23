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

const FILES: {
  key: string;
  label: string;
  file: (code: string, day: string) => string;
  build: (data: StudyExport) => string;
  type: string;
}[] = [
  {
    key: "json",
    label: "Everything (JSON)",
    file: (code, day) => `study-${code}-${day}.json`,
    build: (data) => JSON.stringify(data, null, 2),
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

  const handle = async (entry: (typeof FILES)[number]) => {
    try {
      const data = await exportSession.mutateAsync(session.id);
      const day = data.exportedAt.slice(0, 10);
      download(entry.file(session.join_code, day), entry.build(data), entry.type);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <Card className="space-y-3 p-4 sm:p-6">
      <h2 className="text-lg font-medium">Export</h2>
      <p className="text-sm text-muted-foreground">
        Forms (final and at each phase boundary), answers with who gave them,
        design history, probes, the interaction log and questionnaires.
        Facilitator test answers carry your account id — filter them out.
      </p>
      <div className="flex flex-wrap gap-2">
        {FILES.map((entry) => (
          <Button
            key={entry.key}
            variant={entry.key === "json" ? "default" : "outline"}
            size="sm"
            disabled={exportSession.isPending}
            onClick={() => void handle(entry)}
          >
            {exportSession.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {entry.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
