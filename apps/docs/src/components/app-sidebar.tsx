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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { usePortfolios } from "@/hooks/query/portfolios";
import {
  BarChart3,
  ClipboardList,
  FileText,
  FlaskConical,
  FormInput,
  GalleryVerticalEnd,
  History,
  Home,
  Pencil,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { NavSecondary } from "./nav-secondary";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: portfolios } = usePortfolios();

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <Link href={"/"}>
          <div className="p-2.5 flex flex-row items-center gap-3 rounded-xl transition-colors hover:bg-sidebar-accent">
            <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg shadow-sm">
              <GalleryVerticalEnd className="size-4" />
            </div>
            <div className="flex flex-col gap-0 leading-none">
              <span className="text-[15px] text-primary tracking-tight">
                Interact
              </span>
              <span className="text-[11px] font-sans text-muted-foreground/70">
                Malleable Forms
              </span>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link href="/portfolios">
                    <Home className="h-4 w-4" />
                    <span>Home</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link href="/evaluation">
                    <FlaskConical className="h-4 w-4" />
                    <span>Evaluation</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link href="/portfolios/new">
                    <Plus className="h-4 w-4" />
                    <span>New Portfolio</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {portfolios && portfolios.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Portfolios</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {portfolios.map((portfolio) => (
                  <React.Fragment key={portfolio.id}>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <Link href={`/portfolios/${portfolio.id}`}>
                          <FileText className="h-4 w-4" />
                          <span className="truncate">{portfolio.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {/* Sub-links */}
                    <SidebarMenuItem className="ml-4">
                      <SidebarMenuButton asChild className="h-7">
                        <Link href={`/portfolios/${portfolio.id}`}>
                          <Pencil className="h-3 w-3" />
                          <span className="text-xs">Design</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem className="ml-4">
                      <SidebarMenuButton asChild className="h-7">
                        <Link href={`/portfolios/${portfolio.id}/dashboard`}>
                          <BarChart3 className="h-3 w-3" />
                          <span className="text-xs">Dashboard</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem className="ml-4">
                      <SidebarMenuButton asChild className="h-7">
                        <Link href={`/forms/${portfolio.id}`}>
                          <FormInput className="h-3 w-3" />
                          <span className="text-xs">Form</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem className="ml-4">
                      <SidebarMenuButton asChild className="h-7">
                        <Link href={`/responses/${portfolio.id}`}>
                          <ClipboardList className="h-3 w-3" />
                          <span className="text-xs">Responses</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem className="ml-4">
                      <SidebarMenuButton asChild className="h-7">
                        <Link href={`/portfolios/${portfolio.id}/provenance`}>
                          <History className="h-3 w-3" />
                          <span className="text-xs">History</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </React.Fragment>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <NavSecondary items={[]} className="mt-auto" />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
