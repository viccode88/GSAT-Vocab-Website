#!/usr/bin/env python3
"""
上傳 vocab_details 檔案到 R2
使用多進程並行上傳
"""

import subprocess
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

# 配置
DATA_DIR = "data/output/vocab_details"
BUCKET = "vocab-data"
MAX_WORKERS = 8  # 並行上傳數（降低以避免速率限制）

def upload_file(file_path):
    """上傳單個檔案到 R2"""
    filename = os.path.basename(file_path)
    r2_path = f"{BUCKET}/vocab_details/{filename}"
    
    try:
        result = subprocess.run(
            ["wrangler", "r2", "object", "put", r2_path, f"--file={file_path}", "--remote"],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode == 0:
            return (True, filename)
        else:
            return (False, filename, result.stderr)
    except Exception as e:
        return (False, filename, str(e))

def main():
    # 獲取所有 JSON 檔案
    vocab_dir = Path(DATA_DIR)
    json_files = list(vocab_dir.glob("*.json"))
    total_files = len(json_files)
    
    print(f"找到 {total_files} 個檔案需要上傳")
    print(f"使用 {MAX_WORKERS} 個並行線程")
    print()
    
    # 並行上傳
    success_count = 0
    fail_count = 0
    failed_files = []
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # 提交所有任務
        futures = {executor.submit(upload_file, str(f)): f for f in json_files}
        
        # 使用 tqdm 顯示進度
        with tqdm(total=total_files, desc="上傳進度", unit="檔案") as pbar:
            for future in as_completed(futures):
                result = future.result()
                pbar.update(1)
                
                if result[0]:
                    success_count += 1
                else:
                    fail_count += 1
                    failed_files.append((result[1], result[2] if len(result) > 2 else "Unknown error"))
    
    # 顯示結果
    print()
    print("=" * 60)
    print(f"✅ 成功上傳: {success_count} 個檔案")
    print(f"❌ 失敗: {fail_count} 個檔案")
    print("=" * 60)
    
    if failed_files:
        print("\n失敗的檔案:")
        for filename, error in failed_files[:10]:  # 只顯示前10個
            print(f"  - {filename}: {error[:100]}")
        if len(failed_files) > 10:
            print(f"  ... 還有 {len(failed_files) - 10} 個失敗檔案")

if __name__ == "__main__":
    main()

