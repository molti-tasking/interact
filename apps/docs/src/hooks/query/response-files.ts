"use client";

import {
  replaceFilesDeep,
  type StoredFile,
} from "@/lib/form-renderer/values";
import { createClient } from "@/lib/supabase/client";

/**
 * Private bucket (migrations 008/010): respondents may upload into
 * `<portfolioId>/…` of a published form; only admins can read, via signed URLs.
 */
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

  // No URL is stored: the bucket is private, viewers get signed URLs.
  return { path, name: file.name, size: file.size, type: file.type };
}

/** Lifetime of signed download links shown in the response viewer. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Short-lived download URL for a stored file (admins only — RLS). */
export async function createResponseFileUrl(path: string): Promise<string> {
  const { data, error } = await createClient()
    .storage.from(RESPONSE_FILES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
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
