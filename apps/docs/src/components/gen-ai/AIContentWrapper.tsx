"use client";

import { Badge } from "@/components/ui/badge";
import { INTERACTION_MODE_MAP } from "@/lib/interaction-mode-config";
import { cn } from "@/lib/utils";
import {
  INTERACTION_MODE_META,
  INTERACTION_MODES,
  InteractionMode,
} from "interact";
import { History } from "lucide-react";
import { ReactNode } from "react";
import { DirectEditProvider } from "./DirectEditContext";
import { useInlineEditor } from "./useInlineEditor";

export interface AIEntityMetadata {
  id: string;
  entity_type: "report" | "story" | "visualization";
  entity_id: string;
  generation_prompt?: string | null;
  generation_parameters?: Record<string, unknown>;
  generation_code?: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface AIContentWrapperProps {
  children: ReactNode;
  metadata?: AIEntityMetadata;
  entityType?: "report" | "story" | "visualization";
  entityId?: string;
  editable?: boolean;

  directEdit?: {
    value: string;
    onSave: (newValue: string) => Promise<void>;
    multiline?: boolean;
    validateValue?: (value: string) => string | undefined; // Returns error message if invalid
    disabled?: boolean;
  };

  onPromptEdit?: () => void;
  onContextEdit?: () => void;
  onViewHistory?: () => void;
  className?: string;
}

export function AIContentWrapper({
  children,
  metadata,
  entityType,
  editable = true,
  directEdit,
  onPromptEdit,
  onContextEdit,
  onViewHistory,
  className,
}: AIContentWrapperProps) {
  const directEditProps = useInlineEditor(
    directEdit || {
      value: "",
      onSave: async () => {},
      disabled: true,
    }
  );

  const availableModes = INTERACTION_MODES.filter((mode) => {
    if (mode === "direct" && directEdit) return true;
    if (mode === "prompt" && onPromptEdit) return true;
    if (mode === "context" && onContextEdit) return true;
    return false;
  });

  const handleModeClick = (mode: InteractionMode) => {
    if (mode === "direct" && directEdit) {
      if (directEditProps.isEditing) {
        directEditProps.handleCancelEdit();
      } else {
        directEditProps.handleStartEdit();
      }
    } else if (mode === "prompt" && onPromptEdit) {
      onPromptEdit();
    } else if (mode === "context" && onContextEdit) {
      onContextEdit();
    }
  };

  return (
    <div className={cn("relative")}>
      {/* Interaction Mode Badges - shown on hover */}
      {editable && availableModes.length > 0 && (
        <div
          className={cn(
            "absolute -top-3 right-2 z-20 flex items-center gap-1.5 transition-all duration-200",
            "opacity-100 translate-y-0",
            "peer"
          )}
        >
          {availableModes.map((mode) => {
            // Get the mode-specific styling
            const config = INTERACTION_MODE_MAP[mode];
            const { description } = INTERACTION_MODE_META[mode];

            return (
              <Badge
                key={mode}
                variant="outline"
                className={cn(
                  "cursor-pointer px-2 py-0.5 border transition-all duration-200 hover:scale-105",
                  config.bgColor,
                  config.color,
                  config.borderColor,
                  "shadow-sm"
                )}
                onClick={() => handleModeClick(mode)}
                title={description}
              >
                <span className="flex items-center gap-1">
                  <config.icon className="size-3" />
                  <span className="text-[10px] font-medium">
                    {mode === "direct" && "Edit"}
                    {mode === "prompt" && "Prompt"}
                    {mode === "context" && "Context"}
                  </span>
                </span>
              </Badge>
            );
          })}

          {/* Additional action badges */}
          {onViewHistory && (
            <Badge
              variant="outline"
              className={cn(
                "cursor-pointer px-2 py-0.5 border transition-all duration-200 hover:scale-105",
                "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300",
                "shadow-sm"
              )}
              onClick={onViewHistory}
              title="View edit history"
            >
              <span className="flex items-center gap-1">
                <History className="h-3 w-3" />
                <span className="text-[10px] font-medium">History</span>
              </span>
            </Badge>
          )}
        </div>
      )}

      <div
        className={cn(
          "rounded-lg transition-all duration-200",
          "bg-linear-to-br from-primary/5 via-transparent to-primary/5",
          "border-2 border-transparent peer-hover:border-primary/30",
          className
        )}
      >
        {/* Content Area */}
        <div className={cn("relative")}>
          <DirectEditProvider {...directEditProps}>
            {children}
          </DirectEditProvider>
        </div>

        {/* Generation Info - subtle footer for debugging */}
        {metadata && process.env.NODE_ENV === "development" && (
          <div className="absolute bottom-1 right-2 text-xs text-muted-foreground opacity-50">
            {entityType} •{" "}
            {metadata.created_at
              ? new Date(metadata.created_at).toLocaleDateString()
              : "N/A"}
          </div>
        )}
      </div>
    </div>
  );
}
