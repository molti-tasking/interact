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
import { useUpdatePortfolio } from "@/hooks/query/portfolios";
import { previewSchemaChange } from "@/lib/engine/probe-preview";
import {
  FormRenderer,
  type FieldMark,
} from "@/lib/form-renderer/FormRenderer";
import type { Field, Portfolio, PortfolioSchema } from "@/lib/types";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  Network,
  ShareIcon,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AddFieldInline } from "./AddFieldInline";
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
  const preview = useMemo(
    () =>
      probePreview
        ? previewSchemaChange(schema, probePreview.apply(schema))
        : null,
    [schema, probePreview],
  );

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
      <div className="flex h-8 items-center gap-0.5 rounded-lg border bg-background/90 px-0.5 shadow-sm backdrop-blur">
        <PublishDialog portfolio={portfolio} />
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
      </div>
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

  return (
    <ArtifactCanvas toolbar={toolbar} overlay={overlay}>
      <div className="p-6">
        <FormRenderer
          schema={preview?.schema ?? schema}
          mode="preview"
          onFieldClick={preview ? undefined : onFieldClick}
          fieldAnnotations={preview?.annotations}
          fieldMarks={preview ? undefined : fieldMarks}
          className="space-y-4"
        />
        {onFieldsAdded && !preview && (
          <div className="mt-4">
            <AddFieldInline schema={schema} onFieldsAdded={onFieldsAdded} />
          </div>
        )}
      </div>
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
