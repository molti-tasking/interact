"use client";

import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { DynamicFormRenderer } from "../DynamicFormRenderer";
import { ErrorBoundary } from "../ErrorBoundary";

export const FormSchemaEditView = () => {
  const store = useConfiguratorStore();

  // Check if artifact form has fields
  if (!store.artifactFormSchema?.fields?.length) {
    return null;
  }

  return (
    <div className="bg-gray-100 rounded-xl p-4">
      <ErrorBoundary boundaryName="form-schema-edit-view">
        <DynamicFormRenderer
          schema={store.artifactFormSchema}
          onSubmit={console.log}
        />
      </ErrorBoundary>
    </div>
  );
};
