"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCapabilities } from "@/context/capabilities-context";
import { useStudyLog } from "@/context/study-context";
import { useCurrentUser } from "@/context/user-context";
import { useCommitPortfolio, useUpdatePortfolio } from "@/hooks/query/portfolios";
import { useSchemaDraft } from "@/hooks/query/schema-generation";
import { useUndoToast } from "@/hooks/query/undo";
import { formatActor } from "@/lib/mock-users";
import {
  moveFieldBy,
  moveFieldNextTo,
  moveSection,
  removeSection,
  updateSection,
} from "interact/forms/sections";
import { previewSchemaChange } from "interact/forms/probe-preview";
import { describeSchemaChange } from "interact/forms/guards";
import {
  FormRenderer,
  type FieldMark,
  type FieldMove,
} from "@/lib/form-renderer/FormRenderer";
import { draftSchema } from "@/lib/schema-stream";
import type { Field, FieldGroup, Portfolio, PortfolioSchema } from "@/lib/types";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  Files,
  Loader2,
  Network,
  ShareIcon,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AddFieldInline } from "./AddFieldInline";
import { PretestDialog } from "./PretestDialog";
import { SectionDialog, type SectionEdit } from "./SectionDialog";
import { ArtifactCanvas, scrollIntoCanvasView } from "./ArtifactCanvas";
import {
  useConflictMarks,
  useDeckFocus,
  useProbePreview,
} from "./deck-canvas-context";

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

interface ArtifactPaneProps {
  portfolio: Portfolio;
  onFieldClick?: (field: Field) => void;
  onFieldsAdded?: (fields: Field[]) => Promise<void>;
}

/** Names of fields that are new or changed between two schema versions. */
function changedFieldNames(
  prev: PortfolioSchema,
  next: PortfolioSchema,
): string[] {
  const before = new Map(prev.fields.map((f) => [f.id, JSON.stringify(f)]));
  return next.fields
    .filter((f) => before.get(f.id) !== JSON.stringify(f))
    .map((f) => f.name);
}

