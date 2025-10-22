/**
 * Cloudflare Workers API for GSAT Vocabulary Website
 * 提供 RESTful API 用於詞彙數據訪問
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_CONTROL = 'public, max-age=3600';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }
    
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }
    
    try {
      if (url.pathname === '/api/vocab/index') {
        return await handleGetIndex(request, env);
      } else if (url.pathname === '/api/vocab/search') {
        return await handleSearch(url, env);
      } else if (url.pathname.startsWith('/api/vocab/detail/')) {
        const lemma = url.pathname.split('/').pop();
        return await handleGetDetail(lemma, env);
      } else if (url.pathname === '/api/vocab/random') {
        return await handleRandomWord(url, env);
      } else if (url.pathname === '/api/quiz/generate') {
        return await handleGenerateQuiz(url, env);
      } else if (url.pathname === '/api/search-index') {
        return await handleGetSearchIndex(request, env);
      } else if (url.pathname === '/api/vocab/sentences') {
        return await handleGetSentences(url, env);
      } else if (url.pathname.startsWith('/audio/')) {
        return await handleGetAudio(url.pathname, env);
      } else if (url.pathname === '/') {
        return jsonResponse({
          name: 'GSAT Vocabulary API',
          version: '1.0.0',
          endpoints: {
            'GET /api/vocab/index': '取得詞彙索引',
            'GET /api/vocab/search?q=word': '搜尋單字',
            'GET /api/vocab/detail/:lemma': '取得單字詳情',
            'GET /api/vocab/random?freq=high&pos=VERB': '隨機單字',
            'GET /api/quiz/generate?type=choice&count=10': '生成測驗',
            'GET /api/search-index': '取得搜尋索引',
            'GET /audio/:filename': '取得音訊檔案'
          }
        });
      } else {
        return jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (error) {
      console.error('API Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  },
};

async function handleGetIndex(request, env) {
  try {
    // 優先使用 Cloudflare Edge Cache（每個 PoP 的就近快取）
    const cacheKey = new Request(new URL(request.url), request);
    const edgeCached = await caches.default.match(cacheKey);
    if (edgeCached) {
      // If-None-Match 支援：命中時如 ETag 相同則回 304
      const inm = request.headers.get('If-None-Match');
      const etag = edgeCached.headers.get('ETag');
      if (inm && etag && inm === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            ...CORS_HEADERS,
            'Cache-Control': edgeCached.headers.get('Cache-Control') || CACHE_CONTROL,
            'ETag': etag,
            'Last-Modified': edgeCached.headers.get('Last-Modified') || ''
          }
        });
      }
      return edgeCached;
    }

    if (env.VOCAB_CACHE) {
      const cached = await env.VOCAB_CACHE.get('vocab_index', 'json');
      if (cached) {
        const body = JSON.stringify(cached);
        const resp = new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            ...CORS_HEADERS
          }
        });
        // 放入 Edge Cache 以加速後續請求
        try { await caches.default.put(cacheKey, resp.clone()); } catch (_) {}
        return resp;
      }
    }
    
    const object = await env.VOCAB_DATA.get('vocab_index.json');
    if (!object) {
      return jsonResponse({ error: 'Index not found' }, 404);
    }
    
    const data = await object.json();
    
    if (env.VOCAB_CACHE) {
      await env.VOCAB_CACHE.put('vocab_index', JSON.stringify(data), {
        expirationTtl: 3600
      });
    }
    
    // 使用 R2 物件的 etag/時間作為條件快取的依據
    const etag = object.etag || object.httpEtag || '';
    const lastModified = object.uploaded ? new Date(object.uploaded).toUTCString() : undefined;
    const resp = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        ...(etag ? { 'ETag': etag } : {}),
        ...(lastModified ? { 'Last-Modified': lastModified } : {}),
        ...CORS_HEADERS
      }
    });
    try { await caches.default.put(cacheKey, resp.clone()); } catch (_) {}
    return resp;
  } catch (error) {
    return jsonResponse({ error: 'Failed to load index' }, 500);
  }
}

async function handleSearch(url, env) {
  const query = url.searchParams.get('q');
  if (!query) {
    return jsonResponse({ error: 'Missing query parameter' }, 400);
  }
  
  const searchTerm = query.toLowerCase().trim();
  
  try {
    const indexObj = await env.VOCAB_DATA.get('vocab_index.json');
    if (!indexObj) {
      return jsonResponse({ error: 'Index not found' }, 404);
    }
    
    const index = await indexObj.json();
    
    const results = index.filter(word => 
      word.lemma.toLowerCase().startsWith(searchTerm)
    );
    
    return jsonResponse({
      query: searchTerm,
      count: results.length,
      results: results.slice(0, 100)
    });
  } catch (error) {
    return jsonResponse({ error: 'Search failed' }, 500);
  }
}

async function handleGetDetail(lemma, env) {
  if (!lemma) {
    return jsonResponse({ error: 'Missing lemma' }, 400);
  }
  
  try {
    const cacheKey = `detail_${lemma}`;
    if (env.VOCAB_CACHE) {
      const cached = await env.VOCAB_CACHE.get(cacheKey, 'json');
      if (cached) {
        return jsonResponse(cached);
      }
    }
    
    const object = await env.VOCAB_DATA.get(`vocab_details/${lemma}.json`);
    if (!object) {
      return jsonResponse({ error: 'Word not found' }, 404);
    }
    
    const data = await object.json();

    // 構建精簡詳情：僅回關鍵欄位與 5 句預覽 + 分頁資訊
    const { featured, other } = splitSentencesData(data.sentences);
    const total = featured.length + other.length;
    let sentencesPreview = featured.slice(0, 5);
    if (sentencesPreview.length < 5) {
      sentencesPreview = sentencesPreview.concat(other.slice(0, 5 - sentencesPreview.length));
    }
    const previewCount = sentencesPreview.length;
    const nextOffset = Math.min(total, previewCount);

    const minimal = {
      lemma: data.lemma || lemma,
      count: data.count || 0,
      meanings: data.meanings || undefined,
      pos_dist: data.pos_dist || undefined,
      zh_preview: data.zh_preview || undefined,
      definition: data.definition || undefined, // 兼容舊格式
      // 新增：例句預覽與分頁資訊
      sentences_preview: sentencesPreview,
      sentences_total: total,
      sentences_next_offset: nextOffset
    };

    if (env.VOCAB_CACHE && (data.count || 0) > 10) {
      await env.VOCAB_CACHE.put(cacheKey, JSON.stringify(minimal), {
        expirationTtl: 7200
      });
    }
    
    return jsonResponse(minimal);
  } catch (error) {
    return jsonResponse({ error: 'Failed to load word detail' }, 500);
  }
}

async function handleRandomWord(url, env) {
  const freq = url.searchParams.get('freq');
  const pos = url.searchParams.get('pos');
  const excludePropn = url.searchParams.get('exclude_propn') === 'true';
  const freqMin = parseInt(url.searchParams.get('freq_min') || '');
  const freqMax = parseInt(url.searchParams.get('freq_max') || '');
  
  try {
    const indexObj = await env.VOCAB_DATA.get('search_index.json');
    if (!indexObj) {
      return jsonResponseNoStore({ error: 'Search index not found' }, 404);
    }
    
    const searchIndex = await indexObj.json();
    const vocabIndex = await env.VOCAB_DATA.get('vocab_index.json');
    const index = await vocabIndex.json();
    const indexMap = Object.fromEntries(index.map(w => [w.lemma, w]));
    
    let candidates = [];
    if (freq && (searchIndex.by_frequency || {})[freq]) {
      candidates = searchIndex.by_frequency[freq];
    } else {
      candidates = index.map(w => w.lemma);
    }
    
    if (pos && (searchIndex.by_pos || {})[pos]) {
      const posWords = new Set(searchIndex.by_pos[pos]);
      candidates = candidates.filter(lemma => posWords.has(lemma));
    }
    
    if (excludePropn && (searchIndex.by_pos || {}).PROPN) {
      const propnSet = new Set(searchIndex.by_pos.PROPN);
      candidates = candidates.filter(lemma => !propnSet.has(lemma));
    }
    
    if (!isNaN(freqMin) || !isNaN(freqMax)) {
      const min = isNaN(freqMin) ? -Infinity : freqMin;
      const max = isNaN(freqMax) ? Infinity : freqMax;
      candidates = candidates.filter(lemma => {
        const c = indexMap[lemma]?.count || 0;
        return c >= min && c <= max;
      });
    }
    
    if (candidates.length === 0) {
      return jsonResponseNoStore({ error: 'No words found matching criteria' }, 404);
    }
    
    const randomLemma = candidates[Math.floor(Math.random() * candidates.length)];
    
    // 直接讀取並以 no-store 回傳，避免引用 detail 的快取頭
    const object = await env.VOCAB_DATA.get(`vocab_details/${randomLemma}.json`);
    if (!object) {
      return jsonResponseNoStore({ error: 'Word not found' }, 404);
    }
    const data = await object.json();
    return jsonResponseNoStore(data);
  } catch (error) {
    return jsonResponseNoStore({ error: 'Failed to get random word' }, 500);
  }
}

async function handleGenerateQuiz(url, env) {
  const type = url.searchParams.get('type') || 'choice';
  const count = Math.min(100, Math.max(1, parseInt(url.searchParams.get('count') || '10')));
  const posParam = (url.searchParams.get('pos') || '').split(',').filter(Boolean);
  const excludePropn = url.searchParams.get('exclude_propn') === 'true';
  const lemmasParam = (url.searchParams.get('lemmas') || '').split(',').filter(Boolean);
  const freqMin = parseInt(url.searchParams.get('freq_min') || '');
  const freqMax = parseInt(url.searchParams.get('freq_max') || '');
  
  try {
    const searchIndex = await env.VOCAB_DATA.get('search_index.json');
    const searchData = await searchIndex.json();
    
    const vocabIndex = await env.VOCAB_DATA.get('vocab_index.json');
    const index = await vocabIndex.json();
    const indexMap = Object.fromEntries(index.map(w => [w.lemma, w]));

    let candidates = Object.keys(indexMap);
    if (posParam.length) {
      const byPos = searchData.by_pos || {};
      const posSet = new Set();
      for (const p of posParam) (byPos[p] || []).forEach(l => posSet.add(l));
      candidates = candidates.filter(lemma => posSet.has(lemma));
    }
    if (excludePropn && (searchData.by_pos || {}).PROPN) {
      const propnSet = new Set(searchData.by_pos.PROPN);
      candidates = candidates.filter(lemma => !propnSet.has(lemma));
    }
    if (!isNaN(freqMin) || !isNaN(freqMax)) {
      const min = isNaN(freqMin) ? -Infinity : freqMin;
      const max = isNaN(freqMax) ? Infinity : freqMax;
      candidates = candidates.filter(lemma => {
        const c = indexMap[lemma]?.count || 0;
        return c >= min && c <= max;
      });
    }
    if (lemmasParam.length) {
      candidates = lemmasParam.filter(l => indexMap[l]);
    }

    if (candidates.length === 0) {
      return jsonResponseNoStore({ type, count: 0, questions: [] });
    }

    const questions = [];

    const shuffledCandidates = shuffleArray(candidates);

    if (type === 'fill') {
      // 遍歷更多候選單字，優先選有例句的，直到湊滿題數或用盡
      for (const lemma of shuffledCandidates) {
        if (questions.length >= count) break;
        const wordInfo = indexMap[lemma];
        if (!wordInfo) continue;

        const detailObj = await env.VOCAB_DATA.get(`vocab_details/${lemma}.json`);
        if (!detailObj) continue;
        const detail = await detailObj.json();

        let sentencesArray = [];
        if (Array.isArray(detail.sentences)) {
          sentencesArray = detail.sentences;
        } else if (detail.sentences && detail.sentences.featured) {
          sentencesArray = [...detail.sentences.featured, ...(detail.sentences.other || [])];
        }
        if (sentencesArray.length === 0) continue;

        const sentenceObj = sentencesArray[0];
        let sentenceText = sentenceObj.text || sentenceObj;
        // 允許詞形變化的挖空（複數等）
        const variants = getInflectionVariants(lemma);
        const pattern = `\\b(${variants.map(v => v.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')).join('|')})\\b`;
        const re = new RegExp(pattern, 'gi');
        sentenceText = sentenceText.replace(re, '____');
        const question = {
          type: 'fill',
          word: lemma,
          sentence: sentenceText,
          options: generateChoiceOptions(lemma, shuffledCandidates, indexMap),
          correct: lemma
        };
        questions.push(question);
      }
    } else {
      const selectedLemmas = shuffledCandidates.slice(0, count);
      for (const lemma of selectedLemmas) {
        const wordInfo = indexMap[lemma];
        if (!wordInfo) continue;

        if (type === 'choice') {
          const question = {
            type: 'choice',
            word: lemma,
            question: wordInfo.zh_preview,
            options: generateChoiceOptions(lemma, shuffledCandidates, indexMap),
            correct: lemma
          };
          questions.push(question);
        } else if (type === 'spelling') {
          const posShort = { NOUN: 'n.', VERB: 'v.', ADJ: 'adj.', ADV: 'adv.' }[wordInfo.primary_pos] || '';
          const question = {
            type: 'spelling',
            word: lemma,
            question: `${posShort} ${wordInfo.zh_preview}`.trim(),
            answer: lemma,
            hint: `${lemma.length} 個字母，以 ${lemma[0]} 開頭`,
            correct: lemma
          };
          questions.push(question);
        }
      }
    }
    
    return jsonResponseNoStore({
      type,
      count: questions.length,
      questions
    });
  } catch (error) {
    console.error('Quiz generation error:', error);
    return jsonResponseNoStore({ error: 'Failed to generate quiz' }, 500);
  }
}

async function handleGetSearchIndex(request, env) {
  try {
    const cacheKey = new Request(new URL(request.url), request);
    const edgeCached = await caches.default.match(cacheKey);
    if (edgeCached) {
      const inm = request.headers.get('If-None-Match');
      const etag = edgeCached.headers.get('ETag');
      if (inm && etag && inm === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            ...CORS_HEADERS,
            'Cache-Control': edgeCached.headers.get('Cache-Control') || CACHE_CONTROL,
            'ETag': etag,
            'Last-Modified': edgeCached.headers.get('Last-Modified') || ''
          }
        });
      }
      return edgeCached;
    }
    if (env.VOCAB_CACHE) {
      const cached = await env.VOCAB_CACHE.get('search_index', 'json');
      if (cached) {
        const resp = new Response(JSON.stringify(cached), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            ...CORS_HEADERS
          }
        });
        try { await caches.default.put(cacheKey, resp.clone()); } catch (_) {}
        return resp;
      }
    }
    
    const object = await env.VOCAB_DATA.get('search_index.json');
    if (!object) {
      return jsonResponse({ error: 'Search index not found' }, 404);
    }
    
    const data = await object.json();
    
    if (env.VOCAB_CACHE) {
      await env.VOCAB_CACHE.put('search_index', JSON.stringify(data), {
        expirationTtl: 3600
      });
    }
    
    const etag = object.etag || object.httpEtag || '';
    const lastModified = object.uploaded ? new Date(object.uploaded).toUTCString() : undefined;
    const resp = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        ...(etag ? { 'ETag': etag } : {}),
        ...(lastModified ? { 'Last-Modified': lastModified } : {}),
        ...CORS_HEADERS
      }
    });
    try { await caches.default.put(cacheKey, resp.clone()); } catch (_) {}
    return resp;
  } catch (error) {
    return jsonResponse({ error: 'Failed to load search index' }, 500);
  }
}

// 例句分頁端點：根據 lemma 與 offset/limit 回傳切片
async function handleGetSentences(url, env) {
  try {
    const lemma = (url.searchParams.get('lemma') || '').trim();
    if (!lemma) {
      return jsonResponseNoStore({ error: 'Missing lemma' }, 400);
    }

    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));
    let limit = parseInt(url.searchParams.get('limit') || '30');
    if (isNaN(limit) || limit <= 0) limit = 30;
    limit = Math.min(100, Math.max(1, limit));

    const object = await env.VOCAB_DATA.get(`vocab_details/${lemma}.json`);
    if (!object) {
      return jsonResponseNoStore({ error: 'Word not found' }, 404);
    }

    const data = await object.json();
    const { featured, other } = splitSentencesData(data.sentences);
    const all = featured.concat(other);
    const total = all.length;
    const items = all.slice(offset, offset + limit);
    const nextOffset = Math.min(total, offset + items.length);
    const hasMore = nextOffset < total;

    return jsonResponseNoStore({
      items,
      total,
      next_offset: nextOffset,
      has_more: hasMore
    });
  } catch (error) {
    return jsonResponseNoStore({ error: 'Failed to load sentences' }, 500);
  }
}

async function handleGetAudio(pathname, env) {
  try {
    const audioPath = pathname.replace(/^\/audio\//, '');
    
    if (!env.AUDIO_BUCKET) {
      return new Response('Audio service not available', { status: 503 });
    }
    
    const object = await env.AUDIO_BUCKET.get(audioPath);
    
    if (!object) {
      return new Response('Audio not found', { status: 404 });
    }
    
    const headers = {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000',
      ...CORS_HEADERS
    };
    
    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Audio fetch error:', error);
    return new Response('Failed to fetch audio', { status: 500 });
  }
}

function generateChoiceOptions(correctWord, allCandidates, indexMap) {
  const options = [correctWord];
  const otherWords = allCandidates.filter(w => w !== correctWord);
  
  for (let i = 0; i < 3 && otherWords.length > 0; i++) {
    const randomIndex = Math.floor(Math.random() * otherWords.length);
    options.push(otherWords[randomIndex]);
    otherWords.splice(randomIndex, 1);
  }
  
  return shuffleArray(options).map(lemma => ({
    value: lemma,
    label: indexMap[lemma]?.zh_preview || lemma
  }));
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': CACHE_CONTROL,
      ...CORS_HEADERS
    }
  });
}

// 產生常見詞形變化（極簡規則）
function getInflectionVariants(lemma) {
  const forms = new Set([lemma]);
  const lower = lemma.toLowerCase();
  if (/[sxz]$/.test(lower) || /(ch|sh)$/.test(lower)) {
    forms.add(`${lower}es`);
  } else if (/y$/.test(lower) && !/[aeiou]y$/.test(lower)) {
    forms.add(`${lower.slice(0, -1)}ies`);
  } else {
    forms.add(`${lower}s`);
  }
  // 第三人稱單數（與上相同規則）
  if (/[sxz]$/.test(lower) || /(ch|sh)$/.test(lower)) {
    forms.add(`${lower}es`);
  } else if (/y$/.test(lower) && !/[aeiou]y$/.test(lower)) {
    forms.add(`${lower.slice(0, -1)}ies`);
  } else {
    forms.add(`${lower}s`);
  }
  return Array.from(forms);
}

function jsonResponseNoStore(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS
    }
  });
}

// 將 sentences 轉成 { featured: [], other: [] }
function splitSentencesData(sentencesData) {
  let featured = [];
  let other = [];
  if (Array.isArray(sentencesData)) {
    featured = sentencesData;
  } else if (sentencesData && typeof sentencesData === 'object') {
    featured = Array.isArray(sentencesData.featured) ? sentencesData.featured : [];
    other = Array.isArray(sentencesData.other) ? sentencesData.other : [];
  }
  return { featured, other };
}

