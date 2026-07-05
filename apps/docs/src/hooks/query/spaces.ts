"use client";

import { createClient } from "@/lib/supabase/client";
import { rowToSpace } from "@/lib/supabase/types";
import type { Space } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const SPACES_KEY = ["spaces"] as const;

function spaceKey(id: string) {
  return [...SPACES_KEY, id] as const;
}

export function useSpaces() {
  return useQuery({
    queryKey: SPACES_KEY,
    queryFn: async (): Promise<Space[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("spaces")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map(rowToSpace);
    },
  });
}

export function useSpace(id: string | undefined | null) {
  return useQuery({
    queryKey: spaceKey(id ?? ""),
    queryFn: async (): Promise<Space | null> => {
      if (!id) return null;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("spaces")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data ? rowToSpace(data) : null;
    },
    enabled: !!id,
  });
}

export function useCreateSpace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      origin?: Space["origin"];
    }): Promise<Space> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("spaces")
        .insert({
          name: input.name,
          description: input.description ?? null,
          origin: input.origin ?? "user",
        })
        .select()
        .single();

      if (error) throw error;
      return rowToSpace(data);
    },
    onSuccess: (space) => {
      queryClient.invalidateQueries({ queryKey: SPACES_KEY });
      queryClient.setQueryData(spaceKey(space.id), space);
    },
  });
}

/**
 * Get-or-create for the automatic-space flow: when the user starts working
 * without picking a space, reuse the most recent system-created space or
 * create one on the fly.
 */
export function useEnsureSpace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input?: { name?: string }): Promise<Space> => {
      const supabase = createClient();

      // Reuse an existing auto-created space if one exists
      const { data: existing, error: lookupError } = await supabase
        .from("spaces")
        .select("*")
        .eq("origin", "system")
        .order("updated_at", { ascending: false })
        .limit(1);

      if (lookupError) throw lookupError;
      if (existing && existing.length > 0) return rowToSpace(existing[0]);

      const { data, error } = await supabase
        .from("spaces")
        .insert({
          name: input?.name ?? "My Space",
          description: "Created automatically",
          origin: "system",
        })
        .select()
        .single();

      if (error) throw error;
      return rowToSpace(data);
    },
    onSuccess: (space) => {
      queryClient.invalidateQueries({ queryKey: SPACES_KEY });
      queryClient.setQueryData(spaceKey(space.id), space);
    },
  });
}
