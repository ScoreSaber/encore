import { chmod, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const watchdogPath = dirname(fileURLToPath(import.meta.url));
const repositoryPath = resolve(watchdogPath, '../../../..');
const outputDirectory = join(repositoryPath, 'build', 'watchdog');

if (process.platform === 'darwin') process.exit(0);
if (process.platform !== 'linux' && process.platform !== 'win32') throw new Error(`unsupported watchdog build platform: ${process.platform}`);

const sourceFile = process.platform === 'linux' ? 'encore-watchdog-linux.c' : 'encore-watchdog-win.c';
const sourcePath = join(watchdogPath, sourceFile);

await mkdir(outputDirectory, { recursive: true });

if (process.platform === 'linux') {
   const outputPath = join(outputDirectory, 'encore-watchdog');
   const muslCompiler = Bun.which('musl-gcc');
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
if (!(await Bun.file(vswherePath).exists())) throw new Error('Visual Studio C++ build tools are required to package Encore on Windows');

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
if (!(await Bun.file(developerShell).exists())) throw new Error('Visual Studio C++ build tools are required to package Encore on Windows');
const compiler = Bun.spawn(
   [
      'cmd.exe',
      '/d',
      '/s',
      '/c',
      `call "${developerShell}" -no_logo -arch=x64 -host_arch=x64 && cl.exe ${compilerArguments.map(quoteCommandArgument).join(' ')}`
   ],
   {
      cwd: repositoryPath,
      stdout: 'inherit',
      stderr: 'inherit',
      windowsVerbatimArguments: true
   }
);
const compilerExitCode = await compiler.exited;
if (compilerExitCode !== 0) throw new Error(`cmd.exe exited with code ${compilerExitCode}`);

async function commandExists(command: string) {
   const process = Bun.spawn(['where.exe', command], { stdout: 'ignore', stderr: 'ignore' });
   return (await process.exited) === 0;
}

function quoteCommandArgument(argument: string) {
   return `"${argument.replaceAll('"', '""')}"`;
}

async function capture(command: string[]) {
   const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'inherit' });
   const output = await new Response(process.stdout).text();
   const exitCode = await process.exited;
   if (exitCode !== 0) throw new Error(`${command[0]} exited with code ${exitCode}`);
   return output;
}

async function run(command: string[]) {
   const process = Bun.spawn(command, { cwd: repositoryPath, stdout: 'inherit', stderr: 'inherit' });
   const exitCode = await process.exited;
   if (exitCode !== 0) throw new Error(`${command[0]} exited with code ${exitCode}`);
}
