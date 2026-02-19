"use client";

import { FormCreateForm } from "@/components/form/configurator/FormCreateForm";
import { FormSchemaEditView } from "@/components/form/configurator/FormSchemaEditView";

export default function Page() {
  return (
    <div className="space-y-12">
      <div>Nice Title</div>
      <div>Here we gonna put text area</div>
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
