"use client";

import type { OpinionInteraction } from "@/lib/types";
import type { SchemaConflict, ConflictFix } from "@/app/actions/conflict-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronUp,
  Info,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unified card item — either an opinion or a conflict */
type DeckItem =
  | { kind: "opinion"; data: OpinionInteraction; index: number }
  | { kind: "conflict"; data: SchemaConflict };

// ---------------------------------------------------------------------------
// Severity config for conflicts
// ---------------------------------------------------------------------------

const severityConfig = {
  error: { icon: Ban, color: "border-red-400", bg: "bg-red-50/50" },
  warning: { icon: AlertTriangle, color: "border-amber-400", bg: "bg-amber-50/50" },
  info: { icon: Info, color: "border-blue-400", bg: "bg-blue-50/50" },
};

// Layer colors for opinions
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
  onSelectOpinion,
  onDismissOpinion,
  onSelectConflictFix,
  onDismissConflict,
}: {
  opinions: OpinionInteraction[];
  conflicts: SchemaConflict[];
  anyLoading: boolean;
  onSelectOpinion: (index: number, value: string) => void;
  onDismissOpinion: (index: number) => void;
  onSelectConflictFix: (conflict: SchemaConflict, fix: ConflictFix) => void;
  onDismissConflict: (conflictId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Build unified deck: conflicts first (higher priority), then pending opinions
  const pendingOpinions = opinions.filter(
    (o) => o.status === "pending" || o.status === "loading",
  );
  const resolvedOpinions = opinions.filter((o) => o.status === "resolved");

  const pendingItems: DeckItem[] = [
    ...conflicts.map((c): DeckItem => ({ kind: "conflict", data: c })),
    ...pendingOpinions.map((o, i): DeckItem => ({
      kind: "opinion",
      data: o,
      index: i,
    })),
  ];

  const topItem = pendingItems[0];
  const stackedCount = pendingItems.length - 1;
  const resolvedCount = resolvedOpinions.length;

  if (pendingItems.length === 0 && resolvedCount === 0) return null;

  return (
    <div className="flex flex-col items-center w-full">
      {/* Active card deck */}
      {pendingItems.length > 0 && (
        <div className="relative w-full" style={{ minHeight: 180 }}>
          {/* Stacked cards behind (max 3 visible) */}
          {pendingItems
            .slice(1, 4)
            .reverse()
            .map((item, reverseIdx) => {
              const stackIdx = pendingItems.slice(1, 4).length - reverseIdx;
              const itemKey =
                item.kind === "conflict" ? item.data.id : item.data.id;
              return (
                <motion.div
                  key={itemKey}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{
                    opacity: 0.4 + stackIdx * 0.15,
                    y: stackIdx * 4,
                    scale: 1 - stackIdx * 0.03,
                    rotate: stackIdx % 2 === 0 ? -0.5 : 0.5,
                  }}
                  className="absolute inset-x-0 top-0 pointer-events-none"
                  style={{ zIndex: stackIdx }}
                >
                  <Card className="border-l-4 border-l-gray-300 opacity-60">
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className="text-sm font-medium text-muted-foreground truncate">
                        {item.kind === "conflict"
                          ? item.data.description
                          : item.data.text}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="h-8" />
                  </Card>
                </motion.div>
              );
            })}

          {/* Top card (active) */}
          <AnimatePresence mode="popLayout">
            {topItem && (
              <motion.div
                key={
                  topItem.kind === "conflict"
                    ? topItem.data.id
                    : topItem.data.id
                }
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 40, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="relative"
                style={{ zIndex: 10 }}
              >
                {topItem.kind === "conflict" ? (
                  <ConflictDeckCard
                    conflict={topItem.data}
                    isResolving={anyLoading}
                    onSelectFix={onSelectConflictFix}
                    onDismiss={onDismissConflict}
                  />
                ) : (
                  <OpinionDeckCard
                    interaction={topItem.data}
                    index={topItem.index}
                    anyLoading={anyLoading}
                    onSelect={onSelectOpinion}
                    onDismiss={onDismissOpinion}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Stack count indicator */}
          {stackedCount > 0 && (
            <div className="text-center mt-2">
              <span className="text-xs text-muted-foreground">
                +{stackedCount} more {stackedCount === 1 ? "question" : "questions"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Resolved opinions — collapsed deck */}
      {resolvedCount > 0 && (
        <div className="w-full mt-3">
          <button
            type="button"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-1"
            onClick={() => setExpanded(!expanded)}
          >
            <span className="font-semibold">{resolvedCount} resolved</span>
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            <span>{expanded ? "Hide" : "Show"} timeline</span>
          </button>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-1.5 border rounded-lg p-3 bg-muted/20">
                  {resolvedOpinions.map((o) => {
                    const selectedLabel =
                      o.options.find((opt) => opt.value === o.selectedOption)
                        ?.label ?? o.selectedOption;
                    return (
                      <div
                        key={o.id}
                        className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-md bg-background"
                      >
                        <div
                          className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            o.layer === "intent"
                              ? "bg-blue-400"
                              : o.layer === "dimensions"
                                ? "bg-violet-400"
                                : "bg-amber-400",
                          )}
                        />
                        <span className="flex-1 truncate text-muted-foreground">
                          {o.text}
                        </span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {selectedLabel}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
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
      className={cn("border-l-4", borderColor, interaction.status === "loading" && "opacity-60")}
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
      className={cn("border-l-4", config.color, config.bg, isResolving && "opacity-60")}
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
