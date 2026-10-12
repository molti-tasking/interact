"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";
import { useState } from "react";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  const handleSignOut = async () => {
    setPending(true);
    await createClient().auth.signOut();
    // Full reload: drops every cached query along with the session.
    window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/login`);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={handleSignOut}
      disabled={pending}
      aria-label="Sign out"
    >
      <LogOut className="h-4 w-4" aria-hidden />
      <span className="hidden lg:inline">Sign out</span>
    </Button>
  );
}
