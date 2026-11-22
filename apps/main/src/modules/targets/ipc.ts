import { defineIpc, request, event } from '@/ipc/core';
import type { Target, TargetEvent } from '@/modules/targets/contract';

export const targetsIpc = defineIpc('targets', {
   list: request().returns<Target[]>(),
   onEvent: event<TargetEvent>()
});
