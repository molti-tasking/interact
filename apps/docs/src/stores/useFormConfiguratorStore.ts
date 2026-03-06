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
  // TODO I think we should also have a base prompt ref for the field in order to pass that ref to other parts of the application to build nice animations. I am thinking right now about a loading animation when a "opinion interaction" is being invoked, that we show some kind of particle flow to the original prompt and once it is finished loading, we just fade away that "opinion interaction" element as if it's content was now being absorbed by the base prompt. In a second iteration I was thinking if we can use some kind of streaming API in order to update the basePrompt field "streamingly" or partially instead of just replacing the text at once.

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

  onEditArtifactFormSchema: (
    field: string,
    action: "remove" | "add-option" | "change-label",
    options: object | undefined,
  ) => Promise<void>;
}

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
          if (get().basePromptElement) {
            return;
          }
          set(
            { basePromptElement: ref },
            undefined,
            "configurator/opinionLoading",
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
            const response = await resolveOpinionInteractionAction({
              basePrompt: currentState.basePrompt,
              currentSchema: currentState.artifactFormSchema,
              interactionText: interaction.text,
              selectedOptionLabel: selectedOption.label,
            });

            if (response.success && response.result) {
              set(
                (prev) => ({
                  previousBasePrompt: prev.basePrompt,
                  basePrompt: response.result!.basePrompt,
                  basePromptActive: false,
                  artifactFormSchema: response.result!.artifactFormSchema,
                  configuratorFormSchema:
                    response.result!.configuratorFormSchema,
                  configuratorFormValues:
                    response.result!.configuratorFormValues,
                  opinionInteractions: [
                    ...prev.opinionInteractions.map((item, i) =>
                      i === interactionIndex
                        ? { ...item, status: "resolved" as const }
                        : item,
                    ),
                    ...response.result!.followUpInteractions,
                  ],
                }),
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
          onPromptInserted({
            userPrompt,
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
                () => ({ opinionInteractions: interactions }),
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
    onStart,
    onSuccess,
    onOpinionSuccess,
    onError,
  }: {
    userPrompt: string;
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
      generateOpinionInteractionsAction(userPrompt),
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
