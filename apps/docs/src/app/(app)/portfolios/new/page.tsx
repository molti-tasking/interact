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
import { useCreatePortfolio } from "@/hooks/query/portfolios";
import { useEnsureSpace, useSpaces } from "@/hooks/query/spaces";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Sentinel for "let the system create/reuse a space automatically". */
const AUTO_SPACE = "__auto__";

export default function NewPortfolioPage() {
  const [title, setTitle] = useState("");
  const [spaceChoice, setSpaceChoice] = useState<string>(AUTO_SPACE);
  const router = useRouter();
  const createPortfolio = useCreatePortfolio();
  const ensureSpace = useEnsureSpace();
  const { data: spaces } = useSpaces();

  const isCreating = createPortfolio.isPending || ensureSpace.isPending;

  const handleCreate = async () => {
    if (!title.trim()) return;

    // Resolve the space: explicit choice, or system-created automatically
    const spaceId =
      spaceChoice === AUTO_SPACE
        ? (await ensureSpace.mutateAsync({})).id
        : spaceChoice;

    const portfolio = await createPortfolio.mutateAsync({
      title: title.trim(),
      intent: emptyStructuredIntent(),
      schema: emptyPortfolioSchema(),
      space_id: spaceId,
      status: "draft",
    });

    router.push(`/portfolios/${portfolio.id}`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Portfolio</h1>
        <p className="text-muted-foreground">
          Describe what you want to collect and why.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            placeholder="e.g., Patient Intake Form"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="space">Space</Label>
          <Select value={spaceChoice} onValueChange={setSpaceChoice}>
            <SelectTrigger id="space" className="w-full">
              <SelectValue placeholder="Choose a space" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_SPACE}>
                <span className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-brand-accent" />
                  Automatic — create a space for me
                </span>
              </SelectItem>
              {(spaces ?? []).map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Spaces group related forms. Pick one, or let the system handle it.
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            data-testid="create-portfolio-btn"
            onClick={handleCreate}
            disabled={!title.trim() || isCreating}
          >
            {isCreating ? "Creating..." : "Create & Start Designing"}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
