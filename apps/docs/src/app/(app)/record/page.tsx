"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePortfolios } from "@/hooks/query/portfolios";
import type { Portfolio, PortfolioSchema } from "@/lib/types";
import { FileText, Mic, Plus } from "lucide-react";
import Link from "next/link";

/**
 * Record-mode entry point (step 1): choose which portfolio to dictate into.
 * Selecting one opens its full-screen dictation surface at
 * `/portfolios/[id]/record`.
 */
export default function RecordPickerPage() {
  const { data: portfolios, isLoading } = usePortfolios();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl tracking-tight text-primary">
            <Mic className="h-5 w-5 text-brand-accent" />
            Record mode
          </h1>
          <p className="text-sm text-muted-foreground font-sans">
            Pick a portfolio, then dictate hands-free to shape its form.
          </p>
        </div>
        <Button asChild className="btn-brand font-sans">
          <Link href="/portfolios/new">
            <Plus className="h-4 w-4 mr-2" />
            New Portfolio
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-6 animate-pulse">
              <div className="h-4 bg-muted rounded w-2/3 mb-2" />
              <div className="h-3 bg-muted rounded w-full" />
            </Card>
          ))}
        </div>
      ) : portfolios && portfolios.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {portfolios.map((portfolio) => (
            <RecordCard key={portfolio.id} portfolio={portfolio} />
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No portfolios yet</h3>
          <p className="text-muted-foreground mb-4">
            Create a portfolio first, then come back to dictate into it.
          </p>
          <Button asChild>
            <Link href="/portfolios/new">
              <Plus className="h-4 w-4 mr-2" />
              Create Portfolio
            </Link>
          </Button>
        </Card>
      )}
    </div>
  );
}

function RecordCard({ portfolio }: { portfolio: Portfolio }) {
  const fieldCount = (portfolio.schema as unknown as PortfolioSchema).fields
    .length;

  return (
    <Link href={`/portfolios/${portfolio.id}/record`}>
      <Card className="group p-5 hover:border-primary/40 card-hover-lift cursor-pointer">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold truncate">{portfolio.title}</h3>
          <Badge
            variant={portfolio.status === "published" ? "default" : "secondary"}
          >
            {portfolio.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {portfolio.intent.purpose.content || "No intent defined yet"}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span>
              {fieldCount} field{fieldCount !== 1 ? "s" : ""}
            </span>
          </div>
          <span className="flex items-center gap-1 text-xs font-medium text-brand-accent opacity-0 transition-opacity group-hover:opacity-100">
            <Mic className="h-3 w-3" />
            Dictate
          </span>
        </div>
      </Card>
    </Link>
  );
}
