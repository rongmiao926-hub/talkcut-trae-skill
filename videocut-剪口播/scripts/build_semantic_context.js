#!/usr/bin/env node
/**
 * 把 subtitles_words.json + sentences.txt 整理成更适合语义判断的上下文材料。
 *
 * 用法:
 *   node build_semantic_context.js <subtitles_words.json> <sentences.txt> [output.md]
 */

const fs = require('fs');
const path = require('path');

const wordsFile = process.argv[2];
const sentencesFile = process.argv[3];
const outputFile = process.argv[4] || 'semantic_context.md';

if (!wordsFile || !sentencesFile) {
  console.error('❌ 用法: node build_semantic_context.js <subtitles_words.json> <sentences.txt> [output.md]');
  process.exit(1);
}

if (!fs.existsSync(wordsFile)) {
  console.error(`❌ 找不到字幕文件: ${wordsFile}`);
  process.exit(1);
}

if (!fs.existsSync(sentencesFile)) {
  console.error(`❌ 找不到句子文件: ${sentencesFile}`);
  process.exit(1);
}

const words = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
const sentenceLines = fs.readFileSync(sentencesFile, 'utf8').trim().split('\n').filter(Boolean);

function parseSentenceLine(line) {
  const parts = line.split('|');
  const [startIdx, endIdx] = parts[1].split('-').map(Number);
  return {
    index: Number(parts[0]),
    startIdx,
    endIdx,
    text: parts.slice(2).join('|'),
  };
}

function formatTime(value) {
  return Number(value).toFixed(2);
}

function getComparableText(text) {
  return String(text || '').replace(/[，。！？；：、,.!?;:\s]/g, '');
}

function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length);
  let count = 0;
  while (count < limit && a[count] === b[count]) count++;
  return count;
}

function findGapAround(sentence, direction) {
  if (direction === 'prev') {
    for (let i = sentence.startIdx - 1; i >= 0; i--) {
      const word = words[i];
      if (!word) continue;
      if (word.isGap) return word;
      break;
    }
    return null;
  }

  for (let i = sentence.endIdx + 1; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    if (word.isGap) return word;
    break;
  }
  return null;
}

function buildSentenceMeta(sentence, sentences) {
  const first = words[sentence.startIdx];
  const last = words[sentence.endIdx];
  const prevGap = findGapAround(sentence, 'prev');
  const nextGap = findGapAround(sentence, 'next');
  const prevSentence = sentence.index > 0 ? sentences[sentence.index - 1] : null;
  const nextSentence = sentence.index < sentences.length - 1 ? sentences[sentence.index + 1] : null;
  const cleanText = getComparableText(sentence.text);
  const flags = [];

  if (cleanText.length <= 5) flags.push('短句/疑似残句');
  if (prevGap && (prevGap.end - prevGap.start) >= 1.0) flags.push(`前静音${formatTime(prevGap.end - prevGap.start)}s`);
  if (nextGap && (nextGap.end - nextGap.start) >= 1.0) flags.push(`后静音${formatTime(nextGap.end - nextGap.start)}s`);

  if (prevSentence) {
    const prefix = commonPrefixLength(getComparableText(prevSentence.text), cleanText);
    if (prefix >= 5) flags.push(`与前句前缀重复${prefix}字`);
  }

  if (nextSentence) {
    const prefix = commonPrefixLength(cleanText, getComparableText(nextSentence.text));
    if (prefix >= 5) flags.push(`与后句前缀重复${prefix}字`);
  }

  return {
    ...sentence,
    start: first ? Number(first.start) : 0,
    end: last ? Number(last.end) : 0,
    duration: last && first ? Number(last.end) - Number(first.start) : 0,
    prevGapDuration: prevGap ? Number(prevGap.end) - Number(prevGap.start) : 0,
    nextGapDuration: nextGap ? Number(nextGap.end) - Number(nextGap.start) : 0,
    flags,
  };
}

function buildDuplicateCandidates(sentences) {
  const candidates = [];

  for (let i = 0; i < sentences.length - 1; i++) {
    const current = sentences[i];
    const next = sentences[i + 1];
    const currentText = getComparableText(current.text);
    const nextText = getComparableText(next.text);
    const prefix = commonPrefixLength(currentText, nextText);
    if (prefix >= 5) {
      candidates.push(`- 相邻句候选：句${current.index} / 句${next.index}，共同前缀 ${prefix} 字`);
    }

    const middle = sentences[i + 1];
    const afterNext = sentences[i + 2];
    if (!middle || !afterNext) continue;
    if (getComparableText(middle.text).length > 5) continue;

    const afterText = getComparableText(afterNext.text);
    const bridgePrefix = commonPrefixLength(currentText, afterText);
    if (bridgePrefix >= 5) {
      candidates.push(`- 隔一句候选：句${current.index} / 句${afterNext.index}，中间句${middle.index}较短，共同前缀 ${bridgePrefix} 字`);
    }
  }

  return candidates;
}

const sentences = sentenceLines.map(parseSentenceLine);
const sentenceMetas = sentences.map(sentence => buildSentenceMeta(sentence, sentences));
const duplicateCandidates = buildDuplicateCandidates(sentences);

let output = '# 语义分析上下文\n\n';
output += `- 句子数：${sentenceMetas.length}\n`;
output += `- 字幕元素数：${words.length}\n`;
output += '- 这份文件只用于帮助 Trae 判断“重复句 / 重说纠正 / 残句 / 句内重复”，不是最终输出。\n\n';

output += '## 重复句候选\n\n';
if (duplicateCandidates.length === 0) {
  output += '- 当前没有脚本预检出的明显重复句候选。\n\n';
} else {
  output += `${duplicateCandidates.join('\n')}\n\n`;
}

output += '## 句子清单\n\n';
sentenceMetas.forEach(sentence => {
  output += `### 句${sentence.index}\n\n`;
  output += `- idx：${sentence.startIdx}-${sentence.endIdx}\n`;
  output += `- 时间：${formatTime(sentence.start)}-${formatTime(sentence.end)}（${formatTime(sentence.duration)}s）\n`;
  output += `- 前静音：${formatTime(sentence.prevGapDuration)}s\n`;
  output += `- 后静音：${formatTime(sentence.nextGapDuration)}s\n`;
  output += `- 标记：${sentence.flags.length ? sentence.flags.join('；') : '无'}\n`;
  output += `- 正文：${sentence.text}\n\n`;
});

fs.writeFileSync(outputFile, output);
console.log(`✅ 已生成语义上下文: ${path.resolve(outputFile)}`);
