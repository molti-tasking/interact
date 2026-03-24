"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DecisionCard } from "@/components/workspace/DecisionCard";
import type { DetectedStandard } from "@/lib/domain-standards";
import { Check, Shield, X } from "lucide-react";

interface StandardCardProps {
  detected: DetectedStandard;
  isAccepted: boolean;
  onAccept: (standardId: string) => void;
  onSkip: (standardId: string) => void;
}

export function StandardCard({
  detected,
  isAccepted,
  onAccept,
  onSkip,
}: StandardCardProps) {
  const { standard, confidence, relevantConstraints } = detected;

  const mandatory = relevantConstraints.filter(
    (c) => c.required === "mandatory",
  ).length;
  const recommended = relevantConstraints.filter(
    (c) => c.required === "recommended",
  ).length;
  const optional = relevantConstraints.filter(
    (c) => c.required === "optional",
  ).length;

  return (
    <DecisionCard
      title={standard.name}
      icon={<Shield className="h-4 w-4 text-blue-500 shrink-0" />}
      accentColor={isAccepted ? "border-emerald-400" : "border-blue-400"}
      bgTint={isAccepted ? "bg-emerald-50/50 dark:bg-emerald-950/20" : undefined}
      description={standard.description}
      badges={
        <>
          <Badge variant="outline" className="text-[10px]">
            {standard.domain}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            Conf. {Math.round(confidence * 100)}%
          </Badge>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-3 text-xs text-muted-foreground">
          {mandatory > 0 && (
            <span>
              <strong className="text-foreground">{mandatory}</strong> mandatory
            </span>
          )}
          {recommended > 0 && (
            <span>
              <strong className="text-foreground">{recommended}</strong>{" "}
              recommended
            </span>
          )}
          {optional > 0 && (
            <span>
              <strong className="text-foreground">{optional}</strong> optional
            </span>
          )}
        </div>

        {isAccepted ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Applied — mandatory fields will be included
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              data-testid={`standard-accept-${standard.id}`}
              size="sm"
              variant="default"
              className="h-7"
              onClick={() => onAccept(standard.id)}
            >
              Apply Standard
            </Button>
            <Button
              data-testid={`standard-skip-${standard.id}`}
              size="sm"
              variant="ghost"
              className="h-7 text-muted-foreground"
              onClick={() => onSkip(standard.id)}
            >
              <X className="h-3 w-3 mr-1" />
              Skip
            </Button>
          </div>
        )}
      </div>
    </DecisionCard>
  );
}
