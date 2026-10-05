/**
 * Respondent-facing pages (published forms): no creator chrome — no sidebar
 * listing every portfolio, no "acting as" switcher.
 */
export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <main className="flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="pb-6 text-center text-xs text-muted-foreground">
        Made with Malleable Forms
      </footer>
    </div>
  );
}
