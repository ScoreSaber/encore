import { z } from 'zod';

export type EncoreReleaseInfo = {
   channel: 'alpha';
   version: string;
   label: string;
   source: 'release' | 'commit' | 'fallback';
};

export type PackageFormat = 'appimage' | 'development' | 'flatpak' | 'linux-package' | 'macos' | 'nsis' | 'unknown';

export type AppPackaging = {
   packaged: boolean;
   format: PackageFormat;
   // system package managers own updates for their package formats
   selfUpdates: boolean;
   updateChecks: boolean;
   protocols: readonly string[];
   fileAssociations: readonly string[];
};

export type AppInfo = {
   name: string;
   version: string;
   release: EncoreReleaseInfo;
   packaging: AppPackaging;
   platform: NodeJS.Platform;
   arch: string;
   electron: string;
   chrome: string;
   node: string;
};

export const externalLinkRequestSchema = z.object({ url: z.string().min(1) });

export type ExternalLinkResult = { status: 'opened' | 'blocked' };

export const pathChoiceRequestSchema = z.object({
   kind: z.enum(['folder', 'file']),
   title: z.string().optional(),
   defaultPath: z.string().optional(),
   extensions: z.array(z.string().min(1)).optional()
});

export type PathChoiceRequest = z.infer<typeof pathChoiceRequestSchema>;
export type PathChoice = { status: 'cancelled' } | { status: 'selected'; path: string };
