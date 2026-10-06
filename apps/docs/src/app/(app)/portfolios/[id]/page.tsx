"use client";

import { Button } from "@/components/ui/button";
import { ArtifactPane } from "@/components/workspace/ArtifactPane";
import { DerivationBanner } from "@/components/workspace/DerivationBanner";
import { DesignProbeDeck } from "@/components/workspace/DesignProbeDeck";
import { FieldEditDrawer } from "@/components/workspace/FieldEditDrawer";
import { DeckCanvasProvider } from "@/components/workspace/deck-canvas-context";
import { ReflectiveConversationPane } from "@/components/workspace/ReflectiveConversationPane";
import { useCurrentUser } from "@/context/user-context";
import {
  buildEditDescription,
  useIntentBackpropagation,
} from "@/hooks/query/intent-backpropagation";
import { useCommitPortfolio, usePortfolio } from "@/hooks/query/portfolios";
import { useUndoToast } from "@/hooks/query/undo";
import { addField, removeField, updateField } from "@/lib/engine/schema-ops";
import { formatActor } from "@/lib/mock-users";
import type { Field } from "@/lib/types";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Make `name` unique among existing field names (camelCase suffix). */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}${i}`)) i++;
  return `${name}${i}`;
}

export default function PortfolioWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: portfolio, isLoading, isError, error } = usePortfolio(id);
  const commitPortfolio = useCommitPortfolio(id);
  const notifyUndo = useUndoToast();
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

  /** `updates` holds only the properties the user changed. */
  const handleFieldSave = useCallback(
    async (fieldId: string, updates: Partial<Field>) => {
      const oldField = portfolio?.schema.fields.find((f) => f.id === fieldId);
      const label = updates.label ?? oldField?.label ?? fieldId;
      try {
        const result = await commitPortfolio.mutateAsync((current) => {
          // Apply only the changed properties to the *current* field, so
          // concurrent changes to its other properties survive.
          if (!current.schema.fields.some((f) => f.id === fieldId)) {
            throw new Error(`"${label}" was removed in the meantime.`);
          }
          return {
            schema: updateField(current.schema, fieldId, updates),
            provenance: {
              layer: "configuration",
              action: "field_modified",
              actor,
              rationale: `Modified field "${label}"`,
              always: false,
            },
          };
        });
        notifyUndo(result, `Saved "${label}"`);
        scheduleSync(buildEditDescription(oldField, updates));
      } catch (err) {
        console.error("[FieldEdit] Save error:", err);
        toast.error(errorMessage(err, `Failed to save "${label}"`));
      }
    },
    [portfolio, commitPortfolio, actor, notifyUndo, scheduleSync],
  );

  const handleFieldRemove = useCallback(
    async (fieldId: string) => {
      const removed = portfolio?.schema.fields.find((f) => f.id === fieldId);
      const label = removed?.label ?? fieldId;
      try {
        const result = await commitPortfolio.mutateAsync((current) =>
          current.schema.fields.some((f) => f.id === fieldId)
            ? {
                schema: removeField(current.schema, fieldId),
                provenance: {
                  layer: "configuration",
                  action: "field_removed",
                  actor,
                  rationale: `Removed field "${label}"`,
                },
              }
            : null,
        );
        notifyUndo(result, `Removed "${label}"`);
        if (result) scheduleSync(`Removed field "${label}"`);
      } catch (err) {
        console.error("[FieldEdit] Remove error:", err);
        toast.error(errorMessage(err, `Failed to remove "${label}"`));
      }
    },
    [portfolio, commitPortfolio, actor, notifyUndo, scheduleSync],
  );

  const handleFieldsAdded = useCallback(
    async (newFields: Field[]) => {
      const labels = newFields.map((f) => f.label).join(", ");
      try {
        const result = await commitPortfolio.mutateAsync((current) => {
          let schema = current.schema;
          const taken = new Set(schema.fields.map((f) => f.name));
          for (const field of newFields) {
            const name = uniqueName(field.name, taken);
            taken.add(name);
            schema = addField(schema, { ...field, name, origin: "creator" });
          }
          return {
            schema,
            provenance: {
              layer: "configuration",
              action: "field_added_from_prompt",
              actor,
              rationale: `Added field(s) from prompt: ${labels}`,
            },
          };
        });
        notifyUndo(result, `Added ${labels}`);
        scheduleSync(`Added new field(s): ${labels}`);
      } catch (err) {
        console.error("[AddField] Save error:", err);
        // Rethrow so the inline input keeps the prompt and shows the error
        throw new Error(errorMessage(err, "Failed to save the new field"));
      }
    },
    [commitPortfolio, actor, notifyUndo, scheduleSync],
  );

  // `?generate=1`: a portfolio created with an intent generates right away.
  const autoGenerate = searchParams.get("generate") === "1";
  const clearGenerateParam = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("generate");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-[60vh]"
        role="status"
        aria-label="Loading portfolio"
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !portfolio) {
    return (
      <div className="text-center py-12" role="alert">
        <h2 className="text-lg font-semibold">
          {isError ? "Couldn't load this portfolio" : "Portfolio not found"}
        </h2>
        {isError && (
          <p className="mt-1 text-sm text-muted-foreground">
            {errorMessage(error, "Unknown error")}
          </p>
        )}
        <Button asChild variant="link" className="mt-2">
          <Link href="/portfolios">Back to portfolios</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DerivationBanner portfolio={portfolio} />

      {/*
        Workspace: a narrow sidebar (intent + design probes) next to the form
        on a sticky canvas; stacked on small screens. Uses container queries
        so the open app sidebar is taken into account.
      */}
      <DeckCanvasProvider>
        <div className="@container">
          <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <div
                data-testid="reflective-conversation-pane"
                className="flex flex-col"
              >
                <ReflectiveConversationPane
                  portfolio={portfolio}
                  autoGenerate={autoGenerate}
                  onAutoGenerateStarted={clearGenerateParam}
                />
              </div>

              <DesignProbeDeck
                portfolio={portfolio}
                onDecisionApplied={scheduleSync}
              />
            </div>

            {/* Artifact (form on a canvas) */}
            <div
              data-testid="preview-pane"
              className="h-[70vh] @5xl:sticky @5xl:top-20 @5xl:h-[calc(100vh-6rem)]"
            >
              <ArtifactPane
                portfolio={portfolio}
                onFieldClick={handleFieldClick}
                onFieldsAdded={handleFieldsAdded}
              />
            </div>
          </div>
        </div>
      </DeckCanvasProvider>

      {/* Field edit drawer — saves only the changed properties, applied to
          the latest version of the field */}
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
