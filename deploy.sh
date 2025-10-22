#!/bin/bash

###############################################################################
# GSAT 詞彙網站部署腳本
# 自動化構建和部署流程
###############################################################################

set -e  # 遇到錯誤立即退出

# 可調整的並行上傳數（可用環境變數 MAX_PARALLEL 覆寫，預設 32）
MAX_PARALLEL=${MAX_PARALLEL:-32}

# 顏色輸出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印帶顏色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 檢查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 檢查必要的工具
check_requirements() {
    print_info "檢查必要工具..."
    
    if ! command_exists wrangler; then
        print_error "Wrangler 未安裝，請先安裝: npm install -g wrangler"
        print_info "安裝指令: npm install -g wrangler"
        exit 1
    fi
    
    # 檢查是否已登入
    if ! wrangler whoami >/dev/null 2>&1; then
        print_error "尚未登入 Cloudflare，請先運行: wrangler login"
        exit 1
    fi
    
    print_success "工具檢查完成"
}

# 創建 R2 Buckets（如果不存在）
setup_r2_buckets() {
    print_info "=== 設置 R2 Buckets ==="
    
    # 檢查並創建 vocab-data bucket
    print_info "檢查 vocab-data bucket..."
    if ! wrangler r2 bucket list | grep -q "vocab-data"; then
        print_info "創建 vocab-data bucket..."
        wrangler r2 bucket create vocab-data
        print_success "vocab-data bucket 已創建"
    else
        print_success "vocab-data bucket 已存在"
    fi
    
    # 檢查並創建 vocab-audio bucket
    print_info "檢查 vocab-audio bucket..."
    if ! wrangler r2 bucket list | grep -q "vocab-audio"; then
        print_info "創建 vocab-audio bucket..."
        wrangler r2 bucket create vocab-audio
        print_success "vocab-audio bucket 已創建"
    else
        print_success "vocab-audio bucket 已存在"
    fi
}

# 創建 KV Namespace（如果不存在）
setup_kv_namespace() {
    print_info "=== 設置 KV Namespace ==="
    
    print_info "檢查是否已有 VOCAB_CACHE KV namespace..."
    
    # 嘗試創建 KV namespace
    print_info "創建 VOCAB_CACHE KV namespace..."
    kv_output=$(wrangler kv:namespace create "VOCAB_CACHE" 2>&1 || true)
    
    if echo "$kv_output" | grep -q "id"; then
        kv_id=$(echo "$kv_output" | grep -oP 'id = "\K[^"]+' || true)
        print_success "VOCAB_CACHE KV namespace 已創建，ID: $kv_id"
        
        # 創建預覽 namespace
        print_info "創建預覽 KV namespace..."
        kv_preview_output=$(wrangler kv:namespace create "VOCAB_CACHE" --preview 2>&1 || true)
        kv_preview_id=$(echo "$kv_preview_output" | grep -oP 'preview_id = "\K[^"]+' || true)
        print_success "預覽 KV namespace 已創建，ID: $kv_preview_id"
        
        # 更新 wrangler-api.toml
        print_info "更新 wrangler-api.toml 中的 KV namespace ID..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/^id = \".*\"/id = \"$kv_id\"/" wrangler-api.toml
            sed -i '' "s/^preview_id = \".*\"/preview_id = \"$kv_preview_id\"/" wrangler-api.toml
        else
            # Linux
            sed -i "s/^id = \".*\"/id = \"$kv_id\"/" wrangler-api.toml
            sed -i "s/^preview_id = \".*\"/preview_id = \"$kv_preview_id\"/" wrangler-api.toml
        fi
        
        print_success "wrangler-api.toml 已更新"
    else
        print_warning "KV namespace 可能已存在，請手動檢查 wrangler-api.toml"
    fi
}

