"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePortfolio, usePortfolio } from "@/hooks/query/portfolios";
import { PortfolioSchema } from "@/lib/types";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function DerivePage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, isLoading } = usePortfolio(id);
  const createPortfolio = useCreatePortfolio();
  const router = useRouter();
  const [scenario, setScenario] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  if (isLoading || !portfolio) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleDerive = async () => {
    if (!scenario.trim()) return;
    setIsCreating(true);

    try {
      // For now, create a simple sub-schema derivation (copy all fields)
      // Phase 7 will add LLM-powered classification and field selection
      const derived = await createPortfolio.mutateAsync({
        title: `${portfolio.title} — ${scenario.trim().slice(0, 50)}`,
        intent: scenario.trim(),
        schema: portfolio.schema,
        base_id: portfolio.id,
        projection: {
          type: "sub" as const,
          scenarioIntent: scenario.trim(),
          includedFieldIds: (
            portfolio.schema as unknown as PortfolioSchema
          ).fields.map((f) => f.id),
          additionalFields: [],
          fieldMappings: {},
        },
        status: "draft",
      });

      router.push(`/portfolios/${derived.id}`);
    } catch (err) {
      console.error("Derivation error:", err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/portfolios/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Derive New View</h1>
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Deriving from: <strong>{portfolio.title}</strong> (
            {(portfolio.schema as unknown as PortfolioSchema).fields.length}{" "}
            fields)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="scenario">Scenario Description</Label>
          <Textarea
            id="scenario"
            placeholder="Describe who will use this view and for what purpose. The system will determine which fields to include, exclude, or add..."
            rows={4}
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          />
        </div>

        <Button
          onClick={handleDerive}
          disabled={!scenario.trim() || isCreating}
        >
          {isCreating ? "Creating..." : "Create Derived View"}
        </Button>
      </Card>
    </div>
  );
}
