"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { Field, Portfolio, PortfolioSchema } from "@/lib/types";
import { Network, ShareIcon } from "lucide-react";
import { AddFieldInline } from "./AddFieldInline";
import Link from "next/link";

interface ArtifactPaneProps {
  portfolio: Portfolio;
  onFieldClick?: (field: Field) => void;
  onFieldsAdded?: (fields: Field[]) => void;
}

export function ArtifactPane({ portfolio, onFieldClick, onFieldsAdded }: ArtifactPaneProps) {
  const portfolioSchema = portfolio.schema as unknown as PortfolioSchema;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-row justify-between items-center h-8 mb-3">
        <h3 className="workspace-section-label">Artifact</h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 text-xs"
            asChild
          >
            <Link href={`/forms/${portfolio.id}`}>
              <ShareIcon className="h-3.5 w-3.5" />
              Publish
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 text-xs"
            asChild
          >
            <Link href={`/portfolios/${portfolio.id}/derive`}>
              <Network className="h-3.5 w-3.5" />
              Branch
            </Link>
          </Button>
        </div>
      </div>

      <Card className="flex flex-col overflow-hidden p-0 shadow-none">
        <div className="flex-1 p-5 overflow-auto">
          <FormRenderer
            schema={portfolioSchema}
            mode="preview"
            onFieldClick={onFieldClick}
            className="space-y-4"
          />
          {onFieldsAdded && (
            <div className="mt-4">
              <AddFieldInline
                schema={portfolioSchema}
                onFieldsAdded={onFieldsAdded}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
