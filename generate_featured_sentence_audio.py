#!/usr/bin/env python3
"""
精選例句音頻生成腳本
只為篩選後的精選例句生成 TTS 音頻
支援斷點續傳
"""
import os
import sys
import json
import asyncio
import hashlib
from pathlib import Path
from typing import Tuple, List, Dict, Any

# --- 外部函式庫 ---
from tqdm.asyncio import tqdm
from dotenv import load_dotenv
from openai import AsyncOpenAI
from openai import RateLimitError, APIError

# --- 路徑設定 ---
ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
OUTPUT_DIR = DATA_DIR / "output"
# 使用篩選後的資料檔案
VOCAB_JSON_PATH = OUTPUT_DIR / "vocab_data_filtered.json"
VOCAB_JSON_FALLBACK = OUTPUT_DIR / "vocab_data.json"

# 輸出路徑
TTS_DIR = OUTPUT_DIR / "tts_audio"
SENTENCE_TTS_DIR = TTS_DIR / "sentences"

# 進度檔案（支援斷點續傳）
PROGRESS_FILE = DATA_DIR / "sentence_audio_progress.json"

# 建立輸出資料夾
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TTS_DIR.mkdir(parents=True, exist_ok=True)
SENTENCE_TTS_DIR.mkdir(parents=True, exist_ok=True)

# --- OpenAI API 設定 ---
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    sys.exit("請在 .env 檔案中設定您的 OPENAI_API_KEY。")

client = AsyncOpenAI(api_key=OPENAI_API_KEY)

# --- TTS 模型設定 ---
TTS_MODEL = "gpt-4o-mini-tts"
TTS_VOICE = "onyx"
CONCURRENT_REQUESTS = 50
MAX_RETRIES = 3


def generate_sentence_hash(sentence: str) -> str:
    """生成句子的短雜湊值作為檔案名的一部分"""
    return hashlib.md5(sentence.encode('utf-8')).hexdigest()[:8]


