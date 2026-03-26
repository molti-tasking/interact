"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CircleHelp } from "lucide-react";

export function FieldTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CircleHelp className="inline h-3.5 w-3.5 ml-1 text-muted-foreground cursor-help" />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-64">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
