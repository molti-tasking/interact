"use client";

import { FormCreateForm } from "@/components/form/configurator/FormCreateForm";
import { FormSchemaEditView } from "@/components/form/configurator/FormSchemaEditView";

export default function Page() {
  return (
    <div className="space-y-12 grid grid-cols-2 gap-4">
      <FormCreateForm
        onFormCreated={function (): void {
          throw new Error("Function not implemented.");
        }}
      />
      <div>
        <FormSchemaEditView />
      </div>
    </div>
  );
}
