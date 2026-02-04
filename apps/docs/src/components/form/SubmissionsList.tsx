"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSchema } from "@/hooks/query/schemas";
import { useSubmissions } from "@/hooks/query/submissions";
import {
  clearAllSubmissions,
  deleteSubmission,
  serializeSchemaToZod,
  validateNewSchemaWithPreviousSubmissions,
} from "@/lib/schema-manager";
import { AlertCircleIcon, CheckCircle2Icon, Trash2Icon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import z from "zod";

interface SubmissionsListProps {
  slug: string;
}

export function SubmissionsList({ slug }: SubmissionsListProps) {
  const { data: schema } = useSchema(slug);
  const { data: submissions, refetch: refetchSubmssions } =
    useSubmissions(slug);

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

  // Validate all submissions against current schema
  const validationResults = useMemo(() => {
    if (!schema) return [];
    return validateNewSchemaWithPreviousSubmissions(schema);
  }, [schema, submissions]);

  // Create a map for quick validation lookup
  const validationMap = useMemo(() => {
    const map = new Map();
    validationResults.forEach((result) => {
      map.set(result.submission.id, result.validation);
    });
    return map;
  }, [validationResults]);

  const zodSchema = schema ? serializeSchemaToZod(schema.schema) : null;

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

  const validCount = validationResults.filter(
    (r) => r.validation.success,
  ).length;
  const invalidCount = validationResults.length - validCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">
            Submitted Registrations ({submissions.length})
          </h3>
          {invalidCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircleIcon className="h-3 w-3" />
              {invalidCount} Invalid
            </Badge>
          )}
          {validCount > 0 && (
            <Badge
              variant="outline"
              className="gap-1 bg-green-50 text-green-700 border-green-200"
            >
              <CheckCircle2Icon className="h-3 w-3" />
              {validCount} Valid
            </Badge>
          )}
        </div>
        {submissions.length > 0 && (
          <Button variant="outline" size="sm" onClick={onClearAll}>
            Clear All
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Schema</TableHead>
              {schema?.schema.fields.map((field) => (
                <TableHead key={field.key}>{field.label}</TableHead>
              ))}
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((submission) => {
              const validation = zodSchema?.safeParse(submission.data);
              const isValid = validation?.success;

              return (
                <TableRow
                  key={submission.id}
                  className={!isValid ? "bg-red-50/50 dark:bg-red-950/10" : ""}
                >
                  <TableCell>
                    {isValid ? (
                      <CheckCircle2Icon className="h-5 w-5 text-green-600" />
                    ) : (
                      <div className="relative group">
                        <AlertCircleIcon className="h-5 w-5 text-red-600" />
                        {!isValid && validation && "error" in validation && (
                          <div className="absolute left-0 top-6 z-10 hidden group-hover:block min-w-[200px] p-2 bg-popover text-popover-foreground border rounded-md shadow-md text-xs">
                            <div className="font-semibold mb-1">
                              Validation Errors:
                            </div>

                            {(() => {
                              const errorProperties = z.treeifyError(
                                validation.error,
                              ).properties;
                              const entries = Object.entries(errorProperties!);
                              return (
                                <div>
                                  {entries.map(([key, value]) => (
                                    <div key={key}>
                                      <span>{key}:</span>
                                      {value?.errors.map((error) => (
                                        <span
                                          key={error}
                                          className="italic block"
                                        >
                                          {error}
                                        </span>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatDate(submission.submittedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      v{submission.schemaVersion}
                    </Badge>
                  </TableCell>
                  {schema?.schema.fields.map((field) => {
                    const value = submission.data[field.key];
                    return (
                      <TableCell key={field.key}>
                        {formatValue(value)}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => onDelete(submission.id)}
                    >
                      <Trash2Icon className="h-4 w-4" />
                      <span className="sr-only">Delete submission</span>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
