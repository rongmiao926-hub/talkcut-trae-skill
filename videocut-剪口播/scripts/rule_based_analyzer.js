const fs = require('fs');
const path = require('path');

// 不自动删除“额”，避免误伤“额度 / 名额 / 差额”这类正常内容词。
const AUTO_DELETE_FILLER_WORDS = ['嗯', '啊', '哎', '诶', '呃', '唉', '哦', '噢', '呀', '欸'];

// 规则驱动的自动分析器
class RuleBasedAnalyzer {
    constructor(subtitlesFile, sentencesFile, autoSelectedFile, rulesDir, outputDir = '.') {
        this.subtitles = JSON.parse(fs.readFileSync(subtitlesFile, 'utf8'));
        this.sentences = this.parseSentences(sentencesFile);
        this.selected = new Set(JSON.parse(fs.readFileSync(autoSelectedFile, 'utf8')));
        this.rulesDir = rulesDir;
        this.outputDir = outputDir;
        this.analysisResults = [];
        this.analysisResultKeys = new Set();
    }

    parseSentences(sentencesFile) {
        const content = fs.readFileSync(sentencesFile, 'utf8');
        return content.trim().split('\n').map(line => {
            const parts = line.split('|');
            return {
                index: parseInt(parts[0]),
                startIdx: parseInt(parts[1].split('-')[0]),
                endIdx: parseInt(parts[1].split('-')[1]),
                text: parts[2]
            };
        });
    }

    loadRules() {
        console.log('📚 加载规则文档...');
        const ruleFiles = fs.readdirSync(this.rulesDir)
            .filter(file => file.endsWith('.md') && !file.startsWith('README'));
        
        console.log(`找到 ${ruleFiles.length} 个规则文档`);
        return ruleFiles;
    }

    getSentenceWordIndices(sentence) {
        const indices = [];
        for (let i = sentence.startIdx; i <= sentence.endIdx; i++) {
            const word = this.subtitles[i];
            if (word && !word.isGap) {
                indices.push(i);
            }
        }
        return indices;
    }

    getSentenceTokens(sentence) {
        return this.getSentenceWordIndices(sentence).map(index => this.subtitles[index].text);
    }

    normalizeToken(token) {
        return String(token || '').trim().replace(/^[，。！？；：、,.!?;:]+|[，。！？；：、,.!?;:]+$/g, '');
    }

    getComparableSentenceTokens(sentence) {
        return this.getSentenceTokens(sentence)
            .map(token => this.normalizeToken(token))
            .filter(Boolean);
    }

    getComparableSentenceText(sentence) {
        return this.getComparableSentenceTokens(sentence).join('');
    }

    commonPrefixTokenCount(tokensA, tokensB) {
        const limit = Math.min(tokensA.length, tokensB.length);
        let count = 0;
        while (count < limit && tokensA[count] === tokensB[count]) {
            count++;
        }
        return count;
    }

    commonPrefixTextLength(textA, textB) {
        const limit = Math.min(textA.length, textB.length);
        let count = 0;
        while (count < limit && textA[count] === textB[count]) {
            count++;
        }
        return count;
    }

    isShortResidualSentence(sentence) {
        const text = this.getComparableSentenceText(sentence);
        return text.length > 0 && text.length <= 5;
    }

    isDuplicateSentencePair(sentenceA, sentenceB) {
        const textA = this.getComparableSentenceText(sentenceA);
        const textB = this.getComparableSentenceText(sentenceB);
        if (textA.length < 5 || textB.length < 5) {
            return false;
        }

        const prefixLength = this.commonPrefixTextLength(textA, textB);
        if (prefixLength < 5) {
            return false;
        }

        const minLen = Math.min(textA.length, textB.length);
        return prefixLength >= 8 || prefixLength / minLen >= 0.6;
    }

    addSelectionRange(startIdx, endIdx) {
        for (let i = startIdx; i <= endIdx; i++) {
            this.selected.add(i);
        }
    }

    recordAnalysisResult(type, startIdx, endIdx, text, reason) {
        const key = `${type}:${startIdx}-${endIdx}`;
        if (this.analysisResultKeys.has(key)) {
            return;
        }

        this.analysisResultKeys.add(key);
        this.analysisResults.push({
            type,
            startIdx,
            endIdx,
            text,
            reason,
        });
    }

    markSentence(sentence, type, reason) {
        this.addSelectionRange(sentence.startIdx, sentence.endIdx);
        this.recordAnalysisResult(type, sentence.startIdx, sentence.endIdx, sentence.text, reason);
    }

