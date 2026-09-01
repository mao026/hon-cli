# AI 安装说明

把下面这句话发给能够执行终端命令的 AI Agent：

```text
请阅读 https://github.com/mao026/hon-cli/blob/main/AI_INSTALL.md，按说明安装 hon CLI、添加 hon-cli skill，并验证安装结果。
```

## 安装步骤

1. 确认 Node.js 20 或更高版本可用：

```bash
node --version
```

2. 从 npm 安装 CLI：

```bash
npm install -g @mao026/hon-cli
hon --version
```

3. 从已安装的 npm 包安装 skill，不要再次从 GitHub 下载。macOS / Linux：

```bash
SKILL_SOURCE="$(npm root -g)/@mao026/hon-cli"
npx --yes skills add "$SKILL_SOURCE" --global --skill hon-cli --yes
```

Windows PowerShell：

```powershell
$SkillSource = Join-Path (npm root -g) '@mao026/hon-cli'
npx --yes skills add $SkillSource --global --skill hon-cli --yes
```

4. 验证 skill 和设备环境：

```bash
npx --yes skills list --global
hon devices --json
```

如果 `hon --version` 成功，但 `hon devices --json` 返回 `HDC_NOT_FOUND` 或没有设备，CLI 和 skill 仍已安装成功。此时需要安装 HarmonyOS SDK，将 `toolchains` 目录加入 `PATH`，并开启设备的 USB 或无线调试。

设备连接后执行完整检查：

```bash
hon doctor --json
hon ui --json
```

## 更新

```bash
npm update -g @mao026/hon-cli
SKILL_SOURCE="$(npm root -g)/@mao026/hon-cli"
npx --yes skills add "$SKILL_SOURCE" --global --skill hon-cli --yes
```

完整使用方法见安装后的 `hon-cli` skill，源码位于：

```text
skills/hon-cli/SKILL.md
```
