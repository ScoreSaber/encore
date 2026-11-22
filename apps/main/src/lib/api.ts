import { Result } from 'better-result';
import { z, type ZodType } from 'zod';

import { ipcTransportValueSchema, ipcHandlerReturnSchema, type IpcReturn, type IpcTransportValue } from '@/ipc/core';
import { localTargetId, type TargetCapability, type TargetId } from '@/modules/targets/contract';

export type ApiJsonValue = z.infer<ReturnType<typeof z.json>>;

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

export type TargetDownload<Input extends ZodType<object> = ZodType<object>> = {
   kind: 'download';
   capability: TargetCapability;
   input: Input;
};

type TargetUploads = Record<string, TargetUpload>;
type TargetDownloads = Record<string, TargetDownload>;

export type DomainApi<
   Namespace extends string = string,
   Procedures extends Record<string, TargetProcedure> = Record<string, TargetProcedure>,
   Snapshot extends ZodType | undefined = ZodType | undefined,
   Uploads extends TargetUploads | undefined = TargetUploads | undefined,
   Downloads extends TargetDownloads | undefined = TargetDownloads | undefined
> = {
   namespace: Namespace;
   procedures: Procedures;
} & (Snapshot extends ZodType ? { snapshot: Snapshot } : { snapshot?: undefined }) &
   (Uploads extends TargetUploads ? { uploads: Uploads } : { uploads?: undefined }) &
   (Downloads extends TargetDownloads ? { downloads: Downloads } : { downloads?: undefined });

export type ProcedureInput<Procedure extends TargetProcedure> = Procedure extends { input: infer Input extends ZodType }
   ? z.output<Input>
   : Record<never, never>;
export type ProcedureOutput<Procedure extends TargetProcedure> = z.output<Procedure['output']>;
export type UploadInput<Upload extends TargetUpload> = z.output<Upload['input']>;
export type DownloadInput<Download extends TargetDownload> = z.output<Download['input']>;
export type TargetCall<Procedure extends TargetProcedure> = { targetId: TargetId } & ProcedureInput<Procedure>;
export type SnapshotOutput<Api extends DomainApi> = Api extends { snapshot: infer Snapshot extends ZodType } ? z.output<Snapshot> : never;
export type TargetSnapshot<Snapshot> = { targetId: TargetId; snapshot: Snapshot };

export type ApiMethod<Api extends DomainApi> = keyof Api['procedures'] & string;
type ApiUploads<Api extends DomainApi> = Api extends { uploads: infer Uploads extends TargetUploads } ? Uploads : Record<never, never>;
export type ApiUploadMethod<Api extends DomainApi> = keyof ApiUploads<Api> & string;
export type ApiUpload<Api extends DomainApi, Method extends ApiUploadMethod<Api>> = Extract<ApiUploads<Api>[Method], TargetUpload>;
type ApiDownloads<Api extends DomainApi> = Api extends { downloads: infer Downloads extends TargetDownloads } ? Downloads : Record<never, never>;
export type ApiDownloadMethod<Api extends DomainApi> = keyof ApiDownloads<Api> & string;
export type ApiDownload<Api extends DomainApi, Method extends ApiDownloadMethod<Api>> = Extract<ApiDownloads<Api>[Method], TargetDownload>;

type Awaitable<Value> = Value | Promise<Value>;

export type TargetUploadFailure = {
   kind: 'invalid' | 'not-found' | 'unavailable';
   code: string;
   message: string;
};

type UploadResult = Promise<Result<void, TargetUploadFailure>>;
type DownloadResult = Promise<Result<AsyncIterable<Uint8Array>, TargetUploadFailure>>;

type ApiHandlers<Api extends DomainApi> = {
   [Method in keyof Api['procedures']]: (
      input: ProcedureInput<Api['procedures'][Method]>
   ) => Awaitable<IpcReturn<ProcedureOutput<Api['procedures'][Method]>>>;
};

type UploadHandlers<Api extends DomainApi> = {
   [Method in ApiUploadMethod<Api>]: (input: UploadInput<ApiUpload<Api, Method>>, source: AsyncIterable<Uint8Array>) => UploadResult;
};

type TargetApiHandlers<Api extends DomainApi> = {
   [Method in keyof Api['procedures']]?: (
      call: TargetCall<Api['procedures'][Method]>
   ) => Awaitable<IpcReturn<ProcedureOutput<Api['procedures'][Method]>>>;
};

type TargetUploadHandlers<Api extends DomainApi> = {
   [Method in ApiUploadMethod<Api>]?: (
      call: { targetId: TargetId } & UploadInput<ApiUpload<Api, Method>>,
      source: AsyncIterable<Uint8Array>
   ) => UploadResult;
};