    // 规则1: 重复句检测（相邻句子开头≥5字相同）
    detectDuplicateSentences() {
        console.log('\n🔍 检测重复句...');

        for (let i = 0; i < this.sentences.length - 1; i++) {
            const current = this.sentences[i];
            const next = this.sentences[i + 1];

            if (this.isDuplicateSentencePair(current, next)) {
                console.log(`发现重复句: 句子${i} "${current.text}" 和 句子${i + 1} "${next.text}"`);

                const deleteSentence = current.text.length <= next.text.length ? current : next;

                this.markSentence(deleteSentence, '重复句', '相邻句子开头高度相似');
            }

            const middle = this.sentences[i + 1];
            const afterNext = this.sentences[i + 2];
            if (!middle || !afterNext) {
                continue;
            }

            if (this.isShortResidualSentence(middle) && this.isDuplicateSentencePair(current, afterNext)) {
                console.log(`发现隔一句重复: 句子${i} "${current.text}" / 句子${i + 2} "${afterNext.text}"，中间残句 "${middle.text}"`);

                this.markSentence(current, '隔一句重复', '中间夹短残句，后句重说');
                this.markSentence(middle, '隔一句重复', '夹在两次重说之间的短残句');
            }
        }
    }

    // 规则2: 句内重复检测（A+中间+A模式）
    detectInternalDuplicates() {
        console.log('\n🔍 检测句内重复...');

        this.sentences.forEach(sentence => {
            const wordIndices = this.getSentenceWordIndices(sentence);
            const tokens = wordIndices.map(index => this.subtitles[index].text);
            if (tokens.length < 4) return;

            const occupiedTokenRanges = [];
            const maxPhraseLen = Math.min(8, Math.floor(tokens.length / 2));

            for (let phraseLen = maxPhraseLen; phraseLen >= 2; phraseLen--) {
                for (let start = 0; start + phraseLen * 2 <= tokens.length; start++) {
                    const overlapsExisting = occupiedTokenRanges.some(([usedStart, usedEnd]) => start <= usedEnd && usedStart <= start + phraseLen - 1);
                    if (overlapsExisting) {
                        continue;
                    }

                    const phraseTokens = tokens.slice(start, start + phraseLen);
                    const phraseText = phraseTokens.join('');
                    const hasChinese = /[\u4e00-\u9fff]/.test(phraseText);
                    if ((!hasChinese && phraseText.length < 4) || !/[A-Za-z0-9\u4e00-\u9fff]/.test(phraseText)) {
                        continue;
                    }

                    let matched = null;
                    for (let bridgeLen = 0; bridgeLen <= 3; bridgeLen++) {
                        const secondStart = start + phraseLen + bridgeLen;
                        const secondEnd = secondStart + phraseLen;
                        if (secondEnd > tokens.length) {
                            break;
                        }

                        const secondPhraseTokens = tokens.slice(secondStart, secondEnd);
                        const isSamePhrase = phraseTokens.length === secondPhraseTokens.length && phraseTokens.every((token, idx) => token === secondPhraseTokens[idx]);
                        if (!isSamePhrase) {
                            continue;
                        }

                        matched = { bridgeLen, secondStart, secondEnd };
                        break;
                    }

                    if (!matched) {
                        continue;
                    }

                    const deleteEndToken = start + phraseLen + matched.bridgeLen - 1;
                    if (deleteEndToken < start) {
                        continue;
                    }

                    const startPos = wordIndices[start];
                    const endPos = wordIndices[deleteEndToken];
                    const deleteText = tokens.slice(start, deleteEndToken + 1).join('');
                    console.log(`发现句内重复: "${sentence.text}" 中删除 "${deleteText}"，保留后半句`);

                    this.addSelectionRange(startPos, endPos);
                    this.recordAnalysisResult('句内重复', startPos, endPos, deleteText, 'A+中间+A模式');
                    occupiedTokenRanges.push([start, matched.secondEnd - 1]);
                    start = matched.secondEnd - 1;
                }
            }
        });
    }

    // 规则3: 语气词检测
    detectFillerWords() {
        console.log('\n🔍 检测语气词...');

        this.subtitles.forEach((word, i) => {
            if (!word.isGap && AUTO_DELETE_FILLER_WORDS.includes(word.text)) {
                console.log(`发现语气词: "${word.text}"`);
                
                // 标记语气词为删除
                this.selected.add(i);
                
                this.analysisResults.push({
                    type: '语气词',
                    startIdx: i,
                    endIdx: i,
                    text: word.text,
                    reason: '语气词'
                });
            }
        });
    }

