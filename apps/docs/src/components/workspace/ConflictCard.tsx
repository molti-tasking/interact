"use client";

import type { ConflictFix, SchemaConflict } from "@/app/actions/conflict-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, Ban, Info } from "lucide-react";

const severityConfig = {
  error: {
    icon: Ban,
    badge: "bg-red-100 text-red-700 border-red-200",
    card: "border-red-200 bg-red-50/30",
    label: "Error",
  },
  warning: {
    icon: AlertTriangle,
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    card: "border-amber-200 bg-amber-50/30",
    label: "Warning",
  },
  info: {
    icon: Info,
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    card: "border-blue-200 bg-blue-50/30",
    label: "Suggestion",
  },
};

export function ConflictCard({
  conflict,
  isResolving,
  onSelectFix,
  onDismiss,
}: {
  conflict: SchemaConflict;
  isResolving: boolean;
  onSelectFix: (conflict: SchemaConflict, fix: ConflictFix) => void;
  onDismiss: (conflictId: string) => void;
}) {
  const config = severityConfig[conflict.severity];
  const Icon = config.icon;

  return (
    <Card
      data-testid={`conflict-card-${conflict.id}`}
      className={cn(config.card, isResolving && "opacity-60")}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {conflict.description}
          </CardTitle>
        </div>
        <div className="flex gap-1.5">
          <Badge variant="outline" className={cn("text-[10px] w-fit", config.badge)}>
            {config.label}
          </Badge>
          <Badge variant="outline" className="text-[10px] w-fit">
            {conflict.kind.replace(/_/g, " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {conflict.fixes.map((fix) => (
            <Button
              key={fix.value}
              data-testid={`conflict-fix-${fix.value}`}
              variant="outline"
              size="sm"
              disabled={isResolving}
              onClick={() => onSelectFix(conflict, fix)}
              title={fix.description}
            >
              {fix.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={isResolving}
            onClick={() => onDismiss(conflict.id)}
            className="text-muted-foreground"
          >
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
