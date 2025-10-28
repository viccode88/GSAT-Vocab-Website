# GSAT-Vocab-Website v2

從歷屆學測試題中提取單字、分析頻率、生成AI多義釋義和發音，並提供全面的學習模式（瀏覽、字卡、測驗）供學習使用。

網站連結： [學測英文高頻單字](https://vocab.vicvic88.net)


## V2.0 新功能

### 功能
- **瀏覽模式**：搜索、篩選、查看單字詳情
- **字卡模式**：翻卡學習，標記已掌握/需複習
- **測驗模式**：
  - 選擇題（定義選單字/給單字選定義）
  - 拼寫測驗（聽音頻/看定義拼單字）
  - 填空測驗（從例句選擇正確單字）

## V3.0 預計更新
- **個人化**：學習曲線,登錄功能
- **艱難字詞統計**：使用者回報艱難字詞
- **完善的一字多義**：對每個單字搜集一字多義，並提供例句
- **同義字,反義字**：讓使用者更快關聯單字
- **優化資料儲存結構**：預留後續擴充性，並加快載入速度，為未來資料量的增加做好準備

## 更未來的目標
- **提供更多樣化的範圍**：引入多個單字集，標注每個單字在哪個大考範圍等
- **製作成app等多平台應用**：讓使用者可以在各個平台無縫銜接進度

### 新版本修正
- 由於數據量增加（例句量大幅上升），從原來直接index.json，改由數據分片存儲，優化加載性能
- 增加精選例句之音檔
- 增加選擇題,拼寫測驗,填空測驗與字卡模式

## 系統架構

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

## 如何部署？

### 方式一：使用自動化部署腳本

```bash
# 運行部署腳本
./deploy.sh
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


#### 2. 音頻生成

```bash
# 步驟 4: 生成單字音頻
python generate_tts_audio.py
# 輸出: data/output/tts_audio/*.mp3

# 步驟 5: 生成例句音頻
python generate_sentence_audio.py
# 輸出: data/output/tts_audio/sentences/*.mp3
# 同時生成: data/output/vocab_data_with_audio.json
```

#### 4. 數據分片

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
| `generate_polysemy.py` | 使用 Batch API 進行多義分析（未完成） | `vocab_data_enriched.json` |
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
  - GPT系列模型：AI 釋義生成
  - TTS：語音合成
- **boto3**：R2 上傳

### 前端
- **Vanilla JavaScript**：無框架
- **Tailwind CSS**：美觀的 UI
- **HTML5 Audio API**：音頻播放
- **LocalStorage**：進度追蹤

### 後端
- **Cloudflare Workers**：無伺服器 API
- **Cloudflare R2**：物件儲存
- **Cloudflare KV**：快取層
- **Cloudflare Pages**：靜態網站托管

## 資料來源說明

本專案僅供教育與學習用途。

- **試題資料**：來自大學入學考試中心
- **AI 生成內容**：由 OpenAI API 生成

## 更新日誌

### V2.0.0
- 新增字卡學習模式
- 更多測驗模式（選擇題/拼寫/填空）
- 增加精選例句發音功能
- 按需加載，改善性能

### V1.0.0
- 初始版本
- 單詞瀏覽和搜索
- 單詞發音
- 詞性分析
- 簡單測驗，由單字選定義
---

