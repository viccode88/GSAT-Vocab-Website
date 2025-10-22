# GSAT-Vocab-Website v2

從歷屆學測試題中提取單字、分析頻率、生成AI多義釋義和發音，並提供全面的學習模式（瀏覽、字卡、測驗）供學習使用。

網站連結： [學測英文高頻單字](https://vocab.vicvic88.net)


## V2.0 新特性（節錄）

### 核心升級
- **一字多義分析**：使用 OpenAI Batch API 深度分析每個單字在不同語境下的含義
- **全量例句音頻**：為所有單字和例句生成 TTS 音頻
- **後端 API 架構**：Cloudflare Workers 提供高性能 RESTful API
- **按需加載**：初始只加載輕量索引，詳情按需獲取，大幅提升載入速度

### 學習模式
- **📚 瀏覽模式**：搜索、篩選、查看單字詳情
- **🎴 字卡模式**：翻卡學習，標記已掌握/需複習
- **📝 測驗模式**：
  - 選擇題（給定義選單字/給單字選定義）
  - 拼寫測驗（聽音頻/看定義拼單字）
  - 填空測驗（從例句選擇正確單字）
  - 綜合測驗

### 技術亮點
- 使用 OpenAI Batch API 降低 50% AI 成本
- 數據分片存儲，優化加載性能
- 增量音頻上傳，智能跳過已上傳文件
- 完整的進度追蹤和錯題復習

## 系統架構（節錄）

```
資料處理流程：
大考中心網站 → PDF 下載 → 文字提取 → NLP 分析 → 
AI 多義分析 (Batch API) → TTS 音頻生成 → R2 儲存 → 數據優化

使用者端：
Cloudflare Pages (前端) + Cloudflare Workers (API) + R2 (數據+音頻儲存)
```

### 架構圖
- [architecture.puml](./architecture.puml)

## 快速開始（節錄）

### 環境需求

- Python 3.10+
- Node.js 18+ (用於 Wrangler CLI)
- OpenAI API Key（用於 GPT 和 TTS）
- Cloudflare 帳號（用於部署）

### 安裝依賴

```bash
# 創建虛擬環境
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# 或 venv\Scripts\activate  # Windows

# 安裝 Python 依賴
pip install -r requirements.txt

# 下載 spaCy 英文模型
python -m spacy download en_core_web_sm

# 安裝 Wrangler CLI（用於部署）
npm install -g wrangler
```

### 配置環境變數

創建 `.env` 文件：

```bash
# OpenAI API
OPENAI_API_KEY=sk-proj-your-key-here

# Cloudflare R2
R2_ACCOUNT_ID=your-r2-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
```

## 使用流程（節錄）

### 方式一：使用自動化部署腳本（推薦）

```bash
# 運行部署腳本
./deploy.sh

# 選擇選項 1 進行完整部署
# 或選擇其他選項進行部分操作
```

### 方式二：手動執行各步驟

#### 1. 資料收集與處理

```bash
# 步驟 1: 下載試題 PDF
python ceec_scraper.py

# 步驟 2: 提取單字並生成 AI 釋義（保留所有例句）
python extract_words.py
# 輸出: data/output/vocab_data.json
```

#### 2. 多義分析（使用 Batch API）

```bash
# 步驟 3: 創建多義分析批次
python generate_polysemy.py
# 選擇選項 1: 創建批次
# 記下 Batch ID

# 等待批次完成（可能需要數小時）
# 定期檢查狀態
python generate_polysemy.py
# 選擇選項 2: 檢查狀態

# 批次完成後下載結果
python generate_polysemy.py
# 選擇選項 3: 下載並合併結果
# 輸出: data/output/vocab_data_enriched.json
```

#### 3. 音頻生成

```bash
# 步驟 4: 生成單字音頻
python generate_tts_audio.py
# 輸出: data/output/tts_audio/*.mp3

# 步驟 5: 生成例句音頻（可選，耗時較長）
python generate_sentence_audio.py
# 輸出: data/output/tts_audio/sentences/*.mp3
# 同時生成: data/output/vocab_data_with_audio.json
```

#### 4. 數據優化

```bash
# 步驟 6: 優化數據結構（拆分索引和詳情）
python optimize_data_structure.py
# 輸出:
#   - data/output/vocab_index.json (輕量索引)
#   - data/output/search_index.json (搜索索引)
#   - data/output/vocab_details/*.json (單詞詳情)
```

#### 5. 上傳到 R2

```bash
# 步驟 7: 上傳音頻文件
python r2_up.py
# 增量上傳，自動跳過已存在文件

# 步驟 8: 上傳數據文件到 R2
# 方法 A: 使用 Wrangler
wrangler r2 object put vocab-data/vocab_index.json --file=data/output/vocab_index.json
wrangler r2 object put vocab-data/search_index.json --file=data/output/search_index.json

# 批量上傳詳情文件
for file in data/output/vocab_details/*.json; do
    filename=$(basename "$file")
    wrangler r2 object put vocab-data/vocab_details/$filename --file="$file"
done

# 方法 B: 使用 boto3（修改 r2_up.py 支持數據上傳）
```

#### 6. 部署後端 API

```bash
# 步驟 9: 配置 wrangler-api.toml
# 編輯文件，填入正確的 bucket_name 和 KV namespace ID

# 創建 KV Namespace
wrangler kv:namespace create "VOCAB_CACHE"
# 記下返回的 ID，更新到 wrangler-api.toml

# 部署 Worker
wrangler deploy --config wrangler-api.toml
# 記下 Worker URL，例如: https://gsat-vocab-api.your-account.workers.dev
```

#### 7. 部署前端

```bash
# 步驟 10: 更新前端 API 配置
# 編輯 app.js，將 API_BASE 設置為你的 Worker URL
# 例如: const API_BASE = 'https://gsat-vocab-api.your-account.workers.dev';

# 創建部署目錄
mkdir -p dist
cp index-v2.html dist/index.html
cp app.js dist/app.js

# 部署到 Cloudflare Pages
wrangler pages deploy dist --project-name=gsat-vocab

# 或使用 Git 部署：
# 1. 將 dist/ 推送到 GitHub
# 2. 在 Cloudflare Dashboard 連接 GitHub repo
# 3. 設置構建配置（如果需要）
```

## 主要文件說明

### 資料處理腳本

| 文件 | 功能 | 輸出 |
|------|------|------|
| `ceec_scraper.py` | 從大考中心爬取學測英文試題 PDF | `ceec_english_papers/*.pdf` |
| `extract_words.py` | PDF 提取、NLP 分析、AI 釋義生成 | `vocab_data.json` |
| `generate_polysemy.py` | 使用 Batch API 進行多義分析 | `vocab_data_enriched.json` |
| `generate_tts_audio.py` | 生成單字發音 | `tts_audio/*.mp3` |
| `generate_sentence_audio.py` | 生成例句音頻 | `tts_audio/sentences/*.mp3` |
| `optimize_data_structure.py` | 優化數據結構 | 索引和詳情文件 |
| `r2_up.py` | 上傳音頻至 R2（增量上傳） | - |
| `json_edt.py` | 單字資料編輯工具 | - |

### 後端文件

| 文件 | 功能 |
|------|------|
| `worker-api.js` | Cloudflare Workers API 代碼 |
| `wrangler-api.toml` | Workers 部署配置 |

### 前端文件

| 文件 | 功能 |
|------|------|
| `index-v2.html` | 新版前端 HTML |
| `app.js` | 前端應用邏輯 |
| `index.html` | 舊版前端（保留） |

### 部署文件

| 文件 | 功能 |
|------|------|
| `deploy.sh` | 自動化部署腳本 |
| `README-V2.md` | 本文檔 |

## API 文檔

### 端點

#### `GET /api/vocab/index`
獲取詞彙索引（輕量，用於列表顯示）

**響應示例：**
```json
[
  {
    "lemma": "run",
    "count": 45,
    "primary_pos": "VERB",
    "meaning_count": 3,
    "zh_preview": "跑步；奔跑",
    "en_preview": "to move at a speed faster than..."
  }
]
```

#### `GET /api/vocab/detail/:lemma`
獲取單詞完整詳情

**響應示例：**
```json
{
  "lemma": "run",
  "count": 45,
  "pos_dist": {"VERB": 30, "NOUN": 15},
  "meanings": [
    {
      "pos": "VERB",
      "zh_def": "跑步；奔跑",
      "en_def": "to move at a speed faster than a walk",
      "example_indices": [0, 2, 5],
      "usage_note": "常用於運動語境"
    }
  ],
  "sentences": [
    {
      "text": "He runs every morning.",
      "source": "112學測",
      "audio_file": "run_ex_0_abc123.mp3"
    }
  ]
}
```

#### `GET /api/vocab/search?q=word`
搜索單詞

**參數：**
- `q`: 搜索詞（必需）

#### `GET /api/vocab/random?freq=high&pos=VERB`
獲取隨機單詞

**參數：**
- `freq`: 頻率範圍（high/mid/low，可選）
- `pos`: 詞性過濾（NOUN/VERB/ADJ/ADV，可選）

#### `GET /api/quiz/generate?type=choice&count=10`
生成測驗題目

**參數：**
- `type`: 題型（choice/spelling/fill，必需）
- `count`: 題目數量（5-50，默認 10）
- `freq`: 頻率範圍（可選）
- `pos`: 詞性過濾（可選）

#### `GET /api/search-index`
獲取搜索索引

## 技術堆疊

### 資料處理
- **Python 3.10+**
- **pdfplumber**：PDF 文字提取
- **spaCy**：自然語言處理
- **OpenAI API**：
  - GPT-4o-mini：AI 釋義生成
  - Batch API：大規模多義分析
  - TTS：語音合成
- **boto3**：R2 上傳

### 前端
- **Vanilla JavaScript**：無框架依賴
- **Tailwind CSS**：美觀的 UI
- **HTML5 Audio API**：音頻播放
- **LocalStorage**：進度追蹤

### 後端
- **Cloudflare Workers**：無伺服器 API
- **Cloudflare R2**：物件儲存
- **Cloudflare KV**：快取層
- **Cloudflare Pages**：靜態網站托管

## 優化建議

### 成本優化
1. **使用 Batch API**：多義分析成本降低 50%
2. **增量上傳**：只上傳變更的文件
3. **KV 快取**：減少 R2 讀取次數
4. **HTTP 快取**：設置適當的 Cache-Control

### 性能優化
1. **按需加載**：初始只載入 ~100KB 索引
2. **資料分片**：單詞詳情獨立文件
3. **音頻預載**：預載熱門單詞音頻
4. **虛擬滾動**：大列表性能優化（可選）

### 用戶體驗
1. **離線支持**：使用 Service Worker（可選）
2. **進度同步**：支持跨裝置同步（需要後端）
3. **個人化**：基於學習記錄推薦

## 常見問題

### Q: Batch API 需要多久完成？
A: 通常在數小時內完成，最長 24 小時。

### Q: 音頻文件佔用多少空間？
A: 單詞音頻約 20-50KB/個，例句音頻視長度而定，預計總共 500MB-2GB。

### Q: 如何更新詞彙數據？
A: 重新運行資料處理流程，使用增量上傳可以快速更新變更的文件。

### Q: 可以離線使用嗎？
A: 目前不支持，但可以通過 Service Worker 實現離線功能。

### Q: 如何添加新的測驗類型？
A: 修改 `worker-api.js` 的 `handleGenerateQuiz` 函數和前端 `app.js` 的渲染邏輯。

## 故障排除

### 問題：Batch API 返回錯誤
**解決方案：**
- 檢查 `.jsonl` 文件格式是否正確
- 確認每行都是有效的 JSON
- 檢查是否超過 50,000 請求限制

### 問題：Workers 部署失敗
**解決方案：**
- 檢查 `wrangler-api.toml` 配置
- 確認 R2 bucket 和 KV namespace 已創建
- 運行 `wrangler login` 重新登錄

### 問題：音頻無法播放
**解決方案：**
- 檢查 CORS 設置
- 確認音頻文件已成功上傳到 R2
- 檢查瀏覽器控制台錯誤訊息

### 問題：前端載入很慢
**解決方案：**
- 確認使用的是 `vocab_index.json` 而非完整數據
- 檢查 API Worker 響應時間
- 啟用 KV 快取

## 授權說明

本專案僅供教育與學習用途。

- **試題資料**：來自大學入學考試中心
- **AI 生成內容**：由 OpenAI API 生成

## 貢獻指南

歡迎提交 Issue 和 Pull Request！

## 更新日誌

### V2.0.0 (2025-01-XX)
- ✨ 新增一字多義深度分析
- ✨ 新增字卡學習模式
- ✨ 新增測驗模式（選擇題/拼寫/填空）
- ✨ 完整的例句音頻生成
- 🚀 後端 API 架構重構
- ⚡ 按需加載，性能大幅提升
- 💰 使用 Batch API，成本降低 50%

### V1.0.0 (2024-XX-XX)
- 🎉 初始版本
- 📖 單詞瀏覽和搜索
- 🔊 單詞發音
- 📊 詞性分析

## 聯絡方式

- 網站：https://vocab.vicvic88.net
- Email：your-email@example.com
- GitHub：https://github.com/yourusername/GSAT-Vocab-Website

---

**享受學習！Good luck with your studies! 📚✨**

