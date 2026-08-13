'use client';

import { useRef, useState } from 'react';

import {
   flexRender,
   functionalUpdate,
   getCoreRowModel,
   getSortedRowModel,
   useReactTable,
   type ColumnDef,
   type Row,
   type RowData,
   type SortingState
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/utils';

import { readTableSorting, writeTableSorting } from '@/renderer/collection/table-sort';

declare module '@tanstack/react-table' {
   interface ColumnMeta<TData extends RowData, TValue> {
      className?: string;
      cellClassName?: string;
      flex?: boolean;
      control?: boolean;
   }
}

type SortLabel = NonNullable<React.AriaAttributes['aria-sort']>;

type SortLabels = {
   asc: SortLabel;
   desc: SortLabel;
   false: SortLabel;
};

const sortLabels: SortLabels = {
   asc: 'ascending',
   desc: 'descending',
   false: 'none'
};

export function DataTable<T>({
   columns,
   data,
   getRowId,
   label,
   tableId,
   defaultSorting = [],
   rowHeight = 48,
   rowProps,
   virtual = true,
   className
}: {
   columns: ColumnDef<T>[];
   data: T[];
   getRowId: (item: T) => string;
   label: string;
   tableId?: string;
   defaultSorting?: SortingState;
   rowHeight?: number;
   rowProps?: (item: T) => React.ComponentProps<'tr'>;
   virtual?: boolean;
   className?: string;
}) {
   const scrollRef = useRef<HTMLDivElement>(null);
   const [sorting, setSorting] = useState<SortingState>(() => {
      const remembered = tableId ? readTableSorting(tableId) : [];
      return remembered.length > 0 ? remembered : defaultSorting;
   });
   const table = useReactTable({
      data,
      columns,
      state: { sorting },
      onSortingChange: (updater) => {
         const next = functionalUpdate(updater, sorting);

         setSorting(next);
         if (tableId) writeTableSorting(tableId, next);
         scrollRef.current?.scrollTo({ top: 0 });
      },
      getRowId,
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
      columnResizeMode: 'onChange',
      defaultColumn: { size: 160, minSize: 64 }
   });
   const rows = table.getRowModel().rows;
   const columnCount = table.getVisibleLeafColumns().length;
   const resizing = table.getState().columnSizingInfo.isResizingColumn !== false;

   const virtualizer = useVirtualizer({
      count: virtual ? rows.length : 0,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => rowHeight,
      overscan: 12
   });
   const virtualRows = virtualizer.getVirtualItems();
   const lastRow = virtualRows.at(-1);
   const paddingTop = virtualRows[0]?.start ?? 0;
   const paddingBottom = lastRow ? virtualizer.getTotalSize() - lastRow.end : 0;

   const renderRow = (row: Row<T>, height: number | undefined) => {
      const extra = rowProps?.(row.original);

      return (
         <TableRow key={row.id} {...extra} style={{ height, ...extra?.style }}>
            {row.getVisibleCells().map((cell) => {
               const meta = cell.column.columnDef.meta;

               return (
                  <TableCell key={cell.id} className={cn(meta?.control ? undefined : 'truncate', meta?.className, meta?.cellClassName)}>
                     {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
               );
            })}
         </TableRow>
      );
   };

   return (
      <div ref={scrollRef} className={cn('overflow-auto rounded-md border', virtual && 'min-h-0 flex-1', className)}>
         <table
            data-slot="table"
            aria-label={label}
            className={cn('w-full table-fixed caption-bottom text-sm', resizing && 'select-none')}
            style={{ minWidth: table.getTotalSize() }}
         >
            <colgroup>
               {table.getVisibleLeafColumns().map((column) => (
                  <col key={column.id} style={column.columnDef.meta?.flex ? undefined : { width: column.getSize() }} />
               ))}
            </colgroup>

            <TableHeader className="bg-card sticky top-0 z-10">
               {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                     {group.headers.map((header) => {
                        const direction = header.column.getIsSorted();

                        return (
                           <TableHead
                              key={header.id}
                              aria-sort={header.column.getCanSort() ? sortLabels[`${direction}`] : undefined}
                              className={cn(
                                 'relative',
                                 header.column.columnDef.meta?.control ? undefined : 'truncate',
                                 header.column.columnDef.meta?.className
                              )}
                           >
                              {header.isPlaceholder ? null : header.column.getCanSort() ? (
                                 <button
                                    type="button"
                                    className="hover:text-foreground/70 inline-flex max-w-full cursor-default items-center gap-1"
                                    onClick={header.column.getToggleSortingHandler()}
                                 >
                                    <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                                    {direction === 'asc' ? (
                                       <ArrowUp className="size-3.5 shrink-0" />
                                    ) : direction === 'desc' ? (
                                       <ArrowDown className="size-3.5 shrink-0" />
                                    ) : (
                                       <ChevronsUpDown className="size-3.5 shrink-0 opacity-30" />
                                    )}
                                 </button>
                              ) : (
                                 flexRender(header.column.columnDef.header, header.getContext())
                              )}

                              {header.column.getCanResize() ? (
                                 <span
                                    role="separator"
                                    aria-orientation="vertical"
                                    aria-label={`${label}: resize column`}
                                    tabIndex={0}
                                    data-resizing={header.column.getIsResizing() ? '' : undefined}
                                    className="hover:bg-primary data-[resizing]:bg-primary absolute inset-y-1 right-0 w-1.5 cursor-col-resize touch-none rounded-full select-none"
                                    onMouseDown={header.getResizeHandler()}
                                    onTouchStart={header.getResizeHandler()}
                                    onDoubleClick={() => header.column.resetSize()}
                                 />
                              ) : null}
                           </TableHead>
                        );
                     })}
                  </TableRow>
               ))}
            </TableHeader>

            <TableBody>
               {paddingTop > 0 ? (
                  <tr aria-hidden="true">
                     <td colSpan={columnCount} style={{ height: paddingTop }} />
                  </tr>
               ) : null}

               {virtual
                  ? virtualRows.map((virtualRow) => {
                       const row = rows[virtualRow.index];

                       return row ? renderRow(row, rowHeight) : null;
                    })
                  : rows.map((row) => renderRow(row, undefined))}

               {paddingBottom > 0 ? (
                  <tr aria-hidden="true">
                     <td colSpan={columnCount} style={{ height: paddingBottom }} />
                  </tr>
               ) : null}
            </TableBody>
         </table>
      </div>
   );
}
