import { spawn, type SpawnOptions } from 'node:child_process';
import { access, chmod, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const watchdogPath = dirname(fileURLToPath(import.meta.url));
const appPath = resolve(watchdogPath, '../..');
const outputDirectory = join(appPath, 'build', 'watchdog');

if (process.platform === 'darwin') process.exit(0);
if (process.platform !== 'linux' && process.platform !== 'win32') throw new Error(`unsupported watchdog build platform: ${process.platform}`);

const sourceFile = process.platform === 'linux' ? 'encore-watchdog-linux.c' : 'encore-watchdog-win.c';
const sourcePath = join(watchdogPath, sourceFile);

await mkdir(outputDirectory, { recursive: true });

if (process.platform === 'linux') {
   const outputPath = join(outputDirectory, 'encore-watchdog');
   const muslCompiler = (await commandExists('musl-gcc')) ? 'musl-gcc' : undefined;
   const compiler = muslCompiler ?? 'cc';
   await run([
      compiler,
      '-std=c11',
      '-Os',
      '-flto',
      '-ffunction-sections',
      '-fdata-sections',
      '-D_FORTIFY_SOURCE=2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-Wl,--gc-sections',
      ...(muslCompiler ? ['-static'] : []),
      '-s',
      sourcePath,
      '-o',
      outputPath
   ]);
   await chmod(outputPath, 0o755);
   process.exit(0);
}

const outputPath = join(outputDirectory, 'encore-watchdog.exe');
const compilerArguments = [
   '/nologo',
   '/std:c11',
   '/O1',
   '/GL',
   '/MT',
   '/W4',
   '/WX',
   '/DUNICODE',
   '/D_UNICODE',
   sourcePath,
   `/Fo:${join(outputDirectory, 'encore-watchdog.obj')}`,
   `/Fe:${outputPath}`,
   '/link',
   '/LTCG',
   '/OPT:REF',
   '/OPT:ICF',
   '/SUBSYSTEM:WINDOWS',
   'shell32.lib',
   'user32.lib'
];

if (await commandExists('cl.exe')) {
   await run(['cl.exe', ...compilerArguments]);
   process.exit(0);
}

const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
const vswherePath = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
if (!(await fileExists(vswherePath))) throw new Error('Visual Studio C++ build tools are required to package Encore on Windows');

const installationPath = (
   await capture([
      vswherePath,
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath'
   ])
).trim();
if (!installationPath) throw new Error('Visual Studio C++ build tools are required to package Encore on Windows');

const developerShell = join(installationPath, 'Common7', 'Tools', 'VsDevCmd.bat');
if (!(await fileExists(developerShell))) throw new Error('Visual Studio C++ build tools are required to package Encore on Windows');
await run(
   [
      'cmd.exe',
      '/d',
      '/s',
      '/c',
      `call "${developerShell}" -no_logo -arch=x64 -host_arch=x64 && cl.exe ${compilerArguments.map(quoteCommandArgument).join(' ')}`
   ],
   { windowsVerbatimArguments: true }
);

async function commandExists(command: string) {
   const lookup = process.platform === 'win32' ? ['where.exe', command] : ['sh', '-c', 'command -v -- "$1"', 'sh', command];
   return (await exitCode(lookup, { stdio: 'ignore' })) === 0;
}

async function fileExists(path: string) {
   return access(path).then(
      () => true,
      () => false
   );
}

function quoteCommandArgument(argument: string) {
   return `"${argument.replaceAll('"', '""')}"`;
}

async function capture(command: string[]) {
   const [executable, ...arguments_] = command;
   if (!executable) throw new Error('cannot run an empty command');

   const child = spawn(executable, arguments_, { stdio: ['ignore', 'pipe', 'inherit'] });
   child.stdout.setEncoding('utf8');

   let output = '';
   child.stdout.on('data', (chunk: string) => {
      output += chunk;
   });

   const code = await waitForExit(child, executable);
   if (code !== 0) throw new Error(`${executable} exited with code ${code}`);
   return output;
}

async function run(command: string[], options: Pick<SpawnOptions, 'windowsVerbatimArguments'> = {}) {
   const code = await exitCode(command, {
      cwd: appPath,
      stdio: 'inherit',
      ...options
   });
   if (code !== 0) throw new Error(`${command[0]} exited with code ${code}`);
}

async function exitCode(command: string[], options: SpawnOptions) {
   const [executable, ...arguments_] = command;
   if (!executable) throw new Error('cannot run an empty command');
   return waitForExit(spawn(executable, arguments_, options), executable);
}

function waitForExit(child: ReturnType<typeof spawn>, executable: string) {
   return new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
         if (code !== null) resolve(code);
         else reject(new Error(`${executable} exited from signal ${signal}`));
      });
   });
}
