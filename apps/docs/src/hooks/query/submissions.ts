"use client";
import { loadSubmissions } from "@/lib/schema-manager";
import { useQuery } from "@tanstack/react-query";

export const useSubmissions = () => {
  return useQuery({
    queryKey: ["submissions"],
    queryFn: () => {
      return loadSubmissions();
    },
  });
};
