import { z } from 'zod';

export const storeKindSchema = z.enum(['steam', 'oculus']);
export const storeKinds = storeKindSchema.options;
export type StoreKind = z.infer<typeof storeKindSchema>;

export type TargetId = string;
export type InstallId = string;

export type TargetKind = 'local' | 'remote';

export type TargetStatus = 'ready' | 'unpaired' | 'disconnected';

export type TargetCapability = 'list-installs';

export type Target = {
   id: TargetId;
   kind: TargetKind;
   name: string;
   status: TargetStatus;
   capabilities: TargetCapability[];
};

export type TargetHealth = {
   status: TargetStatus;
   capabilities: TargetCapability[];
   message?: string;
};

export type InstallSummary = {
   id: InstallId;
   targetId: TargetId;
   version: string;
   name?: string;
   store: StoreKind | null;
};

export type TargetEvent =
   | {
        type: 'target-updated';
        target: Target;
     }
   | {
        type: 'installs-updated';
        targetId: TargetId;
        installs: InstallSummary[];
     };

export type TargetClient = {
   listTargets: () => Promise<Target[]>;
   listInstalls: (targetId: TargetId) => Promise<InstallSummary[]>;
   getHealth: (targetId: TargetId) => Promise<TargetHealth | null>;
   onEvent: (listener: (event: TargetEvent) => void) => () => void;
};
