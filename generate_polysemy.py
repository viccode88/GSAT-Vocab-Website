#!/usr/bin/env python3
"""
一字多義分析
使用 OpenAI API 分析每個單字在不同例句中的語境，生成多個意思
"""
import os
import sys
import json
import time
from pathlib import Path
from typing import Dict, Any, List
from dotenv import load_dotenv
from openai import OpenAI

# --- 路徑設定 ---
ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
OUTPUT_DIR = DATA_DIR / "output"
BATCH_DIR = DATA_DIR / "batch"
VOCAB_JSON_PATH = OUTPUT_DIR / "vocab_data_filtered_cleaned.json"
BATCH_INPUT_PATH = BATCH_DIR / "polysemy_batch_input.jsonl"
BATCH_OUTPUT_PATH = BATCH_DIR / "polysemy_batch_output.jsonl"
ENRICHED_VOCAB_PATH = OUTPUT_DIR / "vocab_data_filtered_cleaned_enriched.json"

# 建立資料夾
BATCH_DIR.mkdir(parents=True, exist_ok=True)

# --- OpenAI API 設定 ---
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    sys.exit("請在 .env 檔案中設定您的 OPENAI_API_KEY。")

client = OpenAI(api_key=OPENAI_API_KEY)

# --- 配置 ---
MODEL = "gpt-4o-mini"
MAX_WORDS_PER_BATCH = 50000  # Batch API 限制


def create_batch_input_file(vocab_data: List[Dict[str, Any]]) -> str:
    """
    創建 Batch API 輸入文件
    為每個單詞生成一個請求
    """
    print(f"\n📝 正在創建 Batch 輸入文件...")
    
    system_prompt = """You are an expert lexicographer analyzing English words in context.

Your task: Analyze a word and its example sentences to identify ALL distinct meanings (polysemy).

For each distinct meaning:
1. Identify the part of speech (NOUN, VERB, ADJ, ADV, etc.)
2. Provide a concise Traditional Chinese definition
3. Provide a concise English definition
4. List the indices of example sentences that demonstrate this meaning

Guidelines:
- Consolidate similar meanings into one entry
- Distinguish between different parts of speech
- Distinguish between genuinely different semantic meanings
- Order by frequency (most common first)
- If a word has only one meaning, return one entry

Respond with ONLY a valid JSON object with this structure:
{
  "meanings": [
    {
      "pos": "VERB",
      "zh_def": "中文定義",
      "en_def": "English definition",
      "example_indices": [0, 2, 5],
      "usage_note": "optional usage note"
    }
  ]
}"""

    batch_requests = []
    request_count = 0
    
    for word_data in vocab_data:
        lemma = word_data["lemma"]
        sentences = word_data.get("sentences", [])
        pos_dist = word_data.get("pos_dist", {})
        
        if not sentences:
            continue
        
        # 構建用戶提示
        user_prompt = f"""Word: {lemma}

Part of Speech Distribution: {json.dumps(pos_dist)}

Example Sentences:
"""
        for i, sentence in enumerate(sentences):
            # 移除源標籤，只保留句子文本
            sentence_text = sentence
            if sentence.startswith('['):
                bracket_end = sentence.find(']')
                if bracket_end != -1:
                    sentence_text = sentence[bracket_end + 1:].strip()
            user_prompt += f"{i}. {sentence_text}\n"
        
        # 創建批次請求
        batch_request = {
            "custom_id": f"polysemy_{lemma}",
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.3,
                "max_tokens": 2000
            }
        }
        
        batch_requests.append(batch_request)
        request_count += 1
        
        if request_count >= MAX_WORDS_PER_BATCH:
            print(f"⚠️  達到批次限制 ({MAX_WORDS_PER_BATCH})，將只處理前 {request_count} 個單詞")
            break
    
    # 寫入 JSONL 文件
    with open(BATCH_INPUT_PATH, 'w', encoding='utf-8') as f:
        for request in batch_requests:
            f.write(json.dumps(request, ensure_ascii=False) + '\n')
    
    print(f"✅ 已創建包含 {len(batch_requests)} 個請求的批次文件")
    print(f"   文件路徑: {BATCH_INPUT_PATH}")
    
    return str(BATCH_INPUT_PATH)


def upload_batch_file(file_path: str) -> str:
    """上傳批次輸入文件到 OpenAI"""
    print(f"\n📤 正在上傳批次文件...")
    
    with open(file_path, 'rb') as f:
        batch_file = client.files.create(
            file=f,
            purpose="batch"
        )
    
    print(f"✅ 文件已上傳，File ID: {batch_file.id}")
    return batch_file.id


