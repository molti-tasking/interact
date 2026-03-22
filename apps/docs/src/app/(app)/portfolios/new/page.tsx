"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreatePortfolio } from "@/hooks/query/portfolios";
import { emptyPortfolioSchema } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewPortfolioPage() {
  const [title, setTitle] = useState("");
  const router = useRouter();
  const createPortfolio = useCreatePortfolio();

  const handleCreate = async () => {
    if (!title.trim()) return;

    const portfolio = await createPortfolio.mutateAsync({
      title: title.trim(),
      intent: "",
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
