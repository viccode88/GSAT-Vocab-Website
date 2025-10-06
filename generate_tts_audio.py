#!/usr/bin/env python3
"""
【詞彙語音生成腳本 v4 - 官方推薦結構】

功能：
1. 讀取 `vocab_data.json` 檔案，獲取單字列表。
2. 【v4 核心更新】採用 OpenAI 官方推薦的 `with_streaming_response` 內容管理器來處理音訊串流，提升穩定性與簡潔性。
3. 保留高效率的非同步並發模式與穩健的重試機制。
4. 將生成的 MP3 檔案儲存到指定的輸出資料夾。
5. 自動跳過已存在的檔案，支援中斷續傳。
"""
import os
import sys
import json
import asyncio
from pathlib import Path
from typing import Tuple

# --- 外部函式庫 ---
from tqdm.asyncio import tqdm
from dotenv import load_dotenv
from openai import AsyncOpenAI
from openai import RateLimitError, APIError

# --- 第 0 步：環境設定與常數 ---

# --- 路徑設定 ---
ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
OUTPUT_DIR = DATA_DIR / "output"
VOCAB_JSON_PATH = OUTPUT_DIR / "vocab_data.json"
TTS_DIR = OUTPUT_DIR / "tts_audio"

# 建立輸出資料夾
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TTS_DIR.mkdir(parents=True, exist_ok=True)

# --- OpenAI API 設定 ---
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    sys.exit("⛔ 請在 .env 檔案中設定您的 OPENAI_API_KEY。")

client = AsyncOpenAI(api_key=OPENAI_API_KEY)

# --- TTS 模型設定 ---
TTS_MODEL = "gpt-4o-mini-tts"
TTS_VOICE = "onyx"
CONCURRENT_REQUESTS = 15
MAX_RETRIES = 3

# --- 第 1 步：核心函式 (v4 更新) ---

async def fetch_single_tts(
    word: str,
    semaphore: asyncio.Semaphore,
    output_dir: Path
) -> Tuple[str, str]:
    """
    為單一單字生成語音檔案，採用官方推薦的 with_streaming_response 結構。
    """
    output_file = output_dir / f"{word}.mp3"

    if output_file.exists():
        return "skipped", word

    async with semaphore:
        for attempt in range(MAX_RETRIES):
            try:
                # 【v4 核心修復】使用 async with 和 with_streaming_response
                async with client.audio.speech.with_streaming_response.create(
                    model=TTS_MODEL,
                    voice=TTS_VOICE,
                    input=word,
                    response_format="mp3"
                ) as response:
                    # stream_to_file 也是一個非同步操作，需要 await
                    await response.stream_to_file(output_file)
                return "success", word

            except RateLimitError:
                if attempt < MAX_RETRIES - 1:
                    wait_time = 5 * (attempt + 2)
                    print(f"\n[Warning] 速率限制 '{word}'。將在 {wait_time} 秒後重試... (嘗試 {attempt + 2}/{MAX_RETRIES})")
                    await asyncio.sleep(wait_time)
                else:
                    print(f"\n[Error] 為 '{word}' 重試 {MAX_RETRIES} 次後，因速率限制放棄。")
                    return "failed", word

            except APIError as e:
                print(f"\n[Error] 無法為 '{word}' 生成語音 (API Error): Status {e.status_code}")
                return "failed", word

            except Exception as e:
                print(f"\n[Error] 為 '{word}' 生成語音時發生未預期錯誤: {type(e).__name__} - {e}")
                return "failed", word

    return "failed", word


# --- 第 2 步：主流程 (與之前版本相同) ---

async def main():
    """主執行函式"""
    print("🚀 Starting TTS audio generation (v4 - Official API Structure)...")

    if not VOCAB_JSON_PATH.is_file():
        sys.exit(f"⛔ 輸入檔案未找到: {VOCAB_JSON_PATH}\n請先運行前一個預處理腳本來生成它。")

    print(f"📖 Reading vocabulary from: {VOCAB_JSON_PATH}")
    with open(VOCAB_JSON_PATH, 'r', encoding='utf-8') as f:
        vocab_data = json.load(f)

    words_to_generate = [item["lemma"] for item in vocab_data]
    if not words_to_generate:
        sys.exit("✅ 詞彙列表為空，無需生成語音。")

    print(f"🎤 Found {len(words_to_generate)} words to process.")
    print(f"🔊 Audio files will be saved to: {TTS_DIR.resolve()}")
    print(f"⚙️  Using model='{TTS_MODEL}', voice='{TTS_VOICE}' with {CONCURRENT_REQUESTS} concurrent requests.")

    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)
    tasks = [fetch_single_tts(word, semaphore, TTS_DIR) for word in words_to_generate]

    success_count, skipped_count, failed_count = 0, 0, 0

    print("\n--- Generating audio files ---")
    results = await tqdm.gather(*tasks, desc="Generating TTS")

    for status, word in results:
        if status == "success":
            success_count += 1
        elif status == "skipped":
            skipped_count += 1
        else:
            failed_count += 1

    print("\n--- Generation Report ---")
    print(f"✅ Successfully generated: {success_count} files")
    print(f"⏩ Skipped (already exist): {skipped_count} files")
    if failed_count > 0:
        print(f"❌ Failed to generate: {failed_count} files (詳見上方錯誤訊息)")
    print("-------------------------")
    print(f"\n🎉 All done! Audio files are located in:\n{TTS_DIR.resolve()}")


if __name__ == "__main__":
    if not OPENAI_API_KEY:
        print("錯誤：OPENAI_API_KEY 環境變數未設定。")
        print("請建立一個 .env 檔案並在其中加入 OPENAI_API_KEY='your_key_here'。")
    else:
        asyncio.run(main())