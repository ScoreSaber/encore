import type { DownloadRequestBody } from '@/modules/downloads/contract';
import type { OculusDownloader } from '@/modules/downloads/main/oculus-downloader';
import type { SteamDownloader } from '@/modules/downloads/main/steam-downloader';

export function createDownloadService(options: { steam: SteamDownloader; oculus: OculusDownloader }) {
   function downloader(store: DownloadRequestBody['store']) {
      return store === 'oculus' ? options.oculus : options.steam;
   }

   return {
      getCatalog: options.steam.getCatalog,
      refreshCatalog: options.steam.refreshCatalog,
      preview: (request: DownloadRequestBody) => downloader(request.store).preview(request.version),
      start: (request: DownloadRequestBody) => downloader(request.store).start(request.version)
   };
}
