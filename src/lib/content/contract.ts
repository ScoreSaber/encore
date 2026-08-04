export type ContentSource = { kind: 'url'; url: string } | { kind: 'file'; path: string };

// BeatMods publishes MD5; Encore-generated hashes use SHA-256 or better
export type ContentHashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

export type ContentHash = {
   algorithm: ContentHashAlgorithm;
   value: string;
};

export type ContentProblemCode =
   | 'content.source.invalid-url'
   | 'content.source.unsupported-scheme'
   | 'content.source.embedded-credentials'
   | 'content.source.unsupported-host'
   | 'content.source.not-a-file'
   | 'content.download.request-failed'
   | 'content.download.http-error'
   | 'content.download.redirect-invalid'
   | 'content.download.too-many-redirects'
   | 'content.download.timed-out'
   | 'content.download.too-large'
   | 'content.download.write-failed'
   | 'content.download.cancelled'
   | 'content.hash.read-failed'
   | 'content.hash.mismatch'
   | 'content.staging.failed'
   | 'content.archive.read-failed'
   | 'content.archive.not-zip'
   | 'content.archive.corrupt'
   | 'content.archive.encrypted'
   | 'content.archive.unsupported-compression'
   | 'content.archive.unsupported-entry'
   | 'content.archive.path-rejected'
   | 'content.archive.path-too-long'
   | 'content.archive.duplicate-entry'
   | 'content.archive.too-many-entries'
   | 'content.archive.too-large'
   | 'content.archive.ratio-exceeded'
   | 'content.extract.destination-not-empty'
   | 'content.extract.escaped-root'
   | 'content.extract.size-mismatch'
   | 'content.extract.checksum-mismatch'
   | 'content.extract.write-failed'
   | 'content.extract.cancelled'
   | 'content.commit.failed'
   | 'content.ingest.layout-rejected'
   | 'content.ingest.unsupported-target';

export type ContentProblem = {
   code: ContentProblemCode;
   message: string;
   entry?: string;
   path?: string;
   detail?: string;
};

export type ArchiveEntryKind = 'file' | 'directory';

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