    // 规则4: 卡顿词检测（同一个词连续说2-3次）
    detectStutterWords() {
        console.log('\n🔍 检测卡顿词...');
        
        const stutterPatterns = ['那个那个', '就是就是', '然后然后', '这个这个', '所以所以'];
        
        for (let i = 0; i < this.subtitles.length - 1; i++) {
            const current = this.subtitles[i];
            const next = this.subtitles[i + 1];
            
            if (!current.isGap && !next.isGap) {
                const combined = current.text + next.text;
                if (stutterPatterns.includes(combined)) {
                    console.log(`发现卡顿词: "${combined}"`);
                    
                    // 删前面，保留最后一个
                    this.selected.add(i);
                    
                    this.analysisResults.push({
                        type: '卡顿词',
                        startIdx: i,
                        endIdx: i,
                        text: current.text,
                        reason: '卡顿词'
                    });
                }
            }
        }
    }

    // 规则5: 连续语气词检测（两个语气词连在一起）
    detectConsecutiveFillers() {
        console.log('\n🔍 检测连续语气词...');

        for (let i = 0; i < this.subtitles.length - 1; i++) {
            const current = this.subtitles[i];
            const next = this.subtitles[i + 1];

            if (!current.isGap && !next.isGap && AUTO_DELETE_FILLER_WORDS.includes(current.text) && AUTO_DELETE_FILLER_WORDS.includes(next.text)) {
                console.log(`发现连续语气词: "${current.text}${next.text}"`);
                
                // 全部删除
                this.selected.add(i);
                this.selected.add(i + 1);
                
                this.analysisResults.push({
                    type: '连续语气词',
                    startIdx: i,
                    endIdx: i + 1,
                    text: current.text + next.text,
                    reason: '连续语气词'
                });
            }
        }
    }

    // 规则6: 残句检测（句子过短）
    detectIncompleteSentences() {
        console.log('\n🔍 检测残句...');
        
        this.sentences.forEach(sentence => {
            const text = sentence.text.trim();
            if (text.length <= 3) {
                console.log(`发现残句: "${text}"`);
                
                // 将残句中的所有词标记为删除
                for (let j = sentence.startIdx; j <= sentence.endIdx; j++) {
                    this.selected.add(j);
                }
                
                this.analysisResults.push({
                    type: '残句',
                    startIdx: sentence.startIdx,
                    endIdx: sentence.endIdx,
                    text: text,
                    reason: '句子过短（≤3字）'
                });
            }
        });
    }

    // 规则7: 重说纠正（说错后立即纠正）
    detectSelfCorrection() {
        console.log('\n🔍 检测重说纠正...');
        
        for (let i = 0; i < this.subtitles.length - 1; i++) {
            const current = this.subtitles[i];
            const next = this.subtitles[i + 1];
            
            if (!current.isGap && !next.isGap) {
                // 检测部分重复（前后词语有重叠但不完全相同）
                if (next.text.startsWith(current.text) && next.text.length > current.text.length) {
                    console.log(`发现重说纠正: "${current.text}" -> "${next.text}"`);
                    
                    // 删除前面错误的部分
                    this.selected.add(i);
                    
                    this.analysisResults.push({
                        type: '重说纠正',
                        startIdx: i,
                        endIdx: i,
                        text: current.text,
                        reason: '重说纠正'
                    });
                }
                
                // 检测否定纠正（用否定词纠正刚说的）
                if (current.text === next.text) {
                    console.log(`发现否定纠正: "${current.text}${next.text}"`);
                    
                    // 删除前面的部分
                    this.selected.add(i);
                    
                    this.analysisResults.push({
                        type: '重说纠正',
                        startIdx: i,
                        endIdx: i,
                        text: current.text,
                        reason: '否定纠正'
                    });
                }
            }
        }
    }

