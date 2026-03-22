"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePortfolio } from "@/hooks/query/portfolios";
import { emptyPortfolioSchema } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewPortfolioPage() {
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const router = useRouter();
  const createPortfolio = useCreatePortfolio();

  const handleCreate = async () => {
    if (!title.trim()) return;

    const portfolio = await createPortfolio.mutateAsync({
      title: title.trim(),
      intent: intent.trim(),
      schema: emptyPortfolioSchema(),
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
          <Label htmlFor="intent">Intent</Label>
          <Textarea
            id="intent"
            placeholder="Describe the purpose of this form, who will use it, and what decisions will be made with the collected data..."
            rows={5}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The more detail you provide, the better the AI can help you design
            the form.
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleCreate}
            disabled={!title.trim() || createPortfolio.isPending}
          >
            {createPortfolio.isPending
              ? "Creating..."
              : "Create & Start Designing"}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
