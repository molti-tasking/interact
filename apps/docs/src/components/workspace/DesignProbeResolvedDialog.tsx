"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DecisionCard,
  DimensionBadge,
  LayerBadge,
  layerAccentColors,
} from "@/components/workspace/DecisionCard";
import type { DesignProbe } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArrowUp, Check, Loader2, Pen, RotateCcw } from "lucide-react";
import React, { useState } from "react";
import { ScrollFadeContainer } from "./ScrollFadeContainer";

interface DesignProbeResolvedDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  resolvedProbes: DesignProbe[];
  onReResolve?: (probeId: string, newValue: string) => Promise<void>;
  isReResolving?: boolean;
}

function formatTimeAgo(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const DesignProbeResolvedDialog = ({
  dialogOpen,
  setDialogOpen,
  resolvedProbes,
  onReResolve,
  isReResolving,
}: DesignProbeResolvedDialogProps) => {
  const [reResolvingProbeId, setReResolvingProbeId] = useState<string | null>(
    null,
  );
  // Per-probe edit state
  const [editingProbeId, setEditingProbeId] = useState<string | null>(null);
  const [editSelectedValue, setEditSelectedValue] = useState<string | null>(
    null,
  );
  const [editShowCustom, setEditShowCustom] = useState(false);
  const [editCustomText, setEditCustomText] = useState("");

  // Sort resolved probes: latest first by creation time
  const sortedProbes = [...resolvedProbes].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return dateB - dateA;
  });

  const startEditing = (probe: DesignProbe) => {
    setEditingProbeId(probe.id);
    // Pre-select the current answer
    if (probe.selectedOption?.startsWith("custom:")) {
      setEditShowCustom(true);
      setEditCustomText(probe.selectedOption.slice("custom:".length));
      setEditSelectedValue(null);
    } else {
      setEditSelectedValue(probe.selectedOption);
      setEditShowCustom(false);
      setEditCustomText("");
    }
  };

  const cancelEditing = () => {
    setEditingProbeId(null);
    setEditSelectedValue(null);
    setEditShowCustom(false);
    setEditCustomText("");
  };

  const confirmEdit = async (probe: DesignProbe) => {
    if (!onReResolve) return;

    const newValue = editShowCustom
      ? `custom:${editCustomText.trim()}`
      : editSelectedValue;

    if (!newValue) return;
    if (newValue === probe.selectedOption) {
      cancelEditing();
      return;
    }

    setReResolvingProbeId(probe.id);
    setEditingProbeId(null);
    try {
      await onReResolve(probe.id, newValue);
    } catch (err) {
      console.error("[DesignProbeResolvedDialog] Re-resolve error:", err);
    } finally {
      setReResolvingProbeId(null);
      cancelEditing();
    }
  };

  const hasValidEdit = editShowCustom
    ? editCustomText.trim().length > 0
    : editSelectedValue !== null;

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (!open) cancelEditing();
        setDialogOpen(open);
      }}
    >
      <DialogContent className="max-w-7xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Resolved Design Probes ({resolvedProbes.length})
          </DialogTitle>
        </DialogHeader>
        <ScrollFadeContainer>
          <div className="grid gap-2 mt-2">
            {sortedProbes.map((o, index) => {
              const isThisReResolving = reResolvingProbeId === o.id;
              const isThisEditing = editingProbeId === o.id;
              const editMeta = buildEditMeta(o);

              return (
                <React.Fragment key={o.id}>
                  <DecisionCard
                    title={o.text}
                    accentColor={
                      layerAccentColors[o.layer] ?? "border-gray-300"
                    }
                    badges={
                      <>
                        <LayerBadge layer={o.layer} />
                        {o.dimensionName && (
                          <DimensionBadge name={o.dimensionName} />
                        )}
                        {o.editCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-sans">
                            <RotateCcw className="h-2.5 w-2.5" />
                            edited {o.editCount}x
                          </span>
                        )}
                      </>
                    }
                    description={
                      <>
                        {o.explanation}
                        {editMeta && (
                          <span className="block text-[10px] text-muted-foreground/60 mt-1 font-sans">
                            {editMeta}
                          </span>
                        )}
                      </>
                    }
                  >
                    {isThisReResolving ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Re-resolving with new answer...
                      </div>
                    ) : isThisEditing ? (
                      /* ---- Inline edit mode ---- */
                      <div className="space-y-2">
                        <div className="grid gap-1.5">
                          {o.options.map((opt) => {
                            const isSelected =
                              editSelectedValue === opt.value &&
                              !editShowCustom;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => {
                                  setEditSelectedValue(opt.value);
                                  setEditShowCustom(false);
                                }}
                                className={cn(
                                  "text-left rounded-lg border p-2.5 transition-colors text-xs",
                                  isSelected
                                    ? "border-foreground/30 bg-accent"
                                    : "border-border hover:border-foreground/20 hover:bg-accent/50",
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <div
                                    className={cn(
                                      "h-3.5 w-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                                      isSelected
                                        ? "border-foreground bg-foreground"
                                        : "border-muted-foreground/30",
                                    )}
                                  >
                                    {isSelected && (
                                      <Check className="h-2 w-2 text-background" />
                                    )}
                                  </div>
                                  <span className="font-medium">
                                    {opt.label}
                                  </span>
                                </div>
                              </button>
                            );
                          })}

                          {/* Custom answer option */}
                          <button
                            type="button"
                            onClick={() => {
                              setEditShowCustom(true);
                              setEditSelectedValue(null);
                            }}
                            className={cn(
                              "text-left rounded-lg border border-dashed p-2.5 transition-colors text-xs",
                              editShowCustom
                                ? "border-foreground/30 bg-accent"
                                : "border-border hover:border-foreground/20 hover:bg-accent/50",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={cn(
                                  "h-3.5 w-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                                  editShowCustom
                                    ? "border-foreground bg-foreground"
                                    : "border-muted-foreground/30",
                                )}
                              >
                                {editShowCustom && (
                                  <Pen className="h-1.5 w-1.5 text-background" />
                                )}
                              </div>
                              <span className="font-medium text-muted-foreground">
                                Write a custom answer
                              </span>
                            </div>
                          </button>

                          {editShowCustom && (
                            <Textarea
                              autoFocus
                              placeholder="Describe your preferred approach..."
                              value={editCustomText}
                              onChange={(e) =>
                                setEditCustomText(e.target.value)
                              }
                              rows={2}
                              className="text-xs"
                            />
                          )}
                        </div>
                        <div className="flex gap-1.5 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={!hasValidEdit}
                            onClick={() => confirmEdit(o)}
                          >
                            Confirm
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* ---- Display mode ---- */
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {o.options.map((opt) => {
                            const isCustom =
                              o.selectedOption?.startsWith("custom:");
                            const isSelected =
                              !isCustom && opt.value === o.selectedOption;
                            const wasPrevious =
                              o.previousSelectedOption &&
                              opt.value === o.previousSelectedOption;

                            return (
                              <div
                                key={opt.value}
                                className={cn(
                                  "flex items-center gap-1 text-xs rounded-md px-2 py-1 font-sans",
                                  isSelected
                                    ? "bg-green-50 border border-green-200 font-medium text-green-800"
                                    : wasPrevious
                                      ? "bg-amber-50/50 border border-amber-200/50 text-amber-700/70 line-through"
                                      : "bg-muted/40 border border-transparent text-muted-foreground line-through",
                                )}
                              >
                                {isSelected && (
                                  <Check className="h-3 w-3 text-green-600 shrink-0" />
                                )}
                                {opt.label}
                              </div>
                            );
                          })}
                          {o.selectedOption?.startsWith("custom:") && (
                            <div className="flex items-center gap-1 text-xs rounded-md px-2 py-1 font-sans bg-green-50 border border-green-200 font-medium text-green-800">
                              <Check className="h-3 w-3 text-green-600 shrink-0" />
                              {o.selectedOption.slice("custom:".length)}
                            </div>
                          )}
                        </div>
                        {onReResolve && !isReResolving && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] text-muted-foreground/50 hover:text-foreground shrink-0"
                            onClick={() => startEditing(o)}
                          >
                            <Pen className="h-3 w-3 mr-0.5" />
                            Change
                          </Button>
                        )}
                      </div>
                    )}
                  </DecisionCard>
                  {index < resolvedProbes.length - 1 && (
                    <div className="flex justify-self-center opacity-15">
                      <ArrowUp className="h-4 w-4" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </ScrollFadeContainer>
      </DialogContent>
    </Dialog>
  );
};

function buildEditMeta(probe: DesignProbe): string | null {
  if (probe.editedBy && probe.editCount > 0) {
    const ago = formatTimeAgo(probe.editedAt);
    const prevLabel = probe.previousSelectedOption
      ? ` (previous: ${probe.previousSelectedOption})`
      : "";
    return `Edited by ${probe.editedBy}${ago ? ` ${ago}` : ""}${prevLabel}`;
  }
  if (probe.resolvedBy) {
    const ago = formatTimeAgo(probe.resolvedAt);
    return `Resolved by ${probe.resolvedBy}${ago ? ` ${ago}` : ""}`;
  }
  return null;
}
