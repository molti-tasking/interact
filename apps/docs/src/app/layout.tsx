import { ReactQueryClientProvider } from "@/components/tools/ReactQueryClientProvider";
import { UserProvider } from "@/context/user-context";
import { cn } from "@/lib/utils";
import "interact/styles.css";
import type { Metadata } from "next";
import { Delius, Geist, Geist_Mono } from "next/font/google";
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
    <html lang="en">
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          delius.variable,
          "font-sans antialiased",
        )}
      >
        <ReactQueryClientProvider>
          <UserProvider>
            {/* <ReactQueryDevTools  /> */}
            <Toaster position="bottom-right" />

            {children}
          </UserProvider>
        </ReactQueryClientProvider>
      </body>
    </html>
  );
}
