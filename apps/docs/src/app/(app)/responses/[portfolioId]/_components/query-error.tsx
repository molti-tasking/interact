"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

/** Error state for a failed query: message + retry, instead of "not found". */
export function QueryError({
  title,
  error,
  onRetry,
  children,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : null;

  return (
    <div role="alert" className="py-12 text-center">
      <AlertTriangle
        className="mx-auto mb-3 h-8 w-8 text-destructive"
        aria-hidden
      />
      <h2 className="text-lg font-semibold">{title}</h2>
      {message && (
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      )}
      <div className="mt-4 flex items-center justify-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}
