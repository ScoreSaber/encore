import type { ModIssue, ModWarning } from '@/modules/mods/contract';
import type { ModRepositoryIssue } from '@/modules/mods/contract';
import type { MessageKeyMap } from '@/renderer/i18n/keys';

export const modIssueKeys: MessageKeyMap<ModIssue, 'mods.issues'> = {
   'catalog-unavailable': 'catalogUnavailable',
   'inspect-failed': 'inspectFailed',
   'not-found': 'notFound',
   'nothing-selected': 'nothingSelected',
   'unknown-version': 'unknownVersion',
   'unsupported-file': 'unsupportedFile',
   'unsupported-target': 'unsupportedTarget'
};

export const modWarningKeys: MessageKeyMap<ModWarning, 'mods.warnings'> = {
   'bsipa-first': 'bsipaFirst',
   'claimed-identity': 'claimedIdentity',
   'missing-dependency': 'missingDependency',
   'patcher-runs': 'patcherRuns',
   'patcher-unsupported': 'patcherUnsupported',
   'removes-external': 'removesExternal',
   'replaces-installed': 'replacesInstalled',
   'unofficial-source': 'unofficialSource',
   'unverified-source': 'unverifiedSource'
};

export const modRepositoryIssueKeys: MessageKeyMap<ModRepositoryIssue, 'mods.repositories.issues'> = {
   denylisted: 'denylisted',
   duplicate: 'duplicate',
   'fetch-failed': 'fetchFailed',
   'invalid-listing': 'invalidListing',
   'invalid-url': 'invalidUrl',
   'not-acknowledged': 'notAcknowledged',
   'not-found': 'notFound',
   'policy-unavailable': 'policyUnavailable',
   'unsupported-schema': 'unsupportedSchema',
   'write-failed': 'writeFailed'
};
