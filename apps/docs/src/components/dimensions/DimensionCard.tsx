"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DimensionObject, DimensionScope } from "@/lib/dimension-types";
import { dimensionScopeColors, dimensionScopeLabels } from "@/lib/dimension-types";
import { cn } from "@/lib/utils";
import { Pencil, X } from "lucide-react";
import { useState } from "react";

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
  const [editScope, setEditScope] = useState(dimension.scope);
  const [editImportance, setEditImportance] = useState(dimension.importance);
  const [editQuestions, setEditQuestions] = useState(dimension.openQuestions);
  const [newQuestion, setNewQuestion] = useState("");

  const isRejected = dimension.status === "rejected";

  function startEdit() {
    setEditName(dimension.name);
    setEditScope(dimension.scope);
    setEditImportance(dimension.importance);
    setEditQuestions([...dimension.openQuestions]);
    setEditing(true);
  }

  function saveEdit() {
    onEdit({
      name: editName,
      scope: editScope,
      importance: editImportance,
      openQuestions: editQuestions,
      status: "edited",
    });
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function addQuestion() {
    const trimmed = newQuestion.trim();
    if (trimmed && !editQuestions.includes(trimmed)) {
      setEditQuestions([...editQuestions, trimmed]);
      setNewQuestion("");
    }
  }

  function removeQuestion(index: number) {
    setEditQuestions(editQuestions.filter((_, i) => i !== index));
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
            value={editScope}
            onChange={(e) => setEditScope(e.target.value as DimensionScope)}
            className="h-7 w-full rounded border px-2 text-xs"
          >
            {Object.entries(dimensionScopeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Input
            value={editImportance}
            onChange={(e) => setEditImportance(e.target.value)}
            className="h-7 text-xs"
            placeholder="Why does this matter?"
          />
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Open questions
            </span>
            {editQuestions.map((q, i) => (
              <div key={i} className="flex items-start gap-1">
                <span className="flex-1 text-xs text-muted-foreground">{q}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-4 w-4 shrink-0"
                  onClick={() => removeQuestion(i)}
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              </div>
            ))}
            <Input
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addQuestion();
                }
              }}
              placeholder="Add question..."
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
          <div className={"flex items-start justify-between gap-2"}>
            <div
              className="min-w-0 flex-1 cursor-pointer"
              onClick={() => onAccept()}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium leading-tight">
                  {dimension.name}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0",
                    dimensionScopeColors[dimension.scope],
                  )}
                >
                  {dimensionScopeLabels[dimension.scope]}
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
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={startEdit}
                  title="Edit"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className={cn("h-6 w-6", isRejected && "text-red-500")}
                onClick={isRejected ? onAccept : onReject}
                title={isRejected ? "Restore" : "Reject"}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {dimension.importance && !isRejected && (
            <p className="mt-1 text-xs text-muted-foreground/80 italic">
              {dimension.importance}
            </p>
          )}
          {dimension.openQuestions.length > 0 && !isRejected && (
            <ul className="mt-2 space-y-0.5">
              {dimension.openQuestions.map((q, i) => (
                <li
                  key={i}
                  className="text-xs text-muted-foreground pl-3 relative before:absolute before:left-0 before:content-['?'] before:text-muted-foreground/50 before:font-medium"
                >
                  {q}
                </li>
              ))}
            </ul>
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