# 上傳數據到 R2
upload_data() {
    print_info "=== 上傳數據文件到 R2 ==="
    
    local DATA_DIR="data/output"
    local BUCKET="vocab-data"
    
    if [ ! -d "$DATA_DIR" ]; then
        print_error "數據目錄不存在: $DATA_DIR"
        return 1
    fi
    
    # 上傳索引文件
    if [ -f "$DATA_DIR/vocab_index.json" ]; then
        print_info "上傳 vocab_index.json..."
        wrangler r2 object put "$BUCKET/vocab_index.json" --file="$DATA_DIR/vocab_index.json"
        print_success "vocab_index.json 已上傳"
    else
        print_warning "vocab_index.json 不存在"
    fi
    
    # 上傳搜索索引
    if [ -f "$DATA_DIR/search_index.json" ]; then
        print_info "上傳 search_index.json..."
        wrangler r2 object put "$BUCKET/search_index.json" --file="$DATA_DIR/search_index.json"
        print_success "search_index.json 已上傳"
    else
        print_warning "search_index.json 不存在"
    fi
    
    # 上傳詳情文件
    if [ -d "$DATA_DIR/vocab_details" ]; then
        print_info "並行上傳詞彙詳情文件 (最多 ${MAX_PARALLEL} 個並行)..."
        
        # 計算總文件數
        total_files=$(find "$DATA_DIR/vocab_details" -name "*.json" | wc -l | tr -d ' ')
        print_info "找到 $total_files 個文件需要上傳"
        
        if [ "$total_files" -eq 0 ]; then
            print_warning "沒有找到詳情文件"
        else
            # 創建臨時文件來追踪進度
            progress_file=$(mktemp)
            echo "0" > "$progress_file"
            
            # 定義上傳函數
            upload_file() {
                local file="$1"
                local bucket="$2"
                local progress_file="$3"
                local total="$4"
                
                filename=$(basename "$file")
                
                # 上傳文件（靜默模式）
                if wrangler r2 object put "$bucket/vocab_details/$filename" --file="$file" >/dev/null 2>&1; then
                    # 更新進度（原子操作）
                    local lock_file="${progress_file}.lock"
                    (
                        flock -x 200
                        current=$(cat "$progress_file")
                        current=$((current + 1))
                        echo "$current" > "$progress_file"
                        
                        # 計算百分比
                        percent=$((current * 100 / total))
                        
                        # 生成進度條
                        bar_length=50
                        filled_length=$((percent * bar_length / 100))
                        bar=$(printf "%${filled_length}s" | tr ' ' '█')
                        empty=$(printf "%$((bar_length - filled_length))s" | tr ' ' '░')
                        
                        # 清除當前行並打印進度條
                        printf "\r${BLUE}[上傳進度]${NC} [%s%s] %3d%% (%d/%d)" "$bar" "$empty" "$percent" "$current" "$total" >&2
                    ) 200>"$lock_file"
                fi
            }
            
            # 導出函數和變量
            export -f upload_file
            export BUCKET
            export BLUE
            export NC
            export progress_file
            export total_files
            
            # 使用 parallel 或 xargs 實現並行上傳
            if command_exists parallel; then
                # 使用 GNU parallel（更快）
                find "$DATA_DIR/vocab_details" -name "*.json" | \
                    parallel -j "$MAX_PARALLEL" --bar upload_file {} "$BUCKET" "$progress_file" "$total_files"
            else
                # 使用 xargs（跨平台兼容）
                find "$DATA_DIR/vocab_details" -name "*.json" | \
                    xargs -P "$MAX_PARALLEL" -I {} bash -c 'upload_file "$@"' _ {} "$BUCKET" "$progress_file" "$total_files"
            fi
            
            # 清理臨時文件
            rm -f "$progress_file" "${progress_file}.lock"
            
            # 完成後換行
            echo ""
            print_success "所有詳情文件已上傳 ($total_files 個文件)"
        fi
    else
        print_warning "vocab_details 目錄不存在"
    fi
}

