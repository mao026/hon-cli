#!/usr/bin/env node

import { copyFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const commandOffset = args[0] === '-t' ? 2 : 0;
const command = args.slice(commandOffset);

if (command[0] === 'list' && command[1] === 'targets') {
  process.stdout.write('fake-device USB Connected localhost hdc\n');
} else if (command[0] === 'file' && command[1] === 'recv') {
  await copyFile(new URL('./layout.json', import.meta.url), command[3]);
  process.stdout.write('FileTransfer finish\n');
} else if (command[0] === 'shell') {
  if (command[1].includes('uitest --version')) process.stdout.write('6.0.2.2\n');
  else process.stdout.write('OK\n');
} else {
  process.stdout.write('OK\n');
}
