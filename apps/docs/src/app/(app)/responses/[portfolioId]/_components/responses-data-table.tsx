"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ResponseRowLike } from "@/lib/form-renderer/response-rows";
import { ResponseValue } from "@/lib/form-renderer/ResponseValue";
import { orphanKeys } from "@/lib/form-renderer/values";
import type {
  Field,
  FormResponse,
  Portfolio,
  SavedColumnAction,
} from "@/lib/types";
import {
  type CellContext,
  type ColumnDef,
  type ColumnOrderState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  type HeaderContext,
  type PaginationState,
  type Table as TanstackTable,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ColumnHeader } from "./column-header";
import {
  type ColumnActionTarget,
  ColumnPromptDialog,
} from "./column-prompt-dialog";
import { TableToolbar } from "./table-toolbar";

const PAGE_SIZE = 50;
const OTHER_DATA_COLUMN = "__other";

/** Per-render values the (stable) header/cell components read. */
interface ResponsesTableMeta {
  portfolio: Portfolio;
  openColumnAction: (field: Field, savedAction?: SavedColumnAction) => void;
}

/** Column meta; `fieldLabel` is read by the column toggle in the toolbar. */
interface ResponsesColumnMeta {
  fieldLabel: string;
  field?: Field;
}

type Row = ResponseRowLike;

/**
 * `table` is a stable instance whose `options.meta` changes every render, so
 * components reading it opt out of compiler memoization ("use no memo").
 */
function metaOf(table: TanstackTable<Row>): ResponsesTableMeta {
  return table.options.meta as ResponsesTableMeta;
}

function fieldOf(column: { columnDef: ColumnDef<Row, unknown> }): Field {
  return (column.columnDef.meta as ResponsesColumnMeta).field!;
}

function responseHref(portfolioId: string, responseId: string) {
  return `/responses/${portfolioId}/${responseId}`;
}

// ---------------------------------------------------------------------------
// Stable header / cell components — module-level so flexRender never sees a
// new component type (which would remount headers and their menus).
// ---------------------------------------------------------------------------

function SubmittedCell({ row, table }: CellContext<Row, unknown>) {
  "use no memo";
  const { portfolio } = metaOf(table);
  const submitted = new Date(row.original.submittedAt).toLocaleString();
  return (
    <Link
      href={responseHref(portfolio.id, row.original.id)}
      aria-label={`Open response submitted ${submitted}`}
      className="whitespace-nowrap rounded-sm text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {submitted}
    </Link>
  );
}

function OriginCell({ row }: CellContext<Row, unknown>) {
  const origin = "origin" in row.original ? row.original.origin : "own";
  return (
    <Badge
      variant={origin === "parent" ? "outline" : "secondary"}
      className="text-[10px]"
    >
      {origin === "parent" ? "Parent" : "Own"}
    </Badge>
  );
}

function FieldHeader({ column, table }: HeaderContext<Row, unknown>) {
  "use no memo";
  const { portfolio, openColumnAction } = metaOf(table);
  return (
    <ColumnHeader
      field={fieldOf(column)}
      portfolio={portfolio}
      onOpenAction={openColumnAction}
    />
  );
}

function FieldCell({ getValue, column }: CellContext<Row, unknown>) {
  return (
    <ResponseValue
      value={getValue()}
      field={fieldOf(column)}
      className="max-w-72"
    />
  );
}

function OtherDataHeader() {
  return (
    <span title="Data stored under names the current form doesn't use (renamed or removed fields)">
      Other data
    </span>
  );
}

