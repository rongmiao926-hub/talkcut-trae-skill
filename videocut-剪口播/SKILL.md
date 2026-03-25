---
name: "videocut-剪口播"
description: "口播视频转录和口误识别。生成审查稿、视频介绍草稿和删除任务清单。触发：用户说剪口播、处理视频、识别口误、剪辑视频时调用。"
---

<!--
input: 视频文件 (*.mp4)
output: subtitles_words.json、auto_selected.json、视频介绍草稿.md、review.html
pos: 转录+识别，到用户网页审核为止

架构守护者：一旦我被修改，请同步更新：
1. ../README.md 的 Skill 清单
2. /CLAUDE.md 路由表
-->

# 剪口播 v2

> 语音转录 + AI 口误识别 + 网页审核

## 快速使用

```
用户: 帮我剪这个口播视频
用户: 处理一下这个视频
```

## 输出目录结构

```
{项目目录}/output/
└── YYYY-MM-DD_视频名/
    ├── 剪口播/
    │   ├── 1_转录/
    │   │   ├── audio.mp3
    │   │   ├── volcengine_result.json  (仅火山引擎方案)
    │   │   └── subtitles_words.json
    │   ├── 2_分析/
    │   │   ├── readable.txt
    │   │   ├── semantic_context.md
    │   │   ├── auto_selected.json
    │   │   └── 口误分析.md
    │   └── 3_审核/
    │       ├── review.html
    │       └── 视频介绍草稿.md
    └── 字幕/
        └── ...
```

**规则**：已有文件夹则复用，否则新建。

## 流程

```
0. 创建输出目录
    ↓
1. 提取音频 (ffmpeg)
    ↓
2. 选择转录方案（读取 .env 的 ASR_ENGINE）
    ├─ volcengine: 上传 → 火山引擎 API → generate_subtitles.js
    └─ whisper:    本地 whisper_transcribe.py
    ↓
3. 得到 subtitles_words.json（两条路径汇合）
    ↓
4. AI 分析口误/静音，生成预选列表 (auto_selected.json)
    ↓
5. Trae 生成视频介绍草稿 (视频介绍草稿.md)
    ↓
6. 生成审核网页 (review.html)
    ↓
7. 启动审核服务器，用户网页确认
    ↓
【等待用户确认】→ 网页点击「执行剪辑」或手动 /剪辑
```

## 执行步骤

### 步骤 0: 创建输出目录

输出目录固定为项目目录下的 `output/` 文件夹。

```bash
# 变量设置（根据实际视频调整）
VIDEO_PATH="/path/to/视频.mp4"
VIDEO_NAME=$(basename "$VIDEO_PATH" .mp4)
DATE=$(date +%Y-%m-%d)
SKILL_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_DIR="${SKILL_ROOT}/output/${DATE}_${VIDEO_NAME}/剪口播"

# 创建子目录
mkdir -p "$BASE_DIR/1_转录" "$BASE_DIR/2_分析" "$BASE_DIR/3_审核"
cd "$BASE_DIR"
```

### 步骤 1: 提取音频

```bash
cd 1_转录

# 提取和视频时间轴对齐的审核音频
node "$SKILL_DIR/scripts/extract_review_audio.js" "$VIDEO_PATH" audio.wav audio_timeline.json
```

### 步骤 2: 转录（分支）

读取 `.env` 中的 `ASR_ENGINE`：
- 如果为空 → **直接告诉用户**（不要使用选项工具）：
  - Windows 用户只能使用火山引擎 API
  - macOS 用户可以选择火山引擎或 Whisper 本地
- `volcengine` → 方案 A
- `whisper` → 方案 B（仅 macOS）

**转录方案对比**：

| 方案 | 速度 | 费用 | 平台支持 |
|------|------|------|----------|
| 火山引擎 API | 快（云端处理） | 免费 20 小时额度 | 全平台 |
| Whisper 本地 | 较慢（本地运算） | 完全免费 | **仅 macOS（Apple Silicon）** |

**注意**：Windows 用户只能使用火山引擎 API。

#### 方案 A：火山引擎 API

**API Key 获取指南**：https://my.feishu.cn/wiki/Gh0MwxHePidsYfkIx7zcvJQynqc?from=from_copylink

如果没有 API Key，**直接告诉用户**访问上述链接获取，等待用户提供 API Key。

**认证方式**：使用 `x-api-key` header，不需要 appid 参数。

**平台检测**：
- Windows: 使用 `volcengine_transcribe.py`（Python脚本）
- macOS/Linux: 使用 `volcengine_transcribe.sh`（Bash脚本）

