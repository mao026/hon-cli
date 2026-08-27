import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { EXIT, HonError } from '../src/errors.mjs';
import { findNodes, flattenLayout, parseBounds, resolveNode } from '../src/selectors.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/layout.json', import.meta.url), 'utf8'));
const nodes = flattenLayout(fixture);

test('parses HarmonyOS bounds and calculates center', () => {
  assert.deepEqual(parseBounds('[100,300][980,420]'), {
    left: 100, top: 300, right: 980, bottom: 420, width: 880, height: 120, center: [540, 360],
  });
});

test('normalizes a dumpLayout tree', () => {
  assert.equal(nodes.length, 4);
  assert.equal(nodes[1].type, 'TextInput');
  assert.equal(nodes[1].id, 'email');
  assert.equal(nodes[1].hint, '邮箱地址');
});

test('finds nodes with text and CSS-like selectors', () => {
  assert.equal(resolveNode(nodes, '登录').id, 'login_button');
  assert.equal(resolveNode(nodes, 'TextInput[hint~=邮箱]:visible').id, 'email');
  assert.equal(resolveNode(nodes, '[id=login_button]:clickable').text, '登录');
  assert.equal(resolveNode(nodes, 'Button:has-text("登录")').id, 'login_button');
});

test('plain selector falls back to substring', () => {
  assert.deepEqual(findNodes(nodes, '帮助').map((node) => node.text), ['登录帮助']);
});

test('reports ambiguous selectors with a stable exit code', () => {
  assert.throws(
    () => resolveNode(nodes, '[text~=登录]'),
    (error) => error instanceof HonError && error.code === 'AMBIGUOUS' && error.exitCode === EXIT.AMBIGUOUS,
  );
});
