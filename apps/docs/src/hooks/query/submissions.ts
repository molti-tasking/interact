"use client";
import { loadSubmissions } from "@/lib/schema-manager";
import { useQuery } from "@tanstack/react-query";

export const useSubmissions = (schemaSlug?: string) => {
  return useQuery({
    queryKey: ["submissions", schemaSlug],
    queryFn: () => loadSubmissions(schemaSlug),
  });
};
