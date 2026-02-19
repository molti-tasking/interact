"use client";
import { generateSchemaFromRawDataAction } from "@/app/actions/schema-actions";
import { SchemaMetadata } from "@/lib/schema-manager";
import { debounce } from "@tanstack/pacer/debouncer";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

/**
 * Configurator state interface
 */
interface ConfiguratorState {
  basePrompt: string;
  configuratorFormSchema: SchemaMetadata;
  configuratorFormValues: object;
  artifactFormSchema: SchemaMetadata;

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
    name: "",
    description: "",
    fields: {},
  },
  configuratorFormValues: {},
  artifactFormSchema: {
    name: "",
    description: "",
    fields: {},
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

        onChangeBasePrompt: (newText) => {
          // set({basePrompt: newText})
          console.log("Base prompt changed");
          set(() => ({ basePrompt: newText }));
          onPromptInserted({
            text: newText,
            onStart() {
              console.log("on Start");
              set(() => ({ basePromptActive: true }));
            },
            callback(metadata) {
              set(() => ({
                basePromptActive: false,
                artifactFormSchema: metadata,
              }));
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
    text,
    onStart,
    callback,
  }: {
    text: string;
    onStart: () => void;
    callback: (metadata: SchemaMetadata | undefined) => void;
  }) => {
    console.log("Going through base prompt...");
    onStart();
    await sleep(100); // Add delay for better animation
    const res = await generateSchemaFromRawDataAction({
      formDescription: text,
      formName: `Random name ${Date.now()}`,
      rawData: "Title, Description, Age, Date, Notes",
    });
    callback(res?.schema?.metadata);
  },
  {
    wait: 500,
  },
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
