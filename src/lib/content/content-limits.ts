export type ContentLimits = {
   maxDownloadBytes: number;
   maxRedirects: number;
   requestTimeoutMs: number;
   stallTimeoutMs: number;
   maxArchiveBytes: number;
   maxEntries: number;
   maxEntryBytes: number;
   maxTotalBytes: number;
   maxPathLength: number;
   maxPathDepth: number;
   maxCompressionRatio: number;
   ratioFloorBytes: number;
};

export const defaultContentLimits: ContentLimits = {
   maxDownloadBytes: 512 * 1024 * 1024,
   maxRedirects: 4,
   requestTimeoutMs: 30_000,
   stallTimeoutMs: 30_000,
   maxArchiveBytes: 512 * 1024 * 1024,
   maxEntries: 5_000,
   maxEntryBytes: 256 * 1024 * 1024,
   maxTotalBytes: 1024 * 1024 * 1024,
   maxPathLength: 200,
   maxPathDepth: 12,
   maxCompressionRatio: 200,
   ratioFloorBytes: 64 * 1024
};

export function resolveContentLimits(overrides: Partial<ContentLimits> = {}): ContentLimits {
   return { ...defaultContentLimits, ...overrides };
}
