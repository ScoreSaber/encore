import { Result } from 'better-result';
import { shell } from 'electron';
import { z } from 'zod';

import type { QuestBluetoothPower } from '@/modules/quest/contract';
import { childNodes, gdbus } from '@/modules/quest/main/quest-bluetooth-recovery';

import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

const metaUsbVendorId = 0x2833;

const macBluetoothSchema = z.object({
   SPBluetoothDataType: z.array(z.object({ controller_properties: z.object({ controller_state: z.string() }).optional() }))
});

function run(file: string, args: string[]) {
   return new Promise<Result<string, Error>>((resolve) => {
      execFile(file, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) =>
         resolve(error ? Result.err(error) : Result.ok(stdout))
      );
   });
}

function windowsRadio(turnOn: boolean) {
   const script = [
      "$ErrorActionPreference = 'Stop'",
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
      "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
      'function Await($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }',
      '[Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null',
      "$radio = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]) | Where-Object { $_.Kind -eq 'Bluetooth' } | Select-Object -First 1",
      "if (-not $radio) { 'Missing'; exit }",
      ...(turnOn
         ? [
              'Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null',
              "Await ($radio.SetStateAsync('On')) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null"
           ]
         : []),
      '[string]$radio.State'
   ].join('\n');
   return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

async function linuxAdapters() {
   const xml = await gdbus(['introspect', '--system', '--dest', 'org.bluez', '--object-path', '/org/bluez', '--xml']);
   return Result.map(xml, (value) =>
      childNodes(value)
         .filter((name) => /^hci\d+$/.test(name))
         .map((name) => `/org/bluez/${name}`)
   );
}

export async function readBluetoothPower(): Promise<QuestBluetoothPower> {
   if (process.platform === 'linux') {
      const adapters = await linuxAdapters();
      if (Result.isError(adapters)) return 'unknown';
      if (adapters.value.length === 0) return 'missing';
      for (const adapter of adapters.value) {
         const powered = await gdbus([
            'call',
            '--system',
            '--dest',
            'org.bluez',
            '--object-path',
            adapter,
            '--method',
            'org.freedesktop.DBus.Properties.Get',
            'org.bluez.Adapter1',
            'Powered'
         ]);
         if (Result.isOk(powered) && powered.value.trim() === '(<true>,)') return 'on';
      }
      return 'off';
   }

   if (process.platform === 'darwin') {
      const profile = await run('/usr/sbin/system_profiler', ['SPBluetoothDataType', '-json']);
      if (Result.isError(profile)) return 'unknown';
      const parsed = Result.try(() => macBluetoothSchema.parse(JSON.parse(profile.value)));
      if (Result.isError(parsed)) return 'unknown';
      const state = parsed.value.SPBluetoothDataType.find((entry) => entry.controller_properties)?.controller_properties?.controller_state;
      return state === 'attrib_on' ? 'on' : state === 'attrib_off' ? 'off' : 'missing';
   }

   if (process.platform === 'win32') {
      const state = await windowsRadio(false);
      if (Result.isError(state)) return 'unknown';
      const value = state.value.trim();
      return value === 'On' ? 'on' : value === 'Missing' ? 'missing' : 'off';
   }

   return 'unknown';
}

export async function turnOnBluetooth(): Promise<boolean> {
   if (process.platform === 'linux') {
      const adapters = await linuxAdapters();
      if (Result.isError(adapters)) return false;
      const results = await Promise.all(
         adapters.value.map((adapter) =>
            gdbus([
               'call',
               '--system',
               '--dest',
               'org.bluez',
               '--object-path',
               adapter,
               '--method',
               'org.freedesktop.DBus.Properties.Set',
               'org.bluez.Adapter1',
               'Powered',
               '<true>'
            ])
         )
      );
      return results.some(Result.isOk);
   }

   if (process.platform === 'win32') {
      const state = await windowsRadio(true);
      if (Result.isOk(state) && state.value.trim() === 'On') return true;
      await shell.openExternal('ms-settings:bluetooth');
      return false;
   }

   if (process.platform === 'darwin') await shell.openExternal('x-apple.systempreferences:com.apple.BluetoothSettings');
   return false;
}

export async function questPluggedIn() {
   if (process.platform === 'linux') {
      const entries = await Result.tryPromise(() => readdir('/sys/bus/usb/devices'));
      if (Result.isError(entries)) return false;
      const vendors = await Promise.all(
         entries.value.map((entry) => Result.tryPromise(() => readFile(`/sys/bus/usb/devices/${entry}/idVendor`, 'utf8')))
      );
      return vendors.some((vendor) => Result.isOk(vendor) && Number.parseInt(vendor.value, 16) === metaUsbVendorId);
   }

   if (process.platform === 'darwin') {
      const tree = await run('/usr/sbin/ioreg', ['-p', 'IOUSB', '-l', '-w0']);
      return Result.isOk(tree) && new RegExp(`"idVendor" = ${metaUsbVendorId}\\b`).test(tree.value);
   }

   if (process.platform === 'win32') {
      const devices = await run('pnputil.exe', ['/enum-devices', '/connected']);
      return Result.isOk(devices) && new RegExp(`VID_${metaUsbVendorId.toString(16)}`, 'i').test(devices.value);
   }

   return false;
}
