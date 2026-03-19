---
name: "videocut"
description: "视频剪辑Agent，专为口播视频设计。功能：语义理解、静音检测、重复句检测、字幕生成、自更新。触发：用户说剪视频、处理口播、加字幕、安装环境、更新规则时调用。"
---

# Videocut 视频剪辑

用 AI 辅助剪辑口播视频，自动识别并处理静音、口误、重复等问题。

## 快速开始

### 1. 安装（首次使用）

```
/videocut:install
```

会自动检查并安装：Python、FFmpeg、FunASR、Whisper 模型

### 2. 剪辑口播视频

```
/videocut:cut 视频.mp4
```

流程：
1. 提取音频 → 火山引擎转录（字级别时间戳）
2. AI 审核：静音/口误/重复/语气词
3. 生成审核网页 → 浏览器打开
4. 人工确认 → FFmpeg 自动剪辑

### 3. 生成字幕

```
/videocut:subtitle 视频.mp4
```

流程：
1. Whisper 转录
2. 词典纠错（自定义术语）
3. 人工确认
4. 烧录字幕到视频

### 4. 自更新

```
/videocut:update
```

告诉 AI 你的偏好，它会记住：
- "静音阈值改成 1 秒"
- "保留适量嗯作为过渡"

## 子技能

| 子技能 | 功能 | 说明 |
|--------|------|------|
| install | 环境准备 | 检查并安装依赖 |
| cut | 转录 + AI 审核 + 剪辑 | 核心功能 |
| subtitle | 生成字幕 | 带词典纠错 |
| update | 记录偏好 | 自我进化 |

## 配置

首次使用前需要：
1. 复制 `.env.example` 为 `.env`
2. 填入火山引擎 API Key

申请地址：https://console.volcengine.com/

## 依赖

- Node.js 18+
- FFmpeg
- Python 3.8+
- 火山引擎 API Key