def create_batch_job(input_file_id: str) -> str:
    """創建批次處理任務"""
    print(f"\n🚀 正在創建批次處理任務...")
    
    batch = client.batches.create(
        input_file_id=input_file_id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
        metadata={
            "description": "GSAT vocabulary polysemy analysis",
            "project": "vocab-website"
        }
    )
    
    print(f"✅ 批次任務已創建")
    print(f"   Batch ID: {batch.id}")
    print(f"   狀態: {batch.status}")
    
    return batch.id


def check_batch_status(batch_id: str) -> Dict[str, Any]:
    """檢查批次處理狀態"""
    batch = client.batches.retrieve(batch_id)
    
    status_info = {
        "id": batch.id,
        "status": batch.status,
        "created_at": batch.created_at,
        "completed_at": batch.completed_at,
        "failed_at": batch.failed_at,
        "expired_at": batch.expired_at,
        "output_file_id": batch.output_file_id,
        "error_file_id": batch.error_file_id,
        "request_counts": batch.request_counts
    }
    
    return status_info


def download_batch_results(output_file_id: str, output_path: Path) -> bool:
    """下載批次處理結果"""
    print(f"\n正在下載批次結果...")
    
    try:
        file_response = client.files.content(output_file_id)
        
        with open(output_path, 'wb') as f:
            f.write(file_response.content)
        
        print(f"✅ 結果已下載到: {output_path}")
        return True
    except Exception as e:
        print(f"❌ 下載失敗: {e}")
        return False


def merge_polysemy_results(vocab_data: List[Dict[str, Any]], batch_output_path: Path) -> List[Dict[str, Any]]:
    """
    將批次處理結果合併到詞彙數據中
    """
    print(f"\n正在合併多義分析結果...")
    
    # 讀取批次輸出
    polysemy_results = {}
    
    with open(batch_output_path, 'r', encoding='utf-8') as f:
        for line in f:
            result = json.loads(line)
            custom_id = result.get("custom_id", "")
            
            if not custom_id.startswith("polysemy_"):
                continue
            
            lemma = custom_id.replace("polysemy_", "")
            
            # 檢查是否有錯誤
            if result.get("error"):
                print(f"⚠️  單詞 '{lemma}' 處理失敗: {result['error']}")
                continue
            
            # 提取響應內容
            response = result.get("response", {})
            body = response.get("body", {})
            choices = body.get("choices", [])
            
            if not choices:
                print(f"⚠️  單詞 '{lemma}' 無響應內容")
                continue
            
            content = choices[0].get("message", {}).get("content", "")
            
            try:
                meanings_data = json.loads(content)
                polysemy_results[lemma] = meanings_data.get("meanings", [])
            except json.JSONDecodeError as e:
                print(f"⚠️  單詞 '{lemma}' 的響應無法解析為 JSON: {e}")
                continue
    
    print(f"✅ 成功解析 {len(polysemy_results)} 個單詞的多義分析結果")
    
    # 合併到原始數據
    enriched_count = 0
    for word_data in vocab_data:
        lemma = word_data["lemma"]
        
        if lemma in polysemy_results:
            word_data["meanings"] = polysemy_results[lemma]
            enriched_count += 1
        else:
            # 如果沒有批次結果，使用原有的簡單定義
            word_data["meanings"] = []
            if "definition" in word_data and word_data["definition"]:
                # 將舊格式轉換為新格式
                old_def = word_data["definition"]
                primary_pos = list(word_data.get("pos_dist", {}).keys())[0] if word_data.get("pos_dist") else "UNKNOWN"
                word_data["meanings"] = [{
                    "pos": primary_pos,
                    "zh_def": old_def.get("zh_def", ""),
                    "en_def": old_def.get("en_def", ""),
                    "example_indices": list(range(min(3, len(word_data.get("sentences", []))))),
                    "usage_note": old_def.get("example", "")
                }]
    
    print(f"✅ 已為 {enriched_count} 個單詞添加多義分析")
    
    return vocab_data


