import { Result } from 'better-result';
import { z } from 'zod';

import { readStorageValue, removeStorageValue, writeStorageValue } from '@/renderer/storage';

const sortingSchema = z.array(z.object({ id: z.string(), desc: z.boolean() }));

type TableSorting = z.infer<typeof sortingSchema>;

export function readTableSorting(tableId: string) {
   const stored = Result.unwrapOr(readStorageValue(`encore.table-sort.${tableId}`), null);
   if (!stored) return [];

   const parsed = Result.try({ try: () => sortingSchema.parse(JSON.parse(stored)), catch: () => null });
   return Result.unwrapOr(parsed, []);
}

export function writeTableSorting(tableId: string, sorting: TableSorting) {
   const key = `encore.table-sort.${tableId}`;

   if (sorting.length === 0) removeStorageValue(key);
   else writeStorageValue(key, JSON.stringify(sorting));
}
