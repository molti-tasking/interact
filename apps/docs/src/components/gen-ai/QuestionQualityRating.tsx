"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
import { useState } from "react";

interface QuestionQualityRatingProps {
  initialRating?: number;
  onRatingChange?: (rating: number) => void;
  disabled?: boolean;
}

export function QuestionQualityRating({
  initialRating = 0,
  onRatingChange,
  disabled = false,
}: QuestionQualityRatingProps) {
  const [rating, setRating] = useState(initialRating);
  const [hoverRating, setHoverRating] = useState(0);

  const handleRatingClick = (value: number) => {
    if (disabled) return;
    setRating(value);
    onRatingChange?.(value);
  };

  const handleMouseEnter = (value: number) => {
    if (disabled) return;
    setHoverRating(value);
  };

  const handleMouseLeave = () => {
    if (disabled) return;
    setHoverRating(0);
  };

  const displayRating = hoverRating || rating;

  const getRatingText = (value: number) => {
    switch (value) {
      case 1:
        return "Poor - Needs significant improvement";
      case 2:
        return "Below Average - Some issues to address";
      case 3:
        return "Average - Acceptable quality";
      case 4:
        return "Good - Well-formulated question";
      case 5:
        return "Excellent - Outstanding research question";
      default:
        return "Rate this question quality";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-gray-600">Quality:</span>
      <div className="flex gap-0.5">
        <TooltipProvider>
          {[1, 2, 3, 4, 5].map((value) => (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleRatingClick(value)}
                  onMouseEnter={() => handleMouseEnter(value)}
                  onMouseLeave={handleMouseLeave}
                  disabled={disabled}
                  className={cn(
                    "transition-all focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1",
                    !disabled && "hover:scale-110",
                    disabled && "cursor-not-allowed opacity-50"
                  )}
                  aria-label={`Rate question with ${value} stars`}
                >
                  <Star
                    className={cn(
                      "h-4 w-4 transition-colors",
                      value <= displayRating
                        ? "fill-amber-400 text-amber-400"
                        : "text-gray-300",
                      !disabled &&
                        value > rating &&
                        value <= hoverRating &&
                        "text-amber-300"
                    )}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{getRatingText(value)}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
      {rating > 0 && (
        <span className="text-xs text-muted-foreground">({rating}/5)</span>
      )}
    </div>
  );
}
