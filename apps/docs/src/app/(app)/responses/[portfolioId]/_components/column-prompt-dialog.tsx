"use client";

import { deriveFieldsFromPromptAction } from "@/app/actions/column-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/context/user-context";
import { useCommitPortfolio } from "@/hooks/query/portfolios";
import { useUndoToast } from "@/hooks/query/undo";
import { addField } from "@/lib/engine/schema-ops";
import type { ResponseRowLike } from "@/lib/form-renderer/response-rows";
import { ResponseValue } from "@/lib/form-renderer/ResponseValue";
import { formatActor } from "@/lib/mock-users";
import type { Field, Portfolio, SavedColumnAction } from "@/lib/types";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type ColumnRunResult, useColumnAction } from "./use-column-action";

/** Changed rows listed in the preview before collapsing into "+N more". */
const PREVIEW_ROWS = 15;

export interface ColumnActionTarget {
  field: Field;
  /** Re-running a saved action: prompt is prefilled, nothing new is saved */
  savedAction?: SavedColumnAction;
}

interface ColumnPromptDialogProps {
  target: ColumnActionTarget | null;
  onClose: () => void;
  portfolio: Portfolio;
  responses: ResponseRowLike[];
}

export function ColumnPromptDialog({
  target,
  onClose,
  portfolio,
  responses,
}: ColumnPromptDialogProps) {
  // Lives as long as the table, so the post-apply "Undo" keeps working
  // after the dialog has closed.
  const columnAction = useColumnAction(portfolio);

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {target && (
          <ColumnPromptBody
            key={`${target.field.id}:${target.savedAction?.id ?? "custom"}`}
            target={target}
            portfolio={portfolio}
            responses={responses}
            columnAction={columnAction}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Phase = "edit" | "running" | "preview" | "applying";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function ColumnPromptBody({
  target,
  portfolio,
  responses,
  columnAction,
  onClose,
}: {
  target: ColumnActionTarget;
  portfolio: Portfolio;
  responses: ResponseRowLike[];
  columnAction: ReturnType<typeof useColumnAction>;
  onClose: () => void;
}) {
  const { field, savedAction } = target;
  const [prompt, setPrompt] = useState(savedAction?.prompt ?? "");
  const [remember, setRemember] = useState(false);
  const [phase, setPhase] = useState<Phase>("edit");
  const [preview, setPreview] = useState<ColumnRunResult | null>(null);
  const { currentUser } = useCurrentUser();
  const commit = useCommitPortfolio(portfolio.id);
  const notifyCommit = useUndoToast();

  const busy = phase === "running" || phase === "applying";
  const { progress } = columnAction;

  const handlePreview = async () => {
    const instruction = prompt.trim();
    if (!instruction || responses.length === 0) return;
    setPhase("running");
    try {
      const result = await columnAction.run(field, instruction, responses);
      setPreview(result);
      setPhase("preview");
      if (result.errors.length > 0 && result.missing === result.total) {
        toast.error(`Column action failed: ${result.errors[0]}`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to process the column",
      );
      setPhase("edit");
    }
  };

  /** Derive fields for future submissions and save the action (one commit). */
  const saveAction = async (instruction: string) => {
    const derived = await deriveFieldsFromPromptAction(
      field,
      instruction,
      portfolio.schema.fields.map((f) => f.name),
    );
    if (!derived.success) {
      toast.warning(
        `Couldn't design new fields (${derived.error ?? "unknown error"}) — saving the action only.`,
      );
    }
    const label = derived.label?.trim() || instruction.slice(0, 50);
    let addedCount = 0;

    const result = await commit.mutateAsync((current) => {
      const taken = new Set(current.schema.fields.map((f) => f.name));
      const newFields = (derived.newFields ?? []).filter(
        (f) => !taken.has(f.name),
      );
      addedCount = newFields.length;
      let schema = current.schema;
      for (const f of newFields) schema = addField(schema, f);
      const action: SavedColumnAction = {
        id: `action-${crypto.randomUUID()}`,
        fieldId: field.id,
        prompt: instruction,
        label,
        addedFields: newFields,
        createdAt: new Date().toISOString(),
      };
      return {
        schema: {
          ...schema,
          columnActions: [...(schema.columnActions ?? []), action],
        },
        provenance: {
          layer: "configuration",
          action: "column_action_saved",
          actor: formatActor(currentUser),
          rationale: `Saved column action "${label}" on "${field.label}": ${instruction}`,
        },
      };
    });

    notifyCommit(
      result,
      addedCount > 0
        ? `Saved action "${label}" — ${plural(addedCount, "new field")} added`
        : `Saved action "${label}"`,
    );
  };

  const handleApply = async () => {
    if (!preview) return;
    const instruction = prompt.trim();
    setPhase("applying");
    try {
      if (preview.changes.length > 0) {
        const applied = await columnAction.apply(preview);
        const failedNote = applied.failed.length
          ? ` — ${applied.failed.length} failed (${applied.error})`
          : "";
        const message = `Updated ${plural(applied.updated, "response")} in "${field.label}"${failedNote}`;
        const show = applied.failed.length ? toast.warning : toast.success;
        show(message, {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await columnAction.revert(preview, applied.failed);
                toast("Column change undone");
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to undo",
                );
              }
            },
          },
        });
      }
      if (remember && !savedAction) {
        await saveAction(instruction);
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to apply the changes",
      );
      setPhase("preview");
    }
  };

  const canSaveOnly = remember && !savedAction;
  const applyLabel =
    preview && preview.changes.length > 0
      ? `Apply ${plural(preview.changes.length, "change")}`
      : "Save action only";

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {savedAction ? savedAction.label : "Column action"}: {field.label}
        </DialogTitle>
        <DialogDescription>
          {phase === "preview" || phase === "applying"
            ? "Review the changes. Nothing has been written yet."
            : `Run a prompt against all ${plural(responses.length, "value")} in this column. You'll see a preview before anything is changed.`}
        </DialogDescription>
      </DialogHeader>

      {(phase === "edit" || phase === "running") && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="column-prompt">Prompt</Label>
            <Textarea
              id="column-prompt"
              placeholder={`e.g. "Extract the city name from this address"`}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy || !!savedAction}
            />
          </div>

          {!savedAction && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(checked) => setRemember(checked === true)}
                disabled={busy}
              />
              <Label htmlFor="remember" className="text-sm font-normal">
                Remember this activity — derive new fields for future responses
              </Label>
            </div>
          )}

          {phase === "running" && progress && (
            <div className="space-y-1" role="status" aria-live="polite">
              <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Processed {progress.done} of {progress.total} rows…
              </p>
            </div>
          )}
        </div>
      )}

      {(phase === "preview" || phase === "applying") && preview && (
        <PreviewSummary preview={preview} field={field} />
      )}

      <DialogFooter>
        {(phase === "preview" || phase === "applying") && (
          <Button
            variant="ghost"
            onClick={() => setPhase("edit")}
            disabled={busy}
            className="sm:mr-auto"
          >
            Back
          </Button>
        )}
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {phase === "edit" || phase === "running" ? (
          <Button
            onClick={handlePreview}
            disabled={!prompt.trim() || busy || responses.length === 0}
          >
            {phase === "running" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Running…
              </>
            ) : (
              "Preview changes"
            )}
          </Button>
        ) : (
          <Button
            onClick={handleApply}
            disabled={
              busy || !preview || (preview.changes.length === 0 && !canSaveOnly)
            }
          >
            {phase === "applying" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Applying…
              </>
            ) : (
              applyLabel
            )}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function PreviewSummary({
  preview,
  field,
}: {
  preview: ColumnRunResult;
  field: Field;
}) {
  const shown = preview.changes.slice(0, PREVIEW_ROWS);
  const notes: string[] = [];
  if (preview.unchanged > 0) notes.push(`${preview.unchanged} unchanged`);
  if (preview.invalid.length > 0) {
    const examples = preview.invalid
      .slice(0, 2)
      .map((i) => `row ${i.position}: "${i.raw}" ${i.reason}`)
      .join("; ");
    notes.push(
      `${plural(preview.invalid.length, "result")} skipped — not a valid ${field.type.kind} (${examples})`,
    );
  }
  if (preview.skippedParent > 0) {
    notes.push(
      `${plural(preview.skippedParent, "parent row")} skipped — this field doesn't exist in the parent form`,
    );
  }
  if (preview.missing > 0) {
    notes.push(`${plural(preview.missing, "row")} got no result`);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium">
          {plural(preview.changes.length, "change")}
        </span>{" "}
        of {plural(preview.total, "row")}
        {notes.length > 0 && (
          <span className="text-muted-foreground"> · {notes.join(" · ")}</span>
        )}
      </p>
      {preview.errors.length > 0 && (
        <p className="text-sm text-destructive" role="alert">
          Some batches failed: {preview.errors.join("; ")}
        </p>
      )}
      {shown.length > 0 && (
        <div className="max-h-72 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Row</TableHead>
                <TableHead>Before</TableHead>
                <TableHead className="w-6" aria-hidden />
                <TableHead>After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((change) => (
                <TableRow key={change.row.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {change.position}
                  </TableCell>
                  <TableCell className="max-w-56 text-sm">
                    <ResponseValue
                      value={change.oldValue}
                      field={field}
                      emptyLabel="(empty)"
                    />
                  </TableCell>
                  <TableCell aria-hidden>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </TableCell>
                  <TableCell className="max-w-56 text-sm font-medium">
                    <ResponseValue
                      value={change.newValue}
                      field={field}
                      emptyLabel="(empty)"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {preview.changes.length > shown.length && (
        <p className="text-xs text-muted-foreground">
          … and {preview.changes.length - shown.length} more
        </p>
      )}
    </div>
  );
}