```bash
# 1. 上传获取公网 URL
ffmpeg -y -i audio.wav -c:a libmp3lame audio.mp3
curl -s -F "files[]=@audio.mp3" https://uguu.se/upload
# 返回: {"success":true,"files":[{"url":"https://h.uguu.se/xxx.mp3"}]}

# 2. 调用火山引擎 API
# Windows:
python "$SKILL_DIR/scripts/volcengine_transcribe.py" "https://h.uguu.se/xxx.mp3" "."
# macOS/Linux:
bash "$SKILL_DIR/scripts/volcengine_transcribe.sh" "https://h.uguu.se/xxx.mp3"
# 输出: volcengine_result.json

# 3. 生成字级别字幕
node "$SKILL_DIR/scripts/generate_subtitles.js" volcengine_result.json "" "."
# 输出: subtitles_words.json
```

**API调用示例（直接curl）**：
```bash
# 提交任务
curl -X POST "https://openspeech.bytedance.com/api/v1/vc/submit?language=zh-CN&use_itn=True&use_capitalize=True&max_lines=1&words_per_line=15" \
  -H "content-type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"url":"https://your-audio-url.mp3"}'

# 查询结果
curl "https://openspeech.bytedance.com/api/v1/vc/query?id=TASK_ID" \
  -H "x-api-key: YOUR_API_KEY"
```

#### 方案 B：Whisper 本地模型

先检查 mlx-whisper 是否已安装，未安装则自动安装：

```bash
python3 -c "import mlx_whisper" 2>/dev/null || pip3 install mlx-whisper
```

执行转录（首次运行会自动下载模型，约 1.5GB）：

```bash
python3 "$SKILL_DIR/scripts/whisper_transcribe.py" audio.wav
# 直接输出: subtitles_words.json（已包含 gap 检测，无需再调 generate_subtitles.js）
```

```bash
cd ..
```

→ 两条路径都输出 `subtitles_words.json`，后续步骤完全一致。

### 步骤 3: 分析口误（语义优先 + 规则边界）

#### 3.1 生成易读格式

```bash
cd 2_分析

node -e "
const data = require('../1_转录/subtitles_words.json');
let output = [];
data.forEach((w, i) => {
  if (w.isGap) {
    const dur = (w.end - w.start).toFixed(2);
    if (dur >= 0.5) output.push(i + '|[静' + dur + 's]|' + w.start.toFixed(2) + '-' + w.end.toFixed(2));
  } else {
    output.push(i + '|' + w.text + '|' + w.start.toFixed(2) + '-' + w.end.toFixed(2));
  }
});
require('fs').writeFileSync('readable.txt', output.join('\\n'));
"
```

#### 3.2 读取用户习惯

先读 `用户习惯/` 目录下所有规则文件。

#### 3.3 生成句子列表（关键步骤）

**必须先分句，再分析**。按静音切分成句子列表：

```bash
node -e "
const data = require('../1_转录/subtitles_words.json');
let sentences = [];
let curr = { text: '', startIdx: -1, endIdx: -1 };

data.forEach((w, i) => {
  const isLongGap = w.isGap && (w.end - w.start) >= 0.5;
  if (isLongGap) {
    if (curr.text.length > 0) sentences.push({...curr});
    curr = { text: '', startIdx: -1, endIdx: -1 };
  } else if (!w.isGap) {
    if (curr.startIdx === -1) curr.startIdx = i;
    curr.text += w.text;
    curr.endIdx = i;
  }
});
if (curr.text.length > 0) sentences.push(curr);

sentences.forEach((s, i) => {
  console.log(i + '|' + s.startIdx + '-' + s.endIdx + '|' + s.text);
});
" > sentences.txt
```

#### 3.4 生成语义分析上下文（提升输入质量）

把原始字幕、分句结果、前后静音信息和重复候选整理成一份更适合 Trae 判断的材料：

```bash
node "$SKILL_DIR/scripts/build_semantic_context.js" \
  "../1_转录/subtitles_words.json" \
  "sentences.txt" \
  "semantic_context.md"
```

Trae 在做内容型判断前，必须先读：

- `readable.txt`
- `sentences.txt`
- `semantic_context.md`
- [语义分析提示词.md](语义分析提示词.md)

#### 3.5 脚本自动标记静音（必须先执行）

```bash
node -e "
const words = require('../1_转录/subtitles_words.json');
const selected = [];
words.forEach((w, i) => {
  if (w.isGap && (w.end - w.start) >= 0.5) selected.push(i);
});
require('fs').writeFileSync('auto_selected.json', JSON.stringify(selected, null, 2));
console.log('≥0.5s静音数量:', selected.length);
"
```

→ 输出 `auto_selected.json`（只含静音 idx）

#### 3.6 Trae 语义分析口误（追加到 auto_selected.json）

这一步默认由 Trae 直接做语义判断，不要先调用 `rule_based_analyzer.js`。

目标不是“逐条套规则”，而是先判断这段话在语义上是否成立，再决定哪些词或句子应该删。`用户习惯/` 里的规则只作为边界和偏好，不是替代理解上下文。

**检测规则（按优先级）**：

