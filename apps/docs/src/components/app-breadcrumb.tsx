"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { usePortfolioSummaries } from "@/hooks/query/portfolios";
import { buildBreadcrumbs } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

/**
 * Contextual location in the app header. Portfolio titles come from the
 * (already loaded) sidebar summaries, so this adds no extra request.
 * On phones only the current page is shown.
 */
export function AppBreadcrumb({ className }: { className?: string }) {
  const pathname = usePathname();
  const { data: summaries } = usePortfolioSummaries();

  const crumbs = buildBreadcrumbs(
    pathname,
    (id) => summaries?.find((p) => p.id === id)?.title,
  );

  return (
    <Breadcrumb className={cn("min-w-0", className)}>
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={`${i}-${crumb.label}`}>
              <BreadcrumbItem
                className={cn("min-w-0", !isLast && "hidden md:inline-flex")}
              >
                {crumb.href && !isLast ? (
                  <BreadcrumbLink asChild className="max-w-64 truncate">
                    <Link href={crumb.href} prefetch={false}>
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="block max-w-[50vw] truncate font-medium md:max-w-88">
                    {crumb.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {!isLast && (
                <BreadcrumbSeparator className="hidden md:block" />
              )}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
