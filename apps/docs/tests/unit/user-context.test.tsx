import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProvider, useCurrentUser } from "@/context/user-context";
import { MOCK_USERS } from "@/lib/mock-users";

const STORAGE_KEY = "malleable-forms:acting-as";

function Probe() {
  const { currentUser, setCurrentUser } = useCurrentUser();
  return (
    <>
      <span data-testid="who">{currentUser.id}</span>
      <button onClick={() => setCurrentUser(MOCK_USERS[2])}>switch</button>
    </>
  );
}

describe("UserProvider", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to the first mock user", () => {
    render(
      <UserProvider>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId("who").textContent).toBe(MOCK_USERS[0].id);
  });

  it("persists the selected user across remounts (reloads)", () => {
    const first = render(
      <UserProvider>
        <Probe />
      </UserProvider>,
    );
    act(() => screen.getByText("switch").click());
    expect(screen.getByTestId("who").textContent).toBe(MOCK_USERS[2].id);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(MOCK_USERS[2].id);
    first.unmount();

    render(
      <UserProvider>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId("who").textContent).toBe(MOCK_USERS[2].id);
  });

  it("ignores unknown stored ids", () => {
    window.localStorage.setItem(STORAGE_KEY, "nobody");
    render(
      <UserProvider>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId("who").textContent).toBe(MOCK_USERS[0].id);
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(
      <UserProvider>
        <Probe />
      </UserProvider>,
    );
    act(() => screen.getByText("switch").click());
    expect(screen.getByTestId("who").textContent).toBe(MOCK_USERS[2].id);
  });
});