| # | 类型 | 判断方法 | 删除范围 |
|---|------|----------|----------|
| 1 | 重复句 | 相邻句或隔一句在表达同一意思，后句更完整 | 较短或被修正的**整句** |
| 2 | 残句 | 话说到一半就断了，语义不成立 | **整个残句** |
| 3 | 重说纠正 | 前面那句明显在试探/修正，后面才是正式表达 | 前一段 |
| 4 | 句内重复 | 同一句里明显重复说了一次，影响听感 | 前面多余部分 |
| 5 | 卡顿词 | 那个那个、就是就是、没有没有 | 前面重复部分 |
| 6 | 语气词 | 嗯、啊、呃 | 默认只标记，不自动大删 |

**核心原则**：
- **语义优先**：先判断保留后是否自然，再决定是否删除
- **规则只做边界**：长静音、桥接小停顿、明显连续卡顿可以脚本辅助；高歧义内容必须由 Trae 语义判断
- **先分句，再比对**：用 sentences.txt 看前后句之间的关系
- **整句删除**：残句、重复句都要删整句，不只是删异常的几个字
- **不要机械删语气词**：如果词本身是内容的一部分，例如“免费额度”的“额”，不能因为像语气词就删掉

#### 3.7 写入 `auto_selected.json` 和 `口误分析.md`

在静音初始结果基础上，把 Trae 语义判断出来的 idx 追加进 `auto_selected.json`，并同步写一份 `口误分析.md`。

要求：

- 每一段都写清楚 `idx`、时间、类型、内容、为什么删
- 只把真正高置信的内容型口误放进默认预选
- 有争议的句子宁可不预选，留给审核页人工勾选
- `auto_selected.json` 里只存 idx 数组，不要写说明文字

#### 3.8 规范化 `auto_selected.json`

语义分析写完后，再执行一次规范化，只做低风险边界处理：

```bash
node "$SKILL_DIR/scripts/refine_auto_selected.js" \
  "../1_转录/subtitles_words.json" \
  "auto_selected.json"
```

这个脚本只负责两件事：

- 去重、排序、过滤非法 idx
- 如果一个 `<0.5s` 的停顿前后都已经被选中删除，则把这个小停顿也补进来

不要把“重复句 / 残句 / 重说纠正”的判断再交回规则脚本。

🚨 **关键警告：行号 ≠ idx**

```
readable.txt 格式: idx|内容|时间
                   ↑ 用这个值

行号1500 → "1568|[静1.02s]|..."  ← idx是1568，不是1500！
```

**口误分析.md 格式：**

```markdown
## 第N段 (行号范围)

| idx | 时间 | 类型 | 内容 | 处理 |
|-----|------|------|------|------|
| 65-75 | 15.80-17.66 | 重复句 | "这是我剪出来的一个案例" | 删 |
```

#### 3.9 生成视频介绍草稿

这一步必须由 Trae 直接完成，不要用本地模板脚本代写。

先读取同目录下的 [视频介绍草稿.md](视频介绍草稿.md)，再基于当前准备保留的内容生成：

```text
../3_审核/视频介绍草稿.md
```

硬规则：

- 信息源必须优先基于准备保留的正文，不要按删除片段倒推
- 默认包含标题、正文、标签、内容摘要
- 如果当前稿子明显还是半成品，正文也要跟着真实，不要编造视频里没讲过的内容
- 审核页里默认只展示和复制这份草稿，不依赖用户在页面里手工保存

### 步骤 4-5: 审核

```bash
cd ../3_审核

# 6. 生成审核网页
node "$SKILL_DIR/scripts/generate_review.js" ../1_转录/subtitles_words.json ../2_分析/auto_selected.json ../1_转录/audio.wav
# 输出: review.html

# 7. 启动审核服务器
node "$SKILL_DIR/scripts/review_server.js" 8899 "$VIDEO_PATH"
# 打开 http://localhost:8899
```

用户在网页中：
- 播放视频片段确认
- 勾选/取消删除项
- 查看和复制 `视频介绍草稿.md`
- 点击「执行剪辑」

---

## 数据格式

### subtitles_words.json

```json
[
  {"text": "大", "start": 0.12, "end": 0.2, "isGap": false},
  {"text": "", "start": 6.78, "end": 7.48, "isGap": true}
]
```

### auto_selected.json

```json
[72, 85, 120]  // Trae 语义分析 + 规则边界生成的预选索引
```

---

## 配置

### .env 字段

```bash
VOLCENGINE_API_KEY=xxx    # 火山引擎 API Key
ASR_ENGINE=volcengine     # 转录方案: volcengine / whisper，留空每次询问
OUTPUT_DIR=/path/to/输出目录  # 剪辑后视频输出目录，留空则使用项目目录下的 output/
```

### 火山引擎 API Key

获取指南：https://my.feishu.cn/wiki/Gh0MwxHePidsYfkIx7zcvJQynqc?from=from_copylink

```bash
# 编辑 .env 填入 VOLCENGINE_API_KEY=xxx
```
