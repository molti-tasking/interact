"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConversationPane } from "@/components/workspace/ConversationPane";
import { FieldEditDrawer } from "@/components/workspace/FieldEditDrawer";
import { usePortfolio, useUpdatePortfolio } from "@/hooks/query/portfolios";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas, removeField, updateField } from "@/lib/engine/schema-ops";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { Field, PortfolioSchema } from "@/lib/types";
import {
  BarChart3,
  ClipboardList,
  FormInput,
  History,
  Loader2,
  Network,
} from "lucide-react";
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
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {portfolio.title}
          </h1>
          {portfolio.base_id && (
            <Badge variant="outline" className="mt-1">
              Derived
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/portfolios/${id}/dashboard`}>
              <BarChart3 className="h-4 w-4 mr-1" />
              Dashboard
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/forms/${id}`}>
              <FormInput className="h-4 w-4 mr-1" />
              Fill Form
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
          <Button variant="outline" size="sm" asChild>
            <Link href={`/portfolios/${id}/derive`}>
              <Network className="h-4 w-4 mr-1" />
              Derive
            </Link>
          </Button>
        </div>
      </div>

      {/* Split pane workspace */}
      <div
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        style={{ minHeight: "70vh" }}
      >
        {/* Left: Intent + Dimensions */}
        <div
          data-testid="conversation-pane"
          className="flex flex-col overflow-hidden"
        >
          <ConversationPane portfolio={portfolio} />
        </div>

        {/* Right: Preview */}
        <Card
          data-testid="preview-pane"
          className="flex flex-col overflow-hidden"
        >
          <div className="flex-1 p-4 overflow-auto">
            <FormRenderer
              schema={portfolioSchema}
              mode="preview"
              onFieldClick={handleFieldClick}
              className="space-y-4"
            />
          </div>
        </Card>
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
