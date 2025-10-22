#!/usr/bin/env python3
"""
例句篩選和清理腳本
使用 OpenAI Structured Outputs 篩選精選例句並清理無用句子
支援並發處理（100個並發請求）
"""
import os
import sys
import json
import re
import asyncio
from pathlib import Path
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv
from openai import AsyncOpenAI
from pydantic import BaseModel
from tqdm.asyncio import tqdm

# --- 路徑設定 ---
ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
OUTPUT_DIR = DATA_DIR / "output"
VOCAB_JSON_PATH = OUTPUT_DIR / "vocab_data.json"
FILTERED_VOCAB_PATH = OUTPUT_DIR / "vocab_data_filtered.json"

# --- OpenAI API 設定 ---
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    sys.exit("請在 .env 檔案中設定您的 OPENAI_API_KEY。")

client = AsyncOpenAI(api_key=OPENAI_API_KEY)
MODEL = "gpt-5-mini"  # 使用 gpt-5-mini 模型（這是這正確的，不要動）
CONCURRENT_REQUESTS = 100  #（


# --- Pydantic 模型定義（用於 Structured Outputs） ---
class FeaturedSelection(BaseModel):
    """精選例句選擇結果"""
    featured_indices: List[int]  # 精選例句的索引（1-based）
    reasoning: str  # 選擇理由


class SentenceWithSource(BaseModel):
    """帶來源的例句"""
    text: str
    source: str


class FilteredSentencesResult(BaseModel):
    """篩選後的例句結果"""
    featured: List[SentenceWithSource]  # 精選例句（1-5個）
    other: List[SentenceWithSource]  # 其他有效例句
    removed_count: int  # 刪除的句子數量


def has_chinese(text: str) -> bool:
    """檢查文本是否包含中文字符"""
    return bool(re.search(r'[\u4e00-\u9fff]', text))


def parse_sentence(sentence_with_source: str) -> Dict[str, str]:
    """解析句子，分離文本和來源資訊"""
    source = ""
    text = sentence_with_source
    
    if sentence_with_source.startswith('['):
        bracket_end = sentence_with_source.find(']')
        if bracket_end != -1:
            source = sentence_with_source[1:bracket_end]
            text = sentence_with_source[bracket_end + 1:].strip()
    
    return {
        "text": text,
        "source": source
    }


