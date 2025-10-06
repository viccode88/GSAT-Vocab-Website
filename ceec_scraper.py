#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CEEC 學測『英文科試題卷』批次下載（自動停止重複頁）
---------------------------------------------------
"""
import re, time
from pathlib import Path
from urllib.parse import urljoin, unquote

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

# -------- 常數設定 --------
INDEX_URL   = "https://www.ceec.edu.tw/xmfile?xsmsid=0J052424829869345634"
LIST_URL    = "https://www.ceec.edu.tw/xmfile/indexaction"
CAT_ENGLISH = "0J075836833990807814"
SAVE_DIR    = Path("ceec_english_papers")
TIMEOUT     = 30
RETRY       = 3

ALLOW_EXT = {".pdf", ".doc", ".docx"}
KEEP_RE   = re.compile(r"試題|試卷")
DROP_RE   = re.compile(r"答題卷|答案|評分|非選擇")

# -------- 小工具 --------
def sanitize(s: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", s)

def download(session, url, path):
    path.parent.mkdir(exist_ok=True, parents=True)
    if path.exists():
        return
    tmp = path.with_suffix(".part")
    for n in range(1, RETRY + 1):
        try:
            with session.get(url, stream=True, timeout=TIMEOUT) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                bar = tqdm(total=total, unit="B", unit_scale=True,
                           desc=path.name, leave=False)
                with tmp.open("wb") as f:
                    for chunk in r.iter_content(8192):
                        if chunk:
                            f.write(chunk)
                            bar.update(len(chunk))
                bar.close()
            tmp.rename(path)
            return
        except Exception as e:
            print(f"  下載錯誤 {n}/{RETRY}：{e}")
            time.sleep(1)
    print(f"  !!! 放棄 {url}")

# -------- 抓索引欄位 --------
def hidden_inputs(html: str):
    soup = BeautifulSoup(html, "html.parser")
    return {i["name"]: i.get("value", "")
            for i in soup.select("form#MainForm input[type=hidden]")}

def fetch_page(session, base, page):
    data = base.copy()
    data.update({
        "CatSId": CAT_ENGLISH,
        "ExecAction": "Q",
        "IndexOfPages": str(page),
        "Annaul": ""
    })
    r = session.post(LIST_URL, data=data, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text

def parse_links(html: str):
    soup, out = BeautifulSoup(html, "html.parser"), []
    for row in soup.select("tr"):
        tds = row.find_all("td")
        if len(tds) != 3:             # 標頭或空行
            continue
        title = tds[1].get_text(strip=True)
        if "英文" not in title:
            continue
        for a in tds[2].find_all("a"):
            ext  = Path(unquote(a["href"])).suffix.lower()
            text = a.get_text(strip=True)
            if ext not in ALLOW_EXT:        # 只要試題卷檔
                continue
            if DROP_RE.search(text):
                continue
            if not KEEP_RE.search(text):
                continue
            url = urljoin(INDEX_URL, a["href"])
            out.append((title, url))
            break                           # 一列只取一檔
    return out

# -------- 主程式 --------
def main():
    sess = requests.Session()

    print("取得初始頁…", end="", flush=True)
    first = sess.get(INDEX_URL, timeout=TIMEOUT)
    first.raise_for_status()
    base = hidden_inputs(first.text)
    print("完成")

    seen_urls = set()
    items     = []
    page_idx  = 0

    while True:
        print(f"抓取第 {page_idx+1} 頁…", end="", flush=True)
        html  = fetch_page(sess, base, page_idx)
        links = parse_links(html)

        # ➜ 判斷「這頁新檔數」
        new_links = [t for t in links if t[1] not in seen_urls]
        print(f"  取得 {len(new_links)} (新/{len(links)})")

        if not new_links:                 # ⇦ 沒新檔 ⇒ 結束
            break

        for title, url in new_links:
            seen_urls.add(url)
            items.append((title, url))
        page_idx += 1

    print(f"\n共需下載 {len(items)} 個檔案，開始…\n")

    for title, url in items:
        tw = re.search(r"(\d{2,3})學年度", title)
        twy = tw.group(1) if tw else "??"
        y   = str(int(twy)+1911) if twy.isdigit() else "????"
        fname = Path(unquote(url)).name
        save  = SAVE_DIR / sanitize(f"{y}_{twy}_{fname}")
        download(sess, url, save)

    print("\n✅ 完成，檔案位置：", SAVE_DIR.resolve())

if __name__ == "__main__":
    main()
