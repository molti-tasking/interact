"use client";

import {
  dimensionsToSchemaAction,
  generateDimensionsAction,
} from "@/app/actions/dimension-actions";
import type { OpinionInteraction } from "@/app/actions/opinion-actions";
import {
  generateOpinionInteractionsAction,
  resolveOpinionInteractionAction,
} from "@/app/actions/opinion-actions";
import { detectDomainStandardsAction } from "@/app/actions/standards-actions";
import { PromptDiff } from "@/components/form/configurator/PromptDiff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StandardCard } from "@/components/workspace/StandardCard";
import { useUpdatePortfolio } from "@/hooks/query/portfolios";
import { useProvenance } from "@/hooks/query/provenance";
import type { DimensionObject } from "@/lib/dimension-types";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import type { Portfolio, PortfolioSchema } from "@/lib/types";
import { emptyPortfolioSchema } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, Sparkles, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Label } from "../ui/label";
import { OpinionCard } from "./OpinionCard";

interface ConversationPaneProps {
  portfolio: Portfolio;
}

type DiscoveryPhase =
  | "idle"
  | "generating-dimensions"
  | "reviewing-dimensions"
  | "generating-schema";

export function ConversationPane({ portfolio }: ConversationPaneProps) {
  const portfolioSchema = portfolio?.schema as unknown as PortfolioSchema;

  const editorRef = useRef<HTMLDivElement>(null);
  const [intent, setIntent] = useState(portfolio.intent);
  const [showDiff, setShowDiff] = useState(false);
  const updatePortfolio = useUpdatePortfolio();
  const queryClient = useQueryClient();
  const { data: provenanceEntries } = useProvenance(portfolio.id);

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

  // Dimension discovery state
  const [dimensions, setDimensions] = useState<DimensionObject[]>([]);
  const [discoveryPhase, setDiscoveryPhase] = useState<DiscoveryPhase>("idle");

  // Opinion / refinement question state
  const [opinions, setOpinions] = useState<OpinionInteraction[]>([]);
  const [activeAnimation, setActiveAnimation] = useState<number | null>(null);

  // Prompt-based edit state
  const [promptEditOpen, setPromptEditOpen] = useState(false);
  const [promptEditText, setPromptEditText] = useState("");

  // Standards state
  const [detectedStandards, setDetectedStandards] = useState<
    DetectedStandard[]
  >([]);
  const [acceptedStandardIds, setAcceptedStandardIds] = useState<Set<string>>(
    new Set(),
  );
  const [skippedStandardIds, setSkippedStandardIds] = useState<Set<string>>(
    new Set(),
  );

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null | undefined>();

  // Derive previousIntent from the latest provenance entry
  const latestEntry = provenanceEntries?.[0] ?? null;
  const previousIntent = latestEntry?.prev_intent ?? null;

  // Sync intent from portfolio when it changes externally
  useEffect(() => {
    setIntent(portfolio.intent);
  }, [portfolio.intent]);

  // Clear animation when processing ends
  useEffect(() => {
    if (!isProcessing && activeAnimation !== null) {
      const timer = setTimeout(() => setActiveAnimation(null), 1200);
      return () => clearTimeout(timer);
    }
  }, [isProcessing, activeAnimation]);

  const handleIntentChange = useCallback((value: string) => {
    setIntent(value);
  }, []);

  // -------------------------------------------------------------------
  // Button: Generate dimensions + schema
  // -------------------------------------------------------------------
  const handleGenerate = async () => {
    if (!intent.trim() || isProcessing) return;

    setIsProcessing(true);
    setError(null);

    console.log("[ConversationPane] Generate triggered");

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

      // Step 1: Generate dimensions + detect standards in parallel
      setDiscoveryPhase("generating-dimensions");
      const [standardsResponse, dimensionsResponse] = await Promise.all([
        detectDomainStandardsAction(intent.trim()),
        generateDimensionsAction(intent.trim()),
      ]);

      // Store detected standards for user to accept/skip
      const detected =
        standardsResponse.success && standardsResponse.detectedStandards
          ? standardsResponse.detectedStandards
          : [];
      setDetectedStandards(detected);
      console.log(`[ConversationPane] Standards detected: ${detected.length}`);

      if (!dimensionsResponse.success || !dimensionsResponse.dimensions) {
        setError(dimensionsResponse.error || "Failed to generate dimensions");
        setDiscoveryPhase("idle");
        setIsProcessing(false);
        return;
      }

      console.log(
        `[ConversationPane] Dimensions: ${dimensionsResponse.dimensions.length}`,
      );
      setDimensions(dimensionsResponse.dimensions);

      // Step 2: Generate schema from dimensions (only accepted standards)
      setDiscoveryPhase("generating-schema");
      const acceptedStandards = detected.filter((s) =>
        acceptedStandardIds.has(s.standard.id),
      );
      const schemaResult = await dimensionsToSchemaAction(
        dimensionsResponse.dimensions,
        intent.trim(),
        acceptedStandards.length > 0 ? acceptedStandards : undefined,
      );

      if (!schemaResult.success || !schemaResult.result) {
        setError(schemaResult.error || "Failed to generate schema");
        setDiscoveryPhase("reviewing-dimensions");
        setIsProcessing(false);
        return;
      }

      console.log(
        `[ConversationPane] Schema: ${schemaResult.result.artifactFormSchema.fields.length} fields`,
      );

      const newIntent = schemaResult.result.basePrompt || intent.trim();
      const newSchema = schemaResult.result.artifactFormSchema;
      const schemaDiff = diffSchemas(
        portfolioSchema.fields.length > 0
          ? portfolioSchema
          : emptyPortfolioSchema(),
        newSchema,
      );

      const updated = await updatePortfolio.mutateAsync({
        id: portfolio.id,
        intent: newIntent,
        schema: newSchema,
      });

      console.log("Updated: ", updated.id);

      // Log schema generation provenance
      await logWithSnapshot(
        "dimensions",
        "schema_generated",
        "system",
        schemaDiff,
        `Generated ${newSchema.fields.length} fields from ${dimensionsResponse.dimensions.length} dimensions`,
      );

      // Show prompt diff if intent was refined by LLM
      if (newIntent !== intent.trim()) {
        setIntent(newIntent);
      }

      setDiscoveryPhase("idle");

      // Step 3: Generate refinement questions
      console.log("[ConversationPane] Generating refinement questions...");
      const opinionsResult = await generateOpinionInteractionsAction(
        newIntent,
        5,
        dimensionsResponse.dimensions,
        acceptedStandards.length > 0 ? acceptedStandards : undefined,
      );

      if (opinionsResult.success && opinionsResult.interactions) {
        console.log(
          `[ConversationPane] Opinions: ${opinionsResult.interactions.length}`,
        );
        setOpinions(opinionsResult.interactions);
      }
    } catch (err) {
      console.error("[ConversationPane] Generation error:", err);
      setError(err instanceof Error ? err.message : "Generation failed");
      setDiscoveryPhase("idle");
    } finally {
      setIsProcessing(false);
    }
  };

  // -------------------------------------------------------------------
  // Opinion interaction: select an option → backpropagate into prompt
  // -------------------------------------------------------------------
  const handleOpinionSelect = async (
    opinionIndex: number,
    selectedValue: string,
  ) => {
    const interaction = opinions[opinionIndex];
    if (!interaction || interaction.status !== "pending") return;

    const selectedOption = interaction.options.find(
      (o) => o.value === selectedValue,
    );
    if (!selectedOption) return;

    // Mark as loading + start particle animation
    setOpinions((prev) =>
      prev.map((o, i) =>
        i === opinionIndex
          ? { ...o, status: "loading" as const, selectedOption: selectedValue }
          : o,
      ),
    );
    setActiveAnimation(opinionIndex);
    setIsProcessing(true);

    try {
      const response = await resolveOpinionInteractionAction({
        basePrompt: intent,
        currentSchema: portfolioSchema,
        interactionText: interaction.text,
        selectedOptionLabel: selectedOption.label,
        maxFollowUps: 3,
      });

      if (response.success && response.result) {
        // Update prompt with backpropagated changes

        setIntent(response.result.basePrompt);

        // Compute schema diff for provenance
        const opinionDiff = diffSchemas(
          portfolioSchema,
          response.result.artifactFormSchema,
        );

        // Update schema
        const updated = await updatePortfolio.mutateAsync({
          id: portfolio.id,
          intent: response.result.basePrompt,
          schema: response.result.artifactFormSchema,
        });
        console.log("Updated: ", updated.id);

        // Log provenance for the opinion resolution
        await logWithSnapshot(
          "dimensions",
          "opinion_resolved",
          "creator",
          opinionDiff,
          `"${interaction.text}" → "${selectedOption.label}"`,
        );

        // Resolve this opinion and add follow-ups
        setOpinions((prev) => {
          const resolved = prev.map((o, i) =>
            i === opinionIndex ? { ...o, status: "resolved" as const } : o,
          );
          return [
            ...resolved,
            ...(response.result!.followUpInteractions ?? []),
          ];
        });
      } else {
        // Revert to pending
        setOpinions((prev) =>
          prev.map((o, i) =>
            i === opinionIndex
              ? { ...o, status: "pending" as const, selectedOption: null }
              : o,
          ),
        );
        setError(response.error || "Failed to apply opinion");
      }
    } catch (err) {
      console.error("[ConversationPane] Opinion error:", err);
      setOpinions((prev) =>
        prev.map((o, i) =>
          i === opinionIndex
            ? { ...o, status: "pending" as const, selectedOption: null }
            : o,
        ),
      );
      setError(err instanceof Error ? err.message : "Opinion failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDismissOpinion = (index: number) => {
    setOpinions((prev) =>
      prev.map((o, i) =>
        i === index ? { ...o, status: "dismissed" as const } : o,
      ),
    );
  };

  // -------------------------------------------------------------------
  // Prompt-based edit: user describes a change in natural language
  // -------------------------------------------------------------------
  const handlePromptEdit = async () => {
    if (!promptEditText.trim() || isProcessing || !portfolio) return;

    setIsProcessing(true);
    setError(null);

    console.log("[ConversationPane] Prompt edit:", promptEditText.trim());

    try {
      // Use resolveOpinionInteraction as an edit mechanism — treat the
      // user's edit prompt as an "opinion" that modifies the schema
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

        const updated = await updatePortfolio.mutateAsync({
          id: portfolio.id,
          intent: response.result.basePrompt,
          schema: response.result.artifactFormSchema,
        });
        console.log("Updated: ", updated.id);

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
      setIsProcessing(false);
    }
  };

  // -------------------------------------------------------------------
  // Standard accept/skip
  // -------------------------------------------------------------------
  const handleAcceptStandard = async (standardId: string) => {
    setAcceptedStandardIds((prev) => new Set([...prev, standardId]));
    setSkippedStandardIds((prev) => {
      const next = new Set(prev);
      next.delete(standardId);
      return next;
    });

    const standard = detectedStandards.find(
      (s) => s.standard.id === standardId,
    );
    if (standard && portfolio) {
      await logWithSnapshot(
        "dimensions",
        "standard_accepted",
        "creator",
        { added: [], removed: [], modified: [] },
        `Applied standard: ${standard.standard.name}`,
      );
    }
  };

  const handleSkipStandard = (standardId: string) => {
    setSkippedStandardIds((prev) => new Set([...prev, standardId]));
    setAcceptedStandardIds((prev) => {
      const next = new Set(prev);
      next.delete(standardId);
      return next;
    });
  };

  const isGenerating =
    discoveryPhase === "generating-dimensions" ||
    discoveryPhase === "generating-schema" ||
    isProcessing;

  const visibleOpinions = opinions.filter(
    (o) => o.status !== "resolved" && o.status !== "dismissed",
  );

  const visibleStandards = detectedStandards.filter(
    (s) => !skippedStandardIds.has(s.standard.id),
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
                /* TODO: This "Refine Form" button should always be disabled when the prompt text area is unchanged. */
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

      {/* Standards + Refinement Questions */}
      {(visibleStandards.length > 0 || visibleOpinions.length > 0) && (
        <ScrollArea className="flex-1 px-4 pb-4">
          <div className="space-y-3">
            {/* Suggested Standards */}
            {visibleStandards.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-blue-500" />
                  Suggested Standards
                </h3>
                {visibleStandards.map((detected) => (
                  <StandardCard
                    key={detected.standard.id}
                    detected={detected}
                    isAccepted={acceptedStandardIds.has(detected.standard.id)}
                    onAccept={handleAcceptStandard}
                    onSkip={handleSkipStandard}
                  />
                ))}
              </>
            )}

            {/* Refinement Questions */}
            {visibleOpinions.length > 0 && (
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                Refinement Questions
              </h3>
            )}

            {visibleOpinions.map((interaction) => {
              const globalIndex = opinions.indexOf(interaction);
              return (
                <OpinionCard
                  key={interaction.id}
                  interaction={interaction}
                  index={globalIndex}
                  isAnimating={activeAnimation === globalIndex}
                  editorRef={editorRef}
                  anyLoading={opinions.some((o) => o.status === "loading")}
                  onSelect={handleOpinionSelect}
                  onDismiss={handleDismissOpinion}
                />
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Dimensions (collapsed summary when available) */}
      {dimensions.length > 0 && visibleOpinions.length === 0 && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {dimensions
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
