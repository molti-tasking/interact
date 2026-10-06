import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { AppContent } from "@/components/app-content";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserImpersonationSelect } from "@/components/workspace/UserImpersonationSelect";
import { createLucideIcon } from "lucide-react";

// lucide-react 1.0 dropped brand icons; this is its former GitHub icon.
const Github = createLucideIcon("github", [
  [
    "path",
    {
      d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
      key: "tonef",
    },
  ],
  ["path", { d: "M9 18c-4.51 2-5-2-7-2", key: "9comsn" }],
]);

/**
 * Creator-facing app shell (sidebar, breadcrumb, acting-as switcher).
 * Respondent-facing pages live in the (public) group without it.
 */
export default function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* SidebarInset renders the page's <main> landmark */}
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border/60 bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/60 sm:px-6">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <Separator
            orientation="vertical"
            className="mx-1 data-[orientation=vertical]:h-4"
          />
          <AppBreadcrumb className="flex-1" />
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
            <UserImpersonationSelect />
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-muted-foreground"
            >
              <a
                href="https://github.com/molti-tasking/interact"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Source code on GitHub"
              >
                <Github className="h-4 w-4" aria-hidden />
                <span className="hidden lg:inline">GitHub</span>
              </a>
            </Button>
          </div>
        </header>
        <div className="flex-1 bg-muted/30">
          <AppContent>{children}</AppContent>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
