"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useCreateResponse } from "@/hooks/query/responses-new";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import { PortfolioSchema } from "@/lib/types";
import { FileText, Info, Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

export default function PublishedFormPage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, isLoading } = usePortfolio(id);
  const createResponse = useCreateResponse();

  const handleSubmit = async (data: Record<string, unknown>) => {
    if (!portfolio) return;

    try {
      await createResponse.mutateAsync({
        portfolio_id: portfolio.id,
        data: JSON.parse(JSON.stringify(data)),
      });
      toast.success("Response submitted successfully!");
    } catch {
      toast.error("Failed to submit response");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold">Form not found</h2>
      </div>
    );
  }

  const portfolioSchema = portfolio.schema as unknown as PortfolioSchema;
  const fieldCount = portfolioSchema.fields.length;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Hero header */}
      <div className="text-center space-y-3 mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-2">
          <FileText className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-3xl tracking-tight">{portfolio.title}</h1>

        <div className="flex items-center justify-center gap-2 pt-1">
          <Badge variant="secondary" className="text-xs">
            {fieldCount} field{fieldCount !== 1 ? "s" : ""}
          </Badge>
          {portfolio.base_id && (
            <Badge variant="outline" className="text-xs">
              Derived
            </Badge>
          )}
          {portfolio.intent && (
            <Dialog>
              <DialogTrigger asChild>
                <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  <Info className="h-3 w-3" />
                  About
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>About this form</DialogTitle>
                  <DialogDescription>
                    {portfolio.intent.purpose.content || "No description"}
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Form card */}
      <Card className="p-6 md:p-8">
        <FormRenderer
          schema={portfolioSchema}
          mode="live"
          onSubmit={handleSubmit}
        />
      </Card>
    </div>
  );
}
