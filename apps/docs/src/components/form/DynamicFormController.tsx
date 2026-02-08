"use client";

import { useSchema } from "@/hooks/query/schemas";
import { useSubmissions } from "@/hooks/query/submissions";
import type { SerializedSchema } from "@/lib/schema-manager";
import { diffSchemas, saveSchema, saveSubmission } from "@/lib/schema-manager";
import { useState } from "react";
import { toast } from "sonner";
import { DataMigrationDialog } from "./DataMigrationDialog";
import { DynamicForm } from "./DynamicForm";
import { SchemaModificationDrawer } from "./SchemaModificationDrawer";

interface DynamicFormControllerProps {
  slug: string;
}

export function DynamicFormController({ slug }: DynamicFormControllerProps) {
  const { data: schema, refetch: refetchSchema } = useSchema(slug);
  const { refetch: refetchSubmssions } = useSubmissions(slug);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentField, setCurrentField] = useState<string>("new");
  const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);
  const [pendingSchema, setPendingSchema] = useState<SerializedSchema | null>(
    null,
  );

  const handleFieldModify = (fieldKey: string) => {
    setCurrentField(fieldKey);
    setDrawerOpen(true);
  };

  const handleSchemaGenerated = (newSchema: SerializedSchema) => {
    if (!schema) return;

    // Check for differences
    const diff = diffSchemas(schema.schema, newSchema);
    const hasChanges =
      diff.added.length > 0 ||
      diff.removed.length > 0 ||
      diff.modified.length > 0;

    if (!hasChanges) {
      toast.info("No changes detected in the schema");
      return;
    }

    // TODO: Validate existing data against new schema. As of now we just ignore potential discrepancies and consider the form data purely client side and "droppable"
    // const validation = validateDataAgainstSchema(formData, newSchema);

    // TODO display change suggestions from the LLM to the users of existing data entries. If the user decides to modify existing entries based on the schema, then the users creating those entries, should be modified.

    // if (validation.valid) {
    saveSchema({ title: schema.title, slug: schema.slug, schema: newSchema });
    refetchSchema();
    toast.success("Schema updated successfully. Your data is still valid.");
    // } else {
    //   // Data needs migration, show dialog
    //   setPendingSchema(newSchema);
    //   setMigrationDialogOpen(true);
    // }
  };

  const handleMigrationAccept = () => {
    if (pendingSchema && schema) {
      saveSchema({ ...schema, schema: pendingSchema });
      refetchSchema();
      toast.success("Schema updated and data migrated successfully");
    }
    setMigrationDialogOpen(false);
    setPendingSchema(null);
  };

  const handleMigrationDecline = () => {
    toast.info("Schema changes cancelled");
    setMigrationDialogOpen(false);
    setPendingSchema(null);
  };

  const handleFormSubmit = (data: Record<string, unknown>) => {
    if (!schema) return;

    // Save to submissions array
    saveSubmission(data, schema.schema.version, schema.slug);
    refetchSubmssions();

    toast.success("Registration submitted successfully!");
  };

  if (!schema) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading schema...</div>
      </div>
    );
  }

  return (
    <>
      <DynamicForm
        schema={schema.schema}
        onFieldModify={handleFieldModify}
        onSubmit={handleFormSubmit}
        onSchemaUpdate={handleSchemaGenerated}
      />

      <SchemaModificationDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        currentSchema={schema.schema}
        fieldContext={currentField}
        onSchemaGenerated={handleSchemaGenerated}
      />

      {pendingSchema && (
        <DataMigrationDialog
          open={migrationDialogOpen}
          onOpenChange={setMigrationDialogOpen}
          diff={diffSchemas(schema.schema, pendingSchema)}
          oldSchema={schema.schema}
          newSchema={pendingSchema}
          existingData={{}}
          onAccept={handleMigrationAccept}
          onDecline={handleMigrationDecline}
        />
      )}
    </>
  );
}
