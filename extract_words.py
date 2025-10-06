#!/usr/bin/env python3
"""
【升級版 v3 - Quick Response API】學測英文數據預處理腳本

功能：
1. 從 PDF 提取文本並儲存原文。
2. 使用 spaCy 進行 NLP 處理，分析詞形 (lemma)、詞性 (POS) 並儲存例句。
3. 過濾停用詞、無意義的符號與句子。
4. (可選) 使用 OpenAI Chat Completions API，以高效率的並發模式獲取所有單字的中英釋義與例句。
5. 將所有處理結果彙整成一份結構化的 JSON 檔案，供前端使用。
"""
import os
import re
import sys
import json
import asyncio
from pathlib import Path
from collections import defaultdict
from typing import List, Dict, Any, Tuple, Optional

# --- 外部函式庫 ---
import pdfplumber
import spacy
from tqdm.asyncio import tqdm
from dotenv import load_dotenv
from openai import AsyncOpenAI
from openai import RateLimitError, APIError

# --- 第 0 步：環境設定與常數 ---

# 路徑設定
ROOT_DIR = Path(__file__).parent
SRC_DIR = ROOT_DIR / "ceec_english_papers"  # PDF 來源資料夾
DATA_DIR = ROOT_DIR / "data"
RAW_DIR = DATA_DIR / "raw_txt"
OUTPUT_DIR = DATA_DIR / "output"
DATA_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# OpenAI API 設定
load_dotenv()
OPENAI_ENABLED = bool(os.getenv("OPENAI_API_KEY"))
if OPENAI_ENABLED:
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    OPENAI_MODEL = "gpt-4o-mini" # 推薦使用 gpt-4o-mini，性價比高

# NLP 與過濾設定
try:
    nlp = spacy.load("en_core_web_sm", disable=["ner"])
except OSError:
    print("Downloading spaCy model en_core_web_sm…")
    os.system(f"{sys.executable} -m spacy download en_core_web_sm")
    nlp = spacy.load("en_core_web_sm", disable=["ner"])

# 排除的詞性
STOP_POS = {"ADP", "AUX", "CONJ", "CCONJ", "DET", "NUM", "PART", "PRON", "SCONJ", "PUNCT", "SPACE", "SYM", "X"}

# 自訂的停用詞列表 (小寫)
CUSTOM_STOP_WORDS = {
    'be', 'have', 'do', 'say', 'get', 'make', 'go', 'know', 'take', 'see', 'come', 'think',
    'look', 'want', 'give', 'use', 'find', 'tell', 'ask', 'work', 'seem', 'feel', 'try',
    'leave', 'call', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
    'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'to', 'from', 'in', 'on',
    'at', 'for', 'with', 'by', 'as', 'it', 'he', 'she', 'they', 'we'
}

# --- 第 1 步：工具函式 ---

def extract_text_from_pdf(pdf_file: Path) -> str:
    """從 PDF 檔案中提取所有文本。"""
    try:
        with pdfplumber.open(pdf_file) as pdf:
            return "\n".join(p.extract_text(x_tolerance=2, y_tolerance=2) or "" for p in pdf.pages if p.extract_text())
    except Exception as e:
        print(f"  [Warning] pdfplumber failed on {pdf_file.name}: {e}. Falling back is not implemented in this version.")
        return ""

def is_relevant_sentence(sent_text: str) -> bool:
    """判斷一個句子是否為我們關注的內容。"""
    clean_sent = sent_text.strip().lower()
    if not clean_sent or len(clean_sent.split()) < 5:
        return False
    if re.match(r"^(page \d+|\d+ of \d+|section [ivx]+|questions? \d+-\d+)", clean_sent):
        return False
    if re.match(r"^\([a-d]\)", clean_sent):
        return False
    if sum(1 for char in sent_text if char.isupper()) / len(sent_text.replace(" ", "")) > 0.7 and len(sent_text) > 10:
        return False
    return True

# --- 修改開始：使用標準 API 進行並發請求 ---

async def fetch_single_definition(
    lemma: str, 
    system_prompt: str, 
    semaphore: asyncio.Semaphore
) -> Tuple[str, Optional[Dict[str, str]]]:
    """
    為單一單字獲取釋義。使用信號量控制並發數量。

    返回: 一個包含 (lemma, definition_dict) 的元組。如果失敗則 definition_dict 為 None。
    """
    async with semaphore:
        try:
            response = await client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": lemma}
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                timeout=20.0 # 設定 20 秒超時
            )
            content = response.choices[0].message.content
            if content:
                definition_data = json.loads(content)
                return lemma, definition_data
            else:
                print(f"\n[Warning] No content returned for '{lemma}'")
                return lemma, None
        except RateLimitError:
            print(f"\n[Warning] Rate limit hit. Retrying for '{lemma}' in 10s...")
            await asyncio.sleep(10)
            # 簡單重試一次
            return await fetch_single_definition(lemma, system_prompt, semaphore)
        except (json.JSONDecodeError, KeyError, IndexError, APIError, Exception) as e:
            print(f"\n[Warning] Could not get or parse definition for '{lemma}': {e}")
            return lemma, None

