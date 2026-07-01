import { BrowserWindow } from 'electron';

import { defineIpcMainCommand, defineIpcMainModule, defineIpcMainQuery } from '@/main/ipc/register-ipc-modules';
import type { OperationRegistry } from '@/main/operations/operation-registry';
import {
   operationCancelCommand,
   operationDemoStartCommand,
   operationListQuery,
   operationSnapshotEvent,
   operationsIpcModule
} from '@/shared/ipc/modules/operations';
import type { OperationDemoStartRequest, OperationDemoStartResult } from '@/shared/operations';

const defaultDemoSteps = 5;
const defaultDemoIntervalMs = 250;
const minDemoIntervalMs = 50;
const maxDemoIntervalMs = 2_000;
const minDemoSteps = 1;
const maxDemoSteps = 200;

export function createOperationsIpcModule(registry: OperationRegistry, options: { demoEnabled: boolean }) {
   registry.subscribe((event) => {
      for (const window of BrowserWindow.getAllWindows()) {
         if (window.isDestroyed()) continue;

         window.webContents.send(operationSnapshotEvent.channel, event);
      }
   });

   return defineIpcMainModule(operationsIpcModule, [
      defineIpcMainQuery(operationListQuery, () => registry.list()),
      defineIpcMainCommand(operationCancelCommand, (_event, request) => registry.cancel(request.id)),
      defineIpcMainCommand(operationDemoStartCommand, (_event, request) => startDemoOperation(registry, options, request))
   ]);
}

function startDemoOperation(
   registry: OperationRegistry,
   options: { demoEnabled: boolean },
   request: OperationDemoStartRequest
): OperationDemoStartResult {
   if (!options.demoEnabled) {
      return {
         ok: false,
         error: {
            code: 'operations.demo.disabled',
            message: 'demo operations are only available in development'
         }
      };
   }

   const steps = clampWholeNumber(request.steps, minDemoSteps, maxDemoSteps, defaultDemoSteps);
   const intervalMs = clampWholeNumber(request.intervalMs, minDemoIntervalMs, maxDemoIntervalMs, defaultDemoIntervalMs);
   let currentStep = 0;
   let interval: ReturnType<typeof setInterval> | undefined;

   const operation = registry.create({
      kind: 'demo',
      title: 'Demo operation',
      message: 'Preparing demo work',
      progress: {
         phase: 'demo',
         current: currentStep,
         total: steps,
         percent: 0,
         unit: 'steps'
      },
      metadata: {
         source: 'dev-demo'
      },
      cancel() {
         if (interval) clearInterval(interval);
      }
   });

   interval = setInterval(() => {
      currentStep += 1;

      const snapshot = registry.update(operation.id, {
         message: currentStep >= steps ? 'Finishing demo work' : 'Running demo work',
         progress: {
            phase: 'demo',
            current: currentStep,
            total: steps,
            percent: Math.round((currentStep / steps) * 100),
            unit: 'steps'
         }
      });

      if (!snapshot || snapshot.status === 'cancelled') {
         clearInterval(interval);
         return;
      }

      if (request.outcome === 'fail' && shouldFailDemo(currentStep, steps)) {
         clearInterval(interval);
         registry.fail(operation.id, {
            code: 'operations.demo.failed',
            message: 'demo operation failed'
         });
         return;
      }

      if (currentStep >= steps) {
         clearInterval(interval);
         registry.complete(operation.id, {
            steps
         });
      }
   }, intervalMs);

   return {
      ok: true,
      operation
   };
}

function shouldFailDemo(currentStep: number, steps: number) {
   return currentStep >= Math.max(1, Math.ceil(steps / 2));
}

function clampWholeNumber(value: number | undefined, min: number, max: number, fallback: number) {
   if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;

   return Math.min(max, Math.max(min, Math.round(value)));
}
