"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineEditableTitle } from "@/components/ui/inline-editable-title";
import { ArtifactPane } from "@/components/workspace/ArtifactPane";
import { DesignProbeDeck } from "@/components/workspace/DesignProbeDeck";
import { FieldEditDrawer } from "@/components/workspace/FieldEditDrawer";
import { ReflectiveConversationPane } from "@/components/workspace/ReflectiveConversationPane";
import { usePortfolio, useUpdatePortfolio } from "@/hooks/query/portfolios";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas, removeField, updateField } from "@/lib/engine/schema-ops";
import type { Field, PortfolioSchema } from "@/lib/types";
import { BarChart3, ClipboardList, History, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";

export default function PortfolioWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, isLoading } = usePortfolio(id);
  const portfolioSchema = portfolio?.schema as unknown as PortfolioSchema;
  const updatePortfolio = useUpdatePortfolio();

  // Field edit drawer state
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleFieldClick = useCallback((field: Field) => {
    setEditingField(field);
    setDrawerOpen(true);
  }, []);

  const handleFieldSave = useCallback(
    async (fieldId: string, updates: Partial<Field>) => {
      if (!portfolio) return;
      const newSchema = updateField(portfolioSchema, fieldId, updates);
      const diff = diffSchemas(portfolioSchema, newSchema);
      try {
        const updated = await updatePortfolio.mutateAsync({
          id: portfolio.id,
          schema: newSchema,
        });
        console.log("Updated: ", updated.id);
        await logProvenance(
          portfolio.id,
          "configuration",
          "field_modified",
          "creator",
          diff,
          `Modified field "${updates.label ?? fieldId}"`,
          { intent: portfolio.intent, schema: portfolioSchema },
        );
      } catch (err) {
        console.error("[FieldEdit] Save error:", err);
      }
    },
    [portfolio, updatePortfolio, portfolioSchema],
  );

  const handleFieldRemove = useCallback(
    async (fieldId: string) => {
      if (!portfolio) return;
      const removedField = portfolioSchema.fields.find((f) => f.id === fieldId);
      const newSchema = removeField(portfolioSchema, fieldId);
      const diff = diffSchemas(portfolioSchema, newSchema);
      try {
        const updated = await updatePortfolio.mutateAsync({
          id: portfolio.id,
          schema: newSchema,
        });
        console.log("Updated: ", updated.id);
        await logProvenance(
          portfolio.id,
          "configuration",
          "field_removed",
          "creator",
          diff,
          `Removed field "${removedField?.label ?? fieldId}"`,
          { intent: portfolio.intent, schema: portfolioSchema },
        );
      } catch (err) {
        console.error("[FieldEdit] Remove error:", err);
      }
    },
    [portfolio, updatePortfolio, portfolioSchema],
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <InlineEditableTitle
            value={portfolio.title}
            onSave={(title) =>
              updatePortfolio.mutate({ id: portfolio.id, title })
            }
          />
          {portfolio.base_id && <Badge variant="outline">Derived</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/portfolios/${id}/dashboard`}>
              <BarChart3 className="h-4 w-4 mr-1" />
              Dashboard
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/responses/${id}`}>
              <ClipboardList className="h-4 w-4 mr-1" />
              Responses
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/portfolios/${id}/provenance`}>
              <History className="h-4 w-4 mr-1" />
              History
            </Link>
          </Button>
        </div>
      </div>

      {/* Three-column workspace */}
      <div
        className="grid grid-cols-1 xl:grid-cols-3 gap-8"
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
          <ArtifactPane portfolio={portfolio} onFieldClick={handleFieldClick} />
        </div>
      </div>
      <pre data-testid="field-count">
        Amount of fields: {portfolioSchema?.fields?.length}
      </pre>

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
