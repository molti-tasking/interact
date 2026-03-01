"use client";
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
  configuratorFormSchema: SerializedSchema;
  configuratorFormValues: object;
  artifactFormSchema: SerializedSchema;

  // UI state
  basePromptActive: boolean;
  error: string | null;
  success: string | null;

  // Actions
  onChangeBasePrompt: (newText: string) => void;

  onEditArtifactFormSchema: (
    field: string,
    action: "remove" | "add-option" | "change-label",
    options: object | undefined,
  ) => Promise<void>;
}

const initialState = {
  basePrompt: "",
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

  // initial UI states
  basePromptActive: false,

  error: null,
  success: null,
};

export const useConfiguratorStore = create<ConfiguratorState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

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
    onError,
  }: {
    userPrompt: string;
    onStart: () => void;
    onSuccess: (result: {
      artifactFormSchema: SerializedSchema;
      configuratorFormSchema: SerializedSchema;
      configuratorFormValues: object;
    }) => void;
    onError: (errorMessage: string) => void;
  }) => {
    console.log("Generating schemas from prompt...");
    onStart();
    await sleep(100); // Add delay for better animation

    const response = await regenerateFormSchemaAction({ userPrompt });

    if (response.success && response.result) {
      onSuccess(response.result);
    } else {
      onError(response.error || "Failed to generate schema");
    }
  },
  {
    wait: 1000,
  },
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
