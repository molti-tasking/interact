"use client";

import type {
  ConflictFix,
  SchemaConflict,
} from "@/app/actions/conflict-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OpinionInteraction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Ban, Info, Layers, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { OpinionCardResolvedDialog } from "./OpinionCardResolvedDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeckItem =
  | { kind: "opinion"; data: OpinionInteraction; index: number }
  | { kind: "conflict"; data: SchemaConflict };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const severityConfig = {
  error: { icon: Ban, color: "border-red-400", bg: "bg-red-50/50" },
  warning: {
    icon: AlertTriangle,
    color: "border-amber-400",
    bg: "bg-amber-50/50",
  },
  info: { icon: Info, color: "border-blue-400", bg: "bg-blue-50/50" },
};

const layerColors: Record<string, string> = {
  intent: "border-blue-400",
  dimensions: "border-violet-400",
  both: "border-amber-400",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OpinionCardDeck({
  opinions,
  conflicts,
  anyLoading,
  isRegenerating,
  onSelectOpinion,
  onDismissOpinion,
  onSelectConflictFix,
  onDismissConflict,
  onRegenerate,
}: {
  opinions: OpinionInteraction[];
  conflicts: SchemaConflict[];
  anyLoading: boolean;
  isRegenerating?: boolean;
  onSelectOpinion: (index: number, value: string) => void;
  onDismissOpinion: (index: number) => void;
  onSelectConflictFix: (conflict: SchemaConflict, fix: ConflictFix) => void;
  onDismissConflict: (conflictId: string) => void;
  onRegenerate?: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const pendingOpinions = opinions.filter(
    (o) => o.status === "pending" || o.status === "loading",
  );
  const resolvedOpinions = opinions.filter((o) => o.status === "resolved");

  // Build unified deck: conflicts first, then pending opinions (max 3 shown)
  const allPendingItems: DeckItem[] = [
    ...conflicts.map((c): DeckItem => ({ kind: "conflict", data: c })),
    ...pendingOpinions.map(
      (o, i): DeckItem => ({
        kind: "opinion",
        data: o,
        index: i,
      }),
    ),
  ];

  const visibleItems = allPendingItems.slice(0, 3);
  const hiddenCount = allPendingItems.length - visibleItems.length;
  const resolvedCount = resolvedOpinions.length;

  if (allPendingItems.length === 0 && resolvedCount === 0) return null;

  return (
    <div className="flex flex-col w-full gap-3">
      {/* Pending cards — show up to 3 as a stack */}
      {visibleItems.length > 0 && (
        <div
          className="relative w-full"
          style={{ minHeight: visibleItems.length > 1 ? 200 : undefined }}
        >
          {/* Stacked cards behind (rendered first = lowest z) */}
          {visibleItems
            .slice(1)
            .reverse()
            .map((item, reverseIdx) => {
              const stackPos = visibleItems.length - 1 - reverseIdx; // 1 or 2
              const key =
                item.kind === "conflict" ? item.data.id : item.data.id;
              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{
                    opacity: 0.3 + (visibleItems.length - stackPos) * 0.15,
                    y: stackPos * 6,
                    scale: 1 - stackPos * 0.02,
                  }}
                  className="absolute inset-x-0 top-0 pointer-events-none"
                  style={{ zIndex: visibleItems.length - stackPos }}
                >
                  {/* Fixed-height placeholder card for consistent stacking */}
                  <Card className="border-l-4 border-l-gray-300">
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className="text-sm font-medium text-muted-foreground truncate">
                        {item.kind === "conflict"
                          ? item.data.description
                          : item.data.text}
                      </CardTitle>
                    </CardHeader>
                    <div className="h-10" />
                  </Card>
                </motion.div>
              );
            })}

          {/* Top card (interactive) */}
          <AnimatePresence mode="popLayout">
            {visibleItems[0] && (
              <motion.div
                key={
                  visibleItems[0].kind === "conflict"
                    ? visibleItems[0].data.id
                    : visibleItems[0].data.id
                }
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: -80, scale: 0.9, rotate: -5 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="relative"
                style={{ zIndex: 10 }}
              >
                {visibleItems[0].kind === "conflict" ? (
                  <ConflictDeckCard
                    conflict={visibleItems[0].data}
                    isResolving={anyLoading}
                    onSelectFix={onSelectConflictFix}
                    onDismiss={onDismissConflict}
                  />
                ) : (
                  <OpinionDeckCard
                    interaction={visibleItems[0].data}
                    index={visibleItems[0].index}
                    anyLoading={anyLoading}
                    onSelect={onSelectOpinion}
                    onDismiss={onDismissOpinion}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {hiddenCount > 0 && (
            <div className="text-center mt-2">
              <span className="text-xs text-muted-foreground">
                +{hiddenCount} more{" "}
                {hiddenCount === 1 ? "question" : "questions"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Resolved stack + regenerate button */}
      <div className="flex items-center gap-2">
        {/* Clickable resolved stack */}
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 px-3 rounded-lg border border-dashed hover:border-solid hover:bg-muted/30 flex-1"
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="font-semibold">{resolvedCount}</span>
            <span>resolved — tap to review</span>
          </button>
        )}

        {/* Regenerate button */}
        {onRegenerate && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRegenerate}
            disabled={anyLoading || isRegenerating}
            className="text-xs text-muted-foreground shrink-0"
            title="Generate new refinement questions"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 mr-1",
                isRegenerating && "animate-spin",
              )}
            />
            {isRegenerating ? "Generating..." : "New questions"}
          </Button>
        )}
      </div>

      <OpinionCardResolvedDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        resolvedOpinions={resolvedOpinions}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OpinionDeckCard({
  interaction,
  index,
  anyLoading,
  onSelect,
  onDismiss,
}: {
  interaction: OpinionInteraction;
  index: number;
  anyLoading: boolean;
  onSelect: (index: number, value: string) => void;
  onDismiss: (index: number) => void;
}) {
  const borderColor = layerColors[interaction.layer] ?? "border-gray-300";

  return (
    <Card
      data-testid={`opinion-deck-card-${index}`}
      className={cn(
        "border-l-4",
        borderColor,
        interaction.status === "loading" && "opacity-60",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            {interaction.text}
          </CardTitle>
          {interaction.status === "pending" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onDismiss(index)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {interaction.explanation && (
          <p className="text-xs text-muted-foreground">
            {interaction.explanation}
          </p>
        )}
        <div className="flex gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] w-fit",
              interaction.layer === "intent"
                ? "text-blue-600 border-blue-200"
                : interaction.layer === "dimensions"
                  ? "text-violet-600 border-violet-200"
                  : "text-amber-600 border-amber-200",
            )}
          >
            {interaction.layer}
          </Badge>
          {interaction.dimensionName && (
            <Badge variant="outline" className="text-[10px] w-fit">
              {interaction.dimensionName}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {interaction.options.map((option) => (
            <Button
              key={option.value}
              data-testid={`opinion-option-${option.value}`}
              variant={
                interaction.selectedOption === option.value
                  ? "default"
                  : "outline"
              }
              size="sm"
              disabled={interaction.status !== "pending" || anyLoading}
              onClick={() => onSelect(index, option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ConflictDeckCard({
  conflict,
  isResolving,
  onSelectFix,
  onDismiss,
}: {
  conflict: SchemaConflict;
  isResolving: boolean;
  onSelectFix: (conflict: SchemaConflict, fix: ConflictFix) => void;
  onDismiss: (conflictId: string) => void;
}) {
  const config = severityConfig[conflict.severity];
  const Icon = config.icon;

  return (
    <Card
      data-testid={`conflict-deck-card-${conflict.id}`}
      className={cn(
        "border-l-4",
        config.color,
        config.bg,
        isResolving && "opacity-60",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {conflict.description}
          </CardTitle>
        </div>
        <Badge
          variant="outline"
          className="text-[10px] w-fit text-muted-foreground"
        >
          {conflict.kind.replace(/_/g, " ")}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {conflict.fixes.map((fix) => (
            <Button
              key={fix.value}
              variant="outline"
              size="sm"
              disabled={isResolving}
              onClick={() => onSelectFix(conflict, fix)}
              title={fix.description}
            >
              {fix.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={isResolving}
            onClick={() => onDismiss(conflict.id)}
            className="text-muted-foreground"
          >
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
