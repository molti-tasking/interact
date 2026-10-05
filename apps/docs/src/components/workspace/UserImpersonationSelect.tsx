"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentUser } from "@/context/user-context";
import { formatActor, MOCK_USERS } from "@/lib/mock-users";
import { UserRound } from "lucide-react";

/**
 * Prototype-only identity switch: changes, edits and provenance entries are
 * attributed to the selected collaborator. Persisted across reloads.
 */
export function UserImpersonationSelect() {
  const { currentUser, setCurrentUser } = useCurrentUser();

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="hidden md:inline" aria-hidden>
        Acting as
      </span>
      <Select
        value={currentUser.id}
        onValueChange={(id) => {
          const user = MOCK_USERS.find((u) => u.id === id);
          if (user) setCurrentUser(user);
        }}
      >
        <SelectTrigger
          aria-label={`Acting as ${formatActor(currentUser)}`}
          title="Changes and history entries are attributed to this collaborator"
          className="h-7 w-auto max-w-[40vw] gap-1 border-none px-2 text-xs text-foreground shadow-none sm:max-w-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {MOCK_USERS.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {formatActor(u)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
