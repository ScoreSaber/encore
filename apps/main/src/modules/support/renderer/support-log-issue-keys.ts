import type { SupportLogIssue } from '@/modules/support/contract';
import type { MessageKey } from '@/renderer/i18n/keys';

export const supportLogIssueKeys: Record<SupportLogIssue, MessageKey<'home.logs.issues'>> = {
   'invalid-path': 'invalidPath',
   'not-found': 'notFound',
   unreadable: 'unreadable',
   'unsupported-target': 'unsupportedTarget'
};
