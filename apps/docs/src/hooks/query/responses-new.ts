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

function responseKey(responseId: string) {
  return ["response", responseId] as const;
}

export function useResponse(responseId: string | undefined) {
  return useQuery({
    queryKey: responseKey(responseId ?? ""),
    queryFn: async (): Promise<FormResponse | null> => {
      if (!responseId) return null;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("responses")
        .select("*")
        .eq("id", responseId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data ? rowToResponse(data) : null;
    },
    enabled: !!responseId,
  });
}

export function useUpdateResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      portfolioId: string;
      data: Record<string, unknown>;
    }): Promise<FormResponse> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("responses")
        .update({ data: JSON.parse(JSON.stringify(input.data)) })
        .eq("id", input.id)
        .select()
        .single();

      if (error) throw error;
      return rowToResponse(data);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({
        queryKey: responsesKey(response.portfolioId),
      });
      queryClient.setQueryData(responseKey(response.id), response);
    },
  });
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

export function useBulkUpdateResponses() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      updates: Array<{
        id: string;
        portfolioId: string;
        data: Record<string, unknown>;
      }>,
    ): Promise<void> => {
      const supabase = createClient();

      for (const update of updates) {
        const { error } = await supabase
          .from("responses")
          .update({ data: JSON.parse(JSON.stringify(update.data)) })
          .eq("id", update.id);

        if (error) throw error;
      }
    },
    onSuccess: (_data, updates) => {
      if (updates.length > 0) {
        queryClient.invalidateQueries({
          queryKey: responsesKey(updates[0].portfolioId),
        });
      }
    },
  });
}
