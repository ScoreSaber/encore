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
