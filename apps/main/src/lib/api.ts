import type { Result } from 'better-result';
import type { z, ZodType } from 'zod';

import type { TargetCapability, TargetId } from '@/modules/targets/contract';

export type TargetProcedure<Input extends ZodType | undefined = ZodType | undefined, Output extends ZodType = ZodType> = {
   kind: 'procedure';
   capability: TargetCapability;
   output: Output;
} & (Input extends ZodType ? { input: Input } : { input?: undefined });

export type TargetUpload<Input extends ZodType<object> = ZodType<object>> = {
   kind: 'upload';
   capability: TargetCapability;
   input: Input;
};

type TargetUploads = Record<string, TargetUpload>;

export type DomainApi<
   Namespace extends string = string,
   Procedures extends Record<string, TargetProcedure> = Record<string, TargetProcedure>,
   Snapshot extends ZodType | undefined = ZodType | undefined,
   Uploads extends TargetUploads | undefined = TargetUploads | undefined
> = {
   namespace: Namespace;
   procedures: Procedures;
} & (Snapshot extends ZodType ? { snapshot: Snapshot } : { snapshot?: undefined }) &
   (Uploads extends TargetUploads ? { uploads: Uploads } : { uploads?: undefined });

export type ProcedureInput<Procedure extends TargetProcedure> = Procedure extends { input: infer Input extends ZodType }
   ? z.output<Input>
   : Record<never, never>;
export type ProcedureOutput<Procedure extends TargetProcedure> = z.output<Procedure['output']>;
export type UploadInput<Upload extends TargetUpload> = z.output<Upload['input']>;
export type TargetCall<Procedure extends TargetProcedure> = { targetId: TargetId } & ProcedureInput<Procedure>;
export type SnapshotOutput<Api extends DomainApi> = Api extends { snapshot: infer Snapshot extends ZodType } ? z.output<Snapshot> : never;
export type TargetSnapshot<Snapshot> = { targetId: TargetId; snapshot: Snapshot };

export type ApiHandlers<Api extends DomainApi> = {
   [Method in keyof Api['procedures']]: (
      input: ProcedureInput<Api['procedures'][Method]>
   ) => ProcedureOutput<Api['procedures'][Method]> | Promise<ProcedureOutput<Api['procedures'][Method]>>;
};

export type TargetUploadFailure = {
   kind: 'invalid' | 'not-found' | 'unavailable';
   code: string;
   message: string;
};

type ApiUploads<Api extends DomainApi> = Api extends { uploads: infer Uploads extends TargetUploads } ? Uploads : Record<never, never>;
export type ApiUploadMethod<Api extends DomainApi> = keyof ApiUploads<Api> & string;
export type ApiUpload<Api extends DomainApi, Method extends ApiUploadMethod<Api>> = Extract<ApiUploads<Api>[Method], TargetUpload>;

export type UploadHandlers<Api extends DomainApi> = {
   [Method in ApiUploadMethod<Api>]: (
      input: UploadInput<ApiUpload<Api, Method>>,
      source: AsyncIterable<Uint8Array>
   ) => Promise<Result<void, TargetUploadFailure>>;
};

export type TargetCallResult<Value> = { targetId: TargetId } & (
   | { status: 'ok'; value: Value }
   | { status: 'unsupported'; capability: TargetCapability }
   | { status: 'unavailable'; error: { code: string; message: string } }
);

type SnapshotSubscription<Api extends DomainApi> = Api extends { snapshot: ZodType }
   ? { subscribe: (listener: (snapshot: SnapshotOutput<Api>) => void) => () => void }
   : { subscribe?: undefined };

type UploadImplementation<Api extends DomainApi> = Api extends { uploads: TargetUploads }
   ? { uploadHandlers: UploadHandlers<Api> }
   : { uploadHandlers?: undefined };