def main():
    """主執行函式"""
    print("=" * 60)
    print("一字多義分析工具 (OpenAI Batch API)")
    print("=" * 60)
    
    # 檢查輸入文件
    if not VOCAB_JSON_PATH.exists():
        sys.exit(f"❌ 找不到詞彙數據文件: {VOCAB_JSON_PATH}")
    
    print(f"\n📖 正在讀取詞彙數據: {VOCAB_JSON_PATH}")
    with open(VOCAB_JSON_PATH, 'r', encoding='utf-8') as f:
        vocab_data = json.load(f)
    
    print(f"✅ 已載入 {len(vocab_data)} 個單詞")
    
    # 選擇操作模式
    print("\n請選擇操作模式：")
    print("1. 創建新的批次任務")
    print("2. 檢查現有批次狀態")
    print("3. 下載並合併批次結果")
    
    choice = input("\n請輸入選項 (1-3): ").strip()
    
    if choice == "1":
        # 模式 1: 創建新批次
        input_file_path = create_batch_input_file(vocab_data)
        file_id = upload_batch_file(input_file_path)
        batch_id = create_batch_job(file_id)
        
        # 保存批次 ID
        batch_info_path = BATCH_DIR / "batch_info.json"
        with open(batch_info_path, 'w', encoding='utf-8') as f:
            json.dump({
                "batch_id": batch_id,
                "input_file_id": file_id,
                "created_at": time.time(),
                "status": "submitted"
            }, f, indent=2)
        
        print(f"\n💾 批次資訊已保存到: {batch_info_path}")
        print(f"\n⏰ 請稍後使用選項 2 檢查狀態，或選項 3 下載結果")
        
    elif choice == "2":
        # 模式 2: 檢查狀態
        batch_info_path = BATCH_DIR / "batch_info.json"
        
        if not batch_info_path.exists():
            print("❌ 找不到批次資訊文件，請先創建批次任務")
            return
        
        with open(batch_info_path, 'r', encoding='utf-8') as f:
            batch_info = json.load(f)
        
        batch_id = batch_info.get("batch_id")
        if not batch_id:
            print("❌ 批次 ID 無效")
            return
        
        print(f"\n🔍 正在檢查批次狀態: {batch_id}")
        status_info = check_batch_status(batch_id)
        
        print(f"\n批次狀態資訊：")
        print(f"  狀態: {status_info['status']}")
        print(f"  創建時間: {status_info['created_at']}")
        print(f"  完成時間: {status_info['completed_at']}")
        print(f"  請求統計: {status_info['request_counts']}")
        
        if status_info['status'] == 'completed':
            print(f"\n✅ 批次處理已完成！")
            print(f"  輸出文件 ID: {status_info['output_file_id']}")
            print(f"\n請使用選項 3 下載結果")
            
            # 更新批次資訊
            batch_info["status"] = "completed"
            batch_info["output_file_id"] = status_info['output_file_id']
            batch_info["completed_at"] = status_info['completed_at']
            with open(batch_info_path, 'w', encoding='utf-8') as f:
                json.dump(batch_info, f, indent=2)
        elif status_info['status'] in ['failed', 'expired', 'cancelled']:
            print(f"\n❌ 批次處理失敗或被取消")
            if status_info['error_file_id']:
                print(f"  錯誤文件 ID: {status_info['error_file_id']}")
        else:
            print(f"\n⏳ 批次仍在處理中，請稍後再檢查")
    
    elif choice == "3":
        # 模式 3: 下載並合併結果
        batch_info_path = BATCH_DIR / "batch_info.json"
        
        if not batch_info_path.exists():
            print("❌ 找不到批次資訊文件")
            return
        
        with open(batch_info_path, 'r', encoding='utf-8') as f:
            batch_info = json.load(f)
        
        output_file_id = batch_info.get("output_file_id")
        
        if not output_file_id:
            # 嘗試獲取最新狀態
            batch_id = batch_info.get("batch_id")
            if batch_id:
                status_info = check_batch_status(batch_id)
                output_file_id = status_info.get('output_file_id')
        
        if not output_file_id:
            print("❌ 批次尚未完成或找不到輸出文件 ID")
            print("   請先使用選項 2 檢查狀態")
            return
        
        # 下載結果
        if download_batch_results(output_file_id, BATCH_OUTPUT_PATH):
            # 合併結果
            enriched_vocab = merge_polysemy_results(vocab_data, BATCH_OUTPUT_PATH)
            
            # 保存增強後的詞彙數據
            with open(ENRICHED_VOCAB_PATH, 'w', encoding='utf-8') as f:
                json.dump(enriched_vocab, f, ensure_ascii=False, indent=2)
            
            print(f"\n詞彙數據已保存到: {ENRICHED_VOCAB_PATH}")
    
    else:
        print("❌ 無效的選項")


if __name__ == "__main__":
    main()

