import os
import sys
import json
import hashlib
import boto3
from pathlib import Path
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm
from dotenv import load_dotenv

# 加載 .env 文件
load_dotenv()

# 您的 R2 貯體名稱
BUCKET_NAME = "vocab-audio"
# 您要上傳的本地資料夾完整路徑
SOURCE_DIR = str(Path(__file__).parent / "data" / "output" / "tts_audio" / "sentences")
# 設定最大同時上傳數量 (執行緒數量)
MAX_WORKERS = 10
# 音頻清單文件路徑
MANIFEST_PATH = Path(__file__).parent / "data" / "output" / "audio_manifest.json"


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


def calculate_file_md5(file_path):
    """計算文件的 MD5 哈希值"""
    md5 = hashlib.md5()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            md5.update(chunk)
    return md5.hexdigest()


def load_manifest():
    """載入音頻清單"""
    if MANIFEST_PATH.exists():
        with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_manifest(manifest):
    """保存音頻清單"""
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"✅ 音頻清單已保存到: {MANIFEST_PATH}")


def check_file_exists_in_r2(s3_client, bucket_name, object_key):
    """檢查文件是否已存在於 R2"""
    try:
        s3_client.head_object(Bucket=bucket_name, Key=object_key)
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            return False
        raise

def upload_file(s3_client, file_path, bucket_name, source_dir, manifest, force_upload=False):
    """
    上傳單一檔案到 R2（支持增量上傳）。
    boto3 的 upload_file 會自動處理分段上傳和重試。
    """
    try:
        # ----- 修改開始 -----
        # 強制 object_key 包含 'sentences/' 前綴
        # original: relative_path = os.path.relpath(file_path, source_dir)
        # original: object_key = relative_path.replace(os.path.sep, '/')
        filename = os.path.basename(file_path)
        object_key = f"sentences/{filename}"
        # ----- 修改結束 -----
        
        # 計算文件 MD5
        file_md5 = calculate_file_md5(file_path)
        file_size = os.path.getsize(file_path)
        
        # 檢查是否需要上傳
        if not force_upload and object_key in manifest:
            existing_md5 = manifest[object_key].get('md5')
            if existing_md5 == file_md5:
                # 文件未變更，跳過
                return (file_path, 'skipped', None, object_key, file_md5, file_size)
        
        # 上傳文件
        s3_client.upload_file(file_path, bucket_name, object_key)
        return (file_path, 'success', None, object_key, file_md5, file_size)
    except ClientError as e:
        # 所有自動重試都失敗後，會觸發這裡
        return (file_path, 'failed', e.response['Error']['Message'], None, None, None)
    except Exception as e:
        return (file_path, 'failed', str(e), None, None, None)

def main():
    """主執行函式"""
    print("=" * 60)
    print("Cloudflare R2 音頻上傳工具（增量上傳）")
    print("=" * 60)

    # 載入現有清單
    print(f"\n📖 正在載入音頻清單...")
    manifest = load_manifest()
    print(f"✅ 清單中已有 {len(manifest)} 個文件記錄")

    # 1. 取得憑證並建立 S3 客戶端
    account_id, access_key_id, secret_access_key = get_r2_credentials()
    endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"

    # 2. 重試策略
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
        # 驗證憑證有效性
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
    print(f"\n🔍 正在從 '{SOURCE_DIR}' 搜尋檔案...")
    
    if not os.path.exists(SOURCE_DIR):
        print(f"❌ 來源目錄不存在: {SOURCE_DIR}")
        return
    
    for root, _, files in os.walk(SOURCE_DIR):
        for filename in files:
            # 忽略 macOS 的 .DS_Store 等垃圾檔案
            if not filename.startswith('.') and filename.endswith('.mp3'):
                files_to_upload.append(os.path.join(root, filename))

    if not files_to_upload:
        print("📂 在來源資料夾中找不到任何音頻檔案。")
        return

    total_files = len(files_to_upload)
    print(f"✅ 找到 {total_files} 個音頻檔案")
    
    # 詢問是否強制上傳所有文件
    force_upload = False
    force_choice = input("\n是否強制重新上傳所有文件？(yes/no，默認no): ").strip().lower()
    if force_choice == 'yes':
        force_upload = True
        print("⚠️  將強制上傳所有文件")
    else:
        print("✅ 將使用增量上傳（只上傳新增或變更的文件）")

    # 4. 使用執行緒池進行平行上傳，並顯示進度條
    success_count = 0
    skipped_count = 0
    failure_count = 0
    failed_files = []
    updated_manifest = manifest.copy()

    print(f"\n開始上傳...")
    with tqdm(total=total_files, desc="上傳進度", unit="file") as pbar:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            # 提交所有任務
            futures = {
                executor.submit(upload_file, s3, f, BUCKET_NAME, SOURCE_DIR, manifest, force_upload): f 
                for f in files_to_upload
            }

            # 處理已完成的任務
            for future in as_completed(futures):
                filepath, status, error_msg, object_key, file_md5, file_size = future.result()
                
                if status == 'success':
                    success_count += 1
                    # 更新清單
                    updated_manifest[object_key] = {
                        'md5': file_md5,
                        'size': file_size,
                        'local_path': filepath
                    }
                elif status == 'skipped':
                    skipped_count += 1
                else:
                    failure_count += 1
                    failed_files.append((filepath, error_msg))
                
                pbar.update(1)

    # 5. 保存更新後的清單
    save_manifest(updated_manifest)

    # 6. 輸出最終結果
    print("\n" + "=" * 60)
    print("上傳完成")
    print("=" * 60)
    print(f"✅ 成功上傳: {success_count} 個文件")
    print(f"⏭️  已跳過 (未變更): {skipped_count} 個文件")
    print(f"❌ 失敗: {failure_count} 個文件")
    print(f"📊 總計處理: {total_files} 個文件")
    print(f"📝 清單記錄: {len(updated_manifest)} 個文件")

    if failed_files:
        print("\n以下檔案上傳失敗 (已歷經多次自動重試):")
        for f, reason in failed_files:
            print(f"  - {f}: {reason}")

if __name__ == "__main__":
    main()
