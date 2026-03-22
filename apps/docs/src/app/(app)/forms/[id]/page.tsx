"use client";

import { Button } from "@/components/ui/button";
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
import { Info, Loader2 } from "lucide-react";
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

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{portfolio.title}</h1>
        {portfolio.intent && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Info className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>About this form</DialogTitle>
                <DialogDescription>{portfolio.intent}</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="p-6">
        <FormRenderer
          schema={portfolio.schema as unknown as PortfolioSchema}
          mode="live"
          onSubmit={handleSubmit}
        />
      </Card>
    </div>
  );
}
