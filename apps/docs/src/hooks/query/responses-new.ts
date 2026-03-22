"use client";

import { createClient } from "@/lib/supabase/client";
import type { ResponseInsert } from "@/lib/supabase/types";
import { rowToResponse } from "@/lib/supabase/types";
import type { FormResponse } from "@/lib/types";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

function responsesKey(portfolioId: string) {
  return ["responses", portfolioId] as const;
}

export function useResponses(portfolioId: string | undefined) {
  return useQuery({
    queryKey: responsesKey(portfolioId ?? ""),
    queryFn: async (): Promise<FormResponse[]> => {
      if (!portfolioId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("responses")
        .select("*")
        .eq("portfolio_id", portfolioId)
        .order("submitted_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map(rowToResponse);
    },
    enabled: !!portfolioId,
  });
}

export function useCreateResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ResponseInsert): Promise<FormResponse> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("responses")
        .insert({
          portfolio_id: input.portfolio_id,
          data: JSON.parse(JSON.stringify(input.data)),
        })
        .select()
        .single();

      if (error) throw error;
      return rowToResponse(data);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({
        queryKey: responsesKey(response.portfolioId),
      });
    },
  });
}
