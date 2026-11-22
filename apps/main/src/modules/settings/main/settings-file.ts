import { z } from 'zod';

import { scoreSaberModSourceId } from '@/modules/mods/contract';
import { appSettingsSchema, librarySettingsSchema, type AppSettings, type LibrarySettings } from '@/modules/settings/contract';

export const storedSettingsFileSchema = z.object({
   app: appSettingsSchema,
   library: librarySettingsSchema
});

export type StoredSettingsFile = z.infer<typeof storedSettingsFileSchema>;

type SettingsJson = z.infer<ReturnType<typeof z.json>>;
type SettingsRead = { settings: StoredSettingsFile; invalidFields: string[] };

const jsonObjectSchema = z.record(z.string(), z.json());

const fieldwiseSections = new Set(['app', 'library', 'app.selection', 'app.receiver', 'app.linkHandling']);

export function readStoredSettings(json: SettingsJson, defaults: StoredSettingsFile): SettingsRead {
   const fallback = z.json().safeParse(defaults);
   if (!fallback.success) return { settings: defaults, invalidFields: ['settings'] };

   let candidate = fillMissing(upgradeJson(json), fallback.data, '');
   const parsed = storedSettingsFileSchema.safeParse(candidate);
   if (parsed.success) return { settings: upgradeSettings(parsed.data), invalidFields: [] };

   const invalidFields = new Set<string>();
   for (const issue of parsed.error.issues) {
      const field = fieldSegments(issue.path);
      invalidFields.add(field.join('.') || 'settings');
      candidate = replaceField(candidate, fallback.data, field);
   }

   const recovered = storedSettingsFileSchema.safeParse(candidate);
   return recovered.success
      ? { settings: upgradeSettings(recovered.data), invalidFields: [...invalidFields] }
      : { settings: defaults, invalidFields: ['settings'] };
}

function upgradeJson(json: SettingsJson): SettingsJson {
   const file = jsonObjectSchema.safeParse(json);
   const app = jsonObjectSchema.safeParse(file.data?.app);
   const linkHandling = jsonObjectSchema.safeParse(app.data?.linkHandling);
   if (!file.success || !app.success || !linkHandling.success) return json;

   const { downloadInstall, ...rest } = linkHandling.data;
   if (downloadInstall === undefined || rest.downloadInstalls !== undefined) return json;
   return { ...file.data, app: { ...app.data, linkHandling: { ...rest, downloadInstalls: downloadInstall === null ? [] : [downloadInstall] } } };
}

function fillMissing(value: SettingsJson, fallback: SettingsJson, path: string): SettingsJson {
   const current = jsonObjectSchema.safeParse(value);
   const defaults = jsonObjectSchema.safeParse(fallback);
   if (!current.success || !defaults.success) return value;

   const filled = { ...current.data };
   for (const [key, defaultValue] of Object.entries(defaults.data)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const existing = filled[key];
      if (existing === undefined) filled[key] = defaultValue;
      else if (fieldwiseSections.has(fieldPath)) filled[key] = fillMissing(existing, defaultValue, fieldPath);
   }

   return filled;
}

function fieldSegments(issuePath: PropertyKey[]) {
   const segments: string[] = [];
   for (const key of issuePath) {
      segments.push(String(key));
      if (!fieldwiseSections.has(segments.join('.'))) break;
   }

   return segments;
}

function replaceField(value: SettingsJson, fallback: SettingsJson, segments: string[]): SettingsJson {
   const [key, ...rest] = segments;
   const current = jsonObjectSchema.safeParse(value);
   const defaults = jsonObjectSchema.safeParse(fallback);
   if (key === undefined || !current.success || !defaults.success) return fallback;

   return { ...current.data, [key]: replaceField(current.data[key] ?? null, defaults.data[key] ?? null, rest) };
}

function upgradeSettings(settings: StoredSettingsFile): StoredSettingsFile {
   return { app: upgradeAppSettings(settings.app), library: upgradeLibrarySettings(settings.library) };
}

function upgradeAppSettings(app: AppSettings): AppSettings {
   const modRepositories = app.modRepositories.filter((record) => record.id.trim().toLowerCase() !== scoreSaberModSourceId);

   return modRepositories.length === app.modRepositories.length ? app : { ...app, modRepositories };
}

function upgradeLibrarySettings(library: LibrarySettings): LibrarySettings {
   const lastLaunch = library.lastLaunch;
   if (!lastLaunch || library.launchOptions[lastLaunch.installId]) return library;

   return { ...library, launchOptions: { ...library.launchOptions, [lastLaunch.installId]: lastLaunch.options } };
}
