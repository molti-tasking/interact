import type { Page } from "@playwright/test";

/**
 * Sign-in helper for browser-driven tests (e2e + evaluation simulation).
 * The workspace requires an admin account since migration 010.
 */
export interface Credentials {
  email: string;
  password: string;
}

/** Local e2e admin, created by tests/e2e/global-setup.ts. */
export const E2E_ADMIN: Credentials = {
  email: process.env.E2E_EMAIL ?? "e2e-admin@test.local",
  password: process.env.E2E_PASSWORD ?? "e2e-admin-password",
};

/** Sign in through the login page; throws with the page's error message. */
export async function signIn(
  page: Page,
  baseUrl: string,
  { email, password }: Credentials,
): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  try {
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), {
      timeout: 15_000,
    });
  } catch {
    const message = await page
      .getByRole("alert")
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(`Sign-in as ${email} failed: ${message ?? "timed out"}`);
  }
}
