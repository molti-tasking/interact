"use client";

import { processColumnPromptAction } from "@/app/actions/column-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBulkUpdateResponses } from "@/hooks/query/responses-new";
import type {
  Field,
  FormResponse,
  Portfolio,
  SavedColumnAction,
} from "@/lib/types";
import { MoreVertical, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ColumnPromptDialog } from "./column-prompt-dialog";

interface ColumnHeaderProps {
  field: Field;
  portfolio: Portfolio;
  responses: FormResponse[];
}

export function ColumnHeader({
  field,
  portfolio,
  responses,
}: ColumnHeaderProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const bulkUpdate = useBulkUpdateResponses();

  const schema = portfolio.schema;
  const savedActions = (schema.columnActions ?? []).filter(
    (a) => a.fieldId === field.id,
  );

  const handleRunSavedAction = async (action: SavedColumnAction) => {
    setRunningActionId(action.id);
    try {
      const responseData = responses.map((r) => ({
        responseId: r.id,
        value: r.data[field.name] ?? null,
      }));

      const result = await processColumnPromptAction(
        field,
        action.prompt,
        responseData,
      );

      if (!result.success || !result.results) {
        toast.error(result.error ?? "Failed to run action");
        return;
      }

      const updates = responses
        .filter((r) => result.results![r.id] !== undefined)
        .map((r) => ({
          id: r.id,
          portfolioId: r.portfolioId,
          data: { ...r.data, [field.name]: result.results![r.id] },
        }));

      if (updates.length > 0) {
        await bulkUpdate.mutateAsync(updates);
      }

      toast.success(`"${action.label}" applied to ${updates.length} responses`);
    } catch (error) {
      console.error("Saved action error:", error);
      toast.error("Failed to run saved action");
    } finally {
      setRunningActionId(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <span>{field.label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {savedActions.length > 0 && (
            <>
              {savedActions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  onClick={() => handleRunSavedAction(action)}
                  disabled={runningActionId === action.id}
                >
                  <Zap className="mr-2 h-3.5 w-3.5" />
                  {runningActionId === action.id ? "Running..." : action.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => setDialogOpen(true)}>
            <Sparkles className="mr-2 h-3.5 w-3.5" />
            Custom prompt...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ColumnPromptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        field={field}
        portfolio={portfolio}
        responses={responses}
      />
    </div>
  );
}
