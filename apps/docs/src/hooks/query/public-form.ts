"use client";

/**
 * Respondent-side data access for published forms (`/forms/[id]`).
 *
 * Signed-out visitors have no table access at all (migration 010); they go
 * through two SECURITY DEFINER functions that only expose what the form
 * page needs and only for published forms (admins can also preview drafts).
 */

import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import type { PortfolioSchema } from "@/lib/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { uploadFilesInData } from "./response-files";

export interface PublishedForm {
  id: string;
  title: string;
  schema: PortfolioSchema;
  /** The intent's purpose text, shown in the "About" dialog */
  purpose: string | null;
}

export function usePublishedForm(id: string | undefined) {
  return useQuery({
    queryKey: ["published-form", id ?? ""],
    queryFn: async (): Promise<PublishedForm | null> => {
      if (!id) return null;
      const { data, error } = await createClient().rpc("get_published_form", {
        p_id: id,
      });
      if (error) {
        // Malformed id (not a UUID) — same as "not found" for a visitor.
        if (error.code === "22P02") return null;
        throw error;
      }
      const row = data?.[0];
      if (!row) return null;
      return {
        id: row.id,
        title: row.title,
        schema: row.schema as unknown as PortfolioSchema,
        purpose: row.purpose,
      };
    },
    enabled: !!id,
  });
}

/**
 * Submit a response. `File` values are uploaded to the private
 * `response-files` bucket first (respondents may upload, not read back).
 */
export function useSubmitResponse() {
  return useMutation({
    mutationFn: async (input: {
      portfolioId: string;
      data: Record<string, unknown>;
    }): Promise<string> => {
      const data = await uploadFilesInData(input.portfolioId, input.data);
      const { data: id, error } = await createClient().rpc("submit_response", {
        p_portfolio_id: input.portfolioId,
        p_data: JSON.parse(JSON.stringify(data)) as Json,
      });
      if (error) throw new Error(error.message);
      return id;
    },
  });
}
