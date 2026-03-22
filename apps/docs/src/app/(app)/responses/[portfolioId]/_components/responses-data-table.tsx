"use client";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FormResponse, Portfolio, PortfolioSchema } from "@/lib/types";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ColumnHeader } from "./column-header";
import { TableToolbar } from "./table-toolbar";

interface ResponsesDataTableProps {
  portfolio: Portfolio;
  responses: FormResponse[];
}

export function ResponsesDataTable({
  portfolio,
  responses,
}: ResponsesDataTableProps) {
  const router = useRouter();
  const schema = portfolio.schema as unknown as PortfolioSchema;
  const fields = schema.fields ?? [];

  const columns = useMemo<ColumnDef<FormResponse>[]>(() => {
    const cols: ColumnDef<FormResponse>[] = [
      {
        id: "submittedAt",
        header: "Submitted",
        accessorFn: (row) => row.submittedAt,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {new Date(getValue<string>()).toLocaleString()}
          </span>
        ),
        enableHiding: false,
      },
    ];

    for (const field of fields) {
      cols.push({
        id: field.id,
        header: () => (
          <ColumnHeader
            field={field}
            portfolio={portfolio}
            responses={responses}
          />
        ),
        accessorFn: (row) => row.data[field.name],
        cell: ({ getValue }) => String(getValue() ?? ""),
        meta: { fieldLabel: field.label },
      });
    }

    return cols;
  }, [fields, portfolio, responses]);

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);

  const table = useReactTable({
    data: responses,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      columnVisibility,
      columnOrder,
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
  });

  return (
    <div className="space-y-4">
      <TableToolbar table={table} />
      <Card>
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
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    router.push(
                      `/responses/${portfolio.id}/${row.original.id}`,
                    )
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
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
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No responses yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
