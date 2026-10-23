/**
 * Workshop participant pages (study mode): no creator chrome — no sidebar,
 * no "acting as" switcher. The session page brings its own phase bar.
 */
export default function StudyLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="flex min-h-svh flex-col bg-muted/30">{children}</div>;
}
