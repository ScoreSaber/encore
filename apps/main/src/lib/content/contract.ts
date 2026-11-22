import type { Problem } from '@/lib/errors';
import type { UrlIssue } from '@/lib/http/url';
import type { ProblemCode } from '@/lib/messages';

export type ContentSource = { kind: 'url'; url: string } | { kind: 'file'; path: string };

// BeatMods publishes MD5; Encore-generated hashes use SHA-256 or better
export type ContentHashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

export type ContentHash = {
   algorithm: ContentHashAlgorithm;
   value: string;
};

type ContentProblemCode = Extract<ProblemCode, `content.${string}`> | `content.source.${UrlIssue['code']}`;

export type ContentProblem = Problem<ContentProblemCode> & {
   entry?: string;
   path?: string;
};

type ArchiveEntryKind = 'file' | 'directory';

export type ArchiveEntry = {
   path: string;
   kind: ArchiveEntryKind;
   sizeBytes: number;
   compressedBytes: number;
};

export type ArchiveManifest = {
   format: 'zip';
   entries: ArchiveEntry[];
   fileCount: number;
   directoryCount: number;
   totalBytes: number;
   compressedBytes: number;
   compressionRatio: number;
   rootEntries: string[];
};