type DownloadHandlers<Api extends DomainApi> = {
   [Method in ApiDownloadMethod<Api>]: (input: DownloadInput<ApiDownload<Api, Method>>) => DownloadResult;
};

type TargetDownloadHandlers<Api extends DomainApi> = {
   [Method in ApiDownloadMethod<Api>]?: (call: { targetId: TargetId } & DownloadInput<ApiDownload<Api, Method>>) => DownloadResult;
};

export type TargetCallResult<Value> = { targetId: TargetId } & (
   | { status: 'ok'; value: Value }
   | { status: 'unsupported'; capability: TargetCapability }
   | { status: 'unavailable'; error: { code: string; message: string } }
);

export const apiInputSchema = z.record(z.string(), ipcTransportValueSchema);
export type ApiInput = z.infer<typeof apiInputSchema>;

export type ApiImplementation = {
   api: DomainApi;
   procedures: ReadonlyMap<string, (targetId: TargetId, input: ApiInput) => Promise<IpcTransportValue>>;
   uploads: ReadonlyMap<string, (targetId: TargetId, input: ApiInput, source: AsyncIterable<Uint8Array>) => UploadResult>;
   downloads: ReadonlyMap<string, (targetId: TargetId, input: ApiInput) => DownloadResult>;
   subscribe?: (listener: (event: TargetSnapshot<IpcTransportValue>) => void) => () => void;
};

type LocalApiExtras<Api extends DomainApi> = (Api extends { snapshot: ZodType }
   ? { subscribe: (listener: (snapshot: SnapshotOutput<Api>) => void) => () => void }
   : { subscribe?: undefined }) &
   (Api extends { uploads: TargetUploads } ? { uploads: UploadHandlers<Api> } : { uploads?: undefined }) &
   (Api extends { downloads: TargetDownloads } ? { downloads: DownloadHandlers<Api> } : { downloads?: undefined });

type TargetApiExtras<Api extends DomainApi> = {
   uploads?: TargetUploadHandlers<Api>;
   downloads?: TargetDownloadHandlers<Api>;
   subscribe?: (listener: (event: TargetSnapshot<SnapshotOutput<Api>>) => void) => () => void;
};

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

export function targetDownload<const Input extends ZodType<object>>(definition: {
   capability: TargetCapability;
   input: Input;
}): TargetDownload<Input> {
   return { kind: 'download', ...definition };
}

export function defineDomainApi<
   const Namespace extends string,
   const Procedures extends Record<string, TargetProcedure>,
   const Snapshot extends ZodType | undefined = undefined,
   const Uploads extends TargetUploads | undefined = undefined,
   const Downloads extends TargetDownloads | undefined = undefined
>(
   namespace: Namespace,
   procedures: Procedures,
   options?: {
      snapshot?: Snapshot;
      uploads?: Uploads;
      downloads?: Downloads;
   }
): DomainApi<Namespace, Procedures, Snapshot, Uploads, Downloads>;
export function defineDomainApi(
   namespace: string,
   procedures: Record<string, TargetProcedure>,
   options: {
      snapshot?: ZodType;
      uploads?: TargetUploads;
      downloads?: TargetDownloads;
   } = {}
) {
   return { namespace, procedures, ...options, snapshot: options.snapshot };
}

export function getProcedure<Api extends DomainApi, Method extends ApiMethod<Api>>(api: Api, method: Method): Api['procedures'][Method];
export function getProcedure(api: DomainApi, method: string) {
   const procedure = api.procedures[method];
   if (!procedure) throw new Error(`Unknown API procedure: ${api.namespace}.${method}`);

   return procedure;
}

export function getDownload<Api extends DomainApi, Method extends ApiDownloadMethod<Api>>(api: Api, method: Method): ApiDownload<Api, Method>;
export function getDownload(api: DomainApi, method: string) {
   const download = api.downloads?.[method];
   if (!download) throw new Error(`Unknown API download: ${api.namespace}.${method}`);

   return download;
}

export function getUpload<Api extends DomainApi, Method extends ApiUploadMethod<Api>>(api: Api, method: Method): ApiUpload<Api, Method>;
export function getUpload(api: DomainApi, method: string) {
   const upload = api.uploads?.[method];
   if (!upload) throw new Error(`Unknown API upload: ${api.namespace}.${method}`);

   return upload;
}

