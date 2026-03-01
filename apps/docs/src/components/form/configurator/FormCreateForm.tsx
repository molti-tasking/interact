"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { DynamicFormRenderer } from "../DynamicFormRenderer";
import { ErrorBoundary } from "../ErrorBoundary";

export const FormCreateForm = ({}: { onFormCreated: () => void }) => {
  const store = useConfiguratorStore();

  return (
    <div>
      <div className="space-y-2">
        <Label htmlFor="basePrompt">What you want?</Label>
        <div className="relative overflow-hidden rounded-2xl">
          <div
            className={cn(
              store.basePromptActive
                ? "pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,#ff6ec4,#7873f5,#4ade80,#60a5fa)] bg-size-[200%_200%] animate-gradient opacity-35"
                : "",
            )}
          />
          <Textarea
            id="basePrompt"
            placeholder="Describe what this form is for..."
            value={store.basePrompt}
            className={cn(
              "rounded-2xl relative",
              store.basePromptActive ? "bg-transparent" : "",
            )}
            onChange={(e) => store.onChangeBasePrompt(e.target.value)}
            rows={3}
          />
        </div>
      </div>

      <ConfiguratorForm />
    </div>
  );
};

const ConfiguratorForm = () => {
  const store = useConfiguratorStore();

  // Check if configurator form has fields
  if (!store.configuratorFormSchema?.fields?.length) {
    return null;
  }

  return (
    <div>
      <ErrorBoundary boundaryName="configurator-form">
        <DynamicFormRenderer
          schema={store.configuratorFormSchema}
          onSubmit={console.log}
        />
      </ErrorBoundary>
    </div>
  );
};
