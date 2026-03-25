"use client";

import type { DesignProbe } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useRef } from "react";
import { ParticleOverlay } from "./ParticleOverlay";

export function DesignProbeCard({
  probe,
  index,
  isAnimating,
  editorRef,
  anyLoading,
  onSelect,
  onDismiss,
}: {
  probe: DesignProbe;
  index: number;
  isAnimating: boolean;
  editorRef: React.RefObject<HTMLDivElement | null>;
  anyLoading: boolean;
  onSelect: (index: number, value: string) => void;
  onDismiss: (index: number) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {isAnimating && (
        <ParticleOverlay cardRef={cardRef} targetRef={editorRef} />
      )}
      <Card
        ref={cardRef}
        data-testid={`design-probe-card-${index}`}
        className={cn(probe.status === "loading" && "opacity-60")}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">
              {probe.text}
            </CardTitle>
            <div className="flex shrink-0 items-center gap-1">
              {probe.status === "loading" && (
                <Badge variant="secondary" className="text-xs">
                  Updating...
                </Badge>
              )}
              {probe.status === "pending" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(index);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          {probe.explanation && (
            <p className="text-xs text-muted-foreground">
              {probe.explanation}
            </p>
          )}
          <div className="flex gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] w-fit",
                probe.layer === "intent"
                  ? "text-blue-600 border-blue-200"
                  : probe.layer === "dimensions"
                    ? "text-violet-600 border-violet-200"
                    : "text-amber-600 border-amber-200",
              )}
            >
              {probe.layer}
            </Badge>
            {probe.dimensionName && (
              <Badge variant="outline" className="text-[10px] w-fit">
                {probe.dimensionName}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {probe.options.map((option) => (
              <Button
                key={option.value}
                data-testid={`design-probe-option-${option.value}`}
                variant={
                  probe.selectedOption === option.value
                    ? "default"
                    : "outline"
                }
                size="sm"
                disabled={probe.status !== "pending" || anyLoading}
                onClick={() => onSelect(index, option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
