import { Result, TaggedError, type Err, type Ok } from 'better-result';

class StorageAccessError extends TaggedError('StorageAccessError')<{
   message: string;
   key: string;
   operation: 'read' | 'write' | 'remove';
   cause: unknown;
}>() {}

type StorageResult<T, E> = Ok<T, E> | Err<T, E>;

export function readStorageValue(key: string): StorageResult<string | null, StorageAccessError> {
   return Result.try({
      try: () => localStorage.getItem(key),
      catch: (cause: unknown) =>
         new StorageAccessError({
            message: `failed to read localStorage key "${key}"`,
            key,
            operation: 'read',
            cause
         })
   });
}

export function writeStorageValue(key: string, value: string): StorageResult<void, StorageAccessError> {
   return Result.try({
      try: () => {
         localStorage.setItem(key, value);
      },
      catch: (cause: unknown) =>
         new StorageAccessError({
            message: `failed to write localStorage key "${key}"`,
            key,
            operation: 'write',
            cause
         })
   });
}

export function removeStorageValue(key: string): StorageResult<void, StorageAccessError> {
   return Result.try({
      try: () => {
         localStorage.removeItem(key);
      },
      catch: (cause: unknown) =>
         new StorageAccessError({
            message: `failed to remove localStorage key "${key}"`,
            key,
            operation: 'remove',
            cause
         })
   });
}
