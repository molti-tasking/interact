"use client";

import {
  getMigrationSuggestionAction,
  type MigrationSuggestion,
} from "@/app/actions/schema-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SchemaDiff, SerializedSchema } from "@/lib/schema-manager";
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";

interface DataMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diff: SchemaDiff;
  oldSchema: SerializedSchema;
  newSchema: SerializedSchema;
  existingData: Record<string, unknown>;
  onAccept: (migratedData: Record<string, unknown>) => void;
  onDecline: () => void;
}

export function DataMigrationDialog({
  open,
  onOpenChange,
  diff,
  oldSchema,
  newSchema,
  existingData,
  onAccept,
  onDecline,
}: DataMigrationDialogProps) {
  const [suggestions, setSuggestions] = useState<
    Record<string, MigrationSuggestion>
  >({});
  const [loading, setLoading] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});

  // Get affected fields from the diff
  const affectedFields = [
    ...diff.modified.map((m) => m.field),
    ...diff.added.map((f) => f.key),
  ];

  useEffect(() => {
    if (!open) return;

    const loadSuggestions = async () => {
      setLoading(true);
      const newSuggestions: Record<string, MigrationSuggestion> = {};

      for (const fieldKey of affectedFields) {
        const suggestion = await getMigrationSuggestionAction({
          oldSchema,
          newSchema,
          existingData,
          affectedField: fieldKey,
        });

        if (suggestion) {
          newSuggestions[fieldKey] = suggestion;
        }
      }

      setSuggestions(newSuggestions);
      setLoading(false);
    };

    loadSuggestions();
  }, [open, affectedFields.join(","), oldSchema, newSchema, existingData]);

  const handleAcceptAll = () => {
    const migratedData = { ...existingData };

    for (const [fieldKey, suggestion] of Object.entries(suggestions)) {
      if (decisions[fieldKey] !== false) {
        // If user hasn't declined
        if (suggestion.suggestedValue !== undefined) {
          migratedData[fieldKey] = suggestion.suggestedValue;
        } else if (suggestion.strategy === "clear") {
          delete migratedData[fieldKey];
        }
      }
    }

    onAccept(migratedData);
  };

  const toggleDecision = (fieldKey: string) => {
    setDecisions((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schema Changes Detected</DialogTitle>
          <DialogDescription>
            The form schema has been updated. Review the changes and how your
            existing data will be migrated.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">
              Analyzing data migration...
            </span>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Added fields */}
            {diff.added.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Added Fields</h3>
                {diff.added.map((field) => (
                  <div
                    key={field.key}
                    className="rounded-lg border p-3 bg-green-50 dark:bg-green-950/20"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium">{field.label}</div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {suggestions[field.key]?.explanation ||
                            "New field added"}
                        </div>
                        {suggestions[field.key]?.suggestedValue !==
                          undefined && (
                          <div className="text-sm mt-2">
                            <span className="text-muted-foreground">
                              Default value:
                            </span>{" "}
                            <code className="bg-muted px-1 py-0.5 rounded">
                              {JSON.stringify(
                                suggestions[field.key].suggestedValue
                              )}
                            </code>
                          </div>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className="bg-green-100 dark:bg-green-900"
                      >
                        Added
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Modified fields */}
            {diff.modified.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Modified Fields</h3>
                {diff.modified.map(({ field, oldField, newField }) => {
                  const suggestion = suggestions[field];
                  const isAccepted = decisions[field] !== false;

                  return (
                    <div
                      key={field}
                      className="rounded-lg border p-3 bg-yellow-50 dark:bg-yellow-950/20"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="font-medium">{newField.label}</div>
                          <div className="text-sm text-muted-foreground">
                            {oldField.type} → {newField.type}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="bg-yellow-100 dark:bg-yellow-900"
                        >
                          Modified
                        </Badge>
                      </div>

                      {suggestion && (
                        <div className="space-y-2 mt-2">
                          <div className="flex items-start gap-2 text-sm">
                            {suggestion.strategy === "keep" ? (
                              <CheckCircle2Icon className="h-4 w-4 text-green-600 mt-0.5" />
                            ) : (
                              <AlertCircleIcon className="h-4 w-4 text-yellow-600 mt-0.5" />
                            )}
                            <div className="flex-1">
                              <div className="font-medium">
                                Migration Strategy
                              </div>
                              <div className="text-muted-foreground">
                                {suggestion.explanation}
                              </div>
                            </div>
                          </div>

                          {suggestion.suggestedValue !== undefined && (
                            <div className="text-sm pl-6">
                              <span className="text-muted-foreground">
                                Current:
                              </span>{" "}
                              <code className="bg-muted px-1 py-0.5 rounded">
                                {JSON.stringify(existingData[field])}
                              </code>
                              {" → "}
                              <span className="text-muted-foreground">
                                New:
                              </span>{" "}
                              <code className="bg-muted px-1 py-0.5 rounded">
                                {JSON.stringify(suggestion.suggestedValue)}
                              </code>
                            </div>
                          )}

                          <div className="flex gap-2 pl-6">
                            <Button
                              size="sm"
                              variant={isAccepted ? "default" : "outline"}
                              onClick={() => toggleDecision(field)}
                            >
                              {isAccepted ? "Accepting" : "Accept"}
                            </Button>
                            <Button
                              size="sm"
                              variant={!isAccepted ? "default" : "outline"}
                              onClick={() => toggleDecision(field)}
                            >
                              {!isAccepted ? "Declined" : "Decline"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Removed fields */}
            {diff.removed.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Removed Fields</h3>
                {diff.removed.map((field) => (
                  <div
                    key={field.key}
                    className="rounded-lg border p-3 bg-red-50 dark:bg-red-950/20"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium">{field.label}</div>
                        <div className="text-sm text-muted-foreground mt-1">
                          This field has been removed. Data will be preserved
                          but not visible in the form.
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="bg-red-100 dark:bg-red-900"
                      >
                        Removed
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onDecline} disabled={loading}>
            Cancel Changes
          </Button>
          <Button onClick={handleAcceptAll} disabled={loading}>
            Apply Migration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
