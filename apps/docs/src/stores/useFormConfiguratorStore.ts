"use client";
import { streamOpinionSurfacesAction } from "@/app/actions/a2ui-opinion-actions";
import { streamFormPreviewAction } from "@/app/actions/a2ui-schema-stream-actions";
import {
  dimensionsToSchemaAction,
  generateDimensionsAction,
} from "@/app/actions/dimension-actions";
import type { OpinionInteraction } from "@/app/actions/opinion-actions";
import {
  generateOpinionInteractionsAction,
  resolveOpinionInteractionAction,
} from "@/app/actions/opinion-actions";
import type { DimensionObject } from "@/lib/dimension-types";
import { createDimensionObject } from "@/lib/dimension-types";
import { SerializedSchema } from "@/lib/schema-manager";
import { studyLogger } from "@/lib/study-logger";
import { debounce } from "@tanstack/pacer/debouncer";
import type { StreamableValue } from "ai/rsc";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

/**
 * Discovery phase tracks where we are in the dimension-first flow
 */
type DiscoveryPhase =
  | "idle"
  | "generating-dimensions"
  | "reviewing-dimensions"
  | "generating-schema";

/**
 * Configurator state interface
 */
interface ConfiguratorState {
  basePrompt: string;
  basePromptElement: HTMLTextAreaElement | null;
  setBasePromptElement: (ref: HTMLTextAreaElement | null) => void;

  artifactFormSchema: SerializedSchema;

  // We have different "edit modalities" of the artifact concept. I call it artifact concept here, as it will be represented by a prompt, by an artifcat (in this case a form) but also through stateful interactive elements
  // One edit modality is a form that has values saved inside of it
  configuratorFormSchema: SerializedSchema;
  configuratorFormValues: object;
  // Another edit modality is speech interactive scroll view, these are LLM-generated suggestion cards where users pick options to iteratively refine the form
  opinionInteractions: OpinionInteraction[];

  // Dimension discovery state
  dimensions: DimensionObject[];
  discoveryPhase: DiscoveryPhase;
  dimensionReasoning: string;

  // A2UI state
  a2uiOpinionStream: StreamableValue<string> | null;
  a2uiFormStream: StreamableValue<string> | null;
  /** Completed A2UI messages for the form preview (persisted) */
  a2uiFormMessages: unknown[] | null;

  // UI state
  basePromptActive: boolean;
  previousBasePrompt: string | null;
  error: string | null;
  success: string | null;

  // Actions
  onChangeBasePrompt: (newText: string) => void;
  onOpinionInteraction: (
    interactionIndex: number,
    selectedValue: string,
  ) => Promise<void>;

  dismissOpinionInteraction: (interactionIndex: number) => void;

  onEditArtifactFormSchema: (
    field: string,
    action: "remove" | "add-option" | "change-label",
    options: object | undefined,
  ) => Promise<void>;

  // Dimension actions
  onDimensionAccept: (dimensionId: string) => void;
  onDimensionReject: (dimensionId: string) => void;
  onDimensionEdit: (
    dimensionId: string,
    updates: Partial<DimensionObject>,
  ) => void;
  onDimensionAdd: (name: string) => void;
  onConfirmDimensions: () => Promise<void>;
  onRegenerateDimensions: () => Promise<void>;
}

const MAX_ACTIVE_OPINIONS = 5;

const countActiveOpinions = (interactions: OpinionInteraction[]) =>
  interactions.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  ).length;

const emptySchema: SerializedSchema = {
  fields: [],
  metadata: {
    name: "",
    description: "",
    fields: {},
  },
  version: 1,
  updatedAt: new Date().toISOString(),
};

const initialState = {
  basePrompt: "",
  basePromptElement: null,
  configuratorFormSchema: { ...emptySchema },
  configuratorFormValues: {},
  artifactFormSchema: { ...emptySchema },
  opinionInteractions: [] as OpinionInteraction[],

  // Dimension discovery
  dimensions: [] as DimensionObject[],
  discoveryPhase: "idle" as DiscoveryPhase,
  dimensionReasoning: "",

  // A2UI state
  a2uiOpinionStream: null,
  a2uiFormStream: null,
  a2uiFormMessages: null,

  // initial UI states
  basePromptActive: false,
  previousBasePrompt: null,

  error: null,
  success: null,
};

