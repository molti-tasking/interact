"use client";

import { FormPreviewSurface } from "@/components/a2ui/FormPreviewSurface";
import { A2UISurface } from "@/components/a2ui/A2UISurface";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import type { A2UIMessage } from "@a2ui-sdk/types/0.9";
import { useCallback } from "react";
import type { SerializedSchema } from "@/lib/schema-manager";
import { ErrorBoundary } from "../ErrorBoundary";

export const FormSchemaEditView = () => {
  const a2uiFormStream = useConfiguratorStore((s) => s.a2uiFormStream);
  const a2uiFormMessages = useConfiguratorStore((s) => s.a2uiFormMessages);

  const handleStreamComplete = useCallback(
    (schema: SerializedSchema, messages: A2UIMessage[]) => {
      useConfiguratorStore.setState(
        {
          artifactFormSchema: schema,
          a2uiFormStream: null,
          a2uiFormMessages: messages,
        },
        undefined,
        "configurator/a2uiFormStreamComplete" as never,
      );
    },
    [],
  );

  // Active stream — show progressive preview
  if (a2uiFormStream) {
    return (
      <div className="bg-gray-100 rounded-xl p-4">
        <ErrorBoundary boundaryName="form-preview-streaming">
          <FormPreviewSurface
            streamValue={a2uiFormStream}
            onComplete={handleStreamComplete}
          />
        </ErrorBoundary>
      </div>
    );
  }

  // Completed A2UI messages — render the stored surface
  if (a2uiFormMessages && a2uiFormMessages.length > 0) {
    return (
      <div className="bg-gray-100 rounded-xl p-4">
        <ErrorBoundary boundaryName="form-preview-a2ui">
          <A2UISurface
            messages={a2uiFormMessages as A2UIMessage[]}
            surfaceId="form-preview"
          />
        </ErrorBoundary>
      </div>
    );
  }

  return null;
};
