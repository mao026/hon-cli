import assert from 'node:assert/strict';
import test from 'node:test';

import { HdcClient, shellQuote } from '../src/hdc.mjs';

test('quotes shell arguments without allowing command injection', () => {
  assert.equal(shellQuote('hello world'), "'hello world'");
  assert.equal(shellQuote("it's safe"), "'it'\"'\"'s safe'");
  assert.equal(shellQuote('a; rm -rf /'), "'a; rm -rf /'");
});

test('adds the selected target and sends a single safe shell command', async () => {
  const calls = [];
  const hdc = new HdcClient({
    serial: 'device-1',
    runner: async (executable, args) => {
      calls.push({ executable, args });
      return { stdout: 'OK\n', stderr: '' };
    },
  });
  const output = await hdc.shell(['uitest', 'uiInput', 'text', 'hello world']);
  assert.equal(output, 'OK');
  assert.deepEqual(calls[0], {
    executable: 'hdc',
    args: ['-t', 'device-1', 'shell', "uitest uiInput text 'hello world'"],
  });
});

test('device listing is never scoped to the selected target', async () => {
  const hdc = new HdcClient({
    serial: 'device-1',
    runner: async (_executable, args) => {
      assert.deepEqual(args, ['list', 'targets', '-v']);
      return { stdout: 'device-1 USB Connected\n\n', stderr: '' };
    },
  });
  assert.deepEqual(await hdc.devices(true), ['device-1 USB Connected']);
});
