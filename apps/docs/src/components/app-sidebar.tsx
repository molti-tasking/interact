"use client";

import * as React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  type PortfolioSummary,
  usePortfolioSummaries,
} from "@/hooks/query/portfolios";
import {
  activePortfolioIdFromPath,
  isPrimaryNavActive,
  type PrimaryNavKey,
} from "@/lib/app-nav";
import {
  buildLineageTree,
  flattenLineageTree,
  type LineageTreeNode,
} from "@/lib/portfolio-tree";
import { cn } from "@/lib/utils";
import { useWorkspaceActivityStore } from "@/lib/workspace-activity";
import {
  BookOpen,
  CornerDownRight,
  FileText,
  FlaskConical,
  GalleryVerticalEnd,
  LayoutGrid,
  Loader2,
  Mic,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { NavSecondary } from "./nav-secondary";

/** Show a filter input once the list gets long. */
const SEARCH_THRESHOLD = 8;
/** Collapsed list length (the active portfolio is always shown). */
const COLLAPSED_LIMIT = 12;
/** Indentation stops growing after this depth to keep titles readable. */
const MAX_INDENT_DEPTH = 3;

const PRIMARY_NAV: {
  key: PrimaryNavKey;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "portfolios", href: "/portfolios", label: "Portfolios", icon: LayoutGrid },
  { key: "new", href: "/portfolios/new", label: "New portfolio", icon: Plus },
  { key: "record", href: "/record", label: "Record mode", icon: Mic },
  { key: "evaluation", href: "/evaluation", label: "Evaluation", icon: FlaskConical },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <Link href="/" onClick={closeOnMobile}>
          <div className="p-2.5 flex flex-row items-center gap-3 rounded-xl transition-colors hover:bg-sidebar-accent">
            <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg shadow-sm">
              <GalleryVerticalEnd className="size-4" aria-hidden />
            </div>
            <div className="flex flex-col gap-0.5 leading-none">
              <span className="font-display text-[15px] text-primary tracking-tight">
                Malleable Forms
              </span>
              <span className="text-[11px] text-muted-foreground/70">
                Interact · research prototype
              </span>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {PRIMARY_NAV.map(({ key, href, label, icon: Icon }) => {
                const active = isPrimaryNavActive(key, pathname);
                return (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        onClick={closeOnMobile}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <PortfolioGroup
          activeId={activePortfolioIdFromPath(pathname)}
          onNavigate={closeOnMobile}
        />
      </SidebarContent>

      <SidebarFooter>
        <NavSecondary
          items={[{ title: "About the project", url: "/", icon: BookOpen }]}
          className="mt-auto"
        />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

// ---------------------------------------------------------------------------
// Portfolio list
// ---------------------------------------------------------------------------

function PortfolioGroup({
  activeId,
  onNavigate,
}: {
  activeId: string | null;
  onNavigate: () => void;
}) {
  const { data: portfolios, isLoading, isError } = usePortfolioSummaries();
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);

  // Portfolios with a running AI operation (generation, probe resolution, …)
  const busyIds = useWorkspaceActivityStore(
    useShallow((s) => Array.from(new Set(s.activities.map((a) => a.portfolioId)))),
  );

  const q = query.trim().toLowerCase();
  const rows = React.useMemo(() => {
    const list = portfolios ?? [];
    const filtered = q
      ? list.filter((p) => p.title.toLowerCase().includes(q))
      : list;
    return flattenLineageTree(buildLineageTree(filtered));
  }, [portfolios, q]);

  if (isLoading) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Portfolios</SidebarGroupLabel>
        <SidebarMenu>
          {[0, 1, 2].map((i) => (
            <SidebarMenuItem key={i}>
              <SidebarMenuSkeleton showIcon />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  if (isError) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Portfolios</SidebarGroupLabel>
        <p className="px-2 text-xs text-muted-foreground">
          Couldn&apos;t load portfolios.
        </p>
      </SidebarGroup>
    );
  }

  const total = portfolios?.length ?? 0;
  if (total === 0) return null;

  const collapsible = !q && rows.length > COLLAPSED_LIMIT;
  let visible = rows;
  if (collapsible && !expanded) {
    visible = rows.slice(0, COLLAPSED_LIMIT);
    const activeRow = rows.find((r) => r.item.id === activeId);
    if (activeRow && !visible.includes(activeRow)) visible = [...visible, activeRow];
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        Portfolios
        <span className="ml-auto tabular-nums text-sidebar-foreground/50">
          {total}
        </span>
      </SidebarGroupLabel>
      {total > SEARCH_THRESHOLD && (
        <div className="relative mb-1 px-0.5">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <SidebarInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter portfolios…"
            aria-label="Filter portfolios by title"
            className="pl-7"
          />
        </div>
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          {visible.map((node) => (
            <PortfolioItem
              key={node.item.id}
              node={node}
              active={node.item.id === activeId}
              busy={busyIds.includes(node.item.id)}
              flat={!!q}
              onNavigate={onNavigate}
            />
          ))}
          {q && rows.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              No portfolio matches “{query.trim()}”.
            </li>
          )}
          {collapsible && (
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                className="text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                <span>
                  {expanded ? "Show fewer" : `Show all ${rows.length}`}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function PortfolioItem({
  node,
  active,
  busy,
  flat,
  onNavigate,
}: {
  node: LineageTreeNode<PortfolioSummary>;
  active: boolean;
  busy: boolean;
  /** Search results are listed without indentation. */
  flat: boolean;
  onNavigate: () => void;
}) {
  const { item, depth } = node;
  const indent = flat ? 0 : Math.min(depth, MAX_INDENT_DEPTH);
  const Icon = indent > 0 ? CornerDownRight : FileText;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        style={indent ? { paddingLeft: `${0.5 + indent * 0.75}rem` } : undefined}
      >
        <Link
          href={`/portfolios/${item.id}`}
          prefetch={false}
          title={item.title}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
        >
          <Icon
            className={cn("h-4 w-4", indent > 0 && "text-muted-foreground/70")}
          />
          <span className="truncate">{item.title || "Untitled portfolio"}</span>
          {busy && (
            <Loader2
              className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-brand-accent"
              aria-label="AI working"
            />
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
