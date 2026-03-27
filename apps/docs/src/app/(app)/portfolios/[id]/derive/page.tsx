"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePortfolio, usePortfolio } from "@/hooks/query/portfolios";
import { emptyStructuredIntent, PortfolioSchema } from "@/lib/types";
import {
  ArrowLeft,
  FileText,
  GitBranch,
  Loader2,
  Sparkles,
} from "lucide-react";
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
        intent: {
          ...emptyStructuredIntent(),
          purpose: {
            content: scenario.trim(),
            updatedAt: new Date().toISOString(),
          },
        },
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

  const fieldCount = (portfolio.schema as unknown as PortfolioSchema).fields
    .length;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back link */}
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-2">
        <Link href={`/portfolios/${id}`}>
          <ArrowLeft className="h-4 w-4" />
          Back to design
        </Link>
      </Button>

      {/* Hero header */}
      <div className="text-center space-y-3 mb-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-2">
          <GitBranch className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-3xl tracking-tight">Derive a New Sub Schema</h1>
      </div>

      {/* Source form context */}
      <Card className="p-4 mb-6 border-dashed flex items-center gap-4">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted shrink-0">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{portfolio.title}</p>
          <p className="text-xs text-muted-foreground">
            Source form &middot; {fieldCount} field{fieldCount !== 1 ? "s" : ""}
          </p>
        </div>
      </Card>

      {/* Main action area */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="scenario" className="text-sm">
            What&apos;s this view for?
          </Label>
          <Textarea
            id="scenario"
            placeholder="e.g. A simplified intake form for new patients, focusing only on demographics and insurance..."
            rows={5}
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="text-base bg-white"
          />
          <p className="text-xs text-muted-foreground">
            Describe the audience and purpose. The system will determine which
            fields to include, adapt, or add.
          </p>
        </div>

        <Button
          onClick={handleDerive}
          disabled={!scenario.trim() || isCreating}
          size="lg"
          className="w-full btn-brand"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating view...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Create Derived View
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
