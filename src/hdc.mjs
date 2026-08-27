import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { HonError } from './errors.mjs';

const execFileAsync = promisify(execFile);

export function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", `'"'"'`)}'`;
}

export class HdcClient {
  constructor({ serial, executable = process.env.HDC_PATH || 'hdc', runner } = {}) {
    this.serial = serial;
    this.executable = executable;
    this.runner = runner ?? this.#defaultRunner.bind(this);
  }

  async #defaultRunner(executable, args, options = {}) {
    try {
      return await execFileAsync(executable, args, {
        encoding: options.encoding ?? 'utf8',
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
        timeout: options.timeout ?? 30_000,
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new HonError('HDC_NOT_FOUND', `找不到 hdc：${executable}。请安装 HarmonyOS SDK 并将 toolchains 加入 PATH。`);
      }
      const stderr = String(error.stderr ?? '').trim();
      const stdout = String(error.stdout ?? '').trim();
      throw new HonError('HDC_FAILED', stderr || stdout || error.message, 1, {
        command: [executable, ...args],
        status: error.code,
      });
    }
  }

  args(args, { target = true } = {}) {
    return target && this.serial ? ['-t', this.serial, ...args] : args;
  }

  async run(args, options) {
    const result = await this.runner(this.executable, this.args(args), options);
    return String(result.stdout ?? '').trim();
  }

  async shell(args, options) {
    const command = args.map(shellQuote).join(' ');
    return this.run(['shell', command], options);
  }

  async devices(verbose = false) {
    const output = await this.runner(
      this.executable,
      ['list', 'targets', ...(verbose ? ['-v'] : [])],
      { encoding: 'utf8' },
    );
    return String(output.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line !== '[Empty]');
  }

  recv(remote, local) {
    return this.run(['file', 'recv', remote, local], { timeout: 60_000 });
  }

  send(local, remote) {
    return this.run(['file', 'send', local, remote], { timeout: 60_000 });
  }
}
