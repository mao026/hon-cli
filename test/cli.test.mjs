import assert from 'node:assert/strict';
import test from 'node:test';

import { splitCommand } from '../src/cli.mjs';

test('splits batch commands with shell-like quoting but no shell execution', () => {
  assert.deepEqual(splitCommand('fill "TextInput[hint~=邮箱]" "hello world"'), [
    'fill', 'TextInput[hint~=邮箱]', 'hello world',
  ]);
  assert.deepEqual(splitCommand("tap '[id=login_button]' --first"), [
    'tap', '[id=login_button]', '--first',
  ]);
});
