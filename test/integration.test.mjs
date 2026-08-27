import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const cli = new URL('../bin/hon.mjs', import.meta.url);
const fakeHdc = new URL('./fixtures/fake-hdc.mjs', import.meta.url);
await chmod(fakeHdc, 0o755);

async function run(args) {
  return execFileAsync(process.execPath, [cli.pathname, ...args], {
    env: { ...process.env, HDC_PATH: fakeHdc.pathname },
    encoding: 'utf8',
  });
}

test('CLI completes semantic tap flow and emits one JSON line', async () => {
  const { stdout, stderr } = await run(['tap', '登录', '--json']);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.command, 'tap');
  assert.deepEqual([result.x, result.y], [540, 560]);
  assert.equal(result.node.id, 'login_button');
});

test('CLI emits structured NOT_FOUND and exits with code 2', async () => {
  await assert.rejects(
    run(['tap', '不存在', '--json']),
    (error) => {
      assert.equal(error.code, 2);
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'NOT_FOUND');
      return true;
    },
  );
});
