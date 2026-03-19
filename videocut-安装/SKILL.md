---
name: "videocut-安装"
description: "环境准备。安装依赖、配置 API Key、验证环境。触发：用户说安装、环境准备、初始化、首次使用时调用。"
---

<!--
input: 无
output: 环境就绪
pos: 前置 skill，首次使用前运行

架构守护者：一旦我被修改，请同步更新：
1. ../README.md 的 Skill 清单
2. /CLAUDE.md 路由表
-->

# 安装

> 首次使用前的环境准备

## 快速使用

```
用户: 安装环境
用户: 初始化
```

## 依赖清单

### 必需依赖

| 依赖 | 用途 | 安装命令 |
|------|------|----------|
| Node.js | 运行脚本 | macOS: `brew install node` / Windows: `winget install OpenJS.NodeJS` |
| FFmpeg | 视频剪辑 | macOS: `brew install ffmpeg` / Windows: `winget install Gyan.FFmpeg` |
| curl | API 调用 | 系统自带 |

### 可选依赖（仅在选择 Whisper 方案时安装）

| 依赖 | 用途 | 安装命令 |
|------|------|----------|
| mlx-whisper | 本地语音转录 | `pip3 install mlx-whisper`（仅 macOS Apple Silicon）|

**重要**：不要在安装流程开始时自动安装 mlx-whisper，只有用户明确选择 Whisper 方案后才安装。

## 转录方案

本工具支持两种语音转录方案：

| 方案 | 速度 | 费用 | 平台支持 |
|------|------|------|----------|
| 火山引擎 API | 快（云端处理） | 免费 20 小时额度 | 全平台可用 |
| Whisper 本地 | 较慢（本地运算） | 完全免费 | **仅 macOS（Apple Silicon）** |

**重要**：Windows 用户只能使用火山引擎 API。

选择写入 `.env` 的 `ASR_ENGINE` 字段（`volcengine` 或 `whisper`），留空则每次执行时询问。

## API 配置

### 火山引擎语音识别

控制台：https://console.volcengine.com/speech/new/experience/asr?projectName=default

1. 注册火山引擎账号
2. 开通语音识别服务
3. 获取 API Key

配置到项目目录 `.claude/skills/.env`：

```bash
# 文件路径：剪辑Agent/.claude/skills/.env
VOLCENGINE_API_KEY=your_api_key_here
```

## 安装流程

```
1. 安装 Node.js + FFmpeg
       ↓
2. 选择转录方案（火山引擎 / Whisper）
       ↓
3. 配置所选方案（API Key 或安装 mlx-whisper）
       ↓
4. 验证环境
```

**输出目录**：默认使用项目目录下的 `output/` 文件夹。

## 执行步骤

### 1. 安装必需依赖

检查并安装 Node.js 和 FFmpeg：

```bash
# macOS
brew install node ffmpeg

# Windows
winget install OpenJS.NodeJS
winget install Gyan.FFmpeg

# 验证
node -v
ffmpeg -version
```

**注意**：不要在这个步骤安装 mlx-whisper，它是可选依赖。

### 2. 选择转录方案

询问用户选择哪种转录方案，将选择写入 `.env`：

```bash
# .env 中设置（二选一）
ASR_ENGINE=volcengine   # 火山引擎 API
ASR_ENGINE=whisper      # Whisper 本地模型
ASR_ENGINE=             # 留空 = 每次询问
```

#### 方案 A：火山引擎 API

API Key 获取指南：https://my.feishu.cn/wiki/Gh0MwxHePidsYfkIx7zcvJQynqc?from=from_copylink

```bash
echo "VOLCENGINE_API_KEY=your_key" >> .claude/skills/.env
echo "ASR_ENGINE=volcengine" >> .claude/skills/.env
```

#### 方案 B：Whisper 本地模型（仅 macOS Apple Silicon）

**只有在用户明确选择此方案时才安装！**

```bash
# 安装 mlx-whisper（Apple Silicon 优化）
pip3 install mlx-whisper

# 首次运行时会自动下载模型（~1.5GB）到 ~/.cache/huggingface/
echo "ASR_ENGINE=whisper" >> .claude/skills/.env
```

检查是否已安装：

```bash
python3 -c "import mlx_whisper; print('✅ mlx-whisper 已安装')"
```

### 3. 配置 API Key（仅火山引擎方案）

如果用户选择了火山引擎方案，需要配置 API Key：

API Key 获取指南：https://my.feishu.cn/wiki/Gh0MwxHePidsYfkIx7zcvJQynqc?from=from_copylink

```bash
echo "VOLCENGINE_API_KEY=your_key" >> .trae/skills/.env
```

### 4. 验证环境

```bash
# 检查 Node.js
node -v

# 检查 FFmpeg
ffmpeg -version

# 检查转录方案配置
grep ASR_ENGINE .trae/skills/.env

# 如果选了火山引擎，检查 API Key
grep VOLCENGINE .trae/skills/.env

# 如果选了 Whisper，检查安装（仅 macOS）
python3 -c "import mlx_whisper; print('✅ mlx-whisper OK')"
```

## 常见问题

### Q1: API Key 在哪获取？

火山引擎控制台 → 语音技术 → 语音识别 → API Key

### Q2: ffmpeg 命令找不到

```bash
which ffmpeg  # 应该输出路径
# 如果没有，重新安装：brew install ffmpeg
```

### Q3: 文件名含冒号报错

FFmpeg 命令需加 `file:` 前缀：

```bash
ffmpeg -i "file:2026:01:26 task.mp4" ...
```
