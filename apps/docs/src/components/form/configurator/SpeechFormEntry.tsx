"use client";

import type { OpinionInteraction } from "@/app/actions/opinion-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ParticleOverlay } from "./ParticleOverlay";

export const SpeechFormEntry = ({
  interaction,
  index,
  compact,
}: {
  interaction: OpinionInteraction;
  index: number;
  compact?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const opinionInteractions = useConfiguratorStore(
    (s) => s.opinionInteractions,
  );
  const basePromptElement = useConfiguratorStore((s) => s.basePromptElement);
  const basePromptActive = useConfiguratorStore((s) => s.basePromptActive);
  const onOpinionInteraction = useConfiguratorStore(
    (s) => s.onOpinionInteraction,
  );
  const dismissOpinionInteraction = useConfiguratorStore(
    (s) => s.dismissOpinionInteraction,
  );
  const anyLoading = opinionInteractions.some((i) => i.status === "loading");
  const [animating, setAnimating] = useState(false);

  const onAnimate = () => {
    if (basePromptElement && ref.current) setAnimating(true);
  };

  // Clear animation when basePromptActive ends
  useEffect(() => {
    if (!basePromptActive && animating) {
      const timer = setTimeout(() => setAnimating(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [basePromptActive, animating]);

  return (
    <>
      {animating && (
        <ParticleOverlay cardRef={ref} targetRef={basePromptElement} />
      )}
      <Card
        key={interaction.id}
        className={interaction.status === "loading" ? "opacity-60" : ""}
        ref={ref}
        onClick={onAnimate}
      >
        <CardHeader className={compact ? "p-3 pb-1" : "pb-2"}>
          <div className="flex items-center justify-between gap-2">
            <CardTitle
              className={
                compact ? "text-xs font-medium leading-tight" : "text-sm font-medium"
              }
            >
              {interaction.text}
            </CardTitle>
            <div className="flex shrink-0 items-center gap-1">
              {interaction.status === "loading" && (
                <Badge variant="secondary" className="text-xs">
                  Updating...
                </Badge>
              )}
              {interaction.status === "pending" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissOpinionInteraction(index);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className={compact ? "p-3 pt-0" : ""}>
          <div className="flex flex-wrap gap-2">
            {interaction.options.map((option) => (
              <Button
                key={option.value}
                variant={
                  interaction.selectedOption === option.value
                    ? "default"
                    : "outline"
                }
                size="sm"
                className={compact ? "h-7 text-xs" : ""}
                disabled={interaction.status !== "pending" || anyLoading}
                onClick={() => onOpinionInteraction(index, option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
};
