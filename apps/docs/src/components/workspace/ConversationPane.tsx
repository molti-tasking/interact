"use client";

import { resolveOpinionInteractionAction } from "@/app/actions/opinion-actions";
import { PromptDiff } from "@/components/form/configurator/PromptDiff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StandardCard } from "@/components/workspace/StandardCard";
import { useDimensions, useGenerateDimensions } from "@/hooks/query/dimensions";
import {
  useDismissOpinion,
  useGenerateOpinions,
  useOpinions,
  useResolveOpinion,
} from "@/hooks/query/opinions";
import { useUpdatePortfolio } from "@/hooks/query/portfolios";
import { useProvenance } from "@/hooks/query/provenance";
import { useGenerateSchema } from "@/hooks/query/schema-generation";
import {
  useAcceptStandard,
  useDetectedStandards,
  useDetectStandards,
  useSkippedStandards,
  useSkipStandard,
} from "@/hooks/query/standards";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import type { Portfolio, PortfolioSchema } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, Sparkles, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Label } from "../ui/label";
import { OpinionCardDeck } from "./OpinionCardDeck";

interface ConversationPaneProps {
  portfolio: Portfolio;
}

type DiscoveryPhase = "idle" | "generating-dimensions" | "generating-schema";

export function ConversationPane({ portfolio }: ConversationPaneProps) {
  const portfolioSchema = portfolio.schema as unknown as PortfolioSchema;

  const editorRef = useRef<HTMLDivElement>(null);
  const [intent, setIntent] = useState(portfolio.intent);
  const [showDiff, setShowDiff] = useState(false);
  const updatePortfolio = useUpdatePortfolio();
  const queryClient = useQueryClient();
  const { data: provenanceEntries } = useProvenance(portfolio.id);

  // --- React Query hooks for each subprocess ---
  const { data: dimensions } = useDimensions(portfolio.id);
  const generateDimensions = useGenerateDimensions(portfolio.id);

  const { data: detectedStandards } = useDetectedStandards(portfolio.id);
  const detectStandards = useDetectStandards(portfolio.id);
  const acceptStandard = useAcceptStandard(portfolio.id);
  const skipStandard = useSkipStandard(portfolio.id);
  const { data: skippedStandardIds } = useSkippedStandards(portfolio.id);

  const { data: opinions } = useOpinions(portfolio.id);
  const generateOpinions = useGenerateOpinions(portfolio.id);
  const resolveOpinion = useResolveOpinion(portfolio.id);
  const dismissOpinion = useDismissOpinion(portfolio.id);

  const generateSchema = useGenerateSchema(portfolio.id);

  /** Log provenance with snapshot of current state, then invalidate cache */
  const logWithSnapshot = useCallback(
    async (
      layer: Parameters<typeof logProvenance>[1],
      action: string,
      actor: "creator" | "system",
      diff: Parameters<typeof logProvenance>[4],
      rationale?: string,
    ) => {
      await logProvenance(portfolio.id, layer, action, actor, diff, rationale, {
        intent: portfolio.intent,
        schema: portfolioSchema,
      });
      queryClient.invalidateQueries({ queryKey: ["provenance", portfolio.id] });
    },
    [queryClient, portfolio, portfolioSchema],
  );
  const [discoveryPhase, setDiscoveryPhase] = useState<DiscoveryPhase>("idle");
  const [activeAnimation, setActiveAnimation] = useState<number | null>(null);

  // Prompt-based edit state
  const [promptEditOpen, setPromptEditOpen] = useState(false);
  const [promptEditText, setPromptEditText] = useState("");
  const [isPromptEditing, setIsPromptEditing] = useState(false);
  const [error, setError] = useState<string | null | undefined>();

  // Derive previousIntent from the latest provenance entry
  const latestEntry = provenanceEntries?.[0] ?? null;
  const previousIntent = latestEntry?.prev_intent ?? null;

  // Sync intent from portfolio when it changes externally
  useEffect(() => {
    setIntent(portfolio.intent);
  }, [portfolio.intent]);

  // Clear animation when no opinion is resolving
  const isOpinionResolving = resolveOpinion.isPending;
  useEffect(() => {
    if (!isOpinionResolving && activeAnimation !== null) {
      const timer = setTimeout(() => setActiveAnimation(null), 1200);
      return () => clearTimeout(timer);
    }
  }, [isOpinionResolving, activeAnimation]);

  const handleIntentChange = useCallback((value: string) => {
    setIntent(value);
  }, []);

  // -------------------------------------------------------------------
  // Button: Generate dimensions + schema (now using independent hooks)
  // -------------------------------------------------------------------
  const handleGenerate = async () => {
    if (!intent.trim() || isGenerating) return;

    setError(null);

    try {
      // Save intent + log provenance if intent changed
      const intentChanged = intent.trim() !== portfolio.intent;
      await updatePortfolio.mutateAsync({
        id: portfolio.id,
        intent: intent.trim(),
      });

      if (intentChanged) {
        await logWithSnapshot(
          "intent",
          "intent_updated",
          "creator",
          { added: [], removed: [], modified: [] },
          "Intent updated by creator",
        );
      }

      // Step 1: Generate dimensions + detect standards IN PARALLEL
      setDiscoveryPhase("generating-dimensions");

      const [dimensionsResult, standardsResult] = await Promise.all([
        generateDimensions.mutateAsync(intent.trim()),
        detectStandards.mutateAsync(intent.trim()),
      ]);

      // Step 2: Generate schema from dimensions
      setDiscoveryPhase("generating-schema");

      // Get currently accepted standards from portfolio schema
      const acceptedStandardRefs = portfolioSchema.acceptedStandards ?? [];
      const acceptedStandards = (standardsResult ?? []).filter((s) =>
        acceptedStandardRefs.some((ref) => ref.standardId === s.standard.id),
      );

      const schemaResult = await generateSchema.mutateAsync({
        dimensions: dimensionsResult,
        intent: intent.trim(),
        currentSchema: portfolioSchema,
        acceptedStandards:
          acceptedStandards.length > 0 ? acceptedStandards : undefined,
      });

      // Update local intent if LLM refined it
      if (schemaResult.intent !== intent.trim()) {
        setIntent(schemaResult.intent);
      }

      setDiscoveryPhase("idle");

      // Step 3: Generate refinement questions (fire-and-forget, runs independently)
      generateOpinions.mutate({
        intent: schemaResult.intent,
        dimensions: dimensionsResult,
        acceptedStandards:
          acceptedStandards.length > 0 ? acceptedStandards : undefined,
      });
    } catch (err) {
      console.error("[ConversationPane] Generation error:", err);
      setError(err instanceof Error ? err.message : "Generation failed");
      setDiscoveryPhase("idle");
    }
  };

  // -------------------------------------------------------------------
  // Opinion interaction: select an option → backpropagate into prompt
  // -------------------------------------------------------------------
  const handleOpinionSelect = async (
    opinionIndex: number,
    selectedValue: string,
  ) => {
    const visibleList = (opinions ?? []).filter(
      (o) => o.status !== "resolved" && o.status !== "dismissed",
    );
    const interaction = visibleList[opinionIndex];
    if (!interaction || interaction.status !== "pending") return;

    setActiveAnimation(opinionIndex);

    try {
      const result = await resolveOpinion.mutateAsync({
        opinion: interaction,
        selectedValue,
        currentIntent: intent,
        currentSchema: portfolioSchema,
      });

      setIntent(result.newIntent);
    } catch (err) {
      console.error("[ConversationPane] Opinion error:", err);
      setError(err instanceof Error ? err.message : "Opinion failed");
    }
  };

  const handleDismissOpinion = (index: number) => {
    const visibleList = (opinions ?? []).filter(
      (o) => o.status !== "resolved" && o.status !== "dismissed",
    );
    const interaction = visibleList[index];
    if (interaction) {
      dismissOpinion.mutate(interaction.id);
    }
  };

  // -------------------------------------------------------------------
  // Regenerate refinement questions
  // -------------------------------------------------------------------
  const handleRegenerateOpinions = () => {
    if (!intent.trim() || generateOpinions.isPending) return;

    const acceptedDims = (dimensions ?? []).filter(
      (d) => (d.status === "accepted" || d.status === "edited") && d.isActive,
    );

    const acceptedStandardRefs = portfolioSchema.acceptedStandards ?? [];
    const acceptedStds = (detectedStandards ?? []).filter((s) =>
      acceptedStandardRefs.some((ref) => ref.standardId === s.standard.id),
    );

    generateOpinions.mutate({
      intent: intent.trim(),
      dimensions: acceptedDims.length > 0 ? acceptedDims : undefined,
      acceptedStandards: acceptedStds.length > 0 ? acceptedStds : undefined,
    });
  };

  // -------------------------------------------------------------------
  // Prompt-based edit: user describes a change in natural language
  // -------------------------------------------------------------------
  const handlePromptEdit = async () => {
    if (!promptEditText.trim() || isGenerating || !portfolio) return;

    setIsPromptEditing(true);
    setError(null);

    try {
      const response = await resolveOpinionInteractionAction({
        basePrompt: intent,
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

        setIntent(response.result.basePrompt);

        await updatePortfolio.mutateAsync({
          id: portfolio.id,
          intent: response.result.basePrompt,
          schema: response.result.artifactFormSchema,
        });

        await logWithSnapshot(
          "configuration",
          "prompt_edit",
          "creator",
          editDiff,
          promptEditText.trim(),
        );

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
  // Standard accept/skip (now using react-query hooks)
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
        intent: portfolio.intent,
        schema: portfolioSchema,
      },
    });
  };

  const handleSkipStandard = (standardId: string) => {
    skipStandard.mutate(standardId);
  };

  // -------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------
  const isGenerating = discoveryPhase !== "idle" || isPromptEditing;

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

  return (
    <div className="flex flex-col h-full">
      {/* Intent Editor */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="basePrompt">What you want?</Label>
          {previousIntent && previousIntent !== intent && (
            <Button
              onClick={() => setShowDiff(!showDiff)}
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-xs text-muted-foreground"
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
                ? "pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,#ff6ec4,#7873f5,#4ade80,#60a5fa)] bg-size-[400%_400%] animate-[gradient_3s_ease_infinite] opacity-35 z-10"
                : "",
            )}
          />

          {/* Show diff view when prompt was refined, otherwise show editor */}
          {showDiff && previousIntent ? (
            <div
              className="border rounded-2xl px-3 py-2 bg-muted/30 cursor-pointer"
              onClick={() => setShowDiff(false)}
            >
              <PromptDiff previous={previousIntent} current={intent} />
            </div>
          ) : (
            <div data-testid="intent-editor">
              <MarkdownEditor
                ref={editorRef}
                placeholder="Describe what this form is for, who will use it, and what data you need to collect..."
                value={intent}
                className={cn(
                  "rounded-2xl relative border",
                  isGenerating ? "bg-transparent" : "",
                )}
                onChange={handleIntentChange}
                disabled={isGenerating || promptEditOpen}
              />
            </div>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">
            {error}
          </div>
        )}

        {!showDiff && (
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
                disabled={!intent.trim() || isGenerating}
                className="flex-1"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {discoveryPhase === "generating-dimensions"
                      ? "Discovering dimensions..."
                      : discoveryPhase === "generating-schema"
                        ? "Generating form..."
                        : "Processing..."}
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
        )}
      </div>

      {/* Standards + Opinion Card Deck */}
      <ScrollArea className="flex-1 px-4 pb-4">
        <div className="space-y-3">
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

          {/* Opinion Card Deck */}
          {(opinions ?? []).length > 0 && (
            <div data-testid="opinions-section" className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                Refinement Questions
                {(generateOpinions.isPending || resolveOpinion.isPending) && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
              </h3>
              <OpinionCardDeck
                opinions={opinions ?? []}
                anyLoading={resolveOpinion.isPending}
                isRegenerating={generateOpinions.isPending}
                onSelect={handleOpinionSelect}
                onDismiss={handleDismissOpinion}
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
