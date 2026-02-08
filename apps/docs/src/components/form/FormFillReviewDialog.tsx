"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import type { ParseRawDataResponse } from "@/app/actions/schema-actions";
import {
  CheckCircle2Icon,
  AlertCircleIcon,
  PlusCircleIcon,
} from "lucide-react";

interface FormFillReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parseResult: ParseRawDataResponse | null;
  onFillFormOnly: () => void;
  onUpdateSchemaAndFill: () => void;
}

export function FormFillReviewDialog({
  open,
  onOpenChange,
  parseResult,
  onFillFormOnly,
  onUpdateSchemaAndFill,
}: FormFillReviewDialogProps) {
  if (!parseResult) return null;

  const { parsedData, extraFields, mismatches } = parseResult;
  const matchedFieldsCount = Object.keys(parsedData).length;
  const hasExtraFields = extraFields.length > 0;
  const hasMismatches = mismatches.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Parsed Data</DialogTitle>
          <DialogDescription>
            The AI has analyzed your data. Review the results and choose how to
            proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary */}
          <div className="flex gap-4">
            <Badge variant="default" className="gap-1">
              <CheckCircle2Icon className="h-3 w-3" />
              {matchedFieldsCount} Matched
            </Badge>
            {hasMismatches && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircleIcon className="h-3 w-3" />
                {mismatches.length} Mismatch{mismatches.length !== 1 ? "es" : ""}
              </Badge>
            )}
            {hasExtraFields && (
              <Badge variant="secondary" className="gap-1">
                <PlusCircleIcon className="h-3 w-3" />
                {extraFields.length} New Field{extraFields.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {/* Matched Fields */}
          {matchedFieldsCount > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2Icon className="h-4 w-4 text-green-600" />
                Matched Fields
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(parsedData).map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {JSON.stringify(value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Mismatches */}
          {hasMismatches && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <AlertCircleIcon className="h-4 w-4 text-red-600" />
                  Type Mismatches
                </h3>
                <p className="text-sm text-muted-foreground">
                  These fields have values that don&apos;t match the expected type:
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Expected Type</TableHead>
                      <TableHead>Received Value</TableHead>
                      <TableHead>Suggestion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mismatches.map((mismatch, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {mismatch.field}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{mismatch.expectedType}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {JSON.stringify(mismatch.receivedValue)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {mismatch.suggestion}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {/* Extra Fields */}
          {hasExtraFields && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <PlusCircleIcon className="h-4 w-4 text-blue-600" />
                  New Fields Detected
                </h3>
                <p className="text-sm text-muted-foreground">
                  These fields were found in your data but don&apos;t exist in the current
                  schema:
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extraFields.map((field, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{field.key}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{field.suggestedType}</Badge>
                        </TableCell>
                        <TableCell>{field.label}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {JSON.stringify(field.value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parseResult.schemaSuggestion && (
                  <p className="text-sm text-green-600 mt-2">
                    ✓ A schema update is available that includes these fields
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
          <div className="flex-1 text-sm text-muted-foreground">
            {hasExtraFields
              ? "Choose whether to update the schema or fill only existing fields"
              : "The data matches your current schema"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="default" onClick={onFillFormOnly}>
              Fill Form Only
            </Button>
            {hasExtraFields && parseResult.schemaSuggestion && (
              <Button variant="default" onClick={onUpdateSchemaAndFill}>
                Update Schema & Fill
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
