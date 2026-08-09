import { Result } from 'better-result';

export function readStorageValue(key: string) {
   return Result.try({
      try: () => localStorage.getItem(key),
      catch: (cause) => cause
   });
}

export function writeStorageValue(key: string, value: string) {
   return Result.try({
      try: () => {
         localStorage.setItem(key, value);
      },
      catch: (cause) => cause
   });
}

export function removeStorageValue(key: string) {
   return Result.try({
      try: () => {
         localStorage.removeItem(key);
      },
      catch: (cause) => cause
   });
}
