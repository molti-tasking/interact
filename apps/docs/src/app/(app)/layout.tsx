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
import { Github } from "lucide-react";

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