    // 规则8: 小间隔前后被删则也删（<0.5s的静音，如果前后文字都被删，则静音也删）
    detectOrphanedGaps() {
        console.log('\n🔍 检测孤立小间隔...');
        
        let addedCount = 0;
        this.subtitles.forEach((word, i) => {
            if (word.isGap) {
                const gapDuration = word.end - word.start;
                // 只处理 <0.5s 的小间隔
                if (gapDuration < 0.5) {
                    // 找前一个非gap元素
                    let prevIdx = i - 1;
                    while (prevIdx >= 0 && this.subtitles[prevIdx].isGap) prevIdx--;
                    
                    // 找后一个非gap元素
                    let nextIdx = i + 1;
                    while (nextIdx < this.subtitles.length && this.subtitles[nextIdx].isGap) nextIdx++;
                    
                    // 如果前后都被删，则这个间隔也删
                    const prevDeleted = prevIdx >= 0 && this.selected.has(prevIdx);
                    const nextDeleted = nextIdx < this.subtitles.length && this.selected.has(nextIdx);
                    
                    if (prevDeleted && nextDeleted && !this.selected.has(i)) {
                        this.selected.add(i);
                        addedCount++;
                        console.log(`发现孤立小间隔: idx ${i}, 时长 ${gapDuration.toFixed(2)}s`);
                        
                        this.analysisResults.push({
                            type: '孤立小间隔',
                            startIdx: i,
                            endIdx: i,
                            text: `[静${gapDuration.toFixed(2)}s]`,
                            reason: '前后文字都被删除'
                        });
                    }
                }
            }
        });
        
        if (addedCount > 0) {
            console.log(`新增 ${addedCount} 个孤立小间隔到删除列表`);
        }
    }

    // 辅助方法：根据字符位置获取词索引
    getWordIndexByCharPos(startIdx, endIdx, charPos) {
        let currentCharPos = 0;
        
        for (let i = startIdx; i <= endIdx; i++) {
            const word = this.subtitles[i];
            if (!word.isGap) {
                if (currentCharPos <= charPos && charPos < currentCharPos + word.text.length) {
                    return i;
                }
                currentCharPos += word.text.length;
            }
        }
        
        return -1;
    }

    // 保存分析结果
    saveResults() {
        // 保存auto_selected.json
        const selectedArray = Array.from(this.selected);
        fs.writeFileSync(path.join(this.outputDir, 'auto_selected.json'), 
            JSON.stringify(selectedArray, null, 2));
        console.log(`\n✅ 已保存 auto_selected.json，共 ${selectedArray.length} 个待删除项`);
        
        // 生成口误分析报告
        const analysisReport = this.generateAnalysisReport();
        fs.writeFileSync(path.join(this.outputDir, '口误分析.md'), analysisReport);
        console.log('✅ 已生成 口误分析.md');
    }

    // 生成口误分析报告
    generateAnalysisReport() {
        let report = '# 口误分析报告\n\n';
        
        this.analysisResults.forEach((result, index) => {
            const startTime = this.subtitles[result.startIdx].start.toFixed(2);
            const endTime = this.subtitles[result.endIdx].end.toFixed(2);
            
            report += `## 第${index + 1}段 (idx ${result.startIdx}-${result.endIdx})\n\n`;
            report += `| idx | 时间 | 类型 | 内容 | 处理 |\n`;
            report += `|-----|------|------|------|------|\n`;
            report += `| ${result.startIdx}-${result.endIdx} | ${startTime}-${endTime} | ${result.type} | "${result.text}" | 删 |\n\n`;
        });
        
        return report;
    }

    // 执行所有分析
    analyze() {
        console.log('🎯 开始AI口误分析...');
        
        // 加载规则文件
        this.loadRules();
        
        // 执行各种检测规则
        this.detectDuplicateSentences();
        this.detectInternalDuplicates();
        this.detectFillerWords();
        this.detectStutterWords();
        this.detectConsecutiveFillers();
        this.detectSelfCorrection();
        this.detectIncompleteSentences();
        
        // 最后检测孤立小间隔（依赖前面的删除结果）
        this.detectOrphanedGaps();
        
        // 保存结果
        this.saveResults();
        
        console.log('\n🎉 AI分析完成！');
    }
}

// 主函数：处理命令行参数
function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 4) {
        console.log('用法: node rule_based_analyzer.js <subtitles_words.json> <sentences.txt> <auto_selected.json> <rules_dir> [output_dir]');
        process.exit(1);
    }
    
    const subtitlesFile = args[0];
    const sentencesFile = args[1];
    const autoSelectedFile = args[2];
    const rulesDir = args[3];
    const outputDir = args[4] || '.';
    
    // 创建分析器实例并执行分析
    const analyzer = new RuleBasedAnalyzer(subtitlesFile, sentencesFile, autoSelectedFile, rulesDir, outputDir);
    analyzer.analyze();
}

// 执行主函数
if (require.main === module) {
    main();
}