async def filter_sentences_for_word(
    lemma: str, 
    sentences: List[str], 
    pos_dist: dict,
    semaphore: asyncio.Semaphore
) -> FilteredSentencesResult:
    """
    為單個單詞篩選和清理例句（異步版本）
    使用 Structured Outputs 確保返回格式正確
    保留來源資訊
    """
    if not sentences:
        return FilteredSentencesResult(
            featured=[],
            other=[],
            removed_count=0
        )
    
    # 預處理：移除明顯無效的句子，保留來源資訊
    valid_sentences = []  # 格式: [(原始句子, 解析後的dict)]
    removed_count = 0
    
    for sentence in sentences:
        parsed = parse_sentence(sentence)
        clean_text = parsed["text"]
        
        # 基本驗證
        if (has_chinese(clean_text) or  # 含中文
            len(clean_text.split()) < 5 or  # 太短
            clean_text.lower().startswith(('question', 'answer', 'choose', 'select')) or  # 題目指令
            re.match(r'^\([a-d]\)', clean_text.lower())):  # 選項標記
            removed_count += 1
            continue
        
        valid_sentences.append((sentence, parsed))
    
    if not valid_sentences:
        return FilteredSentencesResult(
            featured=[],
            other=[],
            removed_count=removed_count
        )
    
    # 如果句子數量少於等於5，全部作為精選
    if len(valid_sentences) <= 5:
        featured = [
            SentenceWithSource(text=parsed["text"], source=parsed["source"])
            for _, parsed in valid_sentences
        ]
        return FilteredSentencesResult(
            featured=featured,
            other=[],
            removed_count=removed_count
        )
    
    # 使用 AI 篩選精選例句
    async with semaphore:
        try:
            # 準備例句文本（只用於AI分析，不包含來源）
            sentence_texts = [parsed["text"] for _, parsed in valid_sentences]
            sentences_list = "\n".join([f"{i+1}. {text}" for i, text in enumerate(sentence_texts)])
            
            # 獲取主要詞性
            primary_pos = max(pos_dist.items(), key=lambda x: x[1])[0] if pos_dist else "UNKNOWN"
            
            system_prompt = f"""You are an expert English teacher selecting the best example sentences for vocabulary learning.

Task: From the provided sentences containing the word "{lemma}" ({primary_pos}), select 1-5 FEATURED sentences that:
1. Show different meanings or uses of the word
2. Are clear and easy to understand
3. Demonstrate important or common usage patterns
4. Avoid repetitive contexts

Return ONLY the sentence numbers (1-based index) of the featured sentences, ordered by importance.
The remaining sentences will be kept as "other" examples."""

            user_prompt = f"""Word: {lemma}
Part of Speech: {primary_pos}

Sentences:
{sentences_list}

Select 1-5 featured sentence numbers."""

            # 調用 API（使用 Structured Outputs，移除 temperature 參數）
            response = await client.beta.chat.completions.parse(
                model=MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format=FeaturedSelection
                # 注意：不設置 temperature，使用默認值
            )
            
            selection = response.choices[0].message.parsed
            
            # 轉換為 0-based index
            featured_indices = set(i - 1 for i in selection.featured_indices if 0 < i <= len(valid_sentences))
            
            # 分類句子（保留來源資訊）
            featured = []
            other = []
            
            for i, (_, parsed) in enumerate(valid_sentences):
                sentence_obj = SentenceWithSource(
                    text=parsed["text"],
                    source=parsed["source"]
                )
                
                if i in featured_indices:
                    featured.append(sentence_obj)
                else:
                    other.append(sentence_obj)
            
            # 限制精選句子數量為1-5
            featured = featured[:5]
            
            return FilteredSentencesResult(
                featured=featured,
                other=other,
                removed_count=removed_count
            )
            
        except Exception as e:
            print(f"\n[Warning] 為 '{lemma}' 篩選例句時出錯: {e}")
            
            # 失敗回退：前5個作為精選，其餘作為其他（保留來源）
            featured = [
                SentenceWithSource(text=parsed["text"], source=parsed["source"])
                for _, parsed in valid_sentences[:5]
            ]
            other = [
                SentenceWithSource(text=parsed["text"], source=parsed["source"])
                for _, parsed in valid_sentences[5:]
            ]
            
            return FilteredSentencesResult(
                featured=featured,
                other=other,
                removed_count=removed_count
            )