async def get_definitions_concurrently(lemmas: List[str]) -> Dict[str, Any]:
    """
    使用標準 Chat Completions API，並發地為所有單字生成釋義。
    """
    if not OPENAI_ENABLED:
        return {}

    print(f"\n--- Step 2: Fetching definitions for {len(lemmas)} words via concurrent API calls ---")
    
    system_prompt = (
        "You are an expert lexicographer. For the English word provided by the user, "
        "give a concise definition in both Traditional Chinese and English, and one simple example sentence in English. "
        "Respond ONLY with a single, valid JSON object with three keys: 'zh_def' (Traditional Chinese definition), "
        "'en_def' (English definition), and 'example' (English example sentence)."
    )

    # 使用 asyncio.Semaphore 來限制同時運行的協程數量，避免觸發速率限制
    # 可根據你的 OpenAI 帳戶速率限制（Tier）調整，Tier 1 建議 10-15
    CONCURRENT_REQUESTS = 477
    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)

    # 建立所有請求任務
    tasks = [fetch_single_definition(lemma, system_prompt, semaphore) for lemma in lemmas]

    all_definitions = {}
    
    # 使用 tqdm.gather 來顯示進度條並執行所有任務
    results = await tqdm.gather(*tasks, desc="Fetching definitions")
    
    # 處理結果
    for lemma, definition in results:
        if definition:
            all_definitions[lemma] = definition
            
    return all_definitions

# --- 修改結束 ---


# --- 第 2 步：主流程 ---
async def main():
    """主執行函式"""
    print("🚀 Starting enhanced vocabulary processing...")

    pdf_files = sorted(SRC_DIR.rglob("*.pdf"))
    if not pdf_files:
        sys.exit(f"⛔ No PDF files found in '{SRC_DIR}'. Please add exam papers.")

    vocab_data = defaultdict(lambda: {
        "count": 0,
        "pos_dist": defaultdict(int),
        "sentences": set()
    })

    print("\n--- Step 1: Parsing PDFs and analyzing text ---")
    for pdf_file in tqdm(pdf_files, desc="Processing PDFs"):
        raw_text = extract_text_from_pdf(pdf_file)
        (RAW_DIR / f"{pdf_file.stem}.txt").write_text(raw_text, encoding="utf-8")
        
        doc = nlp(raw_text)
        for sent in doc.sents:
            sent_text = sent.text.replace('\n', ' ').strip()
            if not is_relevant_sentence(sent_text):
                continue
            for token in sent:
                lemma = token.lemma_.lower()
                if (token.pos_ not in STOP_POS and
                    token.is_alpha and
                    not token.is_stop and
                    len(lemma) > 1 and
                    lemma not in CUSTOM_STOP_WORDS):
                    vocab_data[lemma]["count"] += 1
                    vocab_data[lemma]["pos_dist"][token.pos_] += 1
                    # 只儲存前 5 個例句，避免集合過大消耗記憶體
                    if len(vocab_data[lemma]["sentences"]) < 5:
                        vocab_data[lemma]["sentences"].add(f"[{pdf_file.stem}] {sent_text}")

    print("\n✅ Text analysis complete.")
    print(f"📊 Found {len(vocab_data)} unique lemmas.")

    sorted_vocab = sorted(vocab_data.items(), key=lambda item: item[1]["count"], reverse=True)
    
    final_data = []
    for lemma, data in sorted_vocab:
        final_data.append({
            "lemma": lemma,
            "count": data["count"],
            "pos_dist": dict(sorted(data["pos_dist"].items(), key=lambda item: item[1], reverse=True)),
            "sentences": list(data["sentences"]),
            "definition": {"zh_def": "", "en_def": "", "example": ""}
        })

    # --- 第 3 步：(可選) 使用 OpenAI API 獲取釋義 ---
    if OPENAI_ENABLED and final_data:
        words_to_define = [item["lemma"] for item in final_data]
        # ** 使用新的並發函式 **
        all_definitions = await get_definitions_concurrently(words_to_define)
        
        if all_definitions:
            print("\n--- Step 3: Merging definitions into final data structure ---")
            # 將獲取到的釋義更新回主數據結構
            for item in tqdm(final_data, desc="Merging definitions"):
                if item["lemma"] in all_definitions:
                    item["definition"] = all_definitions[item["lemma"]]
            print("\n✅ Definitions merged successfully.")
    else:
        print("\n--- Step 2: Skipped fetching definitions (OpenAI API key not found or no words to process) ---")

    # --- 第 4 步：輸出最終的 JSON 檔案 ---
    output_path = OUTPUT_DIR / "vocab_data.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, indent=2, ensure_ascii=False)

    print(f"\n🎉 All done! Processed data saved to:\n{output_path.resolve()}")


if __name__ == "__main__":
    asyncio.run(main())