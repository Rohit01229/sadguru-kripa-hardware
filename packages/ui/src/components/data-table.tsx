import * as React from "react";
import { cn } from "../lib/cn";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./table";
import { Skeleton } from "./skeleton";
import { EmptyState, type EmptyStateProps } from "./empty-state";

export interface DataTableColumn<Row> {
  /** Stable key. */
  key: string;
  header: React.ReactNode;
  /** Right-align + tabular-nums (money/qty/count). */
  numeric?: boolean;
  /** Cell renderer. */
  cell: (row: Row, index: number) => React.ReactNode;
  /** Optional class for the cell. */
  className?: string;
  /** Optional class for the header. */
  headClassName?: string;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  /** Stable row key. */
  getRowKey: (row: Row, index: number) => React.Key;
  /** Toolbar slot above the table (search / filters). */
  toolbar?: React.ReactNode;
  /** Footer slot below the table (e.g. "Next page →" pagination). */
  footer?: React.ReactNode;
  /** Loading state — renders skeleton rows instead of body. */
  isLoading?: boolean;
  /** Skeleton row count while loading. Default 6. */
  skeletonRows?: number;
  /** Shown when `rows.length === 0` and not loading. */
  empty?: EmptyStateProps;
  className?: string;
  tableClassName?: string;
}

/**
 * List-page shell (§2.2): optional toolbar, a token-styled table, a skeleton body
 * while loading, an EmptyState when there are no rows, and a footer pagination slot.
 * Admin lists and the storefront catalog should converge on this.
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  toolbar,
  footer,
  isLoading,
  skeletonRows = 6,
  empty,
  className,
  tableClassName,
}: DataTableProps<Row>) {
  const showEmpty = !isLoading && rows.length === 0;

  return (
    <div className={cn("space-y-3", className)}>
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}

      {showEmpty && empty ? (
        <EmptyState {...empty} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className={tableClassName}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((col) => (
                  <TableHead key={col.key} numeric={col.numeric} className={col.headClassName}>
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: skeletonRows }).map((_, r) => (
                    <TableRow key={`sk-${r}`} className="hover:bg-transparent">
                      {columns.map((col) => (
                        <TableCell key={col.key} numeric={col.numeric}>
                          <Skeleton className={cn("h-4", col.numeric ? "ml-auto w-16" : "w-24")} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : rows.map((row, index) => (
                    <TableRow key={getRowKey(row, index)}>
                      {columns.map((col) => (
                        <TableCell key={col.key} numeric={col.numeric} className={col.className}>
                          {col.cell(row, index)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      )}

      {footer ? <div className="flex items-center justify-between gap-2">{footer}</div> : null}
    </div>
  );
}
