const fs = require('fs');
const path = require('path');

// 规则驱动的自动分析器
class RuleBasedAnalyzer {
    constructor(subtitlesFile, sentencesFile, autoSelectedFile, rulesDir, outputDir = '.') {
        this.subtitles = JSON.parse(fs.readFileSync(subtitlesFile, 'utf8'));
        this.sentences = this.parseSentences(sentencesFile);
        this.selected = new Set(JSON.parse(fs.readFileSync(autoSelectedFile, 'utf8')));
        this.rulesDir = rulesDir;
        this.outputDir = outputDir;
        this.analysisResults = [];
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

    // 规则1: 重复句检测（相邻句子开头≥5字相同）
    detectDuplicateSentences() {
        console.log('\n🔍 检测重复句...');
        
        for (let i = 0; i < this.sentences.length - 1; i++) {
            const current = this.sentences[i];
            const next = this.sentences[i + 1];
            
            // 相邻句子比对
            const minLength = Math.min(current.text.length, next.text.length, 5);
            if (minLength >= 5 && current.text.substring(0, minLength) === next.text.substring(0, minLength)) {
                console.log(`发现重复句: 句子${i} "${current.text}" 和 句子${i + 1} "${next.text}"`);
                
                // 删除较短的句子
                const deleteSentence = current.text.length <= next.text.length ? current : next;
                
                // 将句子中的所有词标记为删除
                for (let j = deleteSentence.startIdx; j <= deleteSentence.endIdx; j++) {
                    this.selected.add(j);
                }
                
                this.analysisResults.push({
                    type: '重复句',
                    startIdx: deleteSentence.startIdx,
                    endIdx: deleteSentence.endIdx,
                    text: deleteSentence.text,
                    reason: '相邻句子开头≥5字相同'
                });
            }
        }
    }

    // 规则2: 句内重复检测（A+中间+A模式）
    detectInternalDuplicates() {
        console.log('\n🔍 检测句内重复...');
        
        this.sentences.forEach(sentence => {
            const text = sentence.text;
            if (text.length < 6) return;
            
            // 查找A+中间+A模式
            for (let len = 2; len <= Math.floor(text.length / 2); len++) {
                for (let i = 0; i <= text.length - len * 2 - 1; i++) {
                    const part1 = text.substring(i, i + len);
                    const part2 = text.substring(i + len + 1, i + len * 2 + 1);
                    
                    if (part1 === part2) {
                        console.log(`发现句内重复: "${text}" 中的 "${part1}"`);
                        
                        // 将第一个重复部分标记为删除
                        const charCount = part1.length;
                        const startPos = this.getWordIndexByCharPos(sentence.startIdx, sentence.endIdx, i);
                        const endPos = this.getWordIndexByCharPos(sentence.startIdx, sentence.endIdx, i + len - 1);
                        
                        if (startPos !== -1 && endPos !== -1) {
                            for (let j = startPos; j <= endPos; j++) {
                                this.selected.add(j);
                            }
                            
                            this.analysisResults.push({
                                type: '句内重复',
                                startIdx: startPos,
                                endIdx: endPos,
                                text: part1,
                                reason: 'A+中间+A模式'
                            });
                        }
                    }
                }
            }
        });
    }

    // 规则3: 语气词检测
    detectFillerWords() {
        console.log('\n🔍 检测语气词...');
        
        const fillerWords = ['嗯', '啊', '哎', '诶', '呃', '额', '唉', '哦', '噢', '呀', '欸'];
        
        this.subtitles.forEach((word, i) => {
            if (!word.isGap && fillerWords.includes(word.text)) {
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
        
        const fillerWords = ['嗯', '啊', '哎', '诶', '呃', '额', '唉', '哦', '噢', '呀', '欸'];
        
        for (let i = 0; i < this.subtitles.length - 1; i++) {
            const current = this.subtitles[i];
            const next = this.subtitles[i + 1];
            
            if (!current.isGap && !next.isGap && fillerWords.includes(current.text) && fillerWords.includes(next.text)) {
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