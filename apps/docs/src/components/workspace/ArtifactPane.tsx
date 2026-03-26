"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { Field, Portfolio, PortfolioSchema } from "@/lib/types";
import { Network, ShareIcon } from "lucide-react";
import Link from "next/link";

interface ArtifactPaneProps {
  portfolio: Portfolio;
  onFieldClick?: (field: Field) => void;
}

export function ArtifactPane({ portfolio, onFieldClick }: ArtifactPaneProps) {
  const portfolioSchema = portfolio.schema as unknown as PortfolioSchema;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-row justify-between items-center mb-2">
        <h3 className="text-md uppercase font-semibold text-muted-foreground ">
          Artifact
        </h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <Link href={`/forms/${portfolio.id}`}>
              <ShareIcon className="h-4 w-4 mr-1" />
              Publish
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <Link href={`/portfolios/${portfolio.id}/derive`}>
              <Network className="h-4 w-4 mr-1" />
              Branch
            </Link>
          </Button>
        </div>
      </div>

      <Card className="flex flex-col overflow-hidden p-0">
        <div className="flex-1 p-4 overflow-auto">
          <FormRenderer
            schema={portfolioSchema}
            mode="preview"
            onFieldClick={onFieldClick}
            className="space-y-4"
          />
        </div>
      </Card>
    </div>
  );
}
