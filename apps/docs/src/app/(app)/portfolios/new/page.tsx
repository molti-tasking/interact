"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePortfolio } from "@/hooks/query/portfolios";
import { useEnsureSpace, useSpaces } from "@/hooks/query/spaces";
import { deriveTitleFromIntent, EXAMPLE_INTENTS } from "@/lib/new-portfolio";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

/** Sentinel for "let the system create/reuse a space automatically". */
const AUTO_SPACE = "__auto__";

/**
 * Intent-first creation (lazy data space elicitation): the creator starts
 * with a sentence; the workspace drafts a first form from it
 * (`?generate=1`). The page is that one question. A title (otherwise
 * derived from the sentence, and editable in the workspace) and, when there
 * are several, the space are under "More options"; a title alone creates
 * an empty portfolio — the e2e/evaluation harness relies on that path.
 */
export default function NewPortfolioPage() {
  const [intent, setIntent] = useState("");
  const [title, setTitle] = useState("");
  const [spaceChoice, setSpaceChoice] = useState<string>(AUTO_SPACE);
  // Stays true after success until the route changes, so the button can't
  // trigger a duplicate create while navigation is in flight.
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const intentRef = useRef<HTMLTextAreaElement>(null);

  const router = useRouter();
  const createPortfolio = useCreatePortfolio();
  const ensureSpace = useEnsureSpace();
  const { data: spaces } = useSpaces();

  const intentText = intent.trim();
  const titleText = title.trim();
  const canSubmit = (!!intentText || !!titleText) && !submitting;
  const derivedTitle = intentText ? deriveTitleFromIntent(intentText) : "";
  // One space (or none yet): nothing to choose
  const chooseSpace = (spaces?.length ?? 0) > 1;

  const handleCreate = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      // Resolve the space: explicit choice, or system-created automatically
      const spaceId =
        spaceChoice === AUTO_SPACE
          ? (await ensureSpace.mutateAsync({})).id
          : spaceChoice;

      const now = new Date().toISOString();
      const portfolio = await createPortfolio.mutateAsync({
        title: titleText || derivedTitle,
        intent: intentText
          ? {
              ...emptyStructuredIntent(),
              purpose: { content: intentText, updatedAt: now },
            }
          : emptyStructuredIntent(),
        schema: emptyPortfolioSchema(),
        space_id: spaceId,
        status: "draft",
      });

      router.push(
        intentText
          ? `/portfolios/${portfolio.id}?generate=1`
          : `/portfolios/${portfolio.id}`,
      );
    } catch (err) {
      console.error("[NewPortfolio] create failed:", err);
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      toast.error("Couldn't create the portfolio", { description: message });
      setSubmitting(false);
    }
  };

  const applyExample = (text: string) => {
    setIntent(text);
    intentRef.current?.focus();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl tracking-tight text-primary">
        What form do you need?
      </h1>

      <Card className="p-4 sm:p-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
          aria-busy={submitting || undefined}
        >
          <div className="space-y-2">
            <Label htmlFor="intent" className="sr-only">
              What do you need to collect, and why?
            </Label>
            <Textarea
              id="intent"
              ref={intentRef}
              autoFocus
              rows={5}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder="Describe it in a sentence. Rough is fine."
              className="min-h-32 bg-background text-base"
              disabled={submitting}
            />
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Example intents"
            >
              <span className="text-xs text-muted-foreground">Try:</span>
              {EXAMPLE_INTENTS.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={() => applyExample(example.text)}
                  disabled={submitting}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-brand-accent/40 hover:bg-brand-accent/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>

          {showOptions && (
            <div
              id="new-portfolio-options"
              className={chooseSpace ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}
            >
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Taken from your description if left empty"
                  disabled={submitting}
                />
              </div>

              {chooseSpace && (
                <div className="space-y-2">
                  <Label htmlFor="space">Space</Label>
                  <Select
                    value={spaceChoice}
                    onValueChange={setSpaceChoice}
                    disabled={submitting}
                  >
                    <SelectTrigger
                      id="space"
                      className="w-full"
                      title="Spaces group related forms so they can reference each other"
                    >
                      <SelectValue placeholder="Choose a space" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_SPACE}>
                        <span className="flex items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-brand-accent" />
                          Automatic
                        </span>
                      </SelectItem>
                      {(spaces ?? []).map((space) => (
                        <SelectItem key={space.id} value={space.id}>
                          {space.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="new-portfolio-more"
              aria-expanded={showOptions}
              aria-controls="new-portfolio-options"
              onClick={() => setShowOptions((open) => !open)}
              disabled={submitting}
              className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${showOptions ? "rotate-90" : ""}`}
                aria-hidden
              />
              More options
            </button>
            <div className="flex-1" />
            <Button
              type="submit"
              data-testid="create-portfolio-btn"
              className="btn-brand"
              disabled={!canSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {intentText ? "Drafting…" : "Creating…"}
                </>
              ) : intentText || !titleText ? (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Draft my form
                </>
              ) : (
                "Create empty form"
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