export const useConfiguratorStore = create<ConfiguratorState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,
        setBasePromptElement(ref) {
          set(
            { basePromptElement: ref },
            undefined,
            "configurator/setBasePromptElement",
          );
        },
        onOpinionInteraction: async (interactionIndex, selectedValue) => {
          const state = get();
          const interaction = state.opinionInteractions[interactionIndex];
          if (!interaction || interaction.status !== "pending") return;

          const selectedOption = interaction.options.find(
            (o) => o.value === selectedValue,
          );
          if (!selectedOption) return;

          const startTime = Date.now();

          // Mark as loading, activate gradient animation, snapshot current prompt
          set(
            (prev) => ({
              basePromptActive: true,
              opinionInteractions: prev.opinionInteractions.map((item, i) =>
                i === interactionIndex
                  ? {
                      ...item,
                      status: "loading" as const,
                      selectedOption: selectedValue,
                    }
                  : item,
              ),
            }),
            undefined,
            "configurator/opinionLoading",
          );

          try {
            const currentState = get();
            // After resolving this one, count remaining active opinions to determine follow-up capacity
            const activeAfterResolve =
              countActiveOpinions(currentState.opinionInteractions) - 1;
            const followUpCapacity = Math.max(
              0,
              MAX_ACTIVE_OPINIONS - activeAfterResolve,
            );

            const response = await resolveOpinionInteractionAction({
              basePrompt: currentState.basePrompt,
              currentSchema: currentState.artifactFormSchema,
              interactionText: interaction.text,
              selectedOptionLabel: selectedOption.label,
              maxFollowUps: followUpCapacity,
            });

            if (response.success && response.result) {
              studyLogger.log("schema.opinion.selected", {
                interactionText: interaction.text,
                selectedOption: selectedOption.label,
                timeToDecisionMs: Date.now() - startTime,
              });

              set(
                (prev) => {
                  const updated = prev.opinionInteractions.map((item, i) =>
                    i === interactionIndex
                      ? { ...item, status: "resolved" as const }
                      : item,
                  );
                  const followUps = response.result!.followUpInteractions;

                  return {
                    previousBasePrompt: prev.basePrompt,
                    basePrompt: response.result!.basePrompt,
                    basePromptActive: false,
                    artifactFormSchema: response.result!.artifactFormSchema,
                    configuratorFormSchema:
                      response.result!.configuratorFormSchema,
                    configuratorFormValues:
                      response.result!.configuratorFormValues,
                    opinionInteractions: [...updated, ...followUps],
                  };
                },
                undefined,
                "configurator/opinionResolved",
              );
            } else {
              // Revert to pending on error
              set(
                (prev) => ({
                  basePromptActive: false,
                  opinionInteractions: prev.opinionInteractions.map(
                    (item, i) =>
                      i === interactionIndex
                        ? {
                            ...item,
                            status: "pending" as const,
                            selectedOption: null,
                          }
                        : item,
                  ),
                  error:
                    response.error || "Failed to resolve opinion interaction",
                }),
                undefined,
                "configurator/opinionError",
              );
            }
          } catch (error) {
            set(
              (prev) => ({
                basePromptActive: false,
                opinionInteractions: prev.opinionInteractions.map((item, i) =>
                  i === interactionIndex
                    ? {
                        ...item,
                        status: "pending" as const,
                        selectedOption: null,
                      }
                    : item,
                ),
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to resolve opinion interaction",
              }),
              undefined,
              "configurator/opinionError",
            );
          }
        },

        onChangeBasePrompt: (userPrompt) => {
          console.log("Base prompt changed");
          set(
            () => ({ basePrompt: userPrompt, error: null }),
            undefined,
            "configurator/setBasePrompt",
          );

          studyLogger.log("prompt.entered", { prompt: userPrompt });

          // Dimension-first flow: generate dimensions instead of schema directly
          onPromptInsertedDimensions({
            userPrompt,
            onStart() {
              set(
                () => ({
                  discoveryPhase: "generating-dimensions" as const,
                  dimensions: [],
                  dimensionReasoning: "",
                  error: null,
                }),
                undefined,
                "configurator/startDimensionGeneration",
              );
            },
            onSuccess(dimensions, reasoning) {
              studyLogger.log("dimensions.generated", {
                count: dimensions.length,
                names: dimensions.map((d) => d.name),
              });

              if (dimensions.length === 0) {
                set(
                  () => ({
                    discoveryPhase: "idle" as const,
                    dimensions: [],
                    dimensionReasoning: "",
                  }),
                  undefined,
                  "configurator/dimensionsEmpty",
                );
                return;
              }

              set(
                () => ({
                  discoveryPhase: "reviewing-dimensions" as const,
                  dimensions,
                  dimensionReasoning: reasoning,
                  error: null,
                }),
                undefined,
                "configurator/dimensionsGenerated",
              );
            },
            onError(errorMessage) {
              set(
                () => ({
                  discoveryPhase: "idle" as const,
                  error: errorMessage,
                }),
                undefined,
                "configurator/dimensionGenerationError",
              );
            },
          });
        },

        dismissOpinionInteraction: (interactionIndex) => {
          set(
            (prev) => ({
              opinionInteractions: prev.opinionInteractions.map((item, i) =>
                i === interactionIndex
                  ? { ...item, status: "dismissed" as const }
                  : item,
              ),
            }),
            undefined,
            "configurator/opinionDismissed",
          );
        },

        onEditArtifactFormSchema: async (field, action, options) => {
          console.log(field, action, options);
          return;
        },

        // ---------- Dimension actions ----------

        onDimensionAccept: (dimensionId) => {
          const startTime = Date.now();
          set(
            (prev) => ({
              dimensions: prev.dimensions.map((d) =>
                d.id === dimensionId
                  ? {
                      ...d,
                      status:
                        d.status === "rejected"
                          ? ("suggested" as const)
                          : ("accepted" as const),
                      isActive: true,
                    }
                  : d,
              ),
            }),
            undefined,
            "configurator/dimensionAccepted",
          );
          studyLogger.log("dimension.accepted", {
            dimensionId,
            timeToDecisionMs: Date.now() - startTime,
          });
        },

        onDimensionReject: (dimensionId) => {
          set(
            (prev) => ({
              dimensions: prev.dimensions.map((d) =>
                d.id === dimensionId
                  ? { ...d, status: "rejected" as const, isActive: false }
                  : d,
              ),
            }),
            undefined,
            "configurator/dimensionRejected",
          );
          studyLogger.log("dimension.rejected", { dimensionId });
        },

        onDimensionEdit: (dimensionId, updates) => {
          set(
            (prev) => ({
              dimensions: prev.dimensions.map((d) =>
                d.id === dimensionId
                  ? {
                      ...d,
                      ...updates,
                      editHistory: [
                        ...d.editHistory,
                        {
                          timestamp: new Date().toISOString(),
                          field: "values" as const,
                          oldValue: d.values,
                          newValue: updates.values ?? d.values,
                        },
                      ],
                    }
                  : d,
              ),
            }),
            undefined,
            "configurator/dimensionEdited",
          );
          studyLogger.log("dimension.edited", { dimensionId, updates });
        },

        onDimensionAdd: (name) => {
          const newDimension = createDimensionObject({
            name,
            source: "user",
            status: "accepted",
          });
          set(
            (prev) => ({
              dimensions: [...prev.dimensions, newDimension],
            }),
            undefined,
            "configurator/dimensionAdded",
          );
          studyLogger.log("dimension.added", {
            dimensionId: newDimension.id,
            name,
          });
        },

        onConfirmDimensions: async () => {
          const state = get();
          const acceptedDimensions = state.dimensions.filter(
            (d) =>
              (d.status === "accepted" || d.status === "edited") && d.isActive,
          );

          if (acceptedDimensions.length === 0) return;

          studyLogger.log("dimensions.confirmed", {
            count: acceptedDimensions.length,
            names: acceptedDimensions.map((d) => d.name),
          });

          set(
            () => ({
              discoveryPhase: "generating-schema" as const,
              basePromptActive: true,
              error: null,
            }),
            undefined,
            "configurator/startSchemaFromDimensions",
          );

          try {
            // Generate schema first — it rewrites the prompt to incorporate dimensions.
            // Then use that enriched prompt for opinion generation so opinions
            // are contextually aware of what dimensions were confirmed.
            const schemaResponse = await dimensionsToSchemaAction(
              acceptedDimensions,
              state.basePrompt,
            );

            const enrichedPrompt =
              schemaResponse.success && schemaResponse.result
                ? schemaResponse.result.basePrompt
                : state.basePrompt;

            // Start A2UI opinion stream in parallel with classic generation
            let a2uiStream: StreamableValue<string> | null = null;
            try {
              const { stream } = await streamOpinionSurfacesAction(
                enrichedPrompt,
                MAX_ACTIVE_OPINIONS,
                acceptedDimensions,
              );
              a2uiStream = stream;
            } catch {
              // A2UI stream is optional, fall back to classic
            }

            // Also start form preview stream
            let formStream: StreamableValue<string> | null = null;
            try {
              const { stream } = await streamFormPreviewAction(enrichedPrompt);
              formStream = stream;
            } catch {
              // Form stream is optional
            }

            const opinionResponse = await generateOpinionInteractionsAction(
              enrichedPrompt,
              MAX_ACTIVE_OPINIONS,
              acceptedDimensions,
            );

            if (schemaResponse.success && schemaResponse.result) {
              studyLogger.log("schema.generated", {
                fieldCount:
                  schemaResponse.result.artifactFormSchema.fields.length,
                fromDimensions: true,
              });

              set(
                (prev) => ({
                  discoveryPhase: "idle" as const,
                  basePromptActive: false,
                  previousBasePrompt: prev.basePrompt,
                  basePrompt: schemaResponse.result!.basePrompt,
                  artifactFormSchema: schemaResponse.result!.artifactFormSchema,
                  configuratorFormSchema:
                    schemaResponse.result!.configuratorFormSchema,
                  configuratorFormValues:
                    schemaResponse.result!.configuratorFormValues,
                  opinionInteractions: [
                    ...prev.opinionInteractions,
                    ...(opinionResponse.success
                      ? (opinionResponse.interactions ?? [])
                      : []),
                  ],
                  a2uiOpinionStream: a2uiStream,
                  a2uiFormStream: formStream,
                }),
                undefined,
                "configurator/schemaFromDimensionsComplete",
              );
            } else {
              set(
                () => ({
                  discoveryPhase: "reviewing-dimensions" as const,
                  basePromptActive: false,
                  error:
                    schemaResponse.error ||
                    "Failed to generate schema from dimensions",
                }),
                undefined,
                "configurator/schemaFromDimensionsError",
              );
            }
          } catch (error) {
            set(
              () => ({
                discoveryPhase: "reviewing-dimensions" as const,
                basePromptActive: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to generate schema",
              }),
              undefined,
              "configurator/schemaFromDimensionsError",
            );
          }
        },

        onRegenerateDimensions: async () => {
          const state = get();
          set(
            () => ({
              discoveryPhase: "generating-dimensions" as const,
              dimensions: [],
              dimensionReasoning: "",
              error: null,
            }),
            undefined,
            "configurator/regenerateDimensions",
          );

          try {
            const response = await generateDimensionsAction(state.basePrompt);
            if (response.success && response.dimensions) {
              set(
                () => ({
                  discoveryPhase: "reviewing-dimensions" as const,
                  dimensions: response.dimensions!,
                  dimensionReasoning: response.reasoning || "",
                }),
                undefined,
                "configurator/dimensionsRegenerated",
              );
            } else {
              set(
                () => ({
                  discoveryPhase: "idle" as const,
                  error: response.error || "Failed to regenerate dimensions",
                }),
                undefined,
                "configurator/dimensionRegenerationError",
              );
            }
          } catch (error) {
            set(
              () => ({
                discoveryPhase: "idle" as const,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to regenerate dimensions",
              }),
              undefined,
              "configurator/dimensionRegenerationError",
            );
          }
        },
      }),
      {
        name: "configurator-storage",
        partialize: (state) => ({
          // Only persist these fields
          basePrompt: state.basePrompt,
          configuratorFormSchema: state.configuratorFormSchema,
          configuratorFormValues: state.configuratorFormValues,
          artifactFormSchema: state.artifactFormSchema,
          opinionInteractions: state.opinionInteractions,
          dimensions: state.dimensions,
          discoveryPhase: state.discoveryPhase,
          dimensionReasoning: state.dimensionReasoning,
          a2uiFormMessages: state.a2uiFormMessages,
        }),
      },
    ),
    {
      name: "ConfiguratorStore",
    },
  ),
);

const onPromptInsertedDimensions = debounce(
  async ({
    userPrompt,
    onStart,
    onSuccess,
    onError,
  }: {
    userPrompt: string;
    onStart: () => void;
    onSuccess: (dimensions: DimensionObject[], reasoning: string) => void;
    onError: (errorMessage: string) => void;
  }) => {
    console.log("Generating dimensions from prompt...");
    onStart();
    await sleep(100);

    const response = await generateDimensionsAction(userPrompt);

    if (response.success && response.dimensions) {
      onSuccess(response.dimensions, response.reasoning || "");
    } else {
      onError(response.error || "Failed to generate dimensions");
    }
  },
  {
    wait: 1000,
  },
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
