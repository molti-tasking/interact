"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { useState } from "react";
import { DynamicFormRenderer } from "../DynamicFormRenderer";
import { ErrorBoundary } from "../ErrorBoundary";
import { PaperForm } from "./PaperForm";
import { PromptDiff } from "./PromptDiff";
import { SpeechForm } from "./SpeechForm";

export const FormCreateForm = ({}: { onFormCreated: () => void }) => {
  const store = useConfiguratorStore();
  const basePromptElement = useConfiguratorStore((s) => s.basePromptElement);
  const setBasePromptElement = useConfiguratorStore(
    (s) => s.setBasePromptElement,
  );

  const [showingChanges, setShowingChanges] = useState(false);

  return (
    <div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="basePrompt">What you want?</Label>
          {store.previousBasePrompt !== null &&
            store.previousBasePrompt !== store.basePrompt && (
              <Button
                onClick={() => setShowingChanges(!showingChanges)}
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-xs text-muted-foreground"
              >
                {!showingChanges ? "View" : "Hide"} changes
              </Button>
            )}
        </div>
        <div className="relative overflow-hidden rounded-2xl">
          <div
            className={cn(
              store.basePromptActive
                ? "pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,#ff6ec4,#7873f5,#4ade80,#60a5fa)] bg-size-[400%_400%] animate-gradient opacity-35"
                : "",
            )}
          />
          {showingChanges &&
          store.previousBasePrompt !== null &&
          store.previousBasePrompt !== store.basePrompt ? (
            <div
              className={cn(
                "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
                "rounded-2xl relative bg-gray-100",
              )}
            >
              <PromptDiff
                previous={store.previousBasePrompt}
                current={store.basePrompt}
              />
            </div>
          ) : (
            <Textarea
              id="basePrompt"
              ref={(ref) => {
                console.log("Set base prompt element");
                if (!basePromptElement) {
                  setBasePromptElement(ref);
                }
              }}
              placeholder="Describe what this form is for..."
              value={store.basePrompt}
              className={cn(
                "rounded-2xl relative",
                store.basePromptActive ? "bg-transparent" : "",
              )}
              onChange={(e) => store.onChangeBasePrompt(e.target.value)}
              rows={3}
            />
          )}
        </div>
      </div>

      <div className="pt-4">
        <SpeechForm />
      </div>
      <div className="pt-4">
        <PaperForm />
      </div>
      <div className="pt-4">
        <ConfiguratorForm />
      </div>
    </div>
  );
};

const ConfiguratorForm = () => {
  const store = useConfiguratorStore();

  // Check if configurator form has fields
  if (!store.configuratorFormSchema?.fields?.length) {
    return null;
  }

  const onChangeForm = (data: Record<string, unknown>) => {
    console.log(data);
  };

  return (
    <div>
      <ErrorBoundary boundaryName="configurator-form">
        <DynamicFormRenderer
          schema={store.configuratorFormSchema}
          defaultValues={store.configuratorFormValues}
          onChange={onChangeForm}
        />
      </ErrorBoundary>
      <p>THIS FORM IS TO TECHNICAL, MAKE IT LOOK NICE</p>
      <p>
        Small clouds that represent different aspects: If you do not like it you
        can kick it out.
      </p>
      <p>have all suggestions and cluster them bottom up to ask about themes</p>
      <p>Based on what has been suggested in a query </p>
      {/* <pre>{JSON.stringify(store.configuratorFormValues, null, 2)}</pre> */}
    </div>
  );
};
