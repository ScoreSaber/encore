import type { MessageKey } from '@/app/renderer/i18n/keys';
import type { SupportLogIssue } from '@/modules/support/contract';

export const supportLogIssueKeys: Record<SupportLogIssue, MessageKey<'home.logs.issues'>> = {
   'invalid-path': 'invalidPath',
   'not-found': 'notFound',
   unreadable: 'unreadable',
   'unsupported-target': 'unsupportedTarget'
};
