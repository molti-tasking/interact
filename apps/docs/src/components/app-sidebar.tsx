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
import { useSchemas } from "@/hooks/query/schemas";
import { GalleryVerticalEnd } from "lucide-react";
import Link from "next/link";
import { NavSecondary } from "./nav-secondary";

// This is sample data.
const data = {
  versions: ["1.0.1", "1.1.0-alpha", "2.0.0-beta1"],
  navMain: [
    {
      title: "",
      url: "/",
      items: [
        {
          title: "HOME",
          url: "/",
        },
      ],
    },
    {
      title: "Components",
      url: "#",
      items: [
        {
          title: "Hi Mum",
          url: "/hi-mum",
        },
        {
          title: "Generative Form",
          url: "/gen-ai",
        },
        {
          title: "Malleable Forms",
          url: "/malleable-form",
        },
      ],
    },
  ],

  navSecondary: [],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: schemas } = useSchemas();

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <Link href={"/"}>
          <div className="p-2 flex flex-row items-center gap-4 bg-sidebar-primary-foreground rounded-2xl">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <GalleryVerticalEnd className="size-4" />
            </div>
            <div className="flex flex-col gap-0.5 leading-none">
              <span className="font-semibold">Interact</span>
              <span className="font-sm">Documentation</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {/* We create a SidebarGroup for each parent. */}
        {data.navMain.map((item) => (
          <SidebarGroup key={item.title}>
            <SidebarGroupLabel>{item.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {item.items.map((navItem) => (
                  <React.Fragment key={navItem.title}>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <a href={navItem.url}>{navItem.title}</a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>

                    {/* Show dynamic forms as children of "Malleable Forms" */}
                    {navItem.title === "Malleable Forms" &&
                      schemas &&
                      schemas.length > 0 && (
                        <>
                          {schemas.map((schema) => (
                            <SidebarMenuItem key={schema.slug} className="ml-4">
                              <SidebarMenuButton asChild>
                                <a href={`/malleable-form/${schema.slug}`}>
                                  <span className="text-sm">
                                    {schema.title}
                                  </span>
                                </a>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          ))}
                        </>
                      )}
                  </React.Fragment>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
