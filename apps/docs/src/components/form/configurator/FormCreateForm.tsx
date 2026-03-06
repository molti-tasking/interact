"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { useCallback } from "react";
import { DynamicFormRenderer } from "../DynamicFormRenderer";
import { ErrorBoundary } from "../ErrorBoundary";
import { PaperForm } from "./PaperForm";
import { SpeechForm } from "./SpeechForm";

export const FormCreateForm = ({}: { onFormCreated: () => void }) => {
  const store = useConfiguratorStore();
  const basePromptElement = useConfiguratorStore((s) => s.basePromptElement);
  const setBasePromptElement = useConfiguratorStore(
    (s) => s.setBasePromptElement,
  );

  const dismissDiff = useCallback(() => {
    useConfiguratorStore.setState(
      { previousBasePrompt: null },
      undefined,
      "configurator/dismissPromptDiff",
    );
  }, []);

  return (
    <div>
      <div className="space-y-2">
        <Label htmlFor="basePrompt">What you want?</Label>
        <div className="relative overflow-hidden rounded-2xl">
          <div
            className={cn(
              store.basePromptActive
                ? "pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,#ff6ec4,#7873f5,#4ade80,#60a5fa)] bg-size-[200%_200%] animate-gradient opacity-35"
                : "",
            )}
          />
          <Textarea
            id="basePrompt"
            ref={(ref) => {
              console.log("Set base prompt element");
              if (!basePromptElement) {
                setBasePromptElement(ref);
              }
            }}
            placeholder="Describe what this form is for..."
            value={store.basePrompt}
            className={cn(
              "rounded-2xl relative",
              store.basePromptActive ? "bg-transparent" : "",
            )}
            onChange={(e) => store.onChangeBasePrompt(e.target.value)}
            rows={3}
          />
        </div>
        {store.previousBasePrompt !== null &&
          store.previousBasePrompt !== store.basePrompt && (
            <PromptDiff
              previous={store.previousBasePrompt}
              current={store.basePrompt}
              onDismiss={dismissDiff}
            />
          )}
      </div>

      <div className="pt-4">
        <SpeechForm />
      </div>
      <div className="pt-4">
        <PaperForm />
      </div>
      <div className="pt-4">
        <ConfiguratorForm />
      </div>
    </div>
  );
};

const ConfiguratorForm = () => {
  const store = useConfiguratorStore();

  // Check if configurator form has fields
  if (!store.configuratorFormSchema?.fields?.length) {
    return null;
  }

  const onChangeForm = (data: Record<string, unknown>) => {
    console.log(data);
  };

  return (
    <div>
      <ErrorBoundary boundaryName="configurator-form">
        <DynamicFormRenderer
          schema={store.configuratorFormSchema}
          defaultValues={store.configuratorFormValues}
          onChange={onChangeForm}
        />
      </ErrorBoundary>
      <p>THIS FORM IS TO TECHNICAL, MAKE IT LOOK NICE</p>
      <p>
        Small clouds that represent different aspects: If you do not like it you
        can kick it out.
      </p>
      <p>have all suggestions and cluster them bottom up to ask about themes</p>
      <p>Based on what has been suggested in a query </p>
      {/* <pre>{JSON.stringify(store.configuratorFormValues, null, 2)}</pre> */}
    </div>
  );
};

/**
 * Simple word-level diff display between previous and current prompt.
 * Shows removed words in red and added words in green.
 */
const PromptDiff = ({
  previous,
  current,
  onDismiss,
}: {
  previous: string;
  current: string;
  onDismiss: () => void;
}) => {
  const diff = computeWordDiff(previous, current);

  return (
    <div className="rounded-lg border bg-muted/50 p-3 text-sm animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Prompt updated by your choice
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-xs"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
      <p className="leading-relaxed whitespace-pre-wrap">
        {diff.map((segment, i) => {
          if (segment.type === "removed") {
            return (
              <span
                key={i}
                className="bg-red-200 text-red-800 line-through dark:bg-red-900/40 dark:text-red-300"
              >
                {segment.text}
              </span>
            );
          }
          if (segment.type === "added") {
            return (
              <span
                key={i}
                className="bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-300"
              >
                {segment.text}
              </span>
            );
          }
          return <span key={i}>{segment.text}</span>;
        })}
      </p>
    </div>
  );
};

type DiffSegment = {
  type: "same" | "added" | "removed";
  text: string;
};

/**
 * Simple word-level diff using longest common subsequence.
 */
function computeWordDiff(oldText: string, newText: string): DiffSegment[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);

  // LCS table
  const m = oldWords.length;
  const n = newWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const segments: DiffSegment[] = [];
  let i = m;
  let j = n;

  const raw: { type: DiffSegment["type"]; text: string }[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      raw.push({ type: "same", text: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: "added", text: newWords[j - 1] });
      j--;
    } else {
      raw.push({ type: "removed", text: oldWords[i - 1] });
      i--;
    }
  }

  raw.reverse();

  // Merge consecutive segments of the same type
  for (const entry of raw) {
    const last = segments[segments.length - 1];
    if (last && last.type === entry.type) {
      last.text += entry.text;
    } else {
      segments.push({ ...entry });
    }
  }

  return segments;
}
