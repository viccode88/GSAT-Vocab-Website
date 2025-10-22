import os
import boto3
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm
import sys
from pathlib import Path

# 從專案根目錄的 .env 檔案載入環境變數
load_dotenv(dotenv_path=Path(__file__).parent / '.env')

# --- 組態設定 ---
# 從環境變數讀取憑證
ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
BUCKET_NAME = "vocab-audio"  # 固定使用音檔儲存桶

# 本地與 R2 路徑設定
# 腳本預設放置於 'GSAT-Vocab-Website' 專案根目錄
SOURCE_DIR = str(Path(__file__).parent / "data" / "output" / "tts_audio" / "sentences")
R2_PREFIX = "sentences"

# 平行上傳數量
MAX_WORKERS = 10

# --- S3 客戶端初始化 ---
def get_s3_client():
    """初始化並返回一個用於 Cloudflare R2 的 boto3 S3 客戶端。"""
    if not all([ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY]):
        print("❌ 錯誤：缺少必要的 R2 环境变量 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)")
        print("請確保專案根目錄下有 .env 檔案並已正確設定。")
        sys.exit(1)
        
    endpoint_url = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"
    
    s3_client = boto3.client(
        service_name='s3',
        endpoint_url=endpoint_url,
        aws_access_key_id=ACCESS_KEY_ID,
        aws_secret_access_key=SECRET_ACCESS_KEY,
        region_name="auto",
    )
    return s3_client

# --- 檔案上傳邏輯 ---
def upload_file(s3_client, file_path, bucket, object_name):
    """上傳單一檔案到 R2 並返回檔案名稱和狀態。"""
    try:
        s3_client.upload_file(file_path, bucket, object_name)
        return file_path, True
    except Exception as e:
        return file_path, e

# --- 主要執行函式 ---
def main():
    """尋找檔案並以平行方式上傳。"""
    print("============================================================")
    print("臨時腳本：上傳例句音檔 (sentences) 到 Cloudflare R2")
    print("============================================================")

    if not os.path.isdir(SOURCE_DIR):
        print(f"❌ 錯誤：來源目錄不存在 {SOURCE_DIR}")
        print("請確保您已手動建立該目錄並放入 .mp3 檔案。")
        sys.exit(1)

    # 尋找所有要上傳的 MP3 檔案
    files_to_upload = [os.path.join(SOURCE_DIR, f) for f in os.listdir(SOURCE_DIR) if f.endswith('.mp3')]
    total_files = len(files_to_upload)

    if total_files == 0:
        print(f"📂 在目錄 {SOURCE_DIR} 下沒有找到 .mp3 檔案，無需上傳。")
        sys.exit(0)

    print(f"📊 找到 {total_files} 個 .mp3 檔案")
    print(f"📦 目標 R2 Bucket: {BUCKET_NAME}")
    print(f"📁 目標 R2 路徑: {R2_PREFIX}/")
    print("")

    # 確認提示
    try:
        reply = input("是否繼續上傳？(y/n): ").lower().strip()
        if reply != 'y':
            print("❌ 操作已取消")
            sys.exit(0)
    except (KeyboardInterrupt, EOFError):
        print("\n❌ 操作已取消")
        sys.exit(0)

    print("\n🚀 開始上傳...")

    s3 = get_s3_client()
    success_count = 0
    fail_count = 0
    failed_files = []

    # 使用 ThreadPoolExecutor 進行平行上傳
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # 為每個檔案上傳建立一個 future
        future_to_file = {
            executor.submit(
                upload_file, 
                s3, 
                file_path, 
                BUCKET_NAME, 
                f"{R2_PREFIX}/{os.path.basename(file_path)}"
            ): file_path for file_path in files_to_upload
        }

        # 處理完成的任務，並顯示進度條
        with tqdm(total=total_files, desc="上傳進度", unit="file") as pbar:
            for future in as_completed(future_to_file):
                file_path, result = future.result()
                if result is True:
                    success_count += 1
                else:
                    fail_count += 1
                    failed_files.append((os.path.basename(file_path), str(result)))
                pbar.update(1)

    # --- 總結 ---
    print("\n\n============================================================")
    print("上傳完成")
    print("============================================================")
    print(f"✅ 成功: {success_count} 個文件")
    print(f"❌ 失敗: {fail_count} 個文件")
    print(f"📊 總計: {total_files} 個文件")
    print("")

    if fail_count == 0:
        print("🎉 所有文件上傳成功！")
    else:
        print(f"⚠️  有 {fail_count} 個文件上傳失敗，請檢查錯誤:")
        for filename, error in failed_files:
            print(f"  - {filename}: {error}")

if __name__ == "__main__":
    main()
