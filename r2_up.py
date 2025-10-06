# r2_uploader.py
import os
import sys
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

# --- 使用者設定 ---
# 您的 R2 貯體名稱
BUCKET_NAME = "vocab-audio"
# 您要上傳的本地資料夾完整路徑
SOURCE_DIR = "/Users/icv/Documents/project/單字頻率/data/output/tts_audio"
# 設定最大同時上傳數量 (執行緒數量)
MAX_WORKERS = 10
# ------------------


def get_r2_credentials():
    """從環境變數中取得 R2 憑證"""
    try:
        account_id = os.environ['R2_ACCOUNT_ID']
        access_key_id = os.environ['R2_ACCESS_KEY_ID']
        secret_access_key = os.environ['R2_SECRET_ACCESS_KEY']
        return account_id, access_key_id, secret_access_key
    except KeyError as e:
        print(f"❌ 錯誤：缺少環境變數 {e}。")
        print("請設定 R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, 和 R2_SECRET_ACCESS_KEY。")
        sys.exit(1)

def upload_file(s3_client, file_path, bucket_name, source_dir):
    """
    上傳單一檔案到 R2。
    boto3 的 upload_file 會自動處理分段上傳和重試。
    """
    try:
        # 產生物件在 R2 中的路徑 (key)，保留子目錄結構
        relative_path = os.path.relpath(file_path, source_dir)
        object_key = relative_path.replace(os.path.sep, '/')

        s3_client.upload_file(file_path, bucket_name, object_key)
        return (file_path, True, None)
    except ClientError as e:
        # 所有自動重試都失敗後，才會觸發這裡
        return (file_path, False, e.response['Error']['Message'])
    except Exception as e:
        return (file_path, False, str(e))

def main():
    """主執行函式"""
    print("🚀 準備開始上傳檔案至 Cloudflare R2...")

    # 1. 取得憑證並建立 S3 客戶端
    account_id, access_key_id, secret_access_key = get_r2_credentials()
    endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"

    # 2. 設定重試策略 (關鍵！)
    # 'adaptive' 模式會自動啟用指數退避、抖動和客戶端速率限制
    retry_config = Config(
        retries={
            'max_attempts': 10,  # 最多重試 10 次
            'mode': 'adaptive'   # 使用最新的自適應重試模式
        },
        connect_timeout=10,
        read_timeout=60
    )

    try:
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=retry_config
        )
        # 驗證憑證是否有效
        s3.list_buckets() 
    except NoCredentialsError:
        print("❌ 錯誤：找不到憑證，請檢查您的環境變數設定。")
        sys.exit(1)
    except ClientError as e:
        if e.response['Error']['Code'] == 'InvalidAccessKeyId':
            print("❌ 錯誤：Access Key ID 無效。請檢查您的憑證。")
        elif e.response['Error']['Code'] == 'SignatureDoesNotMatch':
            print("❌ 錯誤：Secret Access Key 無效。請檢查您的憑證。")
        else:
            print(f"❌ 連線至 R2 時發生未預期的錯誤: {e}")
        sys.exit(1)

    # 3. 尋找所有要上傳的檔案
    files_to_upload = []
    print(f"🔍 正在從 '{SOURCE_DIR}' 搜尋檔案...")
    for root, _, files in os.walk(SOURCE_DIR):
        for filename in files:
            # 忽略 macOS 的 .DS_Store 等隱藏檔案
            if not filename.startswith('.'):
                files_to_upload.append(os.path.join(root, filename))

    if not files_to_upload:
        print("📂 在來源資料夾中找不到任何檔案。")
        return

    total_files = len(files_to_upload)
    print(f"✅ 找到 {total_files} 個檔案。開始上傳...")

    # 4. 使用執行緒池進行平行上傳，並顯示進度條
    success_count = 0
    failure_count = 0
    failed_files = []

    with tqdm(total=total_files, desc="上傳進度", unit="file") as pbar:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            # 提交所有任務
            futures = {executor.submit(upload_file, s3, f, BUCKET_NAME, SOURCE_DIR): f for f in files_to_upload}

            # 處理已完成的任務
            for future in as_completed(futures):
                _filepath, success, error_msg = future.result()
                if success:
                    success_count += 1
                else:
                    failure_count += 1
                    failed_files.append((_filepath, error_msg))
                pbar.update(1)

    # 5. 輸出最終結果
    print("\n--- 上傳完成 ---")
    print(f"🎉 成功: {success_count} 個")
    print(f"🔥 失敗: {failure_count} 個")

    if failed_files:
        print("\n以下檔案上傳失敗 (已歷經多次自動重試):")
        for f, reason in failed_files:
            print(f"  - {f}: {reason}")

if __name__ == "__main__":
    main()