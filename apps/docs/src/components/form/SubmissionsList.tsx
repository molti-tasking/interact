"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSchema } from "@/hooks/query/schemas";
import { useSubmissions } from "@/hooks/query/submissions";
import { clearAllSubmissions, deleteSubmission } from "@/lib/schema-manager";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { SchemaSubmissionValidator } from "./SchemaSubmissionValidator";

export function SubmissionsList() {
  const { data: schema } = useSchema();
  const { data: submissions, refetch: refetchSubmssions } = useSubmissions();
  const onDelete = (id: string) => {
    deleteSubmission(id);
    refetchSubmssions();
    toast.success("Submission deleted");
  };

  const onClearAll = () => {
    clearAllSubmissions();
    refetchSubmssions();
    toast.success("All submissions cleared");
  };
  if (!submissions?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No submissions yet. Fill out the form above and click &quot;Save
        Registration&quot; to create your first submission.
      </div>
    );
  }

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          Submitted Registrations ({submissions.length})
        </h3>
        {submissions.length > 0 && (
          <Button variant="outline" size="sm" onClick={onClearAll}>
            Clear All
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {submissions.map((submission) => (
          <Card key={submission.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium">
                    {formatDate(submission.submittedAt)}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Badge variant="outline" className="text-xs">
                      Schema v{submission.schemaVersion}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => onDelete(submission.id)}
                >
                  <Trash2Icon className="h-4 w-4" />
                  <span className="sr-only">Delete submission</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="grid grid-cols-1 gap-2 text-sm">
                {schema?.fields.map((field) => {
                  const value = submission.data[field.key];
                  return (
                    <div
                      key={field.key}
                      className="flex justify-between py-1 border-b last:border-0"
                    >
                      <dt className="font-medium text-muted-foreground">
                        {field.label}:
                      </dt>
                      <dd className="text-right">{formatValue(value)}</dd>
                    </div>
                  );
                })}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      {schema && (
        <div>
          <SchemaSubmissionValidator schema={schema} />
        </div>
      )}
    </div>
  );
}
