"use client";

import { type MockUser, MOCK_USERS } from "@/lib/mock-users";
import { createContext, useContext, useState, type ReactNode } from "react";

interface UserContextValue {
  currentUser: MockUser;
  setCurrentUser: (user: MockUser) => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<MockUser>(MOCK_USERS[0]);

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useCurrentUser must be used within UserProvider");
  return ctx;
}