function OtherDataCell({ row, table }: CellContext<Row, unknown>) {
  "use no memo";
  const { portfolio } = metaOf(table);
  const data = row.original.data;
  const keys = orphanKeys(data, portfolio.schema);
  if (keys.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer whitespace-nowrap text-muted-foreground">
        {keys.length} {keys.length === 1 ? "value" : "values"}
      </summary>
      <dl className="mt-1 space-y-1">
        {keys.map((key) => (
          <div key={key}>
            <dt className="font-mono text-[10px] text-muted-foreground">
              {key}
            </dt>
            <dd>
              <ResponseValue value={data[key]} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function buildColumns(
  fields: Field[],
  isDerived: boolean,
  showOtherData: boolean,
): ColumnDef<Row, unknown>[] {
  const cols: ColumnDef<Row, unknown>[] = [
    {
      id: "submittedAt",
      header: "Submitted",
      accessorFn: (row) => row.submittedAt,
      cell: SubmittedCell,
      enableHiding: false,
    },
  ];

  if (isDerived) {
    cols.push({
      id: "origin",
      header: "Source",
      accessorFn: (row) => ("origin" in row ? row.origin : "own"),
      cell: OriginCell,
      enableHiding: false,
    });
  }

  for (const field of fields) {
    cols.push({
      id: field.id,
      header: FieldHeader,
      accessorFn: (row) => row.data[field.name],
      cell: FieldCell,
      meta: { fieldLabel: field.label, field } satisfies ResponsesColumnMeta,
    });
  }

  if (showOtherData) {
    cols.push({
      id: OTHER_DATA_COLUMN,
      header: OtherDataHeader,
      cell: OtherDataCell,
      meta: { fieldLabel: "Other data" } satisfies ResponsesColumnMeta,
    });
  }

  return cols;
}

/** Clicks on links, buttons or disclosure widgets inside a row aren't row clicks. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest("a, button, input, label, summary, details, [role=menuitem]")
  );
}

// ---------------------------------------------------------------------------

interface ResponsesDataTableProps {
  portfolio: Portfolio;
  responses: FormResponse[];
}

export function ResponsesDataTable({
  portfolio,
  responses,
}: ResponsesDataTableProps) {
  const router = useRouter();
  const schema = portfolio.schema;
  const fields = schema.fields;
  const isDerived = !!portfolio.base_id;

  const showOtherData = useMemo(
    () => responses.some((r) => orphanKeys(r.data, schema).length > 0),
    [responses, schema],
  );

  // Depends on the schema only — never on the rows.
  const columns = useMemo(
    () => buildColumns(fields, isDerived, showOtherData),
    [fields, isDerived, showOtherData],
  );

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });
  const [actionTarget, setActionTarget] = useState<ColumnActionTarget | null>(
    null,
  );

  // Clamp the page when rows disappear (e.g. after a refetch)
  const total = responses.length;
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));
  const pageIndex = Math.min(pagination.pageIndex, pageCount - 1);

  const meta: ResponsesTableMeta = {
    portfolio,
    openColumnAction: (field, savedAction) =>
      setActionTarget({ field, savedAction }),
  };

  const table = useReactTable<Row>({
    data: responses,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => row.id,
    // Keep the page when rows refresh after an edit or column action
    autoResetPageIndex: false,
    state: {
      columnVisibility,
      columnOrder,
      pagination: { ...pagination, pageIndex },
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onPaginationChange: setPagination,
    meta,
  });

  const from = total === 0 ? 0 : pageIndex * pagination.pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pagination.pageSize);
  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-4">
      <TableToolbar table={table} />
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="group">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={(e) => {
                    // Keyboard users open rows via the link in the first cell.
                    if (isInteractiveTarget(e.target)) return;
                    router.push(responseHref(portfolio.id, row.original.id));
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="align-top">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {total === 0 ? "No responses yet." : "No responses on this page."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p aria-live="polite">
            Showing {from}–{to} of {total}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <span>
                Page {pageIndex + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPagination((p) => ({
                    ...p,
                    pageIndex: Math.max(0, pageIndex - 1),
                  }))
                }
                disabled={pageIndex === 0}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPagination((p) => ({
                    ...p,
                    pageIndex: Math.min(pageCount - 1, pageIndex + 1),
                  }))
                }
                disabled={pageIndex >= pageCount - 1}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </div>
      )}

      <ColumnPromptDialog
        target={actionTarget}
        onClose={() => setActionTarget(null)}
        portfolio={portfolio}
        responses={responses}
      />
    </div>
  );
}
