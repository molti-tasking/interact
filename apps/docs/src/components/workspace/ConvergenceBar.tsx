"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConvergence } from "@/hooks/query/convergence";
import { CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConvergenceBarProps {
  portfolioId: string;
  className?: string;
}

export function ConvergenceBar({ portfolioId, className }: ConvergenceBarProps) {
  const { data: convergence, isLoading } = useConvergence(portfolioId);

  if (isLoading || !convergence) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="h-2 w-24 bg-muted rounded-full animate-pulse" />
      </div>
    );
  }

  const { score, breakdown } = convergence;

  // Gradient color based on score
  const getGradientColor = (score: number) => {
    if (score < 30) return "from-gray-400 to-gray-500";
    if (score < 60) return "from-blue-400 to-blue-600";
    return "from-purple-500 to-purple-700";
  };

  const gradientClass = getGradientColor(score);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-2 cursor-help", className)}>
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Convergence
          </span>
          <div className="relative h-2 w-32 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "absolute inset-y-0 left-0 bg-gradient-to-r rounded-full transition-all duration-500",
                gradientClass
              )}
              style={{ width: `${score}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-foreground min-w-[3ch]">
            {score}%
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-2">
          <div className="font-semibold text-sm border-b border-background/20 pb-1 mb-2">
            Convergence Breakdown
          </div>
          
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {breakdown.opinions === 100 ? (
                <CheckCircle2 className="h-3 w-3 text-green-400" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span className="text-xs">Opinions Resolved</span>
            </div>
            <span className="text-xs font-medium">{breakdown.opinions}%</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {breakdown.dimensions === 100 ? (
                <CheckCircle2 className="h-3 w-3 text-green-400" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span className="text-xs">Dimensions Accepted</span>
            </div>
            <span className="text-xs font-medium">{breakdown.dimensions}%</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {breakdown.standards === 100 ? (
                <CheckCircle2 className="h-3 w-3 text-green-400" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span className="text-xs">Standards Reviewed</span>
            </div>
            <span className="text-xs font-medium">{breakdown.standards}%</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {breakdown.hasSchema ? (
                <CheckCircle2 className="h-3 w-3 text-green-400" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span className="text-xs">Schema Created</span>
            </div>
            <span className="text-xs font-medium">
              {breakdown.hasSchema ? "✓" : "—"}
            </span>
          </div>

          <div className="text-[10px] text-background/70 pt-1 border-t border-background/20 mt-2">
            Weighted: Opinions 40%, Dimensions 30%, Standards 20%, Schema 10%
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
