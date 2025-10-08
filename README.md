# 學測英文高頻單字

從歷屆學測試題中提取單字、分析頻率、生成AI釋義和發音，並提供網頁介面供學習使用。
網站連結 [學測英文高頻單字](https://vocab.vicvic88.net)
## 特點

- **資料收集**：從大考中心官網爬取歷屆學測英文試題
- **詞性**：使用 spaCy NLP 進行詞性標註
- **內容**：使用OpenAI GPT生成中英文釋義與例句
- **語音**：使用OpenAI TTS生成自然的單字發音
- **介面**：響應式設計，支援桌面和行動裝置
- **無伺服器部署**：完全部署於Cloudflare生態系統（Pages + Workers + R2）

## 系統架構

```
資料處理流程：
大考中心網站 → PDF 下載 → 文字提取 → NLP 分析 → 
AI 釋義生成 → TTS 音頻生成 → R2 儲存

使用者端：
Cloudflare Pages (前端) + Cloudflare Workers (音頻 API) + R2 (音頻儲存)
```

## 快速開始

### 環境需求

- Python 3.10+
- OpenAI API Key（用於 GPT 和 TTS）
- Cloudflare 帳號（用於部署）

### 安裝依賴

```bash
# 創建虛擬環境
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# 或 venv\Scripts\activate  # Windows

# 安裝依賴
pip install -r requirements.txt

# 下載 spaCy 英文模型
python -m spacy download en_core_web_sm
```

### 配置環境變數

創建 `.env` 文件：

```bash
OPENAI_API_KEY=sk-proj-your-key-here
R2_ACCOUNT_ID=your-r2-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
```

## 使用流程

### 1. 資料收集與處理

```bash
# 步驟 1: 下載試題PDF
python ceec_scraper.py

# 步驟 2: 提取單字並生成 AI 釋義
python extract_words.py

# 步驟 3 : 編輯單字資料
python json_edt.py

# 步驟 4: 生成 TTS 音頻
python generate_tts_audio.py

# 步驟 5: 上傳音頻至 R2
python r2_up.py
```

### 2. 部署前端

**方法一：Cloudflare Pages（推薦）**

1. 將 `index.html` 和 `data/output/vocab_data.json` 上傳到pages

**方法二：本地測試**

```bash
# 使用 Python 內建 HTTP 伺服器
python -m http.server 8000
# 訪問 http://localhost:8000
```

### 3. 部署 Cloudflare Worker

```bash
# 安裝 Wrangler CLI
npm install -g wrangler

# 登入 Cloudflare
wrangler login

# 部署 Worker
wrangler deploy
```

## 主要文件說明

| 文件 | 功能 |
|------|------|
| `ceec_scraper.py` | 從大考中心爬取學測英文試題 PDF |
| `extract_words.py` | PDF 文字提取、NLP 分析、AI 釋義生成 |
| `generate_tts_audio.py` | 使用 OpenAI TTS 生成單字發音 |
| `r2_up.py` | 上傳音頻檔案至 Cloudflare R2 |
| `json_edt.py` | 單字資料編輯工具 |
| `worker.js` | Cloudflare Worker api程式碼 |
| `index.html` | 前端網頁 |

## 技術堆疊

**資料處理**
- Python 3.10+
- pdfplumber（PDF 提取）
- spaCy（自然語言處理）
- OpenAI API（GPT-4o-mini & TTS）
- boto3（R2 上傳）

**前端**
- Vanilla JavaScript
- Tailwind CSS
- HTML5 Audio API

**部署**
- Cloudflare Pages（靜態網站）
- Cloudflare Workers（API 服務）
- Cloudflare R2（音頻儲存）

## 授權說明

本專案僅供教育與學習用途。

- **試題資料**：來自大學入學考試中心

