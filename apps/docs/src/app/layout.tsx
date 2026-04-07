import { AppSidebar } from "@/components/app-sidebar";
import { ReactQueryClientProvider } from "@/components/tools/ReactQueryClientProvider";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserImpersonationSelect } from "@/components/workspace/UserImpersonationSelect";
import { UserProvider } from "@/context/user-context";
import { cn } from "@/lib/utils";
import "interact/styles.css";
import { Github } from "lucide-react";
import type { Metadata } from "next";
import { Delius, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const delius = Delius({
  subsets: ["latin"],
  display: "auto",
  variable: "--font-delius",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Malleable Forms",
  description: "Intent-driven form design with AI-powered elicitation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ReactQueryClientProvider>
      <UserProvider>
      <html lang="en">
        <body
          className={cn(
            geistSans.variable,
            geistMono.variable,
            delius.variable,
            "antialiased",
            delius.className,
          )}
        >
          {/* <ReactQueryDevTools  /> */}
          <Toaster position="bottom-right" />

          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-14 items-center gap-2 border-b border-border/60 px-6 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 sticky top-0 z-50">
                <div className="flex flex-row justify-between w-full items-center">
                  <div className="flex flex-row items-center gap-3">
                    <SidebarTrigger className="-ml-1" />
                    <h2 className="text-lg tracking-tight text-primary">
                      Malleable Forms
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <UserImpersonationSelect />
                    <Button
                      variant={"ghost"}
                      size="sm"
                      asChild
                      className="text-muted-foreground font-sans"
                    >
                      <Link
                        href={"https://github.com/molti-tasking/interact"}
                        target="_blank"
                        className="gap-2"
                      >
                        <Github className="h-4 w-4" />
                        <span className="hidden sm:inline">Github</span>
                      </Link>
                    </Button>
                  </div>
                </div>
              </header>
              <main className="flex-1 bg-muted/30">
                <div className="container mx-auto px-6 py-8">{children}</div>
              </main>
            </SidebarInset>
          </SidebarProvider>
        </body>
      </html>
    </UserProvider>
    </ReactQueryClientProvider>
  );
}
