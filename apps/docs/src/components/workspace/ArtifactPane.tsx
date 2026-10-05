"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { Field, Portfolio, PortfolioSchema } from "@/lib/types";
import { Check, Copy, ExternalLink, Network, ShareIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AddFieldInline } from "./AddFieldInline";

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
    el?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-row justify-between items-center h-8 mb-3">
        <div className="flex items-center gap-2">
          <h3 className="workspace-section-label">Artifact</h3>
          <span
            data-testid="field-count"
            className="text-xs text-muted-foreground tabular-nums"
          >
            {fieldCount} field{fieldCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex gap-1">
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
      </div>

      {changed.length > 0 && (
        <div
          role="status"
          className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs"
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
      )}

      <Card className="flex flex-col overflow-hidden p-0 shadow-none">
        <div className="flex-1 p-5 overflow-auto">
          <FormRenderer
            schema={schema}
            mode="preview"
            onFieldClick={onFieldClick}
            className="space-y-4"
          />
          {onFieldsAdded && (
            <div className="mt-4">
              <AddFieldInline schema={schema} onFieldsAdded={onFieldsAdded} />
            </div>
          )}
        </div>
      </Card>
    </div>
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
