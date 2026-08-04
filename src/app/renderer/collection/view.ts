export function matchesQuery(query: string, fields: (string | null | undefined)[]) {
   if (query === '') return true;

   return fields.some((field) => field?.toLowerCase().includes(query) ?? false);
}

export function selectionState(selectedCount: number, visibleCount: number): boolean | 'indeterminate' {
   if (visibleCount === 0 || selectedCount === 0) return false;

   return selectedCount >= visibleCount ? true : 'indeterminate';
}
