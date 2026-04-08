"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentUser } from "@/context/user-context";
import { MOCK_USERS } from "@/lib/mock-users";
import { User } from "lucide-react";

export function UserImpersonationSelect() {
  const { currentUser, setCurrentUser } = useCurrentUser();

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <User className="h-3 w-3" />
      <Select
        value={currentUser.id}
        onValueChange={(id) => {
          const user = MOCK_USERS.find((u) => u.id === id);
          if (user) setCurrentUser(user);
        }}
      >
        <SelectTrigger className="h-7 w-auto gap-1 border-none shadow-none text-xs px-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MOCK_USERS.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name} ({u.role})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
