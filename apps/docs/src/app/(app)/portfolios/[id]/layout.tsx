"use client";

import { PortfolioHeader } from "@/components/portfolio-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePortfolio } from "@/hooks/query/portfolios";
import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

/**
 * Section header shared by every /portfolios/[id]/* page: the (renamable)
 * portfolio title + section tabs. Record mode is a full-screen voice surface
 * and gets no chrome at all.
 */
export default function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname() ?? "";
  const { data: portfolio, isLoading } = usePortfolio(id);

  const base = `/portfolios/${id}`;
  if (pathname === `${base}/record` || pathname.startsWith(`${base}/record/`)) {
    return <>{children}</>;
  }

  if (!isLoading && portfolio === null) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <FileQuestion
          className="mx-auto mb-3 h-10 w-10 text-muted-foreground"
          aria-hidden
        />
        <h1 className="text-xl">Portfolio not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been deleted, or the link is wrong.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/portfolios">Back to portfolios</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PortfolioHeader portfolioId={id} />
      {children}
    </div>
  );
}
