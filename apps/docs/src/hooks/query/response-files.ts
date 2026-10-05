"use client";

import {
  replaceFilesDeep,
  type StoredFile,
} from "@/lib/form-renderer/values";
import { createClient } from "@/lib/supabase/client";

/** Public-read bucket created by migration 008_response_files.sql */
export const RESPONSE_FILES_BUCKET = "response-files";

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_");
  return cleaned.slice(-100) || "file";
}

/** Upload one file to `response-files/<portfolioId>/<uuid>-<name>`. */
export async function uploadResponseFile(
  portfolioId: string,
  file: File,
): Promise<StoredFile> {
  const supabase = createClient();
  const path = `${portfolioId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const bucket = supabase.storage.from(RESPONSE_FILES_BUCKET);

  const { error } = await bucket.upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) {
    throw new Error(`Failed to upload "${file.name}": ${error.message}`);
  }

  const { data } = bucket.getPublicUrl(path);
  return {
    path,
    name: file.name,
    size: file.size,
    type: file.type,
    url: data.publicUrl,
  };
}

/**
 * Upload every `File` in a submission (any depth, e.g. inside groups) and
 * replace it with its `StoredFile` reference, so the data is JSON-safe.
 * Used by `useCreateResponse` / `useUpdateResponse` before writing.
 */
export async function uploadFilesInData(
  portfolioId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await replaceFilesDeep(data, (file) =>
    uploadResponseFile(portfolioId, file),
  )) as Record<string, unknown>;
}
