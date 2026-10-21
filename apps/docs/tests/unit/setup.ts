import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Server actions call `guardLlmRequest()` → `requireDesigner()` (Supabase
// session + admin/participant check), which needs a real request. Unit
// tests run as a signed-in admin; auth-guard.test.ts overrides this per test
// to cover the participant and rejection paths.
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  const admin = { userId: "test-admin", kind: "admin" as const };
  return {
    ...actual,
    requireOwner: vi.fn(async () => {}),
    requireDesigner: vi.fn(async () => admin),
    getPrincipal: vi.fn(async () => admin),
  };
});
