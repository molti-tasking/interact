"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const handleSignOut = async () => {
    setPending(true);
    await createClient().auth.signOut();
    // Drop every cached query (forms, responses) along with the session.
    queryClient.clear();
    router.replace("/login");
    router.refresh();
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
