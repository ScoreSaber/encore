import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Result } from 'better-result';
import jsQR from 'jsqr';
import { encode } from 'uqr';
import { useTranslations } from 'use-intl';

import { cn } from '@/components/utils';

import { readPairingLink } from '@/modules/receiver/contract';
import { runsOnSteamFrame } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

const quietZone = 4;
const scanSquare = 900;
const scanIntervalMs = 150;

type ScannerState = 'initializing' | 'scanning' | 'failed';

export function PairingQrCode({ value, className }: { value: string; className?: string }) {
   const { data, size } = encode(value, { ecc: 'L', border: quietZone });
   const path = data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ''))).join('');

   return (
      <svg
         viewBox={`0 0 ${size} ${size}`}
         className={cn('shrink-0 rounded-md bg-[#7ab8ff] [shape-rendering:crispEdges]', className)}
         aria-hidden="true"
      >
         <path d={path} fill="#000" />
      </svg>
   );
}

export function useCameraAvailable() {
   const devices = useQuery({
      queryKey: ['media', 'videoinput'],
      queryFn: async () => (await navigator.mediaDevices?.enumerateDevices())?.some((device) => device.kind === 'videoinput') ?? false,
      enabled: !window.encore.scanPairingQr,
      staleTime: 60_000
   });
   return Boolean(window.encore.scanPairingQr) || (devices.data ?? false);
}

export function PairingScanner({ onScan }: { onScan: (link: { host: string; code: string }) => void }) {
   const t = useTranslations('settings.remote.setup.scan');
   const { targets } = useTargets();
   const video = useRef<HTMLVideoElement>(null);
   const [scannerState, setScannerState] = useState<ScannerState>('initializing');
   const scanned = useEffectEvent(onScan);

   useEffect(() => {
      const element = video.current;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      let stream: MediaStream | null = null;
      let timer = 0;
      let stopped = false;

      const stopStream = () => {
         for (const track of stream?.getTracks() ?? []) track.stop();
         stream = null;
      };

      const scan = () => {
         if (stopped || !element || !context) return;
         if (element.videoWidth > 0) {
            const side = Math.min(scanSquare, element.videoWidth, element.videoHeight);
            canvas.width = side;
            canvas.height = side;
            context.drawImage(element, (element.videoWidth - side) / 2, (element.videoHeight - side) / 2, side, side, 0, 0, side, side);
            const found = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, {
               inversionAttempts: 'dontInvert'
            });
            const link = found ? readPairingLink(found.data) : null;
            if (link) {
               scanned(link);
               return;
            }
         }
         timer = window.setTimeout(scan, scanIntervalMs);
      };

      const start = async () => {
         const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
         const camera = cameras.find((device) => device.label.includes('SteamVR')) ?? cameras[0];
         const opened = await navigator.mediaDevices.getUserMedia({
            video: camera ? { deviceId: { exact: camera.deviceId } } : true,
            audio: false
         });
         if (stopped || !element) {
            for (const track of opened.getTracks()) track.stop();
            return;
         }
         stream = opened;
         element.srcObject = opened;
         await element.play();
         if (stopped) {
            stopStream();
            return;
         }
         setScannerState('scanning');
         scan();
      };

      void Result.tryPromise(() => start()).then((started) => {
         if (Result.isError(started)) {
            stopStream();
            if (!stopped) setScannerState('failed');
         }
      });

      return () => {
         stopped = true;
         window.clearTimeout(timer);
         stopStream();
      };
   }, []);

   return (
      <div className="flex flex-col gap-2">
         <video ref={video} muted playsInline className="bg-muted aspect-video w-full rounded-lg object-cover" />
         <p className={scannerState === 'failed' ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
            {t(scannerState === 'failed' ? 'failed' : runsOnSteamFrame(targets) ? 'frameHint' : 'hint')}
         </p>
      </div>
   );
}
