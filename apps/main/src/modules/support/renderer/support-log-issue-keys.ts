import type { SupportLogIssue } from '@/modules/support/contract';
import type { MessageKeyMap } from '@/renderer/i18n/keys';

export const supportLogIssueKeys: MessageKeyMap<SupportLogIssue, 'home.logs.issues'> = {
   'invalid-path': 'invalidPath',
   'not-found': 'notFound',
   unreadable: 'unreadable',
   'unsupported-target': 'unsupportedTarget'
};
