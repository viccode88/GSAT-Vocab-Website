import json
import os

def export_lemmas_to_file(data, original_filepath):
    """從資料中提取所有 'lemma' 並將它們儲存到一個文字檔中。"""
    if not data:
        print("\n資料是空的，沒有單字可以匯出。")
        return

    base, _ = os.path.splitext(original_filepath)
    default_export_path = f"{base}_wordlist.txt"
    export_path = input(f"👉 請輸入匯出單字列表的檔名 (預設為 '{default_export_path}'): ").strip() or default_export_path

    try:
        lemmas = [item.get('lemma', 'N/A') for item in data if isinstance(item, dict)]
        with open(export_path, 'w', encoding='utf-8') as f:
            f.writelines(f"{lemma}\n" for lemma in lemmas)
        print(f"\n✅ 成功匯出 {len(lemmas)} 個單字至 '{export_path}'。")
    except Exception as e:
        print(f"❌ 匯出檔案時發生錯誤：{e}")


def interactive_tool(data, original_filepath):
    """一個互動式工具，用於單一/批次刪除單字，或匯出單字列表。"""
    current_data = list(data)

    while True:
        print("-" * 50)
        prompt_text = "👉 請輸入指令 ('單字' 或 '字1,字2,...' 刪除 / 'export' 匯出 / 'exit' 結束): "
        user_input = input(prompt_text).strip()
        
        lower_input = user_input.lower()

        if lower_input in ['exit', 'quit']:
            print("\n👋 結束編輯模式...")
            break
        if not user_input:
            continue
        if lower_input == 'export':
            export_lemmas_to_file(current_data, original_filepath)
            continue

        # --- 刪除邏輯 ---
        # 根據輸入中是否包含逗號，來決定是批次刪除還是單一刪除
        if ',' in user_input:
            # 【批次刪除模式】
            words_to_delete = {word.strip().lower() for word in user_input.split(',') if word.strip()}
            
            found_items = []
            not_found_lemmas = set(words_to_delete)

            for item in current_data:
                lemma = item.get('lemma', '').lower()
                if lemma in not_found_lemmas:
                    found_items.append(item)
                    not_found_lemmas.remove(lemma)
            
            # 報告找不到的單字
            if not_found_lemmas:
                print(f"\n❌ 以下 {len(not_found_lemmas)} 個單字未找到: {', '.join(sorted(list(not_found_lemmas)))}")
            
            # 如果沒有找到任何一個單字，就直接進入下一次迴圈
            if not found_items:
                print("➡️ 您輸入的單字均未在資料中找到。")
                continue

            print(f"\n✅ 以下 {len(found_items)} 個單字已找到，準備刪除:")
            print(', '.join(sorted([item['lemma'] for item in found_items])))
            
            confirm = input(f"\n❓ 您確定要一次刪除這 {len(found_items)} 筆資料嗎？ (請輸入 'yes' 確認): ").strip().lower()

            if confirm == 'yes':
                lemmas_to_delete_set = {item['lemma'].lower() for item in found_items}
                original_count = len(current_data)
                current_data = [item for item in current_data if item.get('lemma', '').lower() not in lemmas_to_delete_set]
                deleted_count = original_count - len(current_data)
                print(f"\n🗑️ 已成功刪除 {deleted_count} 筆資料。")
            else:
                print("\n👍 已取消刪除操作。")

        else:
            # 【單一刪除模式】
            word_to_find = lower_input
            found_item = None
            item_index = -1

            for i, item in enumerate(current_data):
                if item.get("lemma", "").lower() == word_to_find:
                    found_item = item
                    item_index = i
                    break
            
            if found_item:
                print("\n✅ 找到符合的資料：")
                print(json.dumps(found_item, indent=2, ensure_ascii=False))
                confirm = input(f"\n❓ 您確定要刪除 '{found_item['lemma']}' 這筆資料嗎？ (請輸入 'yes' 確認): ").strip().lower()

                if confirm == 'yes':
                    del current_data[item_index]
                    print(f"\n🗑️ 資料 '{found_item['lemma']}' 已成功刪除。")
                else:
                    print("\n👍 已取消刪除操作。")
            else:
                print(f"\n❌ 在 {len(current_data)} 筆資料中，找不到單字 '{word_to_find}'。")

    return current_data


def main():
    """主函式，負責讀取檔案、呼叫編輯工具、並儲存檔案。"""
    json_path = input("👉 請輸入您的 JSON 檔案路徑: ").strip()
    
    if not os.path.exists(json_path):
        print(f"❌ 錯誤：檔案不存在於 '{json_path}'。程式結束。")
        return
        
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            original_data = json.load(f)
        if not isinstance(original_data, list):
             print(f"❌ 錯誤：JSON 檔案的內容不是一個列表 (list)。程式結束。")
             return
        print(f"✅ 成功從 '{json_path}' 載入 {len(original_data)} 筆資料。\n")
    except Exception as e:
        print(f"❌ 載入檔案時發生錯誤：{e}。程式結束。")
        return

    final_data = interactive_tool(original_data, json_path)

    if len(final_data) < len(original_data):
        save_choice = input("\n❓ 資料已被修改，您想要儲存變更嗎？ (yes/no): ").strip().lower()
        if save_choice == 'yes':
            base, ext = os.path.splitext(json_path)
            default_new_path = f"{base}_updated{ext}"
            new_path = input(f"👉 請輸入儲存的新檔案路徑 (預設為 '{default_new_path}'): ").strip() or default_new_path
            
            try:
                with open(new_path, 'w', encoding='utf-8') as f:
                    json.dump(final_data, f, ensure_ascii=False, indent=2)
                print(f"\n💾 檔案已成功儲存至 '{new_path}'，共包含 {len(final_data)} 筆資料。")
            except Exception as e:
                print(f"❌ 儲存檔案時發生錯誤：{e}")
    else:
        print("\n資料未被修改，無需儲存。")

    print("\n程式執行完畢。")

if __name__ == "__main__":
    main()