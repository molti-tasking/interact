"use client";

import { AIContentWrapper } from "@/components/gen-ai/AIContentWrapper";
import { InlineEditor } from "@/components/gen-ai/InlineEditor";
import { PromptEditor } from "@/components/gen-ai/PromptEditor";
import { QuestionQualityRating } from "@/components/gen-ai/QuestionQualityRating";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldQuestionIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface AIFormProps {
  questionNumber: number;
  initialQuestion: string;
  initialContribution: string;
  currentQuestion: string;
  currentContribution: string;
  qualityRating?: number | null;
  onUpdate: () => void;
  disabled?: boolean;
}

export function AIForm({
  questionNumber,
  initialQuestion,
  initialContribution,
  currentQuestion,
  currentContribution,
  qualityRating,
  onUpdate,
  disabled = false,
}: AIFormProps) {
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [isRegenerating, setIsRegenating] = useState(false);

  const handleDirectEdit = async (
    field: "question" | "contribution",
    newValue: string
  ) => {
    if (disabled || isRegenerating) return;

    // Processing direct edit using saveEntityEdit
    try {
      // TODO: Add timeout
      console.log(
        "Here we will need a timeout to assume some background processing..."
      );

      toast.success(
        `${field === "question" ? "Question" : "Contribution"} updated`
      );
    } catch (error) {
      toast.error("Failed to update");
      console.error("Update error:", error);
    }
  };

  const handleRatingChange = async (rating: number) => {
    try {
      // TODO: Add timeout
      console.log(
        "Here we will need a timeout to assume some background processing..."
      );

      toast.success(`Question ${questionNumber} rated: ${rating}/5 stars`);
      onUpdate(); // Refresh the question data
    } catch (error) {
      console.error("Failed to save rating:", error);
      toast.error("Failed to save rating");
    }
  };

  const handlePromptRegeneration = async (prompt: string) => {
    if (disabled || isRegenerating) return;

    // Clear any previous inline errors
    setInlineError(null);

    try {
      // TODO: Add timeout
      console.log(
        "Here we will need a timeout to assume some background processing..."
      );

      toast.success("Regeneration started");
      setShowPromptEdit(false);
      setIsRegenating(true);
      onUpdate();
    } catch (error) {
      // Display inline error as specified in requirements
      setInlineError("Failed to start regeneration");
      console.error("Regeneration error:", error);
    }
  };

  // Disable fields during regeneration
  const fieldDisabled = disabled || isRegenerating;

  return (
    <Card className="relative">
      {/* Loading indicator during regeneration */}
      {isRegenerating && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 rounded-lg">
          <div className="flex items-center gap-2 bg-background p-3 rounded-md shadow-sm border">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Regenerating question...</span>
          </div>
        </div>
      )}

      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex flex-row gap-2 items-center">
            <ShieldQuestionIcon className="size-4" />
            Question {questionNumber}
            {isRegenerating && (
              <span className="text-xs text-muted-foreground">
                (Regenerating...)
              </span>
            )}
          </CardTitle>
          <QuestionQualityRating
            initialRating={qualityRating || 0}
            onRatingChange={handleRatingChange}
            disabled={fieldDisabled}
          />
        </div>
      </CardHeader>
      <AIContentWrapper
        onPromptEdit={() => !isRegenerating && setShowPromptEdit(true)}
        editable={!fieldDisabled}
        className="pt-6"
      >
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Research Question Field */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={`question-${questionNumber}`} className="px-2">
                Research Question
              </Label>
              <AIContentWrapper
                className="p-2"
                editable={!fieldDisabled}
                directEdit={{
                  disabled: fieldDisabled,
                  value: currentQuestion,
                  onSave: (newValue) => handleDirectEdit("question", newValue),
                  multiline: true,
                  validateValue: (value) => {
                    if (!value.trim()) return "Question cannot be empty";
                    if (value.length < 10)
                      return "Question should be more detailed";
                    return undefined;
                  },
                }}
              >
                <div id={`question-${questionNumber}`} className="">
                  <InlineEditor />
                </div>
              </AIContentWrapper>
            </div>

            {/* Research Question Field */}
            <div className="flex flex-col gap-2">
              <Label
                htmlFor={`contribution-${questionNumber}`}
                className="px-2"
              >
                Contribution Summary
              </Label>
              <AIContentWrapper
                className="p-2"
                editable={!fieldDisabled}
                directEdit={{
                  value: currentContribution,
                  disabled: fieldDisabled,
                  onSave: (newValue) =>
                    handleDirectEdit("contribution", newValue),
                  multiline: true,
                  validateValue: (value) => {
                    if (!value.trim())
                      return "Contribution summary cannot be empty";
                    if (value.length < 20)
                      return "Contribution summary should be more detailed";
                    return undefined;
                  },
                }}
              >
                <div id={`contribution-${questionNumber}`}>
                  <InlineEditor />
                </div>
              </AIContentWrapper>
            </div>

            {/* Inline Error Display */}
            {inlineError && (
              <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-md border border-destructive/20">
                {inlineError}
              </div>
            )}

            {/* Edit History Summary */}
            {(currentQuestion !== initialQuestion ||
              currentContribution !== initialContribution) && (
              <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
                <div>Changes made:</div>
                {currentQuestion !== initialQuestion && (
                  <div>• Question modified</div>
                )}
                {currentContribution !== initialContribution && (
                  <div>• Contribution modified</div>
                )}
              </div>
            )}

            {/* Question Prompt Dialog */}
            {showPromptEdit && (
              <PromptEditor
                open={showPromptEdit}
                onOpenChange={setShowPromptEdit}
                entityType="research-question"
                onPromptSubmit={async (prompt: string) =>
                  handlePromptRegeneration(prompt)
                }
              />
            )}
          </div>
        </CardContent>
      </AIContentWrapper>
    </Card>
  );
}
