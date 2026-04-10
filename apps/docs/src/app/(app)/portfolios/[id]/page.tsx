"use client";

import { Button } from "@/components/ui/button";
import { InlineEditableTitle } from "@/components/ui/inline-editable-title";
import { ArtifactPane } from "@/components/workspace/ArtifactPane";
import { DerivationBanner } from "@/components/workspace/DerivationBanner";
import { DesignProbeDeck } from "@/components/workspace/DesignProbeDeck";
import { FieldEditDrawer } from "@/components/workspace/FieldEditDrawer";
import { ReflectiveConversationPane } from "@/components/workspace/ReflectiveConversationPane";
import {
  buildEditDescription,
  useIntentBackpropagation,
} from "@/hooks/query/intent-backpropagation";
import { usePortfolio, useUpdatePortfolio } from "@/hooks/query/portfolios";
import { logProvenance } from "@/lib/engine/provenance";
import { addField, diffSchemas, removeField, updateField } from "@/lib/engine/schema-ops";
import type { Field, PortfolioSchema } from "@/lib/types";
import { useCurrentUser } from "@/context/user-context";
import { formatActor } from "@/lib/mock-users";
import { BarChart3, ClipboardList, History, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";

export default function PortfolioWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, isLoading } = usePortfolio(id);
  const portfolioSchema = portfolio?.schema as unknown as PortfolioSchema;
  const updatePortfolio = useUpdatePortfolio();
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);

  // Field edit drawer state
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Debounced intent backpropagation from field edits
  const { scheduleSync } = useIntentBackpropagation(portfolio);

  const handleFieldClick = useCallback((field: Field) => {
    setEditingField(field);
    setDrawerOpen(true);
  }, []);

  const handleFieldSave = useCallback(
    async (fieldId: string, updates: Partial<Field>) => {
      if (!portfolio) return;
      const oldField = portfolioSchema.fields.find((f) => f.id === fieldId);
      const newSchema = updateField(portfolioSchema, fieldId, updates);
      const diff = diffSchemas(portfolioSchema, newSchema);
      try {
        await updatePortfolio.mutateAsync({
          id: portfolio.id,
          schema: newSchema,
        });
        await logProvenance(
          portfolio.id,
          "configuration",
          "field_modified",
          actor,
          diff,
          `Modified field "${updates.label ?? fieldId}"`,
          { intent: portfolio.intent, schema: portfolioSchema },
        );

        // Queue debounced intent backpropagation
        scheduleSync(buildEditDescription(oldField, updates));
      } catch (err) {
        console.error("[FieldEdit] Save error:", err);
      }
    },
    [portfolio, updatePortfolio, portfolioSchema, scheduleSync],
  );

  const handleFieldRemove = useCallback(
    async (fieldId: string) => {
      if (!portfolio) return;
      const removedField = portfolioSchema.fields.find((f) => f.id === fieldId);
      const newSchema = removeField(portfolioSchema, fieldId);
      const diff = diffSchemas(portfolioSchema, newSchema);
      try {
        await updatePortfolio.mutateAsync({
          id: portfolio.id,
          schema: newSchema,
        });
        await logProvenance(
          portfolio.id,
          "configuration",
          "field_removed",
          actor,
          diff,
          `Removed field "${removedField?.label ?? fieldId}"`,
          { intent: portfolio.intent, schema: portfolioSchema },
        );

        // Queue debounced intent backpropagation
        scheduleSync(`Removed field "${removedField?.label ?? fieldId}"`);
      } catch (err) {
        console.error("[FieldEdit] Remove error:", err);
      }
    },
    [portfolio, updatePortfolio, portfolioSchema, scheduleSync],
  );

  const handleFieldsAdded = useCallback(
    async (newFields: Field[]) => {
      if (!portfolio) return;
      let newSchema = portfolioSchema;
      for (const field of newFields) {
        newSchema = addField(newSchema, field);
      }
      const diff = diffSchemas(portfolioSchema, newSchema);
      try {
        await updatePortfolio.mutateAsync({
          id: portfolio.id,
          schema: newSchema,
        });
        const labels = newFields.map((f) => f.label).join(", ");
        await logProvenance(
          portfolio.id,
          "configuration",
          "field_added_from_prompt",
          actor,
          diff,
          `Added field(s) from prompt: ${labels}`,
          { intent: portfolio.intent, schema: portfolioSchema },
        );
        scheduleSync(`Added new field(s): ${labels}`);
      } catch (err) {
        console.error("[AddField] Save error:", err);
      }
    },
    [portfolio, updatePortfolio, portfolioSchema, scheduleSync],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold">Portfolio not found</h2>
        <Button asChild variant="link" className="mt-2">
          <Link href="/portfolios">Back to portfolios</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <InlineEditableTitle
            value={portfolio.title}
            onSave={(title) =>
              updatePortfolio.mutate({ id: portfolio.id, title })
            }
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground"
          >
            <Link href={`/portfolios/${id}/dashboard`}>
              <BarChart3 className="h-3.5 w-3.5" />
              Dashboard
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground"
          >
            <Link href={`/responses/${id}`}>
              <ClipboardList className="h-3.5 w-3.5" />
              Responses
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground"
          >
            <Link href={`/portfolios/${id}/provenance`}>
              <History className="h-3.5 w-3.5" />
              History
            </Link>
          </Button>
        </div>
      </div>

      <DerivationBanner portfolio={portfolio} />

      {/* Three-column workspace */}
      <div
        className="grid grid-cols-1 xl:grid-cols-3 gap-6 xl:gap-8"
        style={{ minHeight: "70vh" }}
      >
        {/* Left: Intent + Dimensions */}
        <div
          data-testid="reflective-conversation-pane"
          className="flex flex-col overflow-hidden"
        >
          <ReflectiveConversationPane portfolio={portfolio} />
        </div>

        <div>
          <DesignProbeDeck portfolio={portfolio} />
        </div>

        {/* Right: Artifact (form preview + responses) */}
        <div data-testid="preview-pane">
          <ArtifactPane portfolio={portfolio} onFieldClick={handleFieldClick} onFieldsAdded={handleFieldsAdded} />
        </div>
      </div>
      <p
        data-testid="field-count"
        className="text-xs text-muted-foreground/50 text-center"
      >
        {portfolioSchema?.fields?.length} field
        {portfolioSchema?.fields?.length !== 1 ? "s" : ""}
      </p>

      {/* Field edit drawer */}
      <FieldEditDrawer
        field={editingField}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSave={handleFieldSave}
        onRemove={handleFieldRemove}
      />
    </div>
  );
}
