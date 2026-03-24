"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface DecisionCardProps {
  title: string;
  accentColor?: string;
  bgTint?: string;
  icon?: React.ReactNode;
  badges?: React.ReactNode;
  description?: string;
  onDismiss?: () => void;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function DecisionCard({
  title,
  accentColor,
  bgTint,
  icon,
  badges,
  description,
  onDismiss,
  children,
  disabled,
  className,
  "data-testid": testId,
}: DecisionCardProps) {
  return (
    <Card
      data-testid={testId}
      className={cn(
        accentColor && "border-l-4",
        accentColor,
        bgTint,
        disabled && "opacity-60",
        className,
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            {icon}
            {title}
          </CardTitle>
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onDismiss}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {badges && <div className="flex gap-1.5">{badges}</div>}
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reusable badge helpers
// ---------------------------------------------------------------------------

const layerColorMap: Record<string, { text: string; border: string }> = {
  intent: { text: "text-blue-600", border: "border-blue-200" },
  dimensions: { text: "text-violet-600", border: "border-violet-200" },
  both: { text: "text-amber-600", border: "border-amber-200" },
};

export function LayerBadge({ layer }: { layer: string }) {
  const colors = layerColorMap[layer];
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] w-fit", colors?.text, colors?.border)}
    >
      {layer}
    </Badge>
  );
}

export function DimensionBadge({ name }: { name: string }) {
  return (
    <Badge variant="outline" className="text-[10px] w-fit">
      {name}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Accent color maps
// ---------------------------------------------------------------------------

export const layerAccentColors: Record<string, string> = {
  intent: "border-blue-400",
  dimensions: "border-violet-400",
  both: "border-amber-400",
};

export const severityConfig = {
  error: { color: "border-red-400", bg: "bg-red-50/50" },
  warning: { color: "border-amber-400", bg: "bg-amber-50/50" },
  info: { color: "border-blue-400", bg: "bg-blue-50/50" },
} as const;
