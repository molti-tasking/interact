"use client";

import { createResponseFileUrl } from "@/hooks/query/response-files";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { StoredFile } from "./values";

/** Re-sign a bit before the link's 1-hour lifetime runs out. */
const REFRESH_MS = 50 * 60 * 1000;

/**
 * Link to an uploaded response file. The bucket is private, so the href is
 * a short-lived signed URL fetched on demand (works for admins only).
 */
export function StoredFileLink({
  file,
  className,
  children,
}: {
  file: StoredFile;
  className?: string;
  children?: React.ReactNode;
}) {
  const { data: url, isError } = useQuery({
    queryKey: ["response-file-url", file.path],
    queryFn: () => createResponseFileUrl(file.path),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });

  const label = children ?? file.name;

  if (!url) {
    return (
      <span
        className={cn(className, "cursor-default opacity-70")}
        title={isError ? "File unavailable" : "Preparing download link…"}
      >
        {label}
      </span>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className={className}>
      {label}
    </a>
  );
}