async def main():
    """主執行函數（異步版本）"""
    print("=" * 60)
    print("例句篩選和清理工具（並發版本）")
    print("=" * 60)
    
    # 檢查輸入文件
    if not VOCAB_JSON_PATH.exists():
        sys.exit(f"找不到詞彙數據文件: {VOCAB_JSON_PATH}")
    
    print(f"\n正在讀取詞彙數據: {VOCAB_JSON_PATH}")
    with open(VOCAB_JSON_PATH, 'r', encoding='utf-8') as f:
        vocab_data = json.load(f)
    
    print(f"已載入 {len(vocab_data)} 個單詞")
    
    # 詢問是否重新開始
    if FILTERED_VOCAB_PATH.exists():
        print(f"\n發現已存在的篩選結果: {FILTERED_VOCAB_PATH}")
        choice = input("是否從頭開始重新處理？(y/n): ").strip().lower()
        
        if choice != 'y':
            print("從已有結果繼續...")
            with open(FILTERED_VOCAB_PATH, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            
            processed_lemmas = {item['lemma'] for item in existing_data}
            print(f"已處理 {len(processed_lemmas)} 個單詞，將繼續處理剩餘單詞")
        else:
            print("將從頭開始重新處理所有單詞")
            processed_lemmas = set()
            existing_data = []
    else:
        processed_lemmas = set()
        existing_data = []
    
    # 收集需要處理的單詞
    words_to_process = []
    removed_chinese_words = 0
    for word_data in vocab_data:
        lemma = word_data["lemma"]
        
        # 額外過濾中文單字
        if has_chinese(lemma):
            removed_chinese_words += 1
            continue
            
        if lemma not in processed_lemmas:
            words_to_process.append(word_data)
            
    if removed_chinese_words > 0:
        print(f"\n過濾掉 {removed_chinese_words} 個包含中文的無效單詞")

    if not words_to_process:
        print("\n所有單詞已處理完成！")
        return
    
    total_words = len(vocab_data)
    processed_count = len(processed_lemmas)
    to_process_count = len(words_to_process)
    
    print(f"\n開始篩選例句...")
    print(f"已處理: {processed_count}/{total_words}")
    print(f"待處理: {to_process_count} 個單詞")
    print(f"並發數: {CONCURRENT_REQUESTS}")
    print(f"模型: {MODEL}")
    
    # 創建信號量控制並發
    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)
    
    # 創建異步任務
    tasks = []
    for word_data in words_to_process:
        lemma = word_data["lemma"]
        sentences = word_data.get("sentences", [])
        pos_dist = word_data.get("pos_dist", {})
        
        task = filter_sentences_for_word(lemma, sentences, pos_dist, semaphore)
        tasks.append((word_data, task))
    
    # 執行並發處理
    print(f"\n正在並發處理 {to_process_count} 個單詞...")
    
    filtered_data = list(existing_data)
    
    try:
        # 使用 tqdm 顯示進度
        results = await tqdm.gather(*[task for _, task in tasks], desc="篩選例句")
        
        # 處理結果
        for (word_data, _), result in zip(tasks, results):
            lemma = word_data["lemma"]
            
            # 轉換 Pydantic 模型為字典
            featured_list = [
                {"text": s.text, "source": s.source, "audio_file": ""}
                for s in result.featured
            ]
            other_list = [
                {"text": s.text, "source": s.source, "audio_file": ""}
                for s in result.other
            ]
            
            # 更新單詞數據
            filtered_word = dict(word_data)
            filtered_word["sentences"] = {
                "featured": featured_list,
                "other": other_list
            }
            filtered_word["sentences_removed"] = result.removed_count
            
            filtered_data.append(filtered_word)
            processed_count += 1
            
            # 定期保存（每50個單詞）
            if processed_count % 50 == 0:
                with open(FILTERED_VOCAB_PATH, 'w', encoding='utf-8') as f:
                    json.dump(filtered_data, f, ensure_ascii=False, indent=2)
                print(f"\n[已保存進度: {processed_count}/{total_words}]")
        
        # 最終保存
        with open(FILTERED_VOCAB_PATH, 'w', encoding='utf-8') as f:
            json.dump(filtered_data, f, ensure_ascii=False, indent=2)
        
        print("\n" + "=" * 60)
        print("篩選完成")
        print("=" * 60)
        print(f"處理單詞數: {processed_count}")
        print(f"輸出文件: {FILTERED_VOCAB_PATH}")
        
        # 統計資訊
        total_featured = sum(len(w.get("sentences", {}).get("featured", [])) for w in filtered_data)
        total_other = sum(len(w.get("sentences", {}).get("other", [])) for w in filtered_data)
        total_removed = sum(w.get("sentences_removed", 0) for w in filtered_data)
        
        print(f"\n統計:")
        print(f"  精選例句: {total_featured} 個")
        print(f"  其他例句: {total_other} 個")
        print(f"  刪除例句: {total_removed} 個")
        
    except KeyboardInterrupt:
        print("\n\n用戶中斷！正在保存當前進度...")
        with open(FILTERED_VOCAB_PATH, 'w', encoding='utf-8') as f:
            json.dump(filtered_data, f, ensure_ascii=False, indent=2)
        print(f"進度已保存，已處理 {processed_count}/{total_words} 個單詞")
        print(f"下次運行時選擇 'n' 即可從斷點繼續")
        sys.exit(0)


def has_chinese(text: str) -> bool:
    """檢查文本是否包含中文字符"""
    return bool(re.search(r'[\u4e00-\u9fff]', text))


def parse_sentence(sentence_with_source: str) -> Dict[str, str]:
    """解析句子，分離文本和來源資訊（例如 [112學測]）"""
    source = ""
    text = sentence_with_source
    
    if sentence_with_source.startswith('['):
        bracket_end = sentence_with_source.find(']')
        if bracket_end != -1:
            source = sentence_with_source[1:bracket_end]
            text = sentence_with_source[bracket_end + 1:].strip()
    
    return {
        "text": text,
        "source": source
    }


