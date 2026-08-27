import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { HonError, EXIT } from './errors.mjs';
import { findNodes, flattenLayout, resolveNode, summary } from './selectors.mjs';

const REMOTE_DIR = '/data/local/tmp';

function remoteName(kind, extension) {
  return `${REMOTE_DIR}/hon-${kind}-${process.pid}-${Date.now()}.${extension}`;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export class UiSession {
  constructor(hdc) {
    this.hdc = hdc;
  }

  async layout({ bundle, all = false } = {}) {
    const remote = remoteName('layout', 'json');
    const directory = await mkdtemp(join(tmpdir(), 'hon-layout-'));
    const local = join(directory, 'layout.json');
    try {
      const args = ['uitest', 'dumpLayout', '-p', remote];
      if (bundle) args.push('-b', bundle);
      if (all) args.push('-i');
      await this.hdc.shell(args, { timeout: 30_000 });
      await this.hdc.recv(remote, local);
      let data;
      try {
        data = JSON.parse(await readFile(local, 'utf8'));
      } catch (error) {
        throw new HonError('BAD_LAYOUT', `无法解析鸿蒙控件树：${error.message}`);
      }
      return { raw: data, nodes: flattenLayout(data) };
    } finally {
      await this.hdc.shell(['rm', '-f', remote]).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  }

  async find(selector, options = {}) {
    const { nodes } = await this.layout(options);
    return resolveNode(nodes, selector, options);
  }

  async tap(selector, options = {}) {
    const coordinates = parseCoordinates(selector);
    const node = coordinates ? null : await this.find(selector, options);
    const [x, y] = coordinates ?? node.bounds.center;
    await this.hdc.shell(['uitest', 'uiInput', options.kind ?? 'click', x, y]);
    return { x, y, node: node ? summary(node) : undefined };
  }

  async fill(selector, text, options = {}) {
    const node = await this.find(selector, options);
    const [x, y] = node.bounds.center;
    await this.hdc.shell(['uitest', 'uiInput', 'inputText', x, y, text]);
    return { x, y, text, node: summary(node) };
  }

  async wait(selector, { timeout = 10_000, interval = 250, gone = false, ...options } = {}) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started <= timeout) {
      try {
        const { nodes } = await this.layout(options);
        const matches = findNodes(nodes, selector, options);
        if ((!gone && matches.length > 0) || (gone && matches.length === 0)) {
          return { elapsedMs: Date.now() - started, count: matches.length, node: matches[0] ? summary(matches[0]) : undefined };
        }
      } catch (error) {
        lastError = error;
      }
      await delay(interval);
    }
    throw new HonError('TIMEOUT', `${timeout}ms 内${gone ? '控件仍未消失' : '未等到控件'}：${selector}`, EXIT.TIMEOUT, {
      selector,
      timeout,
      cause: lastError?.message,
    });
  }

  async screenshot(output) {
    const destination = resolve(output ?? `hon-${Date.now()}.png`);
    const remote = remoteName('screen', 'png');
    try {
      await this.hdc.shell(['uitest', 'screenCap', '-p', remote], { timeout: 30_000 });
      await this.hdc.recv(remote, destination);
      return { path: destination, name: basename(destination) };
    } finally {
      await this.hdc.shell(['rm', '-f', remote]).catch(() => {});
    }
  }

  press(key) {
    return this.hdc.shell(['uitest', 'uiInput', 'keyEvent', key]);
  }

  swipe(fromX, fromY, toX, toY, velocity = 600, kind = 'swipe') {
    return this.hdc.shell(['uitest', 'uiInput', kind, fromX, fromY, toX, toY, velocity]);
  }
}

export function parseCoordinates(value) {
  const match = String(value).match(/^(-?\d+)\s*,\s*(-?\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}
