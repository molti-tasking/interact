"use client";

import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";

export const FormSchemaEditView = () => {
  const store = useConfiguratorStore();

  if (!store.artifactFormSchema?.fields) {
    return null;
  }

  const fields = Object.values(store.artifactFormSchema.fields);
  if (!fields?.length) {
    return null;
  }

  return (
    <div>
      <p>Render form artifact</p>
      <pre>{JSON.stringify(fields, null, 2)}</pre>
    </div>
  );
};
