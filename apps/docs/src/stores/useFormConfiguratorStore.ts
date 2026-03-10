"use client";
import type { OpinionInteraction } from "@/app/actions/opinion-actions";
import {
  generateOpinionInteractionsAction,
  resolveOpinionInteractionAction,
} from "@/app/actions/opinion-actions";
import { regenerateFormSchemaAction } from "@/app/actions/schema-actions-v2";
import { SerializedSchema } from "@/lib/schema-manager";
import { debounce } from "@tanstack/pacer/debouncer";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

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
}

const MAX_ACTIVE_OPINIONS = 5;

const countActiveOpinions = (interactions: OpinionInteraction[]) =>
  interactions.filter((i) => i.status !== "resolved" && i.status !== "dismissed").length;

const initialState = {
  basePrompt: "",
  basePromptElement: null,
  configuratorFormSchema: {
    fields: [],
    metadata: {
      name: "",
      description: "",
      fields: {},
    },
    version: 1,
    updatedAt: new Date().toISOString(),
  },
  configuratorFormValues: {},
  artifactFormSchema: {
    fields: [],
    metadata: {
      name: "",
      description: "",
      fields: {},
    },
    version: 1,
    updatedAt: new Date().toISOString(),
  },
  opinionInteractions: [] as OpinionInteraction[],

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
            () => ({ basePrompt: userPrompt }),
            undefined,
            "configurator/setBasePrompt",
          );
          const activeCount = countActiveOpinions(get().opinionInteractions);
          const capacity = Math.max(0, MAX_ACTIVE_OPINIONS - activeCount);

          onPromptInserted({
            userPrompt,
            maxOpinions: capacity,
            onStart() {
              console.log("Schema generation started");
              set(
                () => ({ basePromptActive: true, error: null }),
                undefined,
                "configurator/startSchemaGeneration",
              );
            },
            onSuccess(result) {
              set(
                () => ({
                  basePromptActive: false,
                  artifactFormSchema: result.artifactFormSchema,
                  configuratorFormSchema: result.configuratorFormSchema,
                  configuratorFormValues: result.configuratorFormValues,
                  error: null,
                }),
                undefined,
                "configurator/updateGeneratedSchemas",
              );
            },
            onOpinionSuccess(interactions) {
              set(
                (prev) => {
                  const activeCount = countActiveOpinions(
                    prev.opinionInteractions,
                  );
                  const capacity = Math.max(
                    0,
                    MAX_ACTIVE_OPINIONS - activeCount,
                  );
                  return {
                    opinionInteractions: [
                      ...prev.opinionInteractions,
                      ...interactions.slice(0, capacity),
                    ],
                  };
                },
                undefined,
                "configurator/updateOpinionInteractions",
              );
            },
            onError(errorMessage) {
              set(
                () => ({
                  basePromptActive: false,
                  error: errorMessage,
                }),
                undefined,
                "configurator/schemaGenerationError",
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
        }),
      },
    ),
    {
      name: "ConfiguratorStore",
    },
  ),
);

const onPromptInserted = debounce(
  async ({
    userPrompt,
    maxOpinions,
    onStart,
    onSuccess,
    onOpinionSuccess,
    onError,
  }: {
    userPrompt: string;
    maxOpinions: number;
    onStart: () => void;
    onSuccess: (result: {
      artifactFormSchema: SerializedSchema;
      configuratorFormSchema: SerializedSchema;
      configuratorFormValues: object;
    }) => void;
    onOpinionSuccess: (interactions: OpinionInteraction[]) => void;
    onError: (errorMessage: string) => void;
  }) => {
    console.log("Generating schemas from prompt...");
    onStart();
    await sleep(100); // Add delay for better animation

    const [schemaResponse, opinionResponse] = await Promise.all([
      regenerateFormSchemaAction({ userPrompt }),
      generateOpinionInteractionsAction(userPrompt, maxOpinions),
    ]);

    if (schemaResponse.success && schemaResponse.result) {
      onSuccess(schemaResponse.result);
    } else {
      onError(schemaResponse.error || "Failed to generate schema");
    }

    if (opinionResponse.success && opinionResponse.interactions) {
      onOpinionSuccess(opinionResponse.interactions);
    }
  },
  {
    wait: 1000,
  },
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
