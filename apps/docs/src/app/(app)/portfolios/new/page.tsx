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
import {
  deriveTitleFromIntent,
  EXAMPLE_INTENTS,
  MAX_TITLE_LENGTH,
} from "@/lib/new-portfolio";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

/** Sentinel for "let the system create/reuse a space automatically". */
const AUTO_SPACE = "__auto__";

/**
 * Intent-first creation (lazy data space elicitation): the creator starts
 * with a sentence; the workspace drafts a first form from it
 * (`?generate=1`). A title alone still creates an empty portfolio — the
 * e2e/evaluation harness relies on that path.
 */
export default function NewPortfolioPage() {
  const [intent, setIntent] = useState("");
  const [title, setTitle] = useState("");
  const [spaceChoice, setSpaceChoice] = useState<string>(AUTO_SPACE);
  // Stays true after success until the route changes, so the button can't
  // trigger a duplicate create while navigation is in flight.
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intentRef = useRef<HTMLTextAreaElement>(null);

  const router = useRouter();
  const createPortfolio = useCreatePortfolio();
  const ensureSpace = useEnsureSpace();
  const { data: spaces } = useSpaces();

  const intentText = intent.trim();
  const titleText = title.trim();
  const canSubmit = (!!intentText || !!titleText) && !submitting;
  const derivedTitle = intentText ? deriveTitleFromIntent(intentText) : "";

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
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">New portfolio</h1>
        <p className="text-muted-foreground">
          Start with a sentence. The system drafts a first form and asks design
          questions to refine it with you.
        </p>
      </div>

      <Card className="p-4 sm:p-6">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
          aria-busy={submitting || undefined}
        >
          <div className="space-y-2">
            <Label htmlFor="intent" className="text-base">
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
              placeholder="e.g. I need a registration form for our youth soccer club's new season…"
              className="min-h-32 bg-background text-base"
              aria-describedby="intent-hint"
              disabled={submitting}
            />
            <p id="intent-hint" className="text-xs text-muted-foreground">
              Who fills it in, what it&apos;s for, anything that must or must
              not be asked. Rough is fine.{" "}
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
                ⌘/Ctrl
              </kbd>{" "}
              +{" "}
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
                Enter
              </kbd>{" "}
              to create.
            </p>
            <div
              className="flex flex-wrap items-center gap-1.5 pt-1"
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

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">
                Title{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="title"
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={derivedTitle || "e.g., Patient intake form"}
                aria-describedby="title-hint"
                disabled={submitting}
              />
              <p
                id="title-hint"
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >
                {titleText
                  ? " "
                  : derivedTitle
                    ? `Will be titled “${derivedTitle}”.`
                    : `Leave blank to derive one (≤ ${MAX_TITLE_LENGTH} characters).`}
              </p>
            </div>

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
                  aria-describedby="space-hint"
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
              <p id="space-hint" className="text-xs text-muted-foreground">
                Spaces group related forms so they can reference each other.
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.back()}
              disabled={submitting}
            >
              Cancel
            </Button>
            <div className="hidden flex-1 sm:block" />
            {!intentText && !titleText && (
              <p className="text-xs text-muted-foreground sm:text-right">
                Describe what you need — or give it a title to start empty.
              </p>
            )}
            <Button
              type="submit"
              data-testid="create-portfolio-btn"
              className="btn-brand"
              disabled={!canSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {intentText ? "Creating & drafting…" : "Creating…"}
                </>
              ) : intentText ? (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Create &amp; draft form
                </>
              ) : (
                "Create empty portfolio"
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
