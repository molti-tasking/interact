"use client";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useResponses } from "@/hooks/query/responses-new";
import { PortfolioSchema } from "@/lib/types";
import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";

export default function ResponsesPage() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const { data: portfolio } = usePortfolio(portfolioId);
  const portfolioSchema = portfolio?.schema as unknown as PortfolioSchema;

  const { data: responses, isLoading } = useResponses(portfolioId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const fields = portfolioSchema.fields ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Responses{portfolio ? `: ${portfolio.title}` : ""}
        </h1>
        <p className="text-muted-foreground">
          {responses?.length ?? 0} response{responses?.length !== 1 ? "s" : ""}{" "}
          collected.
        </p>
      </div>

      {responses && responses.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submitted</TableHead>
                {fields.map((f) => (
                  <TableHead key={f.id}>{f.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {responses.map((response) => (
                <TableRow key={response.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(response.submittedAt).toLocaleString()}
                  </TableCell>
                  {fields.map((f) => (
                    <TableCell key={f.id}>
                      {String(response.data[f.name] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="p-8 text-center text-muted-foreground">
          No responses yet.
        </Card>
      )}
    </div>
  );
}