async def filter_sentences_for_word(
    lemma: str, 
    sentences: List[str], 
    pos_dist: dict,
    semaphore: asyncio.Semaphore
) -> FilteredSentencesResult:
    """
    為單個單詞篩選和清理例句（異步版本）
    使用 Structured Outputs 確保返回格式正確
    保留來源資訊
    """
    if not sentences:
        return FilteredSentencesResult(
            featured=[],
            other=[],
            removed_count=0
        )
    
    # 預處理：移除明顯無效的句子
    valid_sentences = []  # 格式: [{"text": ..., "source": ...}]
    removed_count = 0
    
    for sentence in sentences:
        parsed = parse_sentence(sentence)
        clean_text = parsed["text"]
        
        # 基本驗證
        if (has_chinese(clean_text) or  # 含中文
            len(clean_text.split()) < 5 or  # 太短
            clean_text.lower().startswith(('question', 'answer', 'choose', 'select')) or  # 題目指令
            re.match(r'^\([a-d]\)', clean_text.lower())):  # 選項標記
            removed_count += 1
            continue
        
        valid_sentences.append(parsed)
    
    if not valid_sentences:
        return FilteredSentencesResult(
            featured=[],
            other=[],
            removed_count=removed_count
        )
    
    # 如果句子數量少於等於5，全部作為精選
    if len(valid_sentences) <= 5:
        featured = [
            SentenceWithSource(text=s["text"], source=s["source"])
            for s in valid_sentences
        ]
        return FilteredSentencesResult(
            featured=featured,
            other=[],
            removed_count=removed_count
        )
    
    # 使用 AI 篩選精選例句
    async with semaphore:
        try:
            # 準備例句文本列表（用於 AI 分析）
            sentence_texts = [s["text"] for s in valid_sentences]
            sentences_list = "\n".join([f"{i+1}. {text}" for i, text in enumerate(sentence_texts)])
            
            # 獲取主要詞性
            primary_pos = max(pos_dist.items(), key=lambda x: x[1])[0] if pos_dist else "UNKNOWN"
            
            system_prompt = f"""You are an expert English teacher selecting the best example sentences for vocabulary learning.

Task: From the provided sentences containing the word "{lemma}" ({primary_pos}), select 1-5 FEATURED sentences that:
1. Show different meanings or uses of the word
2. Are clear and easy to understand
3. Demonstrate important or common usage patterns
4. Avoid repetitive contexts

Return ONLY the sentence numbers (1-based index) of the featured sentences, ordered by importance.
The remaining sentences will be kept as "other" examples."""

            user_prompt = f"""Word: {lemma}
Part of Speech: {primary_pos}

Sentences:
{sentences_list}

Select 1-5 featured sentence numbers."""

            # 調用 API（使用 Structured Outputs）
            # 注意：gpt-4o-mini 的 Structured Outputs 不支援自定義 temperature，使用默認值
            response = await client.beta.chat.completions.parse(
                model=MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format=FeaturedSelection
            )
            
            selection = response.choices[0].message.parsed
            
            # 轉換為 0-based index
            featured_indices = set(i - 1 for i in selection.featured_indices if 0 < i <= len(valid_sentences))
            
            # 分類句子（保留來源資訊）
            featured = []
            other = []
            
            for i, sentence_dict in enumerate(valid_sentences):
                sentence_obj = SentenceWithSource(
                    text=sentence_dict["text"],
                    source=sentence_dict["source"]
                )
                
                if i in featured_indices:
                    featured.append(sentence_obj)
                else:
                    other.append(sentence_obj)
            
            # 限制精選句子數量為1-5
            featured = featured[:5]
            
            return FilteredSentencesResult(
                featured=featured,
                other=other,
                removed_count=removed_count
            )
            
        except Exception as e:
            print(f"\n[Warning] 為 '{lemma}' 篩選例句時出錯: {e}")
            
            # 失敗回退：前5個作為精選，其餘作為其他（保留來源）
            featured = [
                SentenceWithSource(text=s["text"], source=s["source"])
                for s in valid_sentences[:5]
            ]
            other = [
                SentenceWithSource(text=s["text"], source=s["source"])
                for s in valid_sentences[5:]
            ]
            
            return FilteredSentencesResult(
                featured=featured,
                other=other,
                removed_count=removed_count
            )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n用戶中斷！")
        sys.exit(0)
