"use client";

import { ArtifactPane } from "@/components/workspace/ArtifactPane";
import { DerivationBanner } from "@/components/workspace/DerivationBanner";
import { DesignProbeDeck } from "@/components/workspace/DesignProbeDeck";
import { FieldEditDrawer } from "@/components/workspace/FieldEditDrawer";
import { DeckCanvasProvider } from "@/components/workspace/deck-canvas-context";
import { ReflectiveConversationPane } from "@/components/workspace/ReflectiveConversationPane";
import { useCapabilities } from "@/context/capabilities-context";
import { useStudyLog } from "@/context/study-context";
import { useCurrentUser } from "@/context/user-context";
import {
  buildEditDescription,
  useIntentBackpropagation,
} from "@/hooks/query/intent-backpropagation";
import { useCommitPortfolio } from "@/hooks/query/portfolios";
import { useUndoToast } from "@/hooks/query/undo";
import { addField, removeField, updateField } from "@/lib/engine/schema-ops";
import { assignSection } from "@/lib/engine/sections";
import { formatActor } from "@/lib/mock-users";
import type { Field, Portfolio } from "@/lib/types";
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

interface PortfolioWorkspaceProps {
  portfolio: Portfolio;
  /** Generate the form right away (a portfolio just created with an intent) */
  autoGenerate?: boolean;
  onAutoGenerateStarted?: () => void;
}

/**
 * The design workspace: intent + design probes next to the form on a
 * canvas, plus the field edit drawer. Used by the admin workspace page and
 * by workshop participants (study mode, narrowed via capabilities).
 */
export function PortfolioWorkspace({
  portfolio,
  autoGenerate = false,
  onAutoGenerateStarted,
}: PortfolioWorkspaceProps) {
  const id = portfolio.id;
  const commitPortfolio = useCommitPortfolio(id);
  const notifyUndo = useUndoToast();
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);
  const capabilities = useCapabilities();
  const log = useStudyLog();

  // Field edit drawer state
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Debounced intent backpropagation from field edits
  const { scheduleSync } = useIntentBackpropagation(portfolio);

  const handleFieldClick = useCallback(
    (field: Field) => {
      log("field_opened", { fieldId: field.id, label: field.label });
      setEditingField(field);
      setDrawerOpen(true);
    },
    [log],
  );

  /**
   * `updates` holds only the properties the user changed; `section` is the
   * new section title (null = none) when it changed.
   */
  const handleFieldSave = useCallback(
    async (fieldId: string, updates: Partial<Field>, section?: string | null) => {
      const oldField = portfolio?.schema.fields.find((f) => f.id === fieldId);
      const label = updates.label ?? oldField?.label ?? fieldId;
      const changedProps = Object.keys(updates).length > 0;
      try {
        const result = await commitPortfolio.mutateAsync((current) => {
          // Apply only the changed properties to the *current* field, so
          // concurrent changes to its other properties survive.
          if (!current.schema.fields.some((f) => f.id === fieldId)) {
            throw new Error(`"${label}" was removed in the meantime.`);
          }
          let schema = changedProps
            ? updateField(current.schema, fieldId, updates)
            : current.schema;
          if (section !== undefined) schema = assignSection(schema, fieldId, section);
          const moved =
            section === undefined
              ? ""
              : section
                ? `moved to section "${section}"`
                : "taken out of its section";
          return {
            schema,
            provenance: {
              layer: "configuration",
              action: "field_modified",
              actor,
              rationale: [changedProps && `Modified field "${label}"`, moved && `"${label}" ${moved}`]
                .filter(Boolean)
                .join("; "),
              // A section move doesn't show in the field diff; still log it
              always: section !== undefined,
            },
          };
        });
        notifyUndo(result, `Saved "${label}"`);
        log("field_saved", { fieldId, changed: Object.keys(updates), section });
        if (changedProps) scheduleSync(buildEditDescription(oldField, updates));
      } catch (err) {
        console.error("[FieldEdit] Save error:", err);
        toast.error(errorMessage(err, `Failed to save "${label}"`));
      }
    },
    [portfolio, commitPortfolio, actor, notifyUndo, scheduleSync, log],
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
        log("field_removed", { fieldId, label });
        if (result) scheduleSync(`Removed field "${label}"`);
      } catch (err) {
        console.error("[FieldEdit] Remove error:", err);
        toast.error(errorMessage(err, `Failed to remove "${label}"`));
      }
    },
    [portfolio, commitPortfolio, actor, notifyUndo, scheduleSync, log],
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
        log("fields_added", { labels: newFields.map((f) => f.label) });
        scheduleSync(`Added new field(s): ${labels}`);
      } catch (err) {
        console.error("[AddField] Save error:", err);
        // Rethrow so the inline input keeps the prompt and shows the error
        throw new Error(errorMessage(err, "Failed to save the new field"));
      }
    },
    [commitPortfolio, actor, notifyUndo, scheduleSync, log],
  );

  return (
    <div className="space-y-6">
      {capabilities.derive && <DerivationBanner portfolio={portfolio} />}

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
                  onAutoGenerateStarted={onAutoGenerateStarted}
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
        schema={portfolio.schema}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSave={handleFieldSave}
        onRemove={handleFieldRemove}
      />
    </div>
  );
}
