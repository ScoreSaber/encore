import { defineDomainApi, targetProcedure } from '@/lib/api';
import { supportInstallLogGroupSchema, supportInstallLogReadRequestSchema, supportLogExcerptSchema } from '@/modules/support/contract';

export const supportApi = defineDomainApi('support', {
   listInstallLogs: targetProcedure({
      capability: 'read-logs',
      output: supportInstallLogGroupSchema
   }),
   readInstallLog: targetProcedure({
      capability: 'read-logs',
      input: supportInstallLogReadRequestSchema,
      output: supportLogExcerptSchema
   })
});
