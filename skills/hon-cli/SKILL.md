---
name: hon-cli
description: 使用 hon CLI 检查、读取和自动操作 HarmonyOS / OpenHarmony 设备与应用，包括 ArkUI 控件树、点击、输入、等待、截图、按键、滑动、HAP 安装和应用启停。
---

# hon-cli

使用 `hon` 通过 HDC 和系统 `uitest` 操作 HarmonyOS / OpenHarmony 设备。Agent 调用时始终添加 `--json`，根据 `ok`、错误 `code` 和进程退出码判断结果，不解析中文消息。

## 基本流程

通常直接观察当前界面，不要每次任务都先运行 `doctor`：

```bash
hon ui --json
```

然后执行语义操作，并等待或重新观察界面：

```bash
hon fill '[id=email]' 'user@example.com' --json
hon tap '登录' --json
hon wait '首页' --timeout 15s --json
hon ui --json
```

只有命令返回 HDC、设备或 `uitest` 相关错误时才运行：

```bash
hon doctor --json
```

## 设备选择

连接设备未知或出现多设备错误时：

```bash
hon devices --json
hon devices --verbose --json
```

多台设备时，从结果中取得设备 ID，并在后续每条命令中使用同一个 `--serial`：

```bash
hon ui --serial <device-id> --json
hon tap '继续' --serial <device-id> --json
```

不能猜测设备 ID，也不能在多设备之间隐式切换。

## 观察界面

```bash
hon ui --json
hon ui --all --json
hon dump --json
hon screenshot /tmp/hon-screen.png --json
```

优先使用 `ui` 获取紧凑控件列表；缺少目标或需要理解非交互节点时使用 `ui --all`；只有需要原始控件树时使用 `dump`。截图必须写入文件，再使用宿主 Agent 的图片读取能力查看，不要把图片转成 base64 塞入上下文。

## 定位控件

选择器优先级：

1. 唯一且稳定的 id：`[id=login_button]`
2. 唯一的精确文本：`登录`
3. 类型、属性和状态组合：`TextInput[hint~=邮箱]:visible`
4. 刚执行 `ui` 后的坐标：`540,560`

可用形式：

```text
登录
Button:has-text("登录")
Button:text-is("登录")
TextInput[hint~=邮箱]:visible
[id=login_button]:clickable
Text[text^=欢迎]
```

属性操作符为 `=`、`~=`、`^=`、`$=`。状态包括 `:visible`、`:clickable`、`:enabled`、`:focused`、`:checked`、`:selected`、`:scrollable`、`:checkable` 和 `:longClickable`。

默认要求唯一匹配。出现 `AMBIGUOUS` 时使用错误详情中的候选节点细化选择器；不要直接加 `--first`，除非用户明确要求第一个或界面顺序本身就是稳定语义。坐标只作为语义选择器不可用时的回退，并且必须基于刚获取的界面。

## 交互命令

```bash
hon tap '<selector>' --json
hon double-tap '<selector>' --json
hon long-tap '<selector>' --json
hon fill '<selector>' '<text>' --json
hon press Back --json
hon swipe <x1> <y1> <x2> <y2> [velocity] --json
hon drag <x1> <y1> <x2> <y2> [velocity] --json
```

会触发页面变化的操作后，使用 `wait` 等待明确结果；不知道结果控件时重新执行 `ui`：

```bash
hon wait '<selector>' --timeout 10s --json
hon wait '<selector>' --gone --timeout 10s --json
```

不要用固定 `sleep` 代替 `wait`。

## 应用和 HAP

```bash
hon app start <bundle> <ability> --json
hon app stop <bundle> --json
hon install <app.hap> --json
hon uninstall <bundle> --json
```

安装、卸载、强制停止应用属于明显副作用，只在用户任务需要时执行。不要猜测 bundle 或 ability；从用户、项目配置或已验证的设备信息中取得。

## 错误恢复

- `NOT_FOUND`：重新执行 `ui --json`，确认页面状态并改进选择器。
- `AMBIGUOUS`：读取 `error.details.matches`，构造更具体的选择器。
- `TIMEOUT`：执行 `ui --json` 或截图检查真实页面，不盲目重复点击。
- `MULTIPLE_DEVICES`：执行 `devices --json`，选择后持续传入 `--serial`。
- `HDC_NOT_FOUND`：确认 HarmonyOS SDK `toolchains` 已加入 `PATH`。
- `NO_DEVICE`：提示用户开启 USB/无线调试并确认授权。
- `BAD_LAYOUT`：运行 `doctor`；必要时确认设备测试模式。
- `USAGE` 或退出码 `64`：修正命令，不重试原参数。

如果动作返回错误，不要假定动作已经完成。若 HDC 错误发生在动作执行后且结果不明确，先重新观察界面再决定是否重试，避免重复提交或重复点击。

## 批处理

只有步骤固定、不需要中途判断时才使用 `.hon` 脚本：

```bash
hon run <script.hon> --json
```

需要根据页面结果分支时，由 Agent 逐条调用命令并检查 JSON，不要把 `.hon` 扩展成业务脚本语言。
