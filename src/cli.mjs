import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { asHonError, HonError, EXIT } from './errors.mjs';
import { HdcClient } from './hdc.mjs';
import { label, summary } from './selectors.mjs';
import { UiSession } from './session.mjs';

const HELP = `hon - 面向人和 Agent 的鸿蒙自动化 CLI

用法:
  hon devices [-v]                         列出 HDC 设备
  hon doctor                               检查 HDC、设备和 uitest
  hon ui [--all] [--bundle NAME]           输出扁平控件表
  hon dump [--bundle NAME]                 输出原始控件树 JSON
  hon tap <选择器|x,y>                     点击控件或坐标
  hon double-tap <选择器|x,y>              双击
  hon long-tap <选择器|x,y>                长按
  hon fill <选择器> <文本>                 定位输入框并输入
  hon wait <选择器> [--timeout 10s]        等待控件出现
  hon wait <选择器> --gone                 等待控件消失
  hon screenshot [文件.png]                截图并拉取到本机
  hon press <Back|Home|Power|KEY_ID>        注入按键
  hon swipe <x1> <y1> <x2> <y2> [速度]     滑动
  hon drag <x1> <y1> <x2> <y2> [速度]      拖拽
  hon app start <bundle> <ability>          启动应用
  hon app stop <bundle>                     停止应用
  hon install <app.hap>                     安装 HAP
  hon uninstall <bundle>                    卸载应用
  hon run <脚本|->                          批量执行命令

全局选项:
  -s, --serial ID      指定设备
  --json               输出单行 JSON
  --first              多匹配时使用第一个控件（默认报错）
  --hidden             允许匹配不可见控件

选择器:
  "登录"                                  文本/描述/hint/id
  Button:has-text("登录")                 类型 + 文本
  TextInput[hint~=邮箱]:visible            属性 + 状态
  [id=login_button]:clickable              id + 状态

退出码: 0 成功, 1 失败, 2 未找到, 3 超时, 4 多匹配, 64 用法错误`;

const COMMAND_ALIASES = Object.freeze({
  see: 'screenshot',
  type: 'fill',
  use: 'doctor',
});

function parseDuration(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) throw new HonError('BAD_DURATION', `无效时间：${value}`, EXIT.USAGE);
  const factor = match[2] === 'm' ? 60_000 : match[2] === 's' ? 1_000 : 1;
  return Math.round(Number(match[1]) * factor);
}

