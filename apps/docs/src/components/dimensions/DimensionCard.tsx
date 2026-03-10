"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DimensionObject, DimensionType } from "@/lib/dimension-types";
import { dimensionTypeColors } from "@/lib/dimension-types";
import { cn } from "@/lib/utils";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

const typeLabels: Record<DimensionType, string> = {
  categorical: "Categorical",
  ordinal: "Ordinal",
  numerical: "Numerical",
  boolean: "Boolean",
};

const statusStyles: Record<string, string> = {
  suggested: "border-border",
  accepted: "border-green-400 bg-green-50/50",
  rejected: "border-red-300 bg-red-50/30 opacity-50",
  edited: "border-blue-400 bg-blue-50/50",
};

interface DimensionCardProps {
  dimension: DimensionObject;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (updates: Partial<DimensionObject>) => void;
}

export function DimensionCard({
  dimension,
  onAccept,
  onReject,
  onEdit,
}: DimensionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(dimension.name);
  const [editType, setEditType] = useState(dimension.type);
  const [editValues, setEditValues] = useState(dimension.values);
  const [newValue, setNewValue] = useState("");

  const isRejected = dimension.status === "rejected";

  function startEdit() {
    setEditName(dimension.name);
    setEditType(dimension.type);
    setEditValues([...dimension.values]);
    setEditing(true);
  }

  function saveEdit() {
    onEdit({
      name: editName,
      type: editType,
      values: editValues,
      status: "edited",
    });
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function addValue() {
    const trimmed = newValue.trim();
    if (trimmed && !editValues.includes(trimmed)) {
      setEditValues([...editValues, trimmed]);
      setNewValue("");
    }
  }

  function removeValue(index: number) {
    setEditValues(editValues.filter((_, i) => i !== index));
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-all",
        statusStyles[dimension.status],
      )}
    >
      {editing ? (
        <div className="space-y-2">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="h-7 text-sm font-medium"
            placeholder="Dimension name"
          />
          <select
            value={editType}
            onChange={(e) => setEditType(e.target.value as DimensionType)}
            className="h-7 w-full rounded border px-2 text-xs"
          >
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1">
            {editValues.map((v, i) => (
              <Badge
                key={i}
                variant="secondary"
                className="cursor-pointer gap-1 text-xs"
                onClick={() => removeValue(i)}
              >
                {v}
                <X className="h-2.5 w-2.5" />
              </Badge>
            ))}
          </div>
          <div className="flex gap-1">
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addValue();
                }
              }}
              placeholder="Add value..."
              className="h-6 text-xs"
            />
          </div>
          <div className="flex gap-1">
            <Button size="sm" className="h-6 text-xs" onClick={saveEdit}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={cancelEdit}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium leading-tight">
                  {dimension.name}
                </span>
                <Badge
                  variant="outline"
                  className={cn("text-[10px] px-1.5 py-0", dimensionTypeColors[dimension.type])}
                >
                  {typeLabels[dimension.type]}
                </Badge>
              </div>
              {dimension.description && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {dimension.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-0.5">
              {!isRejected && (
                <>
                  <Button
                    size="icon"
                    variant={dimension.status === "accepted" || dimension.status === "edited" ? "default" : "ghost"}
                    className={cn(
                      "h-6 w-6",
                      (dimension.status === "accepted" || dimension.status === "edited") && "bg-green-600 hover:bg-green-700",
                    )}
                    onClick={onAccept}
                    title="Accept"
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={startEdit}
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "h-6 w-6",
                  isRejected && "text-red-500",
                )}
                onClick={isRejected ? onAccept : onReject}
                title={isRejected ? "Restore" : "Reject"}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {dimension.values.length > 0 && !isRejected && (
            <div className="mt-2 flex flex-wrap gap-1">
              {dimension.values.map((v, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {v}
                </Badge>
              ))}
            </div>
          )}
          {dimension.source === "user" && (
            <Badge variant="outline" className="mt-1 text-[10px]">
              User-added
            </Badge>
          )}
        </>
      )}
    </div>
  );
}
