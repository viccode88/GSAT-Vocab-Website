import json
import os
from pathlib import Path
import shutil

# --- Helper Functions from optimize_data_structure.py ---

def create_index_entry(word_data: dict, rank: int) -> dict:
    """Creates a lightweight index entry for the vocabulary list."""
    lemma = word_data["lemma"]
    count = word_data.get("count", 0)
    pos_dist = word_data.get("pos_dist", {})
    
    primary_pos = max(pos_dist, key=pos_dist.get) if pos_dist else ""
    
    meanings = word_data.get("meanings", [])
    meaning_count = len(meanings)
    
    zh_preview = ""
    en_preview = ""
    if meanings:
        zh_preview = meanings[0].get("zh_def", "")[:50]
        en_preview = meanings[0].get("en_def", "")[:50]
    
    return {
        "lemma": lemma,
        "count": count,
        "rank": rank,
        "primary_pos": primary_pos,
        "meaning_count": meaning_count,
        "zh_preview": zh_preview,
        "en_preview": en_preview
    }

def generate_search_index(vocab_data: list[dict]) -> dict:
    """Generates a search index for quick filtering on the frontend."""
    search_index = {
        "by_pos": {},
    }
    
    for idx, word_data in enumerate(vocab_data):
        lemma = word_data["lemma"]
        pos_dist = word_data.get("pos_dist", {})
        for pos in pos_dist.keys():
            if pos not in search_index["by_pos"]:
                search_index["by_pos"][pos] = []
            search_index["by_pos"][pos].append(lemma)
            
    return search_index

# --- Main Script ---

def main():
    """
    Splits the combined vocabulary data file into individual JSON files for each lemma,
    and also generates the vocabulary index and search index files.
    """
    print("=" * 60)
    print("腳本：準備 API 資料 (拆分詳情 + 建立索引)")
    print("=" * 60)

    # --- Path settings ---
    PROJECT_ROOT = Path(__file__).parent
    INPUT_FILE = PROJECT_ROOT / "data" / "output" / "vocab_data_filtered_cleaned_with_audio.json"
    OUTPUT_DIR_DETAILS = PROJECT_ROOT / "data" / "output" / "vocab_details"
    OUTPUT_FILE_INDEX = PROJECT_ROOT / "data" / "output" / "vocab_index.json"
    OUTPUT_FILE_SEARCH_INDEX = PROJECT_ROOT / "data" / "output" / "search_index.json"

    print(f"📖 輸入檔案: {INPUT_FILE}")
    print(f"📂 輸出詳情資料夾: {OUTPUT_DIR_DETAILS}")
    print(f"📑 輸出詞彙索引: {OUTPUT_FILE_INDEX}")
    print(f"🔍 輸出搜尋索引: {OUTPUT_FILE_SEARCH_INDEX}")

    # --- Check for input file ---
    if not INPUT_FILE.exists():
        print(f"❌ 錯誤：找不到輸入檔案。請先執行之前的處理步驟。")
        return

    # --- Prepare output directory ---
    print(f"\n🔄 正在準備輸出資料夾...")
    if OUTPUT_DIR_DETAILS.exists():
        print(f"   - 正在清空已存在的資料夾: {OUTPUT_DIR_DETAILS}")
        shutil.rmtree(OUTPUT_DIR_DETAILS)
    
    OUTPUT_DIR_DETAILS.mkdir(parents=True)
    print(f"   - ✅ 已建立新的輸出資料夾。")

    # --- Read data and process ---
    try:
        print("\n📚 正在讀取合併的詞彙資料...")
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            all_vocab_data = json.load(f)
        print(f"   - ✅ 成功讀取 {len(all_vocab_data)} 個詞彙。")

        # --- Generate and save individual detail files ---
        print("\n✍️  正在生成獨立的詳情 JSON 檔案...")
        details_count = 0
        for vocab_item in all_vocab_data:
            lemma = vocab_item.get("lemma")
            if not lemma:
                print(f"   - ⚠️  警告：找到一個沒有 'lemma' 的項目，已跳過。")
                continue

            safe_lemma = lemma.replace("/", "_")
            output_path = OUTPUT_DIR_DETAILS / f"{safe_lemma}.json"
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(vocab_item, f, indent=2, ensure_ascii=False)
            details_count += 1
        print(f"   - ✅ 成功生成 {details_count} 個詳情檔案！")

        # --- Generate and save vocabulary index ---
        print("\n📑 正在生成詞彙索引...")
        vocab_index = [create_index_entry(word, i + 1) for i, word in enumerate(all_vocab_data)]
        with open(OUTPUT_FILE_INDEX, 'w', encoding='utf-8') as f:
            json.dump(vocab_index, f, indent=2, ensure_ascii=False)
        print(f"   - ✅ 詞彙索引已儲存至: {OUTPUT_FILE_INDEX}")

        # --- Generate and save search index ---
        print("\n🔍 正在生成搜尋索引...")
        search_idx = generate_search_index(all_vocab_data)
        with open(OUTPUT_FILE_SEARCH_INDEX, 'w', encoding='utf-8') as f:
            json.dump(search_idx, f, indent=2, ensure_ascii=False)
        print(f"   - ✅ 搜尋索引已儲存至: {OUTPUT_FILE_SEARCH_INDEX}")

        print(f"\n🎉 處理完成！所有 API 資料已準備就緒。")

    except json.JSONDecodeError:
        print(f"❌ 錯誤：輸入檔案 '{INPUT_FILE}' 不是一個有效的 JSON 檔案。")
    except Exception as e:
        print(f"❌ 發生未預期的錯誤: {e}")

if __name__ == "__main__":
    main()