function parseArguments(argv) {
  const flags = {
    json: false,
    all: false,
    unique: true,
    visible: true,
    gone: false,
    verbose: false,
    timeout: 10_000,
    interval: 250,
  };
  const positional = [];
  const valueFlags = new Map([
    ['--serial', 'serial'], ['-s', 'serial'], ['--bundle', 'bundle'],
    ['--timeout', 'timeout'], ['--interval', 'interval'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (valueFlags.has(arg)) {
      const value = argv[++index];
      if (value === undefined) throw new HonError('USAGE', `${arg} 缺少参数`, EXIT.USAGE);
      const key = valueFlags.get(arg);
      flags[key] = key === 'timeout' || key === 'interval' ? parseDuration(value) : value;
    } else if (arg === '--json') flags.json = true;
    else if (arg === '--all') flags.all = true;
    else if (arg === '--first') flags.unique = false;
    else if (arg === '--hidden') flags.visible = false;
    else if (arg === '--gone') flags.gone = true;
    else if (arg === '--verbose' || arg === '-v') flags.verbose = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' || arg === '-V') flags.version = true;
    else positional.push(arg);
  }
  return { flags, positional };
}

function requireArgs(args, count, usage) {
  if (args.length < count) throw new HonError('USAGE', `用法：${usage}`, EXIT.USAGE);
}

function success(command, data = {}, human = '') {
  return { command, data, human };
}

function actionable(node) {
  return node.clickable || node.longClickable || node.scrollable || /Button|Input|TextArea|Checkbox|Switch|Radio/i.test(node.type);
}

function renderUi(nodes, all) {
  const visibleNodes = nodes.filter((node) => node.bounds && node.visible && (all || actionable(node)) && (all || label(node)));
  return visibleNodes.map((node) => {
    const verb = /Input|TextArea|EditText/i.test(node.type) ? 'fill' : node.clickable ? 'tap ' : 'view';
    const type = node.type.split('.').at(-1).padEnd(14);
    const text = JSON.stringify(label(node)).padEnd(24);
    const id = node.id ? `#${node.id}` : '-';
    const point = node.bounds.center.join(',');
    const states = [node.enabled ? '' : 'disabled', node.checked ? 'checked' : '', node.scrollable ? 'scrollable' : '']
      .filter(Boolean)
      .join(',');
    return `${verb}  ${type} ${text} ${id}  ${point}${states ? `  [${states}]` : ''}`;
  }).join('\n');
}

async function doctor(hdc) {
  const devices = await hdc.devices(true);
  if (devices.length === 0) {
    throw new HonError('NO_DEVICE', '未发现已连接的鸿蒙设备。请开启 USB 调试或无线调试。');
  }
  if (!hdc.serial && devices.length > 1) {
    throw new HonError('MULTIPLE_DEVICES', `发现 ${devices.length} 台设备，请使用 --serial 指定目标。`, 1, { devices });
  }
  const version = await hdc.shell(['uitest', '--version']);
  const apiVersion = await hdc.shell(['param', 'get', 'const.ohos.apiversion']).catch(() => 'unknown');
  const testMode = await hdc.shell(['param', 'get', 'persist.ace.testmode.enabled']).catch(() => 'unknown');
  return success('doctor', { devices, uitest: version, apiVersion, arkuiTestMode: testMode }, [
    `device   ${hdc.serial ?? devices[0].split(/\s+/)[0]}`,
    `uitest   ${version || 'available'}`,
    `api      ${apiVersion || 'unknown'}`,
    `testmode ${testMode || 'unknown'}`,
  ].join('\n'));
}

async function execute(rawArgv, context = {}) {
  const { flags, positional } = parseArguments(rawArgv);
  if (flags.version) return success('version', { version: '0.1.0' }, 'hon 0.1.0');
  if (flags.help || positional.length === 0 || positional[0] === 'help') return success('help', {}, HELP);

  const command = COMMAND_ALIASES[positional[0]] ?? positional[0];
  const args = positional.slice(1);
  const hdc = context.hdc ?? new HdcClient({ serial: flags.serial });
  if (flags.serial && context.hdc) hdc.serial = flags.serial;
  const session = context.session ?? new UiSession(hdc);
  const findOptions = { bundle: flags.bundle, all: flags.all, unique: flags.unique, visible: flags.visible };

  switch (command) {
    case 'devices': {
      const devices = await hdc.devices(flags.verbose);
      return success(command, { devices }, devices.length ? devices.join('\n') : '[Empty]');
    }
    case 'doctor':
      return doctor(hdc);
    case 'ui': {
      const { nodes } = await session.layout(findOptions);
      const items = nodes.filter((node) => node.bounds && node.visible && (flags.all || actionable(node)) && (flags.all || label(node))).map(summary);
      return success(command, { count: items.length, nodes: items }, renderUi(nodes, flags.all));
    }
    case 'dump': {
      const { raw } = await session.layout(findOptions);
      return success(command, { layout: raw }, JSON.stringify(raw, null, 2));
    }
    case 'tap':
    case 'double-tap':
    case 'long-tap': {
      requireArgs(args, 1, `hon ${command} <选择器|x,y>`);
      const kind = command === 'double-tap' ? 'doubleClick' : command === 'long-tap' ? 'longClick' : 'click';
      const result = await session.tap(args[0], { ...findOptions, kind });
      return success(command, result, `${kind} ${result.x},${result.y}`);
    }
    case 'fill': {
      requireArgs(args, 2, 'hon fill <选择器> <文本>');
      const result = await session.fill(args[0], args.slice(1).join(' '), findOptions);
      return success(command, result, `fill ${result.x},${result.y}`);
    }
    case 'wait': {
      requireArgs(args, 1, 'hon wait <选择器> [--timeout 10s] [--gone]');
      const result = await session.wait(args[0], { ...findOptions, timeout: flags.timeout, interval: flags.interval, gone: flags.gone });
      return success(command, result, flags.gone ? `gone ${args[0]}` : `found ${args[0]} (${result.elapsedMs}ms)`);
    }
    case 'screenshot': {
      const result = await session.screenshot(args[0]);
      return success(command, result, result.path);
    }
    case 'press': {
      requireArgs(args, 1, 'hon press <Back|Home|Power|KEY_ID>');
      await session.press(args[0]);
      return success(command, { key: args[0] }, `press ${args[0]}`);
    }
    case 'swipe':
    case 'drag': {
      requireArgs(args, 4, `hon ${command} <x1> <y1> <x2> <y2> [速度]`);
      const values = args.slice(0, 5).map(Number);
      if (values.some(Number.isNaN)) throw new HonError('USAGE', '坐标和速度必须是数字', EXIT.USAGE);
      await session.swipe(values[0], values[1], values[2], values[3], values[4] ?? 600, command);
      return success(command, { from: values.slice(0, 2), to: values.slice(2, 4), velocity: values[4] ?? 600 }, command);
    }
    case 'app': {
      requireArgs(args, 2, 'hon app <start|stop> ...');
      if (args[0] === 'start') {
        requireArgs(args, 3, 'hon app start <bundle> <ability>');
        const output = await hdc.shell(['aa', 'start', '-b', args[1], '-a', args[2]]);
        return success(command, { action: 'start', bundle: args[1], ability: args[2], output }, output || `started ${args[1]}`);
      }
      if (args[0] === 'stop') {
        const output = await hdc.shell(['aa', 'force-stop', args[1]]);
        return success(command, { action: 'stop', bundle: args[1], output }, output || `stopped ${args[1]}`);
      }
      throw new HonError('USAGE', `未知 app 操作：${args[0]}`, EXIT.USAGE);
    }
    case 'install': {
      requireArgs(args, 1, 'hon install <app.hap>');
      const path = resolve(args[0]);
      const output = await hdc.run(['install', path], { timeout: 120_000 });
      return success(command, { path, output }, output || `installed ${path}`);
    }
    case 'uninstall': {
      requireArgs(args, 1, 'hon uninstall <bundle>');
      const output = await hdc.run(['uninstall', args[0]], { timeout: 60_000 });
      return success(command, { bundle: args[0], output }, output || `uninstalled ${args[0]}`);
    }
    case 'run':
      return runScript(args[0] ?? '-', flags, { hdc, session });
    default:
      throw new HonError('USAGE', `未知命令：${command}\n运行 hon --help 查看用法。`, EXIT.USAGE);
  }
}

export function splitCommand(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;
  let started = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      started = true;
    } else if (char === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
      started = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (escaped) current += '\\';
  if (quote) throw new HonError('BAD_SCRIPT', '脚本命令引号未闭合', EXIT.USAGE);
  if (started) tokens.push(current);
  return tokens;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function runScript(path, flags, context) {
  const source = path === '-' ? await readStdin() : await readFile(resolve(path), 'utf8');
  let defaultTimeout = flags.timeout;
  let continueOnError = false;
  const results = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('set ')) {
      const directive = line.slice(4).trim();
      if (directive.startsWith('timeout=')) defaultTimeout = parseDuration(directive.slice(8));
      else if (directive === 'continue-on-error') continueOnError = true;
      else throw new HonError('BAD_SCRIPT', `第 ${index + 1} 行未知设置：${directive}`, EXIT.USAGE);
      continue;
    }
    try {
      const argv = splitCommand(line);
      if (!argv.includes('--timeout')) argv.push('--timeout', `${defaultTimeout}ms`);
      const result = await execute(argv, context);
      results.push({ line: index + 1, command: line, ok: true, data: result.data });
    } catch (error) {
      const honError = asHonError(error);
      results.push({ line: index + 1, command: line, ok: false, error: { code: honError.code, message: honError.message } });
      if (!continueOnError) throw new HonError(honError.code, `脚本第 ${index + 1} 行失败：${honError.message}`, honError.exitCode, { results });
    }
  }
  const failures = results.filter((item) => !item.ok).length;
  if (failures) throw new HonError('SCRIPT_FAILED', `${failures} 条命令失败`, EXIT.FAILURE, { results });
  return success('run', { count: results.length, results }, `ok ${results.length} commands`);
}

function render(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, command: result.command, ...result.data })}\n`);
  } else if (result.human) {
    process.stdout.write(`${result.human}\n`);
  }
}

export async function main(argv) {
  const wantsJson = argv.includes('--json');
  try {
    const result = await execute(argv);
    render(result, wantsJson);
    return EXIT.OK;
  } catch (error) {
    const honError = asHonError(error);
    if (wantsJson) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: { code: honError.code, message: honError.message, details: honError.details },
      })}\n`);
    } else {
      process.stderr.write(`hon: ${honError.code}: ${honError.message}\n`);
    }
    return honError.exitCode;
  }
}
