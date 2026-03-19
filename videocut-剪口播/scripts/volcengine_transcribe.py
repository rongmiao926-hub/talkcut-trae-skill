#!/usr/bin/env python3
"""
火山引擎字幕生成 API（跨平台版本）

用法: python volcengine_transcribe.py <audio_url> [output_dir]
  - audio_url: 音频文件的公网URL（必须以 http:// 或 https:// 开头）
  - output_dir: 输出目录，默认当前目录

输出: volcengine_result.json

注意: 火山引擎API需要公网可访问的URL，不支持本地文件路径。
      如果是本地文件，请先上传到 uguu.se 获取公网URL：
      curl -s -F "files[]=@audio.mp3" https://uguu.se/upload

认证方式: x-api-key header
"""

import requests
import json
import time
import sys
import os
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def get_api_key():
    """从.env文件读取API Key"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    env_file = os.path.join(script_dir, "..", "..", ".env")
    
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("VOLCENGINE_API_KEY="):
                    return line.split("=", 1)[1]
    return None

def load_hot_words():
    """加载热词词典"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    dict_file = os.path.join(script_dir, "..", "字幕", "词典.txt")
    
    hot_words = []
    if os.path.exists(dict_file):
        with open(dict_file, "r", encoding="utf-8") as f:
            for line in f:
                word = line.strip()
                if word:
                    hot_words.append(word)
        print(f"📖 加载热词: {len(hot_words)} 个")
    return hot_words

def transcribe(audio_url, output_dir="."):
    """调用火山引擎API转录音频"""
    api_key = get_api_key()
    
    if not api_key:
        print("❌ 未找到 VOLCENGINE_API_KEY，请检查 .env 配置")
        sys.exit(1)
    
    base_url = "https://openspeech.bytedance.com/api/v1/vc"
    
    print(f"🎤 提交火山引擎转录任务...")
    print(f"音频 URL: {audio_url}")
    
    # 加载热词
    hot_words = load_hot_words()
    
    session = requests.Session()
    session.trust_env = False
    
    # 构建请求体
    request_body = {"url": audio_url}
    if hot_words:
        request_body["hot_words"] = hot_words
    
    # 提交任务
    response = session.post(
        f"{base_url}/submit",
        params={
            "language": "zh-CN",
            "use_itn": "True",
            "use_capitalize": "True",
            "max_lines": 1,
            "words_per_line": 15,
        },
        json=request_body,
        headers={
            "content-type": "application/json",
            "x-api-key": api_key
        },
        timeout=30,
        verify=False
    )
    
    result = response.json()
    
    if result.get("code") not in [0, "0"]:
        print(f"❌ 提交失败: {result.get('message')}")
        sys.exit(1)
    
    task_id = result.get("id")
    print(f"✅ 任务已提交，ID: {task_id}")
    print("⏳ 等待转录完成...")
    
    # 轮询结果（最多等待10分钟）
    max_attempts = 120
    for attempt in range(max_attempts):
        time.sleep(5)
        
        query_response = session.get(
            f"{base_url}/query",
            params={"id": task_id},
            headers={"x-api-key": api_key},
            timeout=30,
            verify=False
        )
        
        query_result = query_response.json()
        code = query_result.get("code")
        
        if code == 0 or code == "0":
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, "volcengine_result.json")
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(query_result, f, ensure_ascii=False, indent=2)
            
            utterances = query_result.get("utterances", [])
            print(f"\n✅ 转录完成，识别到 {len(utterances)} 段语音")
            print(f"📝 已保存: {output_path}")
            return output_path
        
        elif code == 1000 or code == "1000":
            print(".", end="", flush=True)
        else:
            print(f"\n❌ 转录失败: {query_result.get('message')}")
            sys.exit(1)
    
    print("\n❌ 超时，任务未完成")
    sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python volcengine_transcribe.py <audio_url> [output_dir]")
        print("")
        print("参数说明:")
        print("  audio_url  - 音频文件的公网URL（必须以 http:// 或 https:// 开头）")
        print("  output_dir - 输出目录，默认当前目录")
        print("")
        print("注意: 火山引擎API需要公网可访问的URL，不支持本地文件路径。")
        print("      如果是本地文件，请先上传到 uguu.se 获取公网URL：")
        print("      curl -s -F \"files[]=@audio.mp3\" https://uguu.se/upload")
        sys.exit(1)
    
    audio_url = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "."
    
    if not audio_url.startswith("http://") and not audio_url.startswith("https://"):
        print("❌ 错误: 参数必须是公网URL，不支持本地文件路径")
        print("")
        print("正确用法:")
        print("  1. 先上传音频获取公网URL:")
        print("     curl -s -F \"files[]=@audio.mp3\" https://uguu.se/upload")
        print("  2. 使用返回的URL调用本脚本:")
        print("     python volcengine_transcribe.py https://h.uguu.se/xxx.mp3")
        sys.exit(1)
    
    transcribe(audio_url, output_dir)
