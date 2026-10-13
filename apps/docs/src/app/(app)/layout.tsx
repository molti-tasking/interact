import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { AppContent } from "@/components/app-content";
import { AppSidebar } from "@/components/app-sidebar";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserImpersonationSelect } from "@/components/workspace/UserImpersonationSelect";

// lucide-react 1.x removed brand icons, so the GitHub mark is inlined.
function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

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
                <GithubIcon className="h-4 w-4" aria-hidden />
                <span className="hidden lg:inline">GitHub</span>
              </a>
            </Button>
            <SignOutButton />
          </div>
        </header>
        <div className="flex-1 bg-muted/30">
          <AppContent>{children}</AppContent>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
