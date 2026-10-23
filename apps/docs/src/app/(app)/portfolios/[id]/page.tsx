"use client";

import { Button } from "@/components/ui/button";
import { PortfolioWorkspace } from "@/components/workspace/PortfolioWorkspace";
import { usePortfolio } from "@/hooks/query/portfolios";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function PortfolioWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: portfolio, isLoading, isError, error } = usePortfolio(id);

  // `?generate=1`: a portfolio created with an intent generates right away.
  const autoGenerate = searchParams.get("generate") === "1";
  const clearGenerateParam = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("generate");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-[60vh]"
        role="status"
        aria-label="Loading portfolio"
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !portfolio) {
    return (
      <div className="text-center py-12" role="alert">
        <h2 className="text-lg font-semibold">
          {isError ? "Couldn't load this portfolio" : "Portfolio not found"}
        </h2>
        {isError && (
          <p className="mt-1 text-sm text-muted-foreground">
            {errorMessage(error, "Unknown error")}
          </p>
        )}
        <Button asChild variant="link" className="mt-2">
          <Link href="/portfolios">Back to portfolios</Link>
        </Button>
      </div>
    );
  }

  return (
    <PortfolioWorkspace
      portfolio={portfolio}
      autoGenerate={autoGenerate}
      onAutoGenerateStarted={clearGenerateParam}
    />
  );
}
