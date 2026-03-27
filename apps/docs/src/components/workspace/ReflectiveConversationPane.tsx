"use client";

import { resolveDesignProbeAction } from "@/app/actions/design-probe-actions";
import { PromptDiff } from "@/components/form/configurator/PromptDiff";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { useDesignProbes } from "@/hooks/query/design-probes";
import { usePipelineGenerate } from "@/hooks/query/pipeline";
import { useUpdatePortfolio } from "@/hooks/query/portfolios";
import { useProvenance } from "@/hooks/query/provenance";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import {
  parseFromMarkdown,
  serializeToMarkdown,
} from "@/lib/engine/structured-intent";
import type { Portfolio, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DesignProbeResolvedDialog } from "./DesignProbeResolvedDialog";
import { ResolvedStack } from "./ResolvedStack";

interface ReflectiveConversationPaneProps {
  portfolio: Portfolio;
}

/**
 * ReflectiveConversationPane — the primary elicitation workspace.
 * Named after Rost/Schön's "reflective conversation": interaction as a
 * sequence of moves (user) and backtalk (system) where meaning emerges
 * through reciprocal exchange, not upfront specification.
 */
export function ReflectiveConversationPane({
  portfolio,
}: ReflectiveConversationPaneProps) {
  const portfolioSchema = portfolio.schema as unknown as PortfolioSchema;

  const editorRef = useRef<HTMLDivElement>(null);
  const [structuredIntent, setStructuredIntent] = useState<StructuredIntent>(
    portfolio.intent,
  );
  const updatePortfolio = useUpdatePortfolio();
  const queryClient = useQueryClient();

  // Markdown projection of the structured intent for the editor
  const editorValue = useMemo(
    () => serializeToMarkdown(structuredIntent),
    [structuredIntent],
  );

  // Pipeline hook replaces the old handleGenerate
  const pipeline = usePipelineGenerate(portfolio.id);

  // Prompt-based edit state
  const [promptEditOpen, setPromptEditOpen] = useState(false);
  const [promptEditText, setPromptEditText] = useState("");
  const [isPromptEditing, setIsPromptEditing] = useState(false);
  const [error, setError] = useState<string | null | undefined>();

  const { data: provenanceEntries } = useProvenance(portfolio.id);

  // Derive previousIntent from the latest provenance entry
  // TODO Here we might have a bug: sometimes I have to search for provenanceEntries?.[1]?.prev_intent?.purpose.content in order to get the actual last change, because there will not always be changes for this entity as of now. I do not know, if we need to dix the processing somewhere else or if we need to fix the retrieval right here.
  const latestEntry = provenanceEntries?.[0] ?? null;
  const previousIntent = latestEntry?.prev_intent?.purpose.content ?? null;
  const [showDiff, setShowDiff] = useState(false);
  console.log(previousIntent, promptEditText);
  // Sync structured intent from portfolio when it changes externally
  useEffect(() => {
    setStructuredIntent(portfolio.intent);
  }, [portfolio.intent]);

  // Parse markdown from editor back into structured intent
  const handleEditorChange = useCallback((markdown: string) => {
    setStructuredIntent((prev) => parseFromMarkdown(markdown, prev));
  }, []);

  // -------------------------------------------------------------------
  // Button: Smart pipeline generate
  // -------------------------------------------------------------------
  const handleGenerate = async () => {
    if (!structuredIntent.purpose.content.trim() || isGenerating) return;

    setError(null);

    try {
      const result = await pipeline.mutateAsync({
        previousIntent: portfolio.intent,
        currentIntent: structuredIntent,
        currentSchema: portfolioSchema,
      });

      if (result.strategy.kind === "noop") {
        setError("No changes detected. Edit the intent to regenerate.");
        return;
      }

      setStructuredIntent(result.intent);
    } catch (err) {
      console.error("[ReflectiveConversationPane] Generation error:", err);
      setError(err instanceof Error ? err.message : "Generation failed");
    }
  };

  // -------------------------------------------------------------------
  // Prompt-based edit
  // -------------------------------------------------------------------
  const handlePromptEdit = async () => {
    if (!promptEditText.trim() || isGenerating || !portfolio) return;

    setIsPromptEditing(true);
    setError(null);

    try {
      const response = await resolveDesignProbeAction({
        intent: structuredIntent,
        currentSchema: portfolioSchema,
        interactionText: "User requested a direct prompt-based edit",
        selectedOptionLabel: promptEditText.trim(),
        maxFollowUps: 0,
      });

      if (response.success && response.result) {
        const editDiff = diffSchemas(
          portfolioSchema,
          response.result.artifactFormSchema,
        );

        await updatePortfolio.mutateAsync({
          id: portfolio.id,
          intent: structuredIntent,
          schema: response.result.artifactFormSchema,
        });

        await logProvenance(
          portfolio.id,
          "configuration",
          "prompt_edit",
          "creator",
          editDiff,
          promptEditText.trim(),
          { intent: structuredIntent, schema: portfolioSchema },
        );
        queryClient.invalidateQueries({
          queryKey: ["provenance", portfolio.id],
        });

        setPromptEditText("");
        setPromptEditOpen(false);
      } else {
        setError(response.error || "Failed to apply edit");
      }
    } catch (err) {
      console.error("[ReflectiveConversationPane] Prompt edit error:", err);
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setIsPromptEditing(false);
    }
  };

  // -------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------
  const isGenerating = pipeline.isPending || isPromptEditing;
  console.log("Prev intent: ", previousIntent);
  return (
    <div className="flex flex-col h-full">
      {/* Intent Editor — single field, structured data underneath */}
      <div className="space-y-3">
        <div className="flex items-center justify-between h-8 mb-3">
          <h3 className="workspace-section-label">Intent</h3>
          {previousIntent && previousIntent !== editorValue && (
            <Button
              onClick={() => setShowDiff(!showDiff)}
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-muted-foreground/60 hover:text-foreground"
            >
              {!showDiff ? "View" : "Hide"} changes
            </Button>
          )}
        </div>
        <div className="relative overflow-hidden rounded-2xl">
          {/* Animated gradient when processing */}
          <div
            className={cn(
              isGenerating
                ? "pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,#ff6ec4,#7873f5,#4ade80,#60a5fa)] bg-size-[400%_400%] animate-[gradient_3s_ease_infinite] opacity-30 z-10 rounded-2xl"
                : "",
            )}
          />

          {showDiff && previousIntent ? (
            <div
              className="border rounded-2xl p-2.5 bg-muted/30 cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setShowDiff(false)}
            >
              <PromptDiff previous={previousIntent} current={editorValue} />
            </div>
          ) : (
            <div data-testid="intent-editor">
              <MarkdownEditor
                ref={editorRef}
                placeholder="Describe what this form is for, who will use it, and what data you need to collect..."
                value={editorValue}
                className={cn(
                  "rounded-2xl relative border shadow-sm",
                  isGenerating
                    ? "bg-transparent"
                    : "focus-within:shadow-md focus-within:border-ring/30 transition-shadow duration-200",
                )}
                onChange={handleEditorChange}
                disabled={isGenerating || promptEditOpen}
              />
            </div>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="rounded-lg bg-destructive/8 text-destructive px-4 py-3 text-sm border border-destructive/15">
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pb-6">
          {promptEditOpen ? (
            <div className="flex-1 space-y-2">
              <textarea
                placeholder="Describe the change you want to make to the form..."
                value={promptEditText}
                onChange={(e) => setPromptEditText(e.target.value)}
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm resize-none shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/30 transition-shadow"
                disabled={isGenerating}
              />
              <Button
                size="sm"
                onClick={handlePromptEdit}
                disabled={!promptEditText.trim() || isGenerating}
                className="w-full btn-brand font-sans"
              >
                Apply Edit
              </Button>
            </div>
          ) : (
            <Button
              data-testid="generate-form-btn"
              data-loading={isGenerating ? "true" : undefined}
              onClick={handleGenerate}
              disabled={
                !structuredIntent.purpose.content.trim() || isGenerating
              }
              className="flex-1 btn-brand font-sans"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {portfolioSchema.fields.length > 0
                    ? "Refine Form"
                    : "Generate Form"}
                </>
              )}
            </Button>
          )}
          {/* {portfolioSchema.fields.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setPromptEditOpen(!promptEditOpen)}
              disabled={isGenerating}
              className="shadow-sm font-sans"
            >
              {!promptEditOpen ? (
                "Prompt Edit"
              ) : (
                <>
                  Close
                  <XIcon />
                </>
              )}
            </Button>
          )} */}
        </div>
        <ResolvedSection portfolioId={portfolio.id} />
      </div>
    </div>
  );
}

const ResolvedSection = ({ portfolioId }: { portfolioId: string }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: designProbes } = useDesignProbes(portfolioId);

  if (!designProbes?.length) return null;

  // Resolved probes in chronological order (oldest first) for the history stack
  const resolvedProbes = [
    ...designProbes.filter((o) => o.status === "resolved"),
  ].reverse();
  return (
    <>
      <ResolvedStack
        resolvedProbes={resolvedProbes}
        onViewAll={() => setDialogOpen(true)}
      />
      <DesignProbeResolvedDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        resolvedProbes={resolvedProbes}
      />
    </>
  );
};
