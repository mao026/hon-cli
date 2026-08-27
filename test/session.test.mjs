import assert from 'node:assert/strict';
import { copyFile } from 'node:fs/promises';
import test from 'node:test';

import { UiSession } from '../src/session.mjs';

class FakeHdc {
  constructor() {
    this.commands = [];
  }

  async shell(args) {
    this.commands.push(args.map(String));
    return 'OK';
  }

  async recv(_remote, local) {
    await copyFile(new URL('./fixtures/layout.json', import.meta.url), local);
    return 'OK';
  }
}

test('taps a semantic selector at the normalized node center', async () => {
  const hdc = new FakeHdc();
  const session = new UiSession(hdc);
  const result = await session.tap('登录');
  assert.deepEqual([result.x, result.y], [540, 560]);
  assert.deepEqual(hdc.commands.at(-1), ['uitest', 'uiInput', 'click', '540', '560']);
});

test('fills a field using uitest inputText coordinates', async () => {
  const hdc = new FakeHdc();
  const session = new UiSession(hdc);
  const result = await session.fill('[id=email]', 'user@example.com');
  assert.deepEqual([result.x, result.y], [540, 360]);
  assert.deepEqual(hdc.commands.at(-1), ['uitest', 'uiInput', 'inputText', '540', '360', 'user@example.com']);
});

test('supports direct coordinate taps without fetching the layout', async () => {
  const hdc = new FakeHdc();
  const session = new UiSession(hdc);
  await session.tap('12,34');
  assert.deepEqual(hdc.commands, [['uitest', 'uiInput', 'click', '12', '34']]);
});
