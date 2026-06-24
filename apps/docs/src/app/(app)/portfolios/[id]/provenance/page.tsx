"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useProvenance } from "@/hooks/query/provenance";
import { SchemaDiff } from "@/lib/types";
import { ArrowLeft, Loader2, Mic } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function ProvenancePage() {
  const { id } = useParams<{ id: string }>();
  const { data: entries, isLoading } = useProvenance(id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/portfolios/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          Provenance Timeline
        </h1>
      </div>

      {entries && entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((entry) => {
            const diff = entry.diff as unknown as SchemaDiff;
            return (
              <Card key={entry.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{entry.layer}</Badge>
                      <Badge
                        variant={
                          entry.actor === "system" ? "secondary" : "default"
                        }
                      >
                        {entry.actor}
                      </Badge>
                      {(entry as unknown as { voice_session_id?: string | null }).voice_session_id && (
                        <Badge
                          variant="outline"
                          className="gap-1 text-violet-600 border-violet-300"
                          title={`Voice session: ${(entry as unknown as { voice_session_id: string }).voice_session_id}`}
                        >
                          <Mic className="h-3 w-3" />
                          voice
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{entry.action}</p>
                    {entry.rationale && (
                      <p className="text-sm text-muted-foreground">
                        {entry.rationale}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {entry.created_at
                      ? new Date(entry.created_at).toLocaleString()
                      : ""}
                  </span>
                </div>

                {/* Diff summary */}
                {diff && (
                  <div className="flex gap-2 mt-2 text-xs">
                    {diff.added?.length > 0 && (
                      <Badge variant="outline" className="text-green-600">
                        +{diff.added.length} added
                      </Badge>
                    )}
                    {diff.removed?.length > 0 && (
                      <Badge variant="outline" className="text-red-600">
                        -{diff.removed.length} removed
                      </Badge>
                    )}
                    {diff.modified?.length > 0 && (
                      <Badge variant="outline" className="text-yellow-600">
                        ~{diff.modified.length} modified
                      </Badge>
                    )}
                  </div>
                )}

                {/* Trace to transcript affordance */}
                {(entry as unknown as { voice_session_id?: string | null }).voice_session_id && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Mic className="h-3 w-3 text-violet-500 shrink-0" />
                      <span>
                        Sourced from voice session{" "}
                        <code className="font-mono text-[10px] bg-muted px-1 rounded">
                          {(entry as unknown as { voice_session_id: string }).voice_session_id.slice(0, 8)}…
                        </code>
                        . Full transcript and per-field values are stored in{" "}
                        <code className="font-mono text-[10px] bg-muted px-1 rounded">
                          voice_session_entries
                        </code>
                        .
                      </span>
                    </p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-8 text-center text-muted-foreground">
          No provenance entries yet. Changes will appear here as you design the
          form.
        </Card>
      )}
    </div>
  );
}
