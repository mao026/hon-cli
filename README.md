# hon

面向人和 AI Agent 的 HarmonyOS / OpenHarmony UI 自动化 CLI。设计思路参考
[handsets](https://github.com/elliotgao2/handsets)：先把当前界面压缩成稳定、可读的控件列表，再用文本或选择器完成点击、输入和等待。

```console
$ hon ui
fill  TextInput      "邮箱地址"               #email  540,360
tap   Button         "登录"                  #login_button  540,560

$ hon fill "TextInput[hint~=邮箱]" "user@example.com"
fill 540,360
$ hon tap "登录"
click 540,560
$ hon wait "首页" --timeout 15s
found 首页 (508ms)
```

## 当前能力

- 通过 `hdc` 自动发现或指定 HarmonyOS / OpenHarmony 设备
- 使用系统自带 `uitest dumpLayout` 获取并归一化 ArkUI 控件树
- 文本选择器和 Playwright 风格选择器
- `tap`、`double-tap`、`long-tap`、`fill`、`wait`、`press`、`swipe`、`drag`
- 截图拉取、HAP 安装、应用启动和停止
- 面向 Agent 的 `--json` 稳定输出与明确退出码
- `.hon` 批处理脚本，不经过 shell 执行
- 宿主机零运行时依赖，仅需要 Node.js 20+ 和 HarmonyOS SDK 中的 `hdc`

## 安装

确保 HarmonyOS SDK 的 `toolchains` 目录已加入 `PATH`：

```bash
hdc list targets
node --version
```

在本仓库中注册全局命令：

```bash
npm link
hon doctor
```

也可以不注册，直接运行：

```bash
node bin/hon.mjs doctor
```

连接多台设备时使用 `--serial`：

```bash
hon devices -v
hon ui --serial 127.0.0.1:5555
```

部分 OpenHarmony 设备若无法生成 ArkUI 控件树，需要先启用测试模式并重启设备：

```bash
hdc shell param set persist.ace.testmode.enabled 1
```

## 常用命令

```bash
hon ui                               # 仅显示可操作控件
hon ui --all                         # 显示全部可见控件
hon dump --json                      # 原始控件树放入 JSON 输出
hon tap "继续"
hon tap 540,860                      # 也支持坐标
hon fill '[id=email]' 'me@example.com'
hon wait 'Text:has-text("欢迎")' --timeout 15s
hon wait '加载中' --gone
hon screenshot result.png
hon press Back
hon swipe 540 1800 540 500 800
hon app start com.example.demo EntryAbility
hon app stop com.example.demo
hon install entry-default-signed.hap
```

默认要求选择器只匹配一个可见控件。匹配多个控件时返回退出码 `4`，可显式使用
`--first` 选择第一个；需要操作不可见节点时使用 `--hidden`。

## 选择器

纯文本依次匹配 `text`、`description`、`hint`、`id`。先精确匹配，无结果时再做包含匹配。

```text
"登录"
Button:has-text("登录")
TextInput[hint~=邮箱]:visible
[id=login_button]:clickable
Text[text^=欢迎]
```

属性操作符：`=`、`~=`、`^=`、`$=`。支持状态：`:visible`、`:clickable`、
`:enabled`、`:focused`、`:checked`、`:selected`、`:scrollable`、`:checkable`、
`:longClickable`，以及 `:has-text("...")` 和 `:text-is("...")`。

## Agent 输出

`--json` 始终输出一行 JSON：

```console
$ hon tap 登录 --json
{"ok":true,"command":"tap","x":540,"y":560,"node":{"type":"Button","text":"登录","description":"","id":"login_button","center":[540,560]}}
```

错误也保持结构化：

```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"未找到控件：登录"}}
```

退出码：`0` 成功、`1` 通用失败、`2` 未找到、`3` 超时、`4` 多匹配、`64` 参数错误。

## 批处理

示例见 [`examples/login.hon`](examples/login.hon)：

```bash
hon run examples/login.hon --serial <device-id>
```

脚本每行是一条 `hon` 子命令，支持单双引号、注释和两个设置：

```text
set timeout=15s
set continue-on-error
```

解析器不会把脚本交给系统 shell，测试数据中的 `$()`、反引号或分号不会在宿主机执行。

## 架构

```text
hon CLI
  ├─ 参数、JSON 输出、退出码、批处理
  ├─ UiSession：dump / find / tap / fill / wait / screenshot
  ├─ Selector：控件树归一化和语义选择器
  └─ HdcClient
       └─ hdc shell uitest + hdc file recv
```

当前版本优先交付一个不需要安装设备端 HAP 或 daemon 的 MVP。与 `handsets` 相比，每次语义动作仍需执行
`dumpLayout` 并传输 JSON，因此延迟主要受 `hdc` 和系统 `uitest` 影响。下一阶段可在保持 CLI 契约不变的前提下，增加设备侧常驻 RPC、控件树增量缓存和实时 TUI。

## 开发

```bash
npm test
npm run check
```

测试使用真实 `dumpLayout` 字段格式的 fixture 和注入式 HDC 适配器，不要求连接真机。
