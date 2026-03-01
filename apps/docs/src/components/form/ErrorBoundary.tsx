"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  boundaryName?: string;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `Error caught in ${this.props.boundaryName || "ErrorBoundary"}:`,
      error,
      errorInfo
    );
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <h2 className="text-sm font-semibold text-destructive mb-2">
            Something went wrong
          </h2>
          <p className="text-xs text-muted-foreground">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
