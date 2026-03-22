"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useProvenance } from "@/hooks/query/provenance";
import { SchemaDiff } from "@/lib/types";
import { ArrowLeft, Loader2 } from "lucide-react";
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
                          entry.actor === "creator" ? "default" : "secondary"
                        }
                      >
                        {entry.actor}
                      </Badge>
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
