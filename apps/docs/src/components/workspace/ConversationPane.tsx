"use client";

import type {
  ConflictFix,
  SchemaConflict,
} from "@/app/actions/conflict-actions";
import { resolveOpinionInteractionAction } from "@/app/actions/opinion-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StandardCard } from "@/components/workspace/StandardCard";
import {
  useDetectConflicts,
  useResolveConflict,
} from "@/hooks/query/conflicts";
import { useDimensions } from "@/hooks/query/dimensions";
import {
  useDismissOpinion,
  useGenerateOpinions,
  useOpinions,
  useResolveOpinion,
} from "@/hooks/query/opinions";
import { usePipelineGenerate } from "@/hooks/query/pipeline";
import { useUpdatePortfolio } from "@/hooks/query/portfolios";
import {
  useAcceptStandard,
  useDetectedStandards,
  useSkippedStandards,
  useSkipStandard,
} from "@/hooks/query/standards";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import {
  parseFromMarkdown,
  serializeToMarkdown,
} from "@/lib/engine/structured-intent";
import type { Portfolio, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, Sparkles, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OpinionCardDeck } from "./OpinionCardDeck";

interface ConversationPaneProps {
  portfolio: Portfolio;
}

export function ConversationPane({ portfolio }: ConversationPaneProps) {
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

  // --- React Query hooks ---
  const { data: dimensions } = useDimensions(portfolio.id);

  const { data: detectedStandards } = useDetectedStandards(portfolio.id);
  const acceptStandard = useAcceptStandard(portfolio.id);
  const skipStandard = useSkipStandard(portfolio.id);
  const { data: skippedStandardIds } = useSkippedStandards(portfolio.id);

  const { data: opinions } = useOpinions(portfolio.id);
  const generateOpinions = useGenerateOpinions(portfolio.id);
  const resolveOpinion = useResolveOpinion(portfolio.id);
  const dismissOpinion = useDismissOpinion(portfolio.id);

  // Pipeline hook replaces the old handleGenerate
  const pipeline = usePipelineGenerate(portfolio.id);

  // Conflict detection + resolution
  const { data: conflicts } = useDetectConflicts(
    portfolio.id,
    portfolioSchema,
    structuredIntent,
  );
  const resolveConflict = useResolveConflict(portfolio.id);
  const [dismissedConflicts, setDismissedConflicts] = useState<Set<string>>(
    new Set(),
  );

  // Prompt-based edit state
  const [promptEditOpen, setPromptEditOpen] = useState(false);
  const [promptEditText, setPromptEditText] = useState("");
  const [isPromptEditing, setIsPromptEditing] = useState(false);
  const [error, setError] = useState<string | null | undefined>();

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
      console.error("[ConversationPane] Generation error:", err);
      setError(err instanceof Error ? err.message : "Generation failed");
    }
  };

  // -------------------------------------------------------------------
  // Opinion interaction: select an option
  // -------------------------------------------------------------------
  const handleOpinionSelect = async (
    opinionId: string,
    selectedValue: string,
  ) => {
    const interaction = (opinions ?? []).find((o) => o.id === opinionId);
    if (!interaction || interaction.status !== "pending") return;

    try {
      const result = await resolveOpinion.mutateAsync({
        opinion: interaction,
        selectedValue,
        currentIntent: structuredIntent,
        currentSchema: portfolioSchema,
      });

      setStructuredIntent(result.newIntent);
    } catch (err) {
      console.error("[ConversationPane] Opinion error:", err);
      setError(err instanceof Error ? err.message : "Opinion failed");
    }
  };

  const handleDismissOpinion = (opinionId: string) => {
    dismissOpinion.mutate(opinionId);
  };

  // -------------------------------------------------------------------
  // Prompt-based edit
  // -------------------------------------------------------------------
  const handlePromptEdit = async () => {
    if (!promptEditText.trim() || isGenerating || !portfolio) return;

    setIsPromptEditing(true);
    setError(null);

    try {
      const response = await resolveOpinionInteractionAction({
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
      console.error("[ConversationPane] Prompt edit error:", err);
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setIsPromptEditing(false);
    }
  };

  // -------------------------------------------------------------------
  // Standard accept/skip
  // -------------------------------------------------------------------
  const handleAcceptStandard = async (standardId: string) => {
    const detected = (detectedStandards ?? []).find(
      (s) => s.standard.id === standardId,
    );
    if (!detected) return;

    acceptStandard.mutate({
      detected,
      portfolio: {
        id: portfolio.id,
        intent: structuredIntent,
        schema: portfolioSchema,
      },
    });
  };

  const handleSkipStandard = (standardId: string) => {
    skipStandard.mutate(standardId);
  };

  // -------------------------------------------------------------------
  // Conflict resolution
  // -------------------------------------------------------------------
  const handleConflictFix = async (
    conflict: SchemaConflict,
    fix: ConflictFix,
  ) => {
    try {
      const result = await resolveConflict.mutateAsync({
        conflict,
        fix,
        currentSchema: portfolioSchema,
        currentIntent: structuredIntent,
      });
      setStructuredIntent(result.updatedIntent);
    } catch (err) {
      console.error("[ConversationPane] Conflict fix error:", err);
      setError(err instanceof Error ? err.message : "Conflict fix failed");
    }
  };

  const handleDismissConflict = (conflictId: string) => {
    setDismissedConflicts((prev) => new Set([...prev, conflictId]));
  };

  // -------------------------------------------------------------------
  // Regenerate opinions
  // -------------------------------------------------------------------
  const handleRegenerateOpinions = () => {
    if (!structuredIntent.purpose.content.trim() || generateOpinions.isPending)
      return;

    const acceptedDims = (dimensions ?? []).filter(
      (d) => (d.status === "accepted" || d.status === "edited") && d.isActive,
    );

    const acceptedStandardRefs = portfolioSchema.acceptedStandards ?? [];
    const acceptedStds = (detectedStandards ?? []).filter((s) =>
      acceptedStandardRefs.some((ref) => ref.standardId === s.standard.id),
    );

    generateOpinions.mutate({
      intent: structuredIntent,
      dimensions: acceptedDims.length > 0 ? acceptedDims : undefined,
      acceptedStandards: acceptedStds.length > 0 ? acceptedStds : undefined,
    });
  };

  // -------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------
  const isGenerating = pipeline.isPending || isPromptEditing;

  const visibleOpinions = (opinions ?? []).filter(
    (o) => o.status !== "resolved" && o.status !== "dismissed",
  );

  const skippedIds = skippedStandardIds ?? new Set<string>();
  const visibleStandards = (detectedStandards ?? []).filter(
    (s: DetectedStandard) => !skippedIds.has(s.standard.id),
  );

  const acceptedStandardIds = new Set(
    (portfolioSchema.acceptedStandards ?? []).map((s) => s.standardId),
  );

  const visibleConflicts = (conflicts ?? []).filter(
    (c) => !dismissedConflicts.has(c.id),
  );

  return (
    <div className="flex flex-col h-full">
      {/* Intent Editor — single field, structured data underneath */}
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl">
          {/* Animated gradient when processing */}
          <div
            className={cn(
              isGenerating
                ? "pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,#ff6ec4,#7873f5,#4ade80,#60a5fa)] bg-size-[400%_400%] animate-[gradient_3s_ease_infinite] opacity-35 z-10"
                : "",
            )}
          />

          <div data-testid="intent-editor">
            <MarkdownEditor
              ref={editorRef}
              placeholder="Describe what this form is for, who will use it, and what data you need to collect..."
              value={editorValue}
              className={cn(
                "rounded-2xl relative border",
                isGenerating ? "bg-transparent" : "",
              )}
              onChange={handleEditorChange}
              disabled={isGenerating || promptEditOpen}
            />
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {promptEditOpen ? (
            <div className="flex-1 space-y-2">
              <textarea
                placeholder="Describe the change you want to make to the form..."
                value={promptEditText}
                onChange={(e) => setPromptEditText(e.target.value)}
                rows={2}
                className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isGenerating}
              />
              <Button
                size="sm"
                onClick={handlePromptEdit}
                disabled={!promptEditText.trim() || isGenerating}
                className="w-full"
              >
                Apply Edit
              </Button>
            </div>
          ) : (
            <Button
              data-testid="generate-form-btn"
              onClick={handleGenerate}
              disabled={
                !structuredIntent.purpose.content.trim() || isGenerating
              }
              className="flex-1"
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
          {portfolioSchema.fields.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setPromptEditOpen(!promptEditOpen)}
              disabled={isGenerating}
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
          )}
        </div>
      </div>

      {/* Standards + Card Deck (opinions + conflicts) */}
      <ScrollArea className="flex-1 py-4">
        <div className="space-y-3 min-w-0">
          {/* Suggested Standards */}
          {visibleStandards.length > 0 && (
            <div data-testid="standards-section">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-blue-500" />
                Suggested Standards
              </h3>
              {visibleStandards.map((detected: DetectedStandard) => (
                <StandardCard
                  key={detected.standard.id}
                  detected={detected}
                  isAccepted={acceptedStandardIds.has(detected.standard.id)}
                  onAccept={handleAcceptStandard}
                  onSkip={handleSkipStandard}
                />
              ))}
            </div>
          )}

          {/* Opinion Card Deck (unified: conflicts + opinions) */}
          {(visibleConflicts.length > 0 || (opinions ?? []).length > 0) && (
            <div data-testid="card-deck-section" className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                Decisions
                {(generateOpinions.isPending ||
                  resolveOpinion.isPending ||
                  resolveConflict.isPending) && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
              </h3>
              <OpinionCardDeck
                opinions={opinions ?? []}
                conflicts={visibleConflicts}
                anyLoading={
                  resolveOpinion.isPending || resolveConflict.isPending
                }
                isRegenerating={generateOpinions.isPending}
                onSelectOpinion={handleOpinionSelect}
                onDismissOpinion={handleDismissOpinion}
                onSelectConflictFix={handleConflictFix}
                onDismissConflict={handleDismissConflict}
                onRegenerate={handleRegenerateOpinions}
              />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Dimensions (collapsed summary when available) */}
      {(dimensions ?? []).length > 0 && visibleOpinions.length === 0 && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {(dimensions ?? [])
              .filter((d) => d.status !== "rejected")
              .map((d) => (
                <Badge key={d.id} variant="outline" className="text-xs">
                  {d.name}
                </Badge>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