# 上傳音頻到 R2
upload_audio() {
    print_info "=== 上傳音頻文件到 R2 ==="
    
    local AUDIO_DIR="data/output/tts_audio"
    local BUCKET="vocab-audio"
    
    if [ ! -d "$AUDIO_DIR" ]; then
        print_warning "音頻目錄不存在: $AUDIO_DIR，跳過音頻上傳"
        return 0
    fi
    
    print_info "上傳單詞音頻..."
    total_audio=$(find "$AUDIO_DIR" -name "*.mp3" | wc -l | tr -d ' ')
    
    if [ "$total_audio" -eq 0 ]; then
        print_warning "沒有找到音頻文件"
    else
        print_info "找到 $total_audio 個音頻文件"
        
        # 批量上傳音頻文件
        count=0
        for audio_file in "$AUDIO_DIR"/*.mp3; do
            if [ -f "$audio_file" ]; then
                filename=$(basename "$audio_file")
                wrangler r2 object put "$BUCKET/$filename" --file="$audio_file" >/dev/null 2>&1
                count=$((count + 1))
                percent=$((count * 100 / total_audio))
                printf "\r${BLUE}[上傳音頻]${NC} %3d%% (%d/%d)" "$percent" "$count" "$total_audio"
            fi
        done
        
        echo ""
        print_success "音頻文件已上傳 ($total_audio 個文件)"
    fi
}

# 部署 Workers API
deploy_workers() {
    print_info "=== 部署 Cloudflare Workers API ==="
    
    if [ ! -f "worker-api.js" ]; then
        print_error "worker-api.js 不存在"
        return 1
    fi
    
    if [ ! -f "wrangler-api.toml" ]; then
        print_error "wrangler-api.toml 不存在"
        return 1
    fi
    
    print_info "部署 Workers..."
    wrangler deploy --config wrangler-api.toml
    print_success "Workers API 部署完成"
    
    # 獲取 Worker URL
    print_info "獲取 Worker URL..."
    worker_url=$(wrangler deployments list --config wrangler-api.toml 2>&1 | grep -oP 'https://[^ ]+' | head -1 || echo "")
    
    if [ -n "$worker_url" ]; then
        print_success "Worker URL: $worker_url"
        echo ""
        print_warning "請將此 URL 更新到 app.js 中的 CONFIG.API_BASE"
    fi
}

# 構建前端
build_frontend() {
    print_info "=== 構建前端 ==="
    
    if [ ! -f "index-v2.html" ] || [ ! -f "app.js" ]; then
        print_error "前端文件不存在"
        return 1
    fi
    
    # 創建部署目錄
    local DEPLOY_DIR="dist"
    rm -rf "$DEPLOY_DIR"
    mkdir -p "$DEPLOY_DIR"
    
    # 複製文件
    cp index-v2.html "$DEPLOY_DIR/index.html"
    cp app.js "$DEPLOY_DIR/app.js"
    
    # 如果有其他靜態資源，也複製
    if [ -d "assets" ]; then
        cp -r assets "$DEPLOY_DIR/"
    fi
    
    # 複製本地數據（作為備用）
    if [ -f "data/output/vocab_data.json" ]; then
        mkdir -p "$DEPLOY_DIR/data/output"
        cp data/output/vocab_data.json "$DEPLOY_DIR/data/output/"
        print_success "本地備用數據已複製"
    fi
    
    print_success "前端構建完成: $DEPLOY_DIR/"
}

# 部署前端到 Cloudflare Pages
deploy_pages() {
    print_info "=== 部署前端到 Cloudflare Pages ==="
    
    build_frontend
    
    local DEPLOY_DIR="dist"
    
    print_info "部署到 Cloudflare Pages..."
    
    # 檢查項目是否存在
    read -p "請輸入 Pages 項目名稱 (預設: gsat-vocab): " project_name
    project_name=${project_name:-gsat-vocab}
    
    print_info "部署到項目: $project_name"
    
    if wrangler pages deploy "$DEPLOY_DIR" --project-name="$project_name"; then
        print_success "前端部署完成"
        
        # 獲取部署 URL
        print_info "前端 URL: https://$project_name.pages.dev"
    else
        print_warning "部署失敗，您可以手動上傳 $DEPLOY_DIR 目錄到 Cloudflare Pages"
    fi
}

# 快速部署（只部署 Workers 和前端）
quick_deploy() {
    print_info "=== 快速部署（不上傳數據）==="
    
    deploy_workers
    deploy_pages
    
    print_success "快速部署完成！"
}

# 完整部署
full_deploy() {
    print_info "=== 完整部署 ==="
    
    setup_r2_buckets
    setup_kv_namespace
    upload_data
    upload_audio
    deploy_workers
    deploy_pages
    
    print_success "=== 完整部署完成！==="
}

# 驗證部署
verify_deployment() {
    print_info "=== 驗證部署 ==="
    
    read -p "請輸入 API Worker URL: " api_url
    
    if [ -n "$api_url" ]; then
        print_info "測試 API 端點..."
        
        if command_exists curl; then
            response=$(curl -s "$api_url/" | jq -r '.name' 2>/dev/null || echo "")
            if [ "$response" = "GSAT Vocabulary API" ]; then
                print_success "API 響應正常"
            else
                print_error "API 響應異常"
            fi
        fi
    fi
    
    print_success "驗證完成"
}

# 主菜單
show_menu() {
    echo ""
    echo "======================================"
    echo "  GSAT 詞彙網站部署工具"
    echo "======================================"
    echo "1. 完整部署 (設置 + 上傳 + 部署)"
    echo "2. 快速部署 (只部署 Workers + Pages)"
    echo "3. 僅設置 R2 和 KV"
    echo "4. 僅上傳數據"
    echo "5. 僅上傳音頻"
    echo "6. 僅部署 Workers API"
    echo "7. 僅部署前端 Pages"
    echo "8. 驗證部署"
    echo "9. 退出"
    echo "======================================"
    read -p "請選擇操作 (1-9): " choice
    
    case $choice in
        1)
            full_deploy
            verify_deployment
            ;;
        2)
            quick_deploy
            ;;
        3)
            setup_r2_buckets
            setup_kv_namespace
            ;;
        4)
            upload_data
            ;;
        5)
            upload_audio
            ;;
        6)
            deploy_workers
            ;;
        7)
            deploy_pages
            ;;
        8)
            verify_deployment
            ;;
        9)
            print_info "退出"
            exit 0
            ;;
        *)
            print_error "無效選擇"
            show_menu
            ;;
    esac
}

# 主程序
main() {
    print_info "GSAT 詞彙網站部署腳本"
    print_info "當前目錄: $(pwd)"
    
    # 檢查必要工具
    check_requirements
    
    # 加載 .env 文件（如果存在）
    if [ -f ".env" ]; then
        print_info "加載 .env 文件..."
        set -a
        source .env
        set +a
    fi
    
    # 如果提供了參數，直接執行
    if [ $# -gt 0 ]; then
        case $1 in
            full)
                full_deploy
                ;;
            quick)
                quick_deploy
                ;;
            setup)
                setup_r2_buckets
                setup_kv_namespace
                ;;
            data)
                upload_data
                ;;
            audio)
                upload_audio
                ;;
            workers)
                deploy_workers
                ;;
            pages)
                deploy_pages
                ;;
            verify)
                verify_deployment
                ;;
            *)
                print_error "未知參數: $1"
                print_info "可用參數: full, quick, setup, data, audio, workers, pages, verify"
                exit 1
                ;;
        esac
    else
        show_menu
    fi
}

# 運行主程序
main "$@"
