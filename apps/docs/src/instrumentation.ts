import { LangfuseSpanProcessor, ShouldExportSpan } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

// Optional: filter out Next.js infra spans
const shouldExportSpan: ShouldExportSpan = (span) => {
  return span.otelSpan.instrumentationScope.name !== "next.js";
};

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  shouldExportSpan,
});

// Exposed via globalThis (not a module import) so `withTracing` in
// src/lib/telemetry.ts can flush on serverless without importing this file
// into the server-action bundle, which would register a second provider.
(globalThis as Record<string, unknown>).__langfuseSpanProcessor =
  langfuseSpanProcessor;

const tracerProvider = new NodeTracerProvider({
  spanProcessors: [langfuseSpanProcessor],
});

tracerProvider.register();
