interface Array<T> {
   findLast(predicate: (value: T, index: number, array: T[]) => boolean): T | undefined;
}
