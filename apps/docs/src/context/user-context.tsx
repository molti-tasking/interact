"use client";

import { type MockUser, MOCK_USERS } from "@/lib/mock-users";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

interface UserContextValue {
  currentUser: MockUser;
  setCurrentUser: (user: MockUser) => void;
}

const UserContext = createContext<UserContextValue | null>(null);

// ---------------------------------------------------------------------------
// Persisted "acting as" selection
//
// Stored in localStorage so the impersonated user survives reloads. Read via
// useSyncExternalStore: the server snapshot is always the default user, so
// hydration matches and the stored user is applied right after.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "malleable-forms:acting-as";
const listeners = new Set<() => void>();
/** Fallback when storage is unavailable (private mode, blocked cookies). */
let memoryUserId: string | null = null;

function readStoredUserId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryUserId;
  } catch {
    return memoryUserId;
  }
}

function writeStoredUserId(id: string) {
  memoryUserId = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage unavailable — keep the in-memory value
  }
  listeners.forEach((notify) => notify());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const getServerSnapshot = () => null;

export function UserProvider({ children }: { children: ReactNode }) {
  const storedId = useSyncExternalStore(
    subscribe,
    readStoredUserId,
    getServerSnapshot,
  );

  const currentUser =
    MOCK_USERS.find((u) => u.id === storedId) ?? MOCK_USERS[0];

  const setCurrentUser = useCallback((user: MockUser) => {
    writeStoredUserId(user.id);
  }, []);

  const value = useMemo(
    () => ({ currentUser, setCurrentUser }),
    [currentUser, setCurrentUser],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useCurrentUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useCurrentUser must be used within UserProvider");
  return ctx;
}
