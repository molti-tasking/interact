import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Server actions call `requireOwner()` (Supabase session + admin check),
// which needs a real request. Unit tests run as a signed-in admin;
// auth-guard.test.ts overrides this per test to cover the rejection path.
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, requireOwner: vi.fn(async () => {}) };
});
