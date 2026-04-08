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
  description?: React.ReactNode;
  onDismiss?: () => void;
  onClick?: () => void;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  "data-status"?: string;
}

export function DecisionCard({
  title,
  accentColor,
  bgTint,
  icon,
  badges,
  description,
  onDismiss,
  onClick,
  children,
  disabled,
  className,
  "data-testid": testId,
  "data-status": status,
}: DecisionCardProps) {
  return (
    <Card
      data-testid={testId}
      data-status={status}
      onClick={onClick}
      className={cn(
        "card-hover-lift py-2.5 gap-1.5",
        accentColor && "border-l-[3px]",
        accentColor,
        bgTint,
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
    >
      <CardHeader className="pb-0 px-3.5 gap-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-[13px] font-medium leading-snug flex items-center gap-1.5">
            {icon}
            {title}
          </CardTitle>
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
              onClick={onDismiss}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground/80 leading-normal line-clamp-2">
            {description}
          </p>
        )}
        {badges && <div className="flex flex-wrap gap-1">{badges}</div>}
      </CardHeader>
      {children && (
        <CardContent className="pt-0 px-3.5">{children}</CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reusable badge helpers
// ---------------------------------------------------------------------------

const layerColorMap: Record<
  string,
  { text: string; border: string; bg: string }
> = {
  intent: {
    text: "text-blue-600",
    border: "border-blue-200",
    bg: "bg-blue-50/50",
  },
  dimensions: {
    text: "text-violet-600",
    border: "border-violet-200",
    bg: "bg-violet-50/50",
  },
  both: {
    text: "text-amber-600",
    border: "border-amber-200",
    bg: "bg-amber-50/50",
  },
};

const layerLabelMap: Record<string, string> = {
  intent: "Intent",
  dimensions: "Structure",
};

export function LayerBadge({ layer }: { layer: string }) {
  if (layer === "both") {
    return (
      <>
        <LayerBadge layer="intent" />
        <LayerBadge layer="dimensions" />
      </>
    );
  }
  const label = layerLabelMap[layer];
  if (!label) return null;
  const colors = layerColorMap[layer];
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] w-fit font-medium",
        colors?.text,
        colors?.border,
        colors?.bg,
      )}
    >
      {label}
    </Badge>
  );
}

export function DimensionBadge({ name }: { name: string }) {
  return (
    <Badge
      variant="outline"
      className="text-[10px] w-fit font-medium text-muted-foreground"
    >
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