export type ApiModule<Api extends DomainApi> = { api: Api; handlers: ApiHandlers<Api> } & SnapshotSubscription<Api> & UploadImplementation<Api>;
export type TargetApiModule = { api: DomainApi; handlers: object; subscribe?: object; uploadHandlers?: object };
export type SnapshotTargetApiModule = TargetApiModule & {
   api: DomainApi & { snapshot: ZodType };
   subscribe: object;
};
export type UploadTargetApiModule = TargetApiModule & {
   api: DomainApi & { uploads: TargetUploads };
   uploadHandlers: object;
};
export type ApiMethod<Api extends DomainApi> = keyof Api['procedures'] & string;

export type TargetDispatcher = <Api extends DomainApi, Method extends ApiMethod<Api>>(
   local: ApiModule<Api>,
   method: Method,
   targetId: TargetId,
   input: ProcedureInput<Api['procedures'][Method]>
) => Promise<TargetCallResult<ProcedureOutput<Api['procedures'][Method]>>>;

export function targetProcedure<Output extends ZodType>(definition: {
   capability: TargetCapability;
   output: Output;
}): TargetProcedure<undefined, Output>;
export function targetProcedure<Input extends ZodType, Output extends ZodType>(definition: {
   capability: TargetCapability;
   input: Input;
   output: Output;
}): TargetProcedure<Input, Output>;
export function targetProcedure(definition: { capability: TargetCapability; input?: ZodType; output: ZodType }) {
   return { kind: 'procedure', ...definition };
}

export function targetUpload<const Input extends ZodType<object>>(definition: { capability: TargetCapability; input: Input }): TargetUpload<Input> {
   return { kind: 'upload', ...definition };
}

export function defineDomainApi<
   const Namespace extends string,
   const Procedures extends Record<string, TargetProcedure>,
   const Snapshot extends ZodType | undefined = undefined,
   const Uploads extends TargetUploads | undefined = undefined
>(
   namespace: Namespace,
   procedures: Procedures,
   options?: {
      snapshot?: Snapshot;
      uploads?: Uploads;
   }
): DomainApi<Namespace, Procedures, Snapshot, Uploads>;
export function defineDomainApi(
   namespace: string,
   procedures: Record<string, TargetProcedure>,
   options: {
      snapshot?: ZodType;
      uploads?: TargetUploads;
   } = {}
) {
   return { namespace, procedures, ...options };
}

export function getProcedure<Api extends DomainApi, Method extends ApiMethod<Api>>(api: Api, method: Method): Api['procedures'][Method];
export function getProcedure(api: DomainApi, method: string) {
   const procedure = api.procedures[method];
   if (!procedure) throw new Error(`Unknown API procedure: ${api.namespace}.${method}`);

   return procedure;
}

export function getUpload<Api extends DomainApi, Method extends ApiUploadMethod<Api>>(api: Api, method: Method): ApiUpload<Api, Method>;
export function getUpload(api: DomainApi, method: string) {
   const upload = api.uploads?.[method];
   if (!upload) throw new Error(`Unknown API upload: ${api.namespace}.${method}`);

   return upload;
}

export function hasSnapshotStream(module: TargetApiModule): module is SnapshotTargetApiModule {
   return Boolean(module.api.snapshot && module.subscribe);
}

export function hasUploads(module: TargetApiModule): module is UploadTargetApiModule {
   return Boolean(module.api.uploads && module.uploadHandlers);
}

type ApiModuleOptions<Api extends DomainApi> = SnapshotSubscription<Api> & UploadImplementation<Api>;

export function defineApiHandlers<Api extends DomainApi & { snapshot?: undefined; uploads?: undefined }>(
   api: Api,
   handlers: ApiHandlers<Api>
): ApiModule<Api>;
export function defineApiHandlers<Api extends DomainApi>(api: Api, handlers: ApiHandlers<Api>, options: ApiModuleOptions<Api>): ApiModule<Api>;
export function defineApiHandlers(api: DomainApi, handlers: object, options?: { subscribe?: object; uploadHandlers?: object }) {
   return { api, handlers, ...options };
}
