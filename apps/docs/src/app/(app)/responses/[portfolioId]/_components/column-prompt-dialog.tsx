"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  processColumnPromptAction,
  deriveFieldsFromPromptAction,
} from "@/app/actions/column-actions";
import { useBulkUpdateResponses } from "@/hooks/query/responses-new";
import { useUpdatePortfolio } from "@/hooks/query/portfolios";
import { addField } from "@/lib/engine/schema-ops";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import type {
  Field,
  FormResponse,
  Portfolio,
  PortfolioSchema,
  SavedColumnAction,
} from "@/lib/types";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ColumnPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: Field;
  portfolio: Portfolio;
  responses: FormResponse[];
}

export function ColumnPromptDialog({
  open,
  onOpenChange,
  field,
  portfolio,
  responses,
}: ColumnPromptDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [remember, setRemember] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const bulkUpdate = useBulkUpdateResponses();
  const updatePortfolio = useUpdatePortfolio();

  const handleRun = async () => {
    if (!prompt.trim()) return;
    setIsRunning(true);

    try {
      const responseData = responses.map((r) => ({
        responseId: r.id,
        value: r.data[field.name] ?? null,
      }));

      // 1. Process the prompt against existing data
      const processResult = await processColumnPromptAction(
        field,
        prompt.trim(),
        responseData,
      );

      if (!processResult.success || !processResult.results) {
        toast.error(processResult.error ?? "Failed to process prompt");
        return;
      }

      // 2. Update responses with enriched data
      const updates = responses
        .filter((r) => processResult.results![r.id] !== undefined)
        .map((r) => ({
          id: r.id,
          portfolioId: r.portfolioId,
          data: {
            ...r.data,
            [field.name]: processResult.results![r.id],
          },
        }));

      if (updates.length > 0) {
        await bulkUpdate.mutateAsync(updates);
      }

      toast.success(`Processed ${updates.length} responses`);

      // 3. If "Remember" is checked, derive new fields and update schema
      if (remember) {
        const schema = portfolio.schema as unknown as PortfolioSchema;
        const existingFieldNames = schema.fields.map((f) => f.name);

        const deriveResult = await deriveFieldsFromPromptAction(
          field,
          prompt.trim(),
          existingFieldNames,
        );

        if (deriveResult.success && deriveResult.newFields?.length) {
          let updatedSchema = { ...schema };

          for (const newField of deriveResult.newFields) {
            updatedSchema = addField(updatedSchema, newField);
          }

          const savedAction: SavedColumnAction = {
            id: `action-${Date.now()}`,
            fieldId: field.id,
            prompt: prompt.trim(),
            label: deriveResult.label ?? prompt.trim().slice(0, 50),
            addedFields: deriveResult.newFields,
            createdAt: new Date().toISOString(),
          };

          updatedSchema = {
            ...updatedSchema,
            columnActions: [
              ...(updatedSchema.columnActions ?? []),
              savedAction,
            ],
          };

          const diff = diffSchemas(schema, updatedSchema);

          await updatePortfolio.mutateAsync({
            id: portfolio.id,
            schema: updatedSchema,
          });

          await logProvenance(
            portfolio.id,
            "configuration",
            "column_action_remembered",
            "creator",
            diff,
            prompt.trim(),
            { intent: portfolio.intent, schema },
          );

          toast.success(
            `Remembered action: "${deriveResult.label}" — ${deriveResult.newFields.length} new field(s) added`,
          );
        }
      }

      setPrompt("");
      setRemember(false);
      onOpenChange(false);
    } catch (error) {
      console.error("Column prompt error:", error);
      toast.error("An error occurred while processing");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Column Action: {field.label}</DialogTitle>
          <DialogDescription>
            Run a custom prompt against all values in this column.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="column-prompt">Prompt</Label>
            <Textarea
              id="column-prompt"
              placeholder={`e.g. "Extract the city name from this address"`}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRunning}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember"
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
              disabled={isRunning}
            />
            <Label htmlFor="remember" className="text-sm font-normal">
              Remember this activity — derive new fields for future responses
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isRunning}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRun}
            disabled={!prompt.trim() || isRunning}
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              "Run"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
