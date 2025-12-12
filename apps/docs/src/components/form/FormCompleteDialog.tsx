"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { INTERACTION_MODE_MAP } from "@/lib/interaction-mode-config";
import { cn } from "@/lib/utils";
import { INTERACTION_MODE_META } from "interact";
import { useState } from "react";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

interface FormCompleteDialogProps {
  onConfirm: () => void;
}

export function FormCompleteDialog({}: FormCompleteDialogProps) {
  const contextMode = INTERACTION_MODE_MAP["context"];
  const { title } = INTERACTION_MODE_META["context"];

  const [prompt, setPrompt] = useState("");

  const pasteFromClipboard = async () => {
    const clipboard = await navigator.clipboard.readText();
    setPrompt(clipboard);
  };

  return (
    <Dialog>
      <DialogTrigger>
        <Button>Prompt Fill</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <div className={cn("h-5 w-5", contextMode.color)}>
              <contextMode.icon />
            </div>
            <span className={cn(contextMode.color)}>{title}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="bg-muted/50 rounded-lg p-3 mt-4">
          <p className="text-sm">
            <span className="font-medium">
              What will happen (once implemented):
            </span>
          </p>
          <ul className="text-sm text-muted-foreground mt-2 space-y-1 ml-4">
            <li className="list-disc">
              You prompt will be analyzed and compared to the underlying form
            </li>
            <li className="list-disc">
              It will update the entire form accordingly
            </li>
          </ul>
        </div>
        {/* Prompt Input */}
        <div className="space-y-2">
          <div className="flex flex-row items-center justify-between">
            <Label htmlFor="prompt">Input Informarion</Label>
            <Label className="cursor-pointer" onClick={pasteFromClipboard}>
              Paste
            </Label>
          </div>
          <Textarea
            id="prompt"
            placeholder={
              "Insert any information of your choice and it will be filled into the form."
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="resize-vertical"
            autoFocus
          />
        </div>
        <DialogFooter className="flex flex-row gap-2">
          <Button variant="outline">Cancel</Button>
          <Button>Process</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