function fieldElement(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-testid="form-field-${CSS.escape(name)}"]`,
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ArtifactPane({
  portfolio,
  onFieldClick,
  onFieldsAdded,
}: ArtifactPaneProps) {
  const schema = portfolio.schema;
  const fieldCount = schema.fields.length;

  // Fields of a form being generated right now (see `useGenerateSchema`).
  // Shown only while the form is still empty: drafts never cover real fields.
  const draft = useSchemaDraft(portfolio.id);
  const arriving = useMemo(
    () => (draft && fieldCount === 0 ? draftSchema(draft) : null),
    [draft, fieldCount],
  );

  // Sections: edit from their heading on the canvas; one page or one per page
  const commitPortfolio = useCommitPortfolio(portfolio.id);
  const capabilities = useCapabilities();
  const notifyUndo = useUndoToast();
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);
  const log = useStudyLog();
  const [editingSection, setEditingSection] = useState<FieldGroup | null>(null);
  const sectionIndex = editingSection
    ? schema.groups.findIndex((g) => g.id === editingSection.id)
    : -1;

  const commitSections = async (
    change: (s: PortfolioSchema) => PortfolioSchema,
    rationale: string,
  ) => {
    try {
      const result = await commitPortfolio.mutateAsync((current) => ({
        trigger: "field-edit",
        schema: change(current.schema),
        provenance: { layer: "configuration", action: "sections_edited", actor, rationale },
      }));
      notifyUndo(result, rationale);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the sections");
    }
  };

  const handleSectionEdit = (edit: SectionEdit) => {
    const section = editingSection;
    if (!section) return;
    if (edit.kind === "move") {
      // Keep the dialog open on the moved section
      void commitSections(
        (s) => moveSection(s, section.id, edit.delta),
        `Moved section "${section.label}" ${edit.delta < 0 ? "up" : "down"}`,
      );
      return;
    }
    setEditingSection(null);
    if (edit.kind === "remove") {
      void commitSections(
        (s) => removeSection(s, section.id),
        `Removed section "${section.label}" (its fields stay)`,
      );
    } else {
      void commitSections(
        (s) => updateSection(s, section.id, edit),
        edit.label.trim() !== section.label
          ? `Renamed section "${section.label}" to "${edit.label.trim()}"`
          : `Edited the intro of section "${section.label}"`,
      );
    }
  };

  // Direct manipulation: drag a field (or step it with the arrow keys)
  const handleFieldMove = (move: FieldMove) => {
    const label =
      schema.fields.find((f) => f.id === move.fieldId)?.label ?? "a field";
    const rationale =
      "targetId" in move
        ? `Moved "${label}" ${move.place} "${schema.fields.find((f) => f.id === move.targetId)?.label ?? "another field"}"`
        : `Moved "${label}" ${move.delta < 0 ? "up" : "down"}`;
    log("field_moved", {
      fieldId: move.fieldId,
      ...("targetId" in move
        ? { targetId: move.targetId, place: move.place, via: "drag" }
        : { delta: move.delta, via: "keyboard" }),
    });
    void (async () => {
      try {
        await commitPortfolio.mutateAsync((current) => ({
          trigger: "field-edit",
          schema:
            "targetId" in move
              ? moveFieldNextTo(current.schema, move.fieldId, move.targetId, move.place)
              : moveFieldBy(current.schema, move.fieldId, move.delta),
          provenance: { layer: "configuration", action: "field_moved", actor, rationale },
        }));
        // Keep the handle focused for the next arrow key press
        if (!("targetId" in move)) {
          const name = schema.fields.find((f) => f.id === move.fieldId)?.name;
          requestAnimationFrame(() =>
            (name ? fieldElement(name) : null)
              ?.querySelector<HTMLElement>('[data-testid="field-move-handle"]')
              ?.focus(),
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't move the field");
      }
    })();
  };

  // AI help for respondents — opt-in per form, saved with the schema
  const canSetAssist = capabilities.respondentAssist;
  const assist = schema.assist ?? {};
  const assistOn = !!(assist.explain || assist.prefill);
  const toggleAssist = (key: "explain" | "prefill", label: string) =>
    commitSections(
      (s) => {
        const next = { ...s.assist, [key]: !s.assist?.[key] };
        return { ...s, assist: next.explain || next.prefill ? next : undefined };
      },
      `${assist[key] ? "Turned off" : "Turned on"} "${label}" for respondents`,
    );

  const paged = schema.layout === "paged";
  const togglePaged = () =>
    commitSections(
      (s) => ({ ...s, layout: paged ? "single" : "paged" }),
      paged ? "Show all sections on one page" : "Show one section per page",
    );

  // Track which fields changed since the last render of this portfolio so
  // AI-driven edits (probes, voice, conflict fixes) are visible where they
  // land — "adjusting state while rendering" instead of an effect.
  const [seen, setSeen] = useState({ id: portfolio.id, schema });
  const [changed, setChanged] = useState<string[]>([]);
  if (seen.schema !== schema || seen.id !== portfolio.id) {
    setSeen({ id: portfolio.id, schema });
    setChanged(
      seen.id === portfolio.id ? changedFieldNames(seen.schema, schema) : [],
    );
  }

  // Flash the changed fields, then clear the notice after a while.
  useEffect(() => {
    if (changed.length === 0) return;
    if (!prefersReducedMotion()) {
      for (const name of changed) {
        fieldElement(name)?.animate(
          [
            { backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)" },
            { backgroundColor: "transparent" },
          ],
          { duration: 2400, easing: "ease-out" },
        );
      }
    }
    const t = setTimeout(() => setChanged([]), 8000);
    return () => clearTimeout(t);
  }, [changed]);

  const showFirstChange = () => {
    const el = changed.map(fieldElement).find(Boolean);
    if (el) {
      scrollIntoCanvasView(el, {
        block: "center",
        smooth: !prefersReducedMotion(),
      });
    }
  };

  // A probe answer or conflict fix hovered in the deck: show what it'd do
  const probePreview = useProbePreview();
  const preview = useMemo(() => {
    if (!probePreview) return null;
    const next = probePreview.apply(schema);
    return {
      ...previewSchemaChange(schema, next),
      // What changes about fields the creator already has
      notes: describeSchemaChange(schema, next),
    };
  }, [schema, probePreview]);

  // Fields involved in a detected conflict; the open conflict stands out.
  // Clicking a marker opens that conflict in the deck.
  const { marks: conflicts, activeId: activeConflictId } = useConflictMarks();
  const [, setDeckFocus] = useDeckFocus();
  const fieldMarks = useMemo(() => {
    const byField: Record<string, FieldMark> = {};
    const ordered = [...conflicts].sort(
      (a, b) =>
        Number(b.id === activeConflictId) - Number(a.id === activeConflictId) ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    for (const conflict of ordered) {
      for (const fieldId of conflict.fieldIds) {
        byField[fieldId] ??= {
          tone: conflict.severity,
          label: conflict.label,
          title: conflict.description,
          emphasized: conflict.id === activeConflictId,
          onClick: () => setDeckFocus(conflict.id),
        };
      }
    }
    return byField;
  }, [conflicts, activeConflictId, setDeckFocus]);

  // Opening a conflict brings its fields into view
  const activeConflictField = conflicts
    .find((c) => c.id === activeConflictId)
    ?.fieldIds.map((id) => schema.fields.find((f) => f.id === id)?.name)
    .find(Boolean);
  useEffect(() => {
    const el = activeConflictField && fieldElement(activeConflictField);
    if (el) {
      scrollIntoCanvasView(el, {
        block: "nearest",
        smooth: !prefersReducedMotion(),
      });
    }
  }, [activeConflictField]);
  const previewChanges = preview ? Object.keys(preview.annotations) : [];

  // Bring the first previewed change into view (only if it's off screen)
  const firstPreviewChange = preview?.schema.fields.find(
    (f) => preview.annotations[f.id],
  )?.name;
  useEffect(() => {
    const el = firstPreviewChange && fieldElement(firstPreviewChange);
    if (el) {
      scrollIntoCanvasView(el, {
        block: "nearest",
        smooth: !prefersReducedMotion(),
      });
    }
  }, [firstPreviewChange]);

  const toolbar = (
    <>
      <div className="flex h-8 items-center gap-2 rounded-lg border bg-background/90 px-2.5 shadow-sm backdrop-blur">
        <h3 className="workspace-section-label">Artifact</h3>
        <span
          data-testid="field-count"
          className="text-xs text-muted-foreground tabular-nums"
        >
          {fieldCount} field{fieldCount !== 1 ? "s" : ""}
        </span>
        {schema.groups.length > 0 && (
          <button
            type="button"
            data-testid="toggle-paged"
            aria-pressed={paged}
            onClick={togglePaged}
            disabled={commitPortfolio.isPending}
            title={
              paged
                ? "Respondents see one section per page — click to show all on one page"
                : "Respondents see all sections on one page — click to show one per page"
            }
            className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/10 aria-pressed:text-foreground"
          >
            <Files className="h-3 w-3" aria-hidden />
            {paged ? "Page per section" : "One page"}
          </button>
        )}
        {canSetAssist && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="respondent-assist"
                data-on={assistOn}
                title="AI help for the people filling in this form (off unless you turn it on)"
                className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[on=true]:bg-primary/10 data-[on=true]:text-foreground"
              >
                <Sparkles className="h-3 w-3" aria-hidden />
                {assistOn ? "AI help on" : "AI help"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Help for respondents. Their text is sent to the AI service
                only when they use it.
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                data-testid="assist-explain"
                checked={!!assist.explain}
                disabled={commitPortfolio.isPending}
                onCheckedChange={() => toggleAssist("explain", "What does this mean?")}
              >
                &ldquo;What does this mean?&rdquo; on each question
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                data-testid="assist-prefill"
                checked={!!assist.prefill}
                disabled={commitPortfolio.isPending}
                onCheckedChange={() => toggleAssist("prefill", "Fill in from a text")}
              >
                Fill in the form from a text they write
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {conflicts.length > 0 && (
          <button
            type="button"
            data-testid="conflict-count"
            onClick={() => setDeckFocus(conflicts[0].id)}
            title="Show the first conflict"
            className="flex cursor-pointer items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
          >
            <TriangleAlert className="h-3 w-3" aria-hidden />
            {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>
      {/* Pretest issues become elicitation questions, so no deck, no pretest */}
      {capabilities.designProbes && capabilities.pretest && fieldCount > 0 && (
        <div className="flex h-8 items-center gap-0.5 rounded-lg border bg-background/90 px-0.5 shadow-sm backdrop-blur">
          <PretestDialog portfolio={portfolio} />
        </div>
      )}
      {(capabilities.publish || capabilities.derive) && (
        <div className="flex h-8 items-center gap-0.5 rounded-lg border bg-background/90 px-0.5 shadow-sm backdrop-blur">
          {capabilities.publish && <PublishDialog portfolio={portfolio} />}
          {capabilities.derive && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-7 text-xs"
              asChild
            >
              <Link
                href={`/portfolios/${portfolio.id}/derive`}
                title="Derive a variant of this form for a specific scenario"
              >
                <Network className="h-3.5 w-3.5" aria-hidden />
                Derive variant
              </Link>
            </Button>
          )}
        </div>
      )}
    </>
  );

  const overlay = probePreview ? (
    <div
      role="status"
      data-testid="probe-preview-notice"
      className="flex max-w-full items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur"
    >
      <Eye className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="truncate">
        <span className="font-medium">{probePreview.label}</span>
        <span className="text-muted-foreground">
          {" "}
          —{" "}
          {previewChanges.length > 0
            ? probePreview.summary
            : "no change to the form"}
        </span>
      </span>
      <span className="shrink-0 text-muted-foreground/70">· click to apply</span>
    </div>
  ) : changed.length > 0 ? (
    <div
      role="status"
      className="flex items-center gap-3 rounded-full border border-primary/20 bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur"
    >
      <span>
        {changed.length} field{changed.length !== 1 ? "s" : ""} added or
        changed
      </span>
      <button
        type="button"
        onClick={showFirstChange}
        className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        Show
      </button>
    </div>
  ) : null;

  // First generation under way: the fields written so far, as drafts.
  // They can't be edited or moved — the form exists once it is committed.
  if (arriving) {
    return (
      <ArtifactCanvas
        toolbar={toolbar}
        overlay={
          <div
            role="status"
            className="flex items-center gap-2 rounded-full border border-primary/20 bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
            <span>
              {arriving.fields.length === 0
                ? "Writing your form…"
                : `Writing your form… ${arriving.fields.length} field${arriving.fields.length !== 1 ? "s" : ""} so far`}
            </span>
          </div>
        }
      >
        <div className="p-6" aria-busy="true" data-testid="form-arriving">
          {arriving.fields.length > 0 && (
            <div inert className="select-none opacity-70">
              <FormRenderer schema={arriving} mode="preview" className="space-y-4" />
            </div>
          )}
          <div
            className="mt-4 h-9 rounded-lg border border-dashed border-primary/30 bg-primary/5 animate-pulse motion-reduce:animate-none"
            aria-hidden
          />
        </div>
      </ArtifactCanvas>
    );
  }

  return (
    <ArtifactCanvas toolbar={toolbar} overlay={overlay}>
      <div className="p-6">
        <FormRenderer
          schema={preview?.schema ?? schema}
          mode="preview"
          onFieldClick={preview ? undefined : onFieldClick}
          onSectionClick={preview ? undefined : setEditingSection}
          fieldAnnotations={preview?.annotations}
          fieldChangeNotes={preview?.notes}
          onFieldMove={preview ? undefined : handleFieldMove}
          fieldMarks={preview ? undefined : fieldMarks}
          className="space-y-4"
        />
        {onFieldsAdded && !preview && (
          <div className="mt-4">
            <AddFieldInline schema={schema} intent={portfolio.intent} onFieldsAdded={onFieldsAdded} />
          </div>
        )}
      </div>
      <SectionDialog
        section={
          editingSection
            ? (schema.groups.find((g) => g.id === editingSection.id) ?? null)
            : null
        }
        index={sectionIndex}
        count={schema.groups.length}
        onOpenChange={(open) => !open && setEditingSection(null)}
        onEdit={handleSectionEdit}
      />
    </ArtifactCanvas>
  );
}

// ---------------------------------------------------------------------------
// Publish — sets the status and hands out the respondent link
// ---------------------------------------------------------------------------

function PublishDialog({ portfolio }: { portfolio: Portfolio }) {
  const updatePortfolio = useUpdatePortfolio();
  const [copied, setCopied] = useState(false);
  const isPublished = portfolio.status === "published";
  const formPath = `/forms/${portfolio.id}`;

  const formUrl = () => {
    // Respect a deployment basePath: everything before /portfolios/
    const base = window.location.pathname.split("/portfolios/")[0];
    return `${window.location.origin}${base}${formPath}`;
  };

  const setStatus = (status: "draft" | "published") =>
    updatePortfolio.mutate(
      { id: portfolio.id, status },
      {
        onSuccess: () =>
          toast.success(
            status === "published" ? "Form published" : "Form unpublished",
          ),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to update status",
          ),
      },
    );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(formUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 text-xs"
        >
          <ShareIcon className="h-3.5 w-3.5" aria-hidden />
          {isPublished ? "Published" : "Publish"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Share form
            <Badge variant={isPublished ? "default" : "secondary"}>
              {portfolio.status}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {isPublished
              ? "Respondents can fill in the form at this link. The form keeps evolving as you refine it."
              : "Publishing marks the form as ready for respondents. You can keep refining it afterwards."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            readOnly
            aria-label="Form link"
            value={typeof window === "undefined" ? formPath : formUrl()}
            onFocus={(e) => e.currentTarget.select()}
            className="text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyLink}
            aria-label="Copy form link"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={formPath} target="_blank">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open form
            </Link>
          </Button>
          <Button
            size="sm"
            variant={isPublished ? "outline" : "default"}
            disabled={updatePortfolio.isPending}
            onClick={() => setStatus(isPublished ? "draft" : "published")}
          >
            {isPublished ? "Unpublish" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
