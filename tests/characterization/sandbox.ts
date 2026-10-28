/**
 * Boots a real DVinyl process for one characterization test file.
 *
 * The app resolves its uploads and plugins folders from its own source location, and at
 * boot it deletes uploads no item references and re-grows custom plugin folders from the
 * database. Started from the repository against an empty database, it would therefore
 * delete the images of any instance sharing `public/uploads`. Each app instance runs from
 * a private copy of the source tree instead, with only `node_modules` linked back.
 */

import { spawn, execFileSync, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Backend } from './backend';
import { Client } from './client';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BOOT_TIMEOUT_MS = 60_000;

export interface App {
  baseUrl: string;
  root: string;
  /** A fresh client with no session. */
  client(): Client;
  /** What the process printed so far, for failure messages. */
  logs(): string;
  stop(): Promise<void>;
}

/** Copies a working tree (tracked and new files, ignored ones excepted). */
function copySourceTree(target: string, from: string): void {
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: from
  }).toString('utf8');
  for (const relative of listing.split('\0')) {
    if (!relative) continue;
    const source = path.join(from, relative);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(target, 'node_modules'), 'dir');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Only what a process needs to run: provider keys, AI settings and OIDC from the
 * developer's shell must not leak in, or sources would turn on and reach the network.
 */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

/**
 * `sourceRoot` runs another checkout instead of this one (an older release, to see what
 * upgrading from it does); it shares this one's node_modules.
 */
export async function startApp(
  backend: Backend,
  extraEnv: Record<string, string> = {},
  options: { sourceRoot?: string } = {}
): Promise<App> {
  await backend.reset();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvinyl-char-'));
  copySourceTree(root, options.sourceRoot || REPO_ROOT);
  const port = await freePort();

  let output = '';
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'app.ts'], {
    cwd: root,
    env: {
      ...baseEnv(),
      ...backend.env,
      VINYL_PORT: String(port),
      BASE_URL: '',
      PROD: 'false',
      PASSJWT: 'characterization-jwt-secret',
      SESSION_SECRET: 'characterization-session-secret',
      // Push notifications are prepared but never leave the machine.
      PUSH_DRY_RUN: 'true',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout!.on('data', chunk => { output += chunk; });
  child.stderr!.on('data', chunk => { output += chunk; });

  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  };

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (!/\[BOOT\] Server started/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      await stop();
      throw new Error(`DVinyl did not boot:\n${output.slice(-4000)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    root,
    client: () => new Client(baseUrl),
    logs: () => output,
    stop
  };
}