def load_progress() -> Dict[str, List[str]]:
    """載入進度檔案"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_progress(progress: Dict[str, List[str]]):
    """儲存進度檔案"""
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(progress, f, indent=2, ensure_ascii=False)


async def fetch_single_sentence_tts(
    lemma: str,
    sentence_index: int,
    sentence_dict: Dict[str, str],  # <--- 修改這裡，接收字典
    semaphore: asyncio.Semaphore,
    output_dir: Path
) -> Tuple[str, str, str]:
    """
    為單個例句生成 TTS 音頻
    
    返回: (status, lemma, filename)
    """
    sentence_text = sentence_dict.get("text", "")
    if not sentence_text:
        return "failed", lemma, "invalid_sentence"

    # 檔名: {lemma}_ex_{index}_{hash}.mp3
    sentence_hash = generate_sentence_hash(sentence_text)
    filename = f"{lemma}_ex_{sentence_index}_{sentence_hash}.mp3"
    output_file = output_dir / filename

    if output_file.exists():
        return "skipped", lemma, filename

    # 限制句子長度（TTS API 有長度限制）
    if len(sentence_text) > 4000:
        print(f"\n[Warning] 句子太長，截斷: {lemma} - 例句 {sentence_index}")
        sentence_text = sentence_text[:4000]

    async with semaphore:
        for attempt in range(MAX_RETRIES):
            try:
                async with client.audio.speech.with_streaming_response.create(
                    model=TTS_MODEL,
                    voice=TTS_VOICE,
                    input=sentence_text,
                    response_format="mp3"
                ) as response:
                    await response.stream_to_file(output_file)
                return "success", lemma, filename

            except RateLimitError:
                if attempt < MAX_RETRIES - 1:
                    wait_time = 5 * (attempt + 2)
                    print(f"\n[Warning] 速率限制 '{lemma}' 例句 {sentence_index}。將在 {wait_time} 秒後重試... (嘗試 {attempt + 2}/{MAX_RETRIES})")
                    await asyncio.sleep(wait_time)
                else:
                    print(f"\n[Error] 為 '{lemma}' 例句 {sentence_index} 重試 {MAX_RETRIES} 次後，因速率限制放棄。")
                    return "failed", lemma, filename

            except APIError as e:
                print(f"\n[Error] 無法為 '{lemma}' 例句 {sentence_index} 生成語音 (API Error): Status {e.status_code}")
                return "failed", lemma, filename

            except Exception as e:
                print(f"\n[Error] 為 '{lemma}' 例句 {sentence_index} 生成語音時發生未預期錯誤: {type(e).__name__} - {e}")
                return "failed", lemma, filename

    return "failed", lemma, filename


async def main():
    """主執行函式"""
    print("=" * 60)
    print("精選例句音頻生成工具")
    print("=" * 60)

    # 檢查輸入檔案
    input_path = None
    if VOCAB_JSON_PATH.exists():
        input_path = VOCAB_JSON_PATH
        print(f"\n使用篩選後的資料: {VOCAB_JSON_PATH}")
    elif VOCAB_JSON_FALLBACK.exists():
        input_path = VOCAB_JSON_FALLBACK
        print(f"\n使用基礎資料: {VOCAB_JSON_FALLBACK}")
        print("警告: 該檔案未經篩選，將處理所有例句")
    else:
        sys.exit(f"找不到輸入檔案，請先執行 filter_sentences.py")

    with open(input_path, 'r', encoding='utf-8') as f:
        vocab_data = json.load(f)

    # 載入進度
    progress = load_progress()
    print(f"\n已處理單字數: {len(progress)}")

    # 收集需要生成的精選例句
    sentence_tasks = []
    
    print(f"\n正在掃描精選例句...")
    for word_data in vocab_data:
        lemma = word_data["lemma"]
        
        # 檢查是否已處理
        if lemma in progress:
            continue
        
        sentences = word_data.get("sentences", [])
        
        # 處理新格式（篩選後）
        if isinstance(sentences, dict):
            featured = sentences.get("featured", [])
            for idx, sentence in enumerate(featured):
                sentence_tasks.append((lemma, idx, sentence))
        # 處理舊格式（未篩選）
        elif isinstance(sentences, list):
            # 如果是舊格式，只取前5個
            for idx, sentence in enumerate(sentences[:5]):
                if isinstance(sentence, dict):
                    text = sentence.get("text", "")
                else:
                    text = sentence
                sentence_tasks.append((lemma, idx, text))
    
    if not sentence_tasks:
        print("沒有需要處理的例句")
        return

    print(f"找到 {len(sentence_tasks)} 個精選例句需要處理")
    print(f"   音頻檔案將儲存到: {SENTENCE_TTS_DIR.resolve()}")
    print(f"   使用模型='{TTS_MODEL}', 語音='{TTS_VOICE}', 並發數={CONCURRENT_REQUESTS}")

    # 詢問是否繼續
    if len(sentence_tasks) > 100:
        confirm = input(f"\n將生成 {len(sentence_tasks)} 個音頻檔案，可能需要較長時間。確定繼續？(y/n): ").strip().lower()
        if confirm != 'y':
            print("已取消操作")
            return

    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)
    
    # 建立非同步任務
    tasks = [
        fetch_single_sentence_tts(lemma, idx, sentence, semaphore, SENTENCE_TTS_DIR)
        for lemma, idx, sentence in sentence_tasks
    ]

    success_count, skipped_count, failed_count = 0, 0, 0
    current_word_files = {}

    print("\n--- 正在生成音頻檔案 ---")
    results = await tqdm.gather(*tasks, desc="生成例句 TTS")

    for (lemma, idx, sentence), (status, _, filename) in zip(sentence_tasks, results):
        if status == "success":
            success_count += 1
            if lemma not in current_word_files:
                current_word_files[lemma] = []
            current_word_files[lemma].append(filename)
        elif status == "skipped":
            skipped_count += 1
            if lemma not in current_word_files:
                current_word_files[lemma] = []
            current_word_files[lemma].append(filename)
        else:
            failed_count += 1
        
        # 更新進度（每個單字完成後）
        if lemma in current_word_files and lemma not in progress:
            progress[lemma] = current_word_files[lemma]
            if len(progress) % 10 == 0:
                save_progress(progress)

    # 最終儲存進度
    save_progress(progress)

    print("\n--- 生成報告 ---")
    print(f"成功生成: {success_count} 個檔案")
    print(f"已跳過 (已存在): {skipped_count} 個檔案")
    if failed_count > 0:
        print(f"失敗: {failed_count} 個檔案 (詳見上方錯誤訊息)")
    print("-------------------------")
    print(f"\n完成！音頻檔案位於:\n{SENTENCE_TTS_DIR.resolve()}")
    print(f"進度檔案: {PROGRESS_FILE}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n使用者中斷！進度已自動儲存")
        print("下次執行時將從斷點繼續")
        sys.exit(0)