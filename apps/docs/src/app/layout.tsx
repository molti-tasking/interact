import { AppSidebar } from "@/components/app-sidebar";
import { ReactQueryClientProvider } from "@/components/tools/ReactQueryClientProvider";
import { ReactQueryDevTools } from "@/components/tools/ReactQueryDevTools";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import "interact/styles.css";
import { Github } from "lucide-react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Interact Gen AI",
  description: "Interactivity with generative AI beyond chat interfaces.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ReactQueryClientProvider>
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <ReactQueryDevTools />
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-16 items-center gap-2 border-b px-6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
                <div className="flex flex-row justify-between w-full items-center">
                  <div className="flex flex-row items-center gap-4">
                    <SidebarTrigger className="-ml-1" />
                    <h2 className="text-lg font-semibold tracking-tight">
                      Interact Gen AI
                    </h2>
                  </div>
                  <Button variant={"ghost"} size="sm" asChild>
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
              </header>
              <main className="flex-1">
                <div className="container max-w-7xl mx-auto px-6 py-8">
                  {children}
                </div>
              </main>
            </SidebarInset>
          </SidebarProvider>
        </body>
      </html>
    </ReactQueryClientProvider>
  );
}
