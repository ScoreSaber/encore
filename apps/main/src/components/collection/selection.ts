import { useCallback, useState } from 'react';

const nothingSelected: ReadonlySet<string> = new Set();

export function matchesQuery(query: string, fields: (string | null | undefined)[]) {
   if (query === '') return true;

   return fields.some((field) => field?.toLowerCase().includes(query) ?? false);
}

export function selectionState(selectedCount: number, visibleCount: number): boolean | 'indeterminate' {
   if (visibleCount === 0 || selectedCount === 0) return false;

   return selectedCount >= visibleCount ? true : 'indeterminate';
}

export function useCollectionSelection(scope: string) {
   const [selection, setSelection] = useState({ scope, ids: nothingSelected });
   const selected = selection.scope === scope ? selection.ids : nothingSelected;

   const toggle = useCallback(
      (id: string) =>
         setSelection((current) => {
            const ids = new Set(current.scope === scope ? current.ids : []);
            if (!ids.delete(id)) ids.add(id);

            return { scope, ids };
         }),
      [scope]
   );

   const toggleAll = useCallback(
      (ids: string[]) =>
         setSelection((current) => {
            const known = current.scope === scope ? current.ids : nothingSelected;
            const allSelected = ids.length > 0 && ids.every((id) => known.has(id));
            const next = new Set(known);
            for (const id of ids) {
               if (allSelected) next.delete(id);
               else next.add(id);
            }
            return { scope, ids: next.size === 0 ? nothingSelected : next };
         }),
      [scope]
   );

   const clear = useCallback(() => setSelection({ scope, ids: nothingSelected }), [scope]);

   return { selected, toggle, toggleAll, clear };
}

export type CollectionSelection = ReturnType<typeof useCollectionSelection>;
