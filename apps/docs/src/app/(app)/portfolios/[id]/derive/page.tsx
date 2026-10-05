"use client";

import { deriveSchemaAction } from "@/app/actions/derive-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePortfolio, usePortfolio } from "@/hooks/query/portfolios";
import {
  type DerivationSpec,
  emptyStructuredIntent,
  type PortfolioInsert,
} from "@/lib/types";
import {
  AlertTriangle,
  FileText,
  GitBranch,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export default function DerivePage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, isLoading, isError, error: loadError, refetch } =
    usePortfolio(id);
  const createPortfolio = useCreatePortfolio();
  const router = useRouter();
  const [scenario, setScenario] = useState("");
  // Stays true after success until navigation completes (no double submit).
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4" aria-busy="true">
        <Skeleton className="mx-auto h-10 w-64" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="mx-auto max-w-md items-center gap-3 p-10 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
        <h2 className="text-lg">Couldn&apos;t load the source form</h2>
        <p className="text-sm text-muted-foreground">
          {loadError instanceof Error ? loadError.message : "Please try again."}
        </p>
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </Card>
    );
  }

  // Not-found is rendered by the portfolio layout.
  if (!portfolio) return null;

  const parentSchema = portfolio.schema;
  const fieldCount = parentSchema.fields.length;
  const canSubmit = !!scenario.trim() && !isCreating && fieldCount > 0;

  const handleDerive = async () => {
    if (!canSubmit) return;
    setIsCreating(true);
    setError(null);

    const fail = (message: string) => {
      setError(message);
      toast.error("Couldn't derive the view", { description: message });
      setIsCreating(false);
    };

    try {
      // LLM-powered derivation: classify, select fields, add new ones
      const deriveResult = await deriveSchemaAction({
        parentIntent: portfolio.intent,
        parentSchema,
        scenarioDescription: scenario.trim(),
      });

      if (!deriveResult.success || !deriveResult.result) {
        fail(deriveResult.error ?? "Failed to derive schema");
        return;
      }

      const {
        derivationType,
        includedFieldKeys,
        additionalFields,
        schema,
        derivedPurpose,
        derivedIntent,
      } = deriveResult.result;

      const projection: DerivationSpec = {
        type: derivationType,
        scenarioIntent: scenario.trim(),
        includedFieldIds: parentSchema.fields
          .filter((f) => includedFieldKeys.includes(f.name))
          .map((f) => f.id),
        additionalFields: JSON.parse(JSON.stringify(additionalFields)),
        fieldMappings: {},
      };

      const derived = await createPortfolio.mutateAsync({
        title: `${portfolio.title} — ${scenario.trim().slice(0, 50)}`,
        // Inherits the parent's exclusions + constraints (from the action)
        intent: derivedIntent ?? {
          ...emptyStructuredIntent(),
          purpose: {
            content: derivedPurpose,
            updatedAt: new Date().toISOString(),
          },
        },
        schema,
        base_id: portfolio.id,
        // Keep derived views in the base's space (lists, reference siblings)
        space_id: portfolio.space_id,
        projection: projection as unknown as PortfolioInsert["projection"],
        status: "draft",
      });

      router.push(`/portfolios/${derived.id}`);
    } catch (err) {
      console.error("Derivation error:", err);
      fail(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Hero header */}
      <div className="mb-8 space-y-3 text-center">
        <div className="mb-2 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <GitBranch className="h-7 w-7 text-primary" aria-hidden />
        </div>
        <h2 className="text-3xl tracking-tight">Derive a New Sub Schema</h2>
        <p className="text-sm text-muted-foreground">
          Create a scenario-specific view of this form — a subset, an extension,
          or a mix — without duplicating the data space.
        </p>
      </div>

      {/* Source form context */}
      <Card className="mb-6 flex-row items-center gap-4 border-dashed p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{portfolio.title}</p>
          <p className="text-xs text-muted-foreground">
            Source form &middot; {fieldCount} field{fieldCount !== 1 ? "s" : ""}
          </p>
        </div>
      </Card>

      {/* Main action area */}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleDerive();
        }}
        aria-busy={isCreating || undefined}
      >
        <div className="space-y-2">
          <Label htmlFor="scenario" className="text-sm">
            What&apos;s this view for?
          </Label>
          <Textarea
            id="scenario"
            placeholder="e.g. A surgical planning view with implant details and operative protocols..."
            rows={5}
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleDerive();
              }
            }}
            disabled={isCreating}
            className="bg-background text-base"
            aria-describedby="scenario-hint"
          />
          <p id="scenario-hint" className="text-xs text-muted-foreground">
            Describe the audience and purpose. The system will determine which
            fields to include, exclude, or add.
          </p>
        </div>

        {fieldCount === 0 && (
          <p className="text-sm text-muted-foreground">
            The source form has no fields yet — design it first, then derive
            views from it.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={!canSubmit}
          size="lg"
          className="w-full btn-brand"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Deriving view...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              Create Derived View
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