export function implementApi<Api extends DomainApi & { snapshot?: undefined; uploads?: undefined }>(
   api: Api,
   handlers: ApiHandlers<Api>
): ApiImplementation;
export function implementApi<Api extends DomainApi>(api: Api, handlers: ApiHandlers<Api>, extras: LocalApiExtras<Api>): ApiImplementation;
export function implementApi<Api extends DomainApi>(api: Api, handlers: ApiHandlers<Api>, extras?: LocalApiExtras<Api>): ApiImplementation {
   const subscribe = extras?.subscribe;

   return {
      api,
      procedures: eraseProcedures(api, handlers, (_targetId, input) => input),
      uploads: eraseUploads(api, extras?.uploads ?? {}, (_targetId, input) => input),
      downloads: eraseDownloads(api, extras?.downloads ?? {}, (_targetId, input) => input),
      subscribe:
         subscribe &&
         ((listener) => subscribe((snapshot) => listener({ targetId: localTargetId, snapshot: ipcTransportValueSchema.parse(snapshot) })))
   };
}

export function implementTargetApi<Api extends DomainApi>(
   api: Api,
   handlers: TargetApiHandlers<Api>,
   extras: TargetApiExtras<Api> = {}
): ApiImplementation {
   const subscribe = extras.subscribe;

   return {
      api,
      procedures: eraseProcedures(api, handlers, (targetId, input) => ({ ...input, targetId })),
      uploads: eraseUploads(api, extras.uploads ?? {}, (targetId, input) => ({ ...input, targetId })),
      downloads: eraseDownloads(api, extras.downloads ?? {}, (targetId, input) => ({ ...input, targetId })),
      subscribe:
         subscribe && ((listener) => subscribe(({ targetId, snapshot }) => listener({ targetId, snapshot: ipcTransportValueSchema.parse(snapshot) })))
   };
}

const erasedProcedureSchema = z.function({ input: [z.unknown()] }).optional();
const erasedUploadSchema = z.function({ input: [z.unknown(), z.custom<AsyncIterable<Uint8Array>>()] }).optional();
const uploadResultSchema = z.discriminatedUnion('status', [
   z.object({ status: z.literal('ok') }),
   z.object({
      status: z.literal('error'),
      error: z.object({ kind: z.enum(['invalid', 'not-found', 'unavailable']), code: z.string(), message: z.string() })
   })
]);

type ErasableHandlers = { readonly [method: string]: ((...args: never[]) => void) | undefined };

function eraseProcedures(api: DomainApi, handlers: ErasableHandlers, toInput: (targetId: TargetId, input: ApiInput) => ApiInput) {
   const handlerSchemas = Object.fromEntries(Object.keys(api.procedures).map((method) => [method, erasedProcedureSchema]));
   const procedures = new Map<string, (targetId: TargetId, input: ApiInput) => Promise<IpcTransportValue>>();
   for (const [method, handler] of Object.entries(z.object(handlerSchemas).parse(handlers))) {
      if (handler) procedures.set(method, async (targetId, input) => ipcHandlerReturnSchema.parse(await handler(toInput(targetId, input))));
   }

   return procedures;
}

function eraseUploads(api: DomainApi, handlers: ErasableHandlers, toInput: (targetId: TargetId, input: ApiInput) => ApiInput) {
   const handlerSchemas = Object.fromEntries(Object.keys(api.uploads ?? {}).map((method) => [method, erasedUploadSchema]));
   const uploads = new Map<string, (targetId: TargetId, input: ApiInput, source: AsyncIterable<Uint8Array>) => UploadResult>();
   for (const [method, handler] of Object.entries(z.object(handlerSchemas).parse(handlers))) {
      if (!handler) continue;
      uploads.set(method, async (targetId, input, source) => {
         const result = uploadResultSchema.parse(await handler(toInput(targetId, input), source));
         return result.status === 'ok' ? Result.ok(undefined) : Result.err(result.error);
      });
   }

   return uploads;
}

const erasedDownloadSchema = z.function({ input: [z.unknown()] }).optional();
const downloadResultSchema = z.discriminatedUnion('status', [
   z.object({
      status: z.literal('ok'),
      value: z.custom<AsyncIterable<Uint8Array>>()
   }),
   z.object({
      status: z.literal('error'),
      error: z.object({ kind: z.enum(['invalid', 'not-found', 'unavailable']), code: z.string(), message: z.string() })
   })
]);

function eraseDownloads(api: DomainApi, handlers: ErasableHandlers, toInput: (targetId: TargetId, input: ApiInput) => ApiInput) {
   const handlerSchemas = Object.fromEntries(Object.keys(api.downloads ?? {}).map((method) => [method, erasedDownloadSchema]));
   const downloads = new Map<string, (targetId: TargetId, input: ApiInput) => DownloadResult>();
   for (const [method, handler] of Object.entries(z.object(handlerSchemas).parse(handlers))) {
      if (!handler) continue;
      downloads.set(method, async (targetId, input) => {
         const result = downloadResultSchema.parse(await handler(toInput(targetId, input)));
         return result.status === 'ok' ? Result.ok(result.value) : Result.err(result.error);
      });
   }

   return downloads;
}
