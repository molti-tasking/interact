"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

interface OwnAnswerDialogProps {
  question: string;
  explanation?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  /** The typed answer. It is previewed on the card before it can be applied. */
  onSubmit: (text: string) => void;
}

/**
 * The free-text answer to an elicitation question. Submitting doesn't change
 * the form: the answer joins the card's other answers with a preview of what
 * it would change, and is applied from there.
 */
export function OwnAnswerDialog({
  question,
  explanation,
  open,
  onOpenChange,
  disabled,
  onSubmit,
}: OwnAnswerDialogProps) {
  const [text, setText] = useState("");
  const answer = text.trim();

  const close = (next: boolean) => {
    if (!next) setText("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">{question}</DialogTitle>
          <DialogDescription>
            {explanation ? `${explanation} ` : ""}
            Write your own answer. You will see what it changes before it is
            applied.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!answer || disabled) return;
            onSubmit(answer);
            close(false);
          }}
          className="grid gap-3"
        >
          <Textarea
            autoFocus
            data-testid="own-answer-input"
            aria-label="Your answer"
            placeholder="Describe what you want instead"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={disabled || !answer}
              data-testid="own-answer-preview"
            >
              Preview answer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
