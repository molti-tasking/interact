"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useResponses } from "@/hooks/query/responses-new";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import type { Field, Portfolio, PortfolioSchema } from "@/lib/types";
import { FormInput, Loader2, Network, Table2 } from "lucide-react";
import Link from "next/link";

interface ArtifactPaneProps {
  portfolio: Portfolio;
  onFieldClick?: (field: Field) => void;
}

export function ArtifactPane({ portfolio, onFieldClick }: ArtifactPaneProps) {
  const portfolioSchema = portfolio.schema as unknown as PortfolioSchema;
  const { data: responses, isLoading: responsesLoading } = useResponses(
    portfolio.id,
  );

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        Artifact
      </h3>
      <Tabs defaultValue="form-preview" className="flex-1 flex flex-col">
        <TabsList className="w-full">
          <TabsTrigger value="form-preview" className="flex-1">
            Form Preview
          </TabsTrigger>
          <TabsTrigger value="responses" className="flex-1">
            <Table2 className="h-3.5 w-3.5 mr-1" />
            Responses
            {(responses?.length ?? 0) > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({responses?.length})
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form-preview" className="flex-1 mt-2">
          <Card className="flex flex-col overflow-hidden">
            <div className="flex-1 p-4 overflow-auto">
              <FormRenderer
                schema={portfolioSchema}
                mode="preview"
                onFieldClick={onFieldClick}
                className="space-y-4"
              />
            </div>
          </Card>
          <div className="flex gap-2 mt-3">
            <Button variant="outline" size="sm" className="flex-1" asChild>
              <Link href={`/forms/${portfolio.id}`}>
                <FormInput className="h-4 w-4 mr-1" />
                Fill Form
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="flex-1" asChild>
              <Link href={`/portfolios/${portfolio.id}/derive`}>
                <Network className="h-4 w-4 mr-1" />
                Derive Sub-Form
              </Link>
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="responses" className="flex-1 mt-2">
          {responsesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !responses?.length ? (
            <Card className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No responses yet. Share the form to start collecting data.
            </Card>
          ) : (
            <Card className="overflow-auto">
              <div className="p-4">
                <p className="text-sm text-muted-foreground mb-2">
                  {responses.length} response{responses.length !== 1 ? "s" : ""} collected
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/responses/${portfolio.id}`}>
                    View Full Data Table
                  </Link>
                </Button>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
