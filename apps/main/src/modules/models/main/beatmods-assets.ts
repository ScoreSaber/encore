import { Result } from 'better-result';
import { z } from 'zod';

import { fetchJsonResource, toCatalogProblem, type JsonDocumentFetch } from '@/lib/http/json';
import { resolveHttpsUrl } from '@/lib/http/url';
import { modelTypes, isCatalogModelType, type CatalogModelType, type CatalogModelSummary } from '@/modules/models/contract';
import { beatModsHost, beatModsOrigin } from '@/modules/mods/contract';

const assetsEndpoint = '/api/v3/assets';
const searchPageSize = 20;
const assetTypes = {
   avatar: 'avatar_avatar',
   bloq: 'note_bloq',
   platform: 'platform_plat',
   saber: 'saber_saber'
};

export const modelDownloadHosts = [beatModsHost];

const assetSchema = z.object({
   id: z.int().positive(),
   oldId: z.int().nullable(),
   gameName: z.literal('beatsaber'),
   type: z.string(),
   name: z.string(),
   uploader: z.object({ displayName: z.string(), username: z.string() }).nullable(),
   iconUrls: z.array(z.string()),
   fileHash: z.hash('md5').transform((hash) => hash.toLowerCase()),
   downloadUrl: z.string(),
   tags: z.array(z.string()),
   createdAt: z.string()
});

const resultsSchema = z.object({
   assets: z.array(assetSchema.nullable().catch(null)),
   total: z.int().nonnegative()
});

type ModelAsset = { summary: CatalogModelSummary; downloadUrl: string };

export function createBeatModsAssetCatalog(options: { fetchJson?: JsonDocumentFetch } = {}) {
   async function readJson<Output>(url: URL, schema: z.ZodType<Output>) {
      const result = await fetchJsonResource({ url: url.href, schema, fetchJson: options.fetchJson });
      return result.mapError(toCatalogProblem);
   }

   async function search(input: { type: CatalogModelType; query: string; page: number }) {
      const page = input.page + 1;
      const url = new URL(assetsEndpoint, beatModsOrigin);
      url.searchParams.set('type', assetTypes[input.type]);
      url.searchParams.set('page', String(page));
      url.searchParams.set('limit', String(searchPageSize));
      const query = input.query.trim();
      if (query) url.searchParams.set('name', query);

      const result = await readJson(url, resultsSchema);
      return result.map(({ assets, total }) => ({
         models: assets.flatMap((asset) => {
            const model = asset && toModel(asset);
            return model?.summary.type === input.type ? [model.summary] : [];
         }),
         hasMore: page * searchPageSize < total
      }));
   }

   async function getById(id: string): Promise<Result<ModelAsset, ReturnType<typeof toCatalogProblem>>> {
      const assetId = Number(id);
      const result = await readJson(new URL(`${assetsEndpoint}/${assetId}`, beatModsOrigin), assetSchema);
      if (Result.isError(result)) return Result.err(result.error);

      const asset = result.value;
      const model = toModel(asset);
      if (!model || (asset.id !== assetId && asset.oldId !== assetId)) return Result.err({ issue: 'invalid-response' });

      return Result.ok(model);
   }

   return { search, getById };
}

function toModel(asset: z.infer<typeof assetSchema>): ModelAsset | null {
   const type = modelTypes.find((type) => isCatalogModelType(type) && assetTypes[type] === asset.type);
   if (!type) return null;
   const download = resolveHttpsUrl(asset.downloadUrl, { allowedHosts: modelDownloadHosts });
   if (Result.isError(download)) return null;

   return {
      summary: {
         id: String(asset.id),
         type,
         name: asset.name.trim() || String(asset.id),
         author: asset.uploader?.displayName.trim() || asset.uploader?.username || '',
         hash: asset.fileHash,
         thumbnailUrl: asset.iconUrls[0] || null,
         tags: asset.tags,
         publishedAt: asset.createdAt,
         installed: false
      },
      downloadUrl: download.value.href
   };
}
