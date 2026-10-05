"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supportsColumnAction } from "@/lib/form-renderer/response-rows";
import type { Field, Portfolio, SavedColumnAction } from "@/lib/types";
import { MoreVertical, Sparkles, Zap } from "lucide-react";

interface ColumnHeaderProps {
  field: Field;
  portfolio: Portfolio;
  /** Opens the column-action dialog (prefilled when re-running a saved action) */
  onOpenAction: (field: Field, savedAction?: SavedColumnAction) => void;
}

export function ColumnHeader({
  field,
  portfolio,
  onOpenAction,
}: ColumnHeaderProps) {
  const savedActions = (portfolio.schema.columnActions ?? []).filter(
    (a) => a.fieldId === field.id,
  );

  return (
    <div className="flex items-center gap-1">
      <span>{field.label}</span>
      {supportsColumnAction(field) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Column actions for ${field.label}`}
              className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {savedActions.length > 0 && (
              <>
                {savedActions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    onSelect={() => onOpenAction(field, action)}
                  >
                    <Zap className="mr-2 h-3.5 w-3.5" aria-hidden />
                    {action.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => onOpenAction(field)}>
              <Sparkles className="mr-2 h-3.5 w-3.5" aria-hidden />
              Custom prompt…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
