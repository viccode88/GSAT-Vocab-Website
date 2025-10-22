/**
 * GSAT Vocabulary Learning Platform
 * Main Application Logic
 */

// ============================================================================
// 配置
// ============================================================================

const CONFIG = {
    // API 基礎 URL
    API_BASE: 'https://gsat-vocab-api.vic0407lu.workers.dev',
    // 音頻播放配置
    AUDIO_ENABLED: true,
    // 字卡音頻預取的前視張數
    AUDIO_PREFETCH_COUNT: 2
};

// UI 請求鎖，防止重複觸發
const AppLocks = {
    loadingDetail: false,
    fetchingRandom: false,
    generatingQuiz: false,
    loadingFlashcard: false
};

// ============================================================================
// 應用狀態
// ============================================================================

const AppState = {
    // 當前模式: browse, flashcard, quiz
    currentMode: 'browse',
    
    // 詞彙數據
    vocabIndex: [],
    searchIndex: null,
    
    // 當前篩選條件
    currentFilters: {
        searchTerm: '',
        freqMin: 1,
        freqMax: 999999, // 將在數據載入後更新為實際最大值
        pos: 'all'
    },
    
    // 瀏覽模式狀態
    browseState: {
        isGridMode: false,
        activeItem: null
    },
    
    // 字卡模式狀態
    flashcardState: {
        currentIndex: 0,
        words: [],
        knownWords: new Set(),
        reviewWords: new Set(),
        autoSpeak: true
    },
    
    // 測驗模式狀態
    quizState: {
        type: null,
        questions: [],
        currentQuestion: 0,
        answers: [],
        score: 0
    }
};

// 音頻預取狀態
const PrefetchState = {
    prefetchedAudio: new Set()
};

// 網格預覽狀態
const BrowsePreviewState = {
    tooltip: null,
    cache: new Map(),
    lastPreviewedCell: null,
    previewTimeout: null,
    isMobile: false
};

// ============================================================================
// DOM 元素引用
// ============================================================================

const DOM = {};

// ============================================================================
// 初始化
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 載入完成，開始初始化應用...');
    
    try {
        initDOM();
        console.log('✓ DOM 元素初始化完成');
        
        initEventListeners();
        console.log('✓ 事件監聽器初始化完成');
        
        loadVocabData();
        console.log('✓ 開始載入詞彙數據');
        
        loadProgress();
        console.log('✓ 載入學習進度');
        // 非阻塞 UI 預熱：等一幀後開始，避免與初次渲染競爭
        requestAnimationFrame(() => {
            try { requestIdleCallback(prewarmUI); } catch (_) { setTimeout(prewarmUI, 0); }
        });
        
        // 初始化網格預覽功能
        initBrowsePreview();
    } catch (error) {
        console.error('❌ 初始化失敗:', error);
        alert('應用初始化失敗，請刷新頁面重試。錯誤: ' + error.message);
    }
});

/**
 * 初始化 DOM 元素引用
 */
function initDOM() {
    // 主要容器
    DOM.app = document.getElementById('app');
    DOM.mainContent = document.getElementById('main-content');
    
    // 模式切換按鈕
    DOM.browseModeBtn = document.getElementById('browse-mode-btn');
    DOM.flashcardModeBtn = document.getElementById('flashcard-mode-btn');
    DOM.quizModeBtn = document.getElementById('quiz-mode-btn');
    DOM.homeLink = document.getElementById('home-link');
    
    // 控制面板
    DOM.controlPanel = document.getElementById('control-panel');
    DOM.searchInput = document.getElementById('search-input');
    DOM.freqSliderMin = document.getElementById('freq-slider-min');
    DOM.freqSliderMax = document.getElementById('freq-slider-max');
    DOM.freqRangeDisplay = document.getElementById('freq-range-display');
    DOM.posFilterGroup = document.getElementById('pos-filter-group');
    DOM.randomWordBtn = document.getElementById('random-word-btn');
    DOM.showFiltersBtn = document.getElementById('show-filters-btn');
    DOM.overlay = document.getElementById('overlay');
    
    // 瀏覽模式
    DOM.browseContainer = document.getElementById('browse-container');
    DOM.wordListContainer = document.getElementById('word-list-container');
    DOM.resultsHeader = document.getElementById('results-header');
    DOM.resultsCount = document.getElementById('results-count');
    DOM.wordList = document.getElementById('word-list');
    DOM.gridToggleBtn = document.getElementById('grid-toggle-btn');
    DOM.detailWrapper = document.getElementById('detail-wrapper');
    DOM.detailPanel = document.getElementById('detail-panel');
    DOM.welcomeView = document.getElementById('welcome-view');
    DOM.detailView = document.getElementById('detail-view');
    DOM.loadingState = document.getElementById('loading-state');
    DOM.backToListBtn = document.getElementById('back-to-list-btn');
    
    // 字卡模式
    DOM.flashcardContainer = document.getElementById('flashcard-container');
    DOM.flashcard = document.getElementById('flashcard');
    DOM.flashcardWord = document.getElementById('flashcard-word');
    DOM.flashcardPos = document.getElementById('flashcard-pos');
    DOM.flashcardDefinitions = document.getElementById('flashcard-definitions');
    DOM.flashcardProgress = document.getElementById('flashcard-progress');
    DOM.flashcardPrev = document.getElementById('flashcard-prev');
    DOM.flashcardNext = document.getElementById('flashcard-next');
    DOM.flashcardKnown = document.getElementById('flashcard-known');
    DOM.flashcardReview = document.getElementById('flashcard-review');
    DOM.flashcardPlay = document.getElementById('flashcard-play');
    // 字卡結算
    DOM.flashcardSummary = document.getElementById('flashcard-summary');
    DOM.fcTotal = document.getElementById('fc-total');
    DOM.fcKnown = document.getElementById('fc-known');
    DOM.fcReview = document.getElementById('fc-review');
    DOM.fcRestartAll = document.getElementById('fc-restart-all');
    DOM.fcRestartReview = document.getElementById('fc-restart-review');
    DOM.fcExportReview = document.getElementById('fc-export-review');
    DOM.fcBackToSetup = document.getElementById('fc-back-to-setup');
    // 字卡設定視窗元素
    DOM.flashcardSetup = document.getElementById('flashcard-setup');
    DOM.flashcardSetupStart = document.getElementById('flashcard-setup-start');
    DOM.flashcardSetupCancel = document.getElementById('flashcard-setup-cancel');
    DOM.flashcardCount = document.getElementById('flashcard-count');
    DOM.flashcardPosGroup = document.getElementById('flashcard-pos-group');
    DOM.flashcardFreqMin = document.getElementById('flashcard-freq-min');
    DOM.flashcardFreqMax = document.getElementById('flashcard-freq-max');
    DOM.flashcardManualList = document.getElementById('flashcard-manual-list');
    DOM.flashcardManualSearch = document.getElementById('flashcard-manual-search');
    DOM.flashcardAutoSpeak = document.getElementById('flashcard-auto-speak');
    
    // 測驗模式
    DOM.quizContainer = document.getElementById('quiz-container');
    DOM.quizSelection = document.getElementById('quiz-selection');
    DOM.quizActive = document.getElementById('quiz-active');
    DOM.quizResults = document.getElementById('quiz-results');
    DOM.quizCount = document.getElementById('quiz-count');
    DOM.quizPos = document.getElementById('quiz-pos');
    DOM.quizExcludePropn = document.getElementById('quiz-exclude-propn');
    DOM.quizFreqMin = document.getElementById('quiz-freq-min');
    DOM.quizFreqMax = document.getElementById('quiz-freq-max');
    DOM.quizChoiceDirectionInputs = document.getElementsByName('quiz-choice-direction');
    
    // 加載遮罩
    DOM.loadingOverlay = document.getElementById('loading-overlay');
    DOM.loadingText = document.getElementById('loading-text');
    DOM.quizRetryIncorrect = document.getElementById('quiz-retry-incorrect');
    
    // 檢查關鍵元素
    const criticalElements = [
        'wordList', 'resultsCount', 'loadingState', 'detailView', 'welcomeView'
    ];
    
    const missingElements = criticalElements.filter(key => !DOM[key]);
    if (missingElements.length > 0) {
        console.error('❌ 缺少關鍵 DOM 元素:', missingElements);
        throw new Error('缺少關鍵 DOM 元素: ' + missingElements.join(', '));
    }
    
    console.log('  - 找到', Object.keys(DOM).length, '個 DOM 元素');
}

/**
 * 初始化事件監聽器
 */
function initEventListeners() {
    // 模式切換
    DOM.browseModeBtn.addEventListener('click', () => switchMode('browse'));
    DOM.flashcardModeBtn.addEventListener('click', () => switchMode('flashcard'));
    DOM.quizModeBtn.addEventListener('click', () => switchMode('quiz'));
    // 標題返回主畫面
    if (DOM.homeLink) {
        DOM.homeLink.addEventListener('click', () => {
            switchMode('browse');
            DOM.app.classList.remove('mobile-detail-view-active');
        });
    }
    
    // 搜索
    DOM.searchInput.addEventListener('input', debounce(() => {
        AppState.currentFilters.searchTerm = DOM.searchInput.value.trim().toLowerCase();
        applyFilters();
    }, 300));
    
    // 頻率滑動條：雙向一致約束
    DOM.freqSliderMin.addEventListener('input', () => {
        const min = parseInt(DOM.freqSliderMin.value);
        const max = parseInt(DOM.freqSliderMax.value);
        if (min > max) {
            // 當拖動最小值超過最大值，推動最大值到最小值位置
            DOM.freqSliderMax.value = String(min);
        }
        updateFreqRange();
    });
    DOM.freqSliderMax.addEventListener('input', () => {
        const min = parseInt(DOM.freqSliderMin.value);
        const max = parseInt(DOM.freqSliderMax.value);
        if (max < min) {
            // 當拖動最大值低於最小值，拉動最小值到最大值位置
            DOM.freqSliderMin.value = String(max);
        }
        updateFreqRange();
    });
    
    // 移除頻率預設按鈕事件（按鈕已被刪除，以下為兼容防呆）
    document.querySelectorAll('.freq-preset-btn').forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });
    
    // 詞性篩選
    DOM.posFilterGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (btn) {
            AppState.currentFilters.pos = btn.dataset.pos;
            updateActiveButton(DOM.posFilterGroup, btn);
            applyFilters();
        }
    });
    
    // 隨機單字
    DOM.randomWordBtn.addEventListener('click', getRandomWord);
    
    // 網格視圖切換
    DOM.gridToggleBtn.addEventListener('click', () => {
        AppState.browseState.isGridMode = !AppState.browseState.isGridMode;
        DOM.mainContent.classList.toggle('browse-mode', AppState.browseState.isGridMode);
        renderWordList();
    });
    
    // 單字列表點擊（包含網格預覽邏輯）
    DOM.wordList.addEventListener('click', (e) => {
        const item = e.target.closest('.word-item');
        if (item) {
            const lemma = item.dataset.lemma;
            // 網格模式 + 手機版：兩段式點擊
            if (AppState.browseState.isGridMode && BrowsePreviewState.isMobile) {
                if (BrowsePreviewState.lastPreviewedCell === item) {
                    // 第二次點擊：查看詳情
                    hideBrowsePreview();
                    showWordDetail(lemma, item);
                } else {
                    // 第一次點擊：顯示預覽
                    showBrowsePreview(item, lemma);
                }
            } else {
                // 非網格或桌面版：直接查看詳情
                showWordDetail(lemma, item);
            }
        }
    });
    
    // 返回列表按鈕（移動版）
    DOM.backToListBtn.addEventListener('click', () => {
        DOM.app.classList.remove('mobile-detail-view-active');
        // 清除手機版預覽狀態
        hideBrowsePreview();
    });
    
    // 側邊欄切換（移動版）
    DOM.showFiltersBtn.addEventListener('click', toggleSidebar);
    DOM.overlay.addEventListener('click', toggleSidebar);
    
    // 字卡模式
    DOM.flashcard.addEventListener('click', () => {
        DOM.flashcard.classList.toggle('flipped');
    });
    
    DOM.flashcardPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        previousFlashcard();
    });
    
    DOM.flashcardNext.addEventListener('click', (e) => {
        e.stopPropagation();
        nextFlashcard();
    });
    
    DOM.flashcardKnown.addEventListener('click', (e) => {
        e.stopPropagation();
        markFlashcard('known');
    });
    
    DOM.flashcardReview.addEventListener('click', (e) => {
        e.stopPropagation();
        markFlashcard('review');
    });
    if (DOM.flashcardPlay) {
        DOM.flashcardPlay.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = (DOM.flashcardWord?.textContent || '').trim();
            if (text) playAudio(text);
        });
    }
    // 字卡設定：chips 多選
    if (DOM.flashcardPosGroup) {
        DOM.flashcardPosGroup.addEventListener('click', (e) => {
            const chip = e.target.closest('.pos-chip');
            if (!chip) return;
            chip.classList.toggle('active');
            // 變更詞性後即時重算候選清單
            populateFlashcardManualList();
        });
    }
    // 字卡設定：開始 / 取消
    if (DOM.flashcardSetupStart) {
        DOM.flashcardSetupStart.addEventListener('click', () => {
            startFlashcardWithSetup();
        });
    }
    if (DOM.flashcardSetupCancel) {
        DOM.flashcardSetupCancel.addEventListener('click', () => {
            closeFlashcardSetup();
            switchMode('browse');
        });
    }
    if (DOM.flashcardCount) {
        const clampCount = () => {
            let v = parseInt(DOM.flashcardCount.value || '0');
            if (isNaN(v)) v = 20;
            v = Math.max(1, Math.min(100, v));
            DOM.flashcardCount.value = String(v);
        };
        DOM.flashcardCount.addEventListener('change', clampCount);
        DOM.flashcardCount.addEventListener('blur', clampCount);
    }
    if (DOM.flashcardFreqMin) {
        DOM.flashcardFreqMin.addEventListener('input', () => {
            const min = parseInt(DOM.flashcardFreqMin.value || '');
            const max = parseInt(DOM.flashcardFreqMax?.value || '');
            if (!isNaN(min) && !isNaN(max) && min > max) {
                DOM.flashcardFreqMin.value = String(max);
            }
            populateFlashcardManualList();
        });
    }
    if (DOM.flashcardFreqMax) {
        DOM.flashcardFreqMax.addEventListener('input', () => {
            const min = parseInt(DOM.flashcardFreqMin?.value || '');
            const max = parseInt(DOM.flashcardFreqMax.value || '');
            if (!isNaN(min) && !isNaN(max) && max < min) {
                DOM.flashcardFreqMax.value = String(min);
            }
            populateFlashcardManualList();
        });
    }
    if (DOM.flashcardManualSearch) {
        DOM.flashcardManualSearch.addEventListener('input', debounce(() => {
            filterFlashcardManualList(DOM.flashcardManualSearch.value.trim().toLowerCase());
        }, 200));
    }
    // 字卡設定：自動發音變更時即時保存
    if (DOM.flashcardAutoSpeak) {
        DOM.flashcardAutoSpeak.addEventListener('change', () => {
            const val = !!DOM.flashcardAutoSpeak.checked;
            AppState.flashcardState.autoSpeak = val;
            try { localStorage.setItem('gsat_vocab_auto_speak_flashcard', String(val)); } catch (_) {}
        });
    }
    
    // 測驗模式
    document.querySelectorAll('.quiz-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            startQuiz(type);
        });
    });

    // 詞性多選（晶片式）
    const quizPosGroup = document.getElementById('quiz-pos-group');
    if (quizPosGroup) {
        quizPosGroup.addEventListener('click', (e) => {
            const chip = e.target.closest('.pos-chip');
            if (!chip) return;
            chip.classList.toggle('active');
        });
    }
}

// ============================================================================
// 數據加載
// ============================================================================

/**
 * 加載詞彙數據
 */
async function loadVocabData() {
    showLoading('載入詞彙數據...');
    DOM.loadingState.textContent = '正在載入數據...';
    
    try {
        console.log('開始載入詞彙數據，API 地址:', CONFIG.API_BASE);
        
        // 嘗試從 API 加載索引
        const response = await fetch(`${CONFIG.API_BASE}/api/vocab/index`);
        
        console.log('API 響應狀態:', response.status, response.statusText);
        
        if (response.ok) {
            AppState.vocabIndex = await response.json();
            console.log('成功載入詞彙數據，共', AppState.vocabIndex.length, '個單詞');
            
            setupFrequencyFilter();

            DOM.loadingState.textContent = '數據載入完成！';
            DOM.loadingState.classList.remove('animate-pulse');
            
            // 同時載入搜索索引
            loadSearchIndex();
            
            applyFilters();
            hideLoading();
        } else {
            throw new Error(`API response not OK: ${response.status}`);
        }
    } catch (error) {
        console.error('從 API 載入失敗:', error);
        console.error('本地備用已禁用，無法載入數據');
        DOM.resultsCount.textContent = '數據載入失敗';
        DOM.loadingState.textContent = '數據載入失敗！請檢查網絡連接。';
        DOM.loadingState.classList.add('text-red-500');
        hideLoading();
    }
}

/**
 * 獲取第一個定義
 */
function getFirstDefinition(word, lang) {
    if (word.meanings && word.meanings.length > 0) {
        return lang === 'zh' ? word.meanings[0].zh_def : word.meanings[0].en_def;
    }
    if (word.definition) {
        return lang === 'zh' ? word.definition.zh_def : word.definition.en_def;
    }
    return '';
}

/**
 * 載入搜索索引
 */
async function loadSearchIndex() {
    try {
        const response = await fetch(`${CONFIG.API_BASE}/api/search-index`);
        if (response.ok) {
            AppState.searchIndex = await response.json();
        }
    } catch (error) {
        console.error('Failed to load search index:', error);
    }
}

// ============================================================================
// 篩選與搜索
// ============================================================================

/**
 * 更新頻率範圍顯示
 */
function updateFreqRange() {
    const min = parseInt(DOM.freqSliderMin.value);
    const max = parseInt(DOM.freqSliderMax.value);
    AppState.currentFilters.freqMin = min;
    AppState.currentFilters.freqMax = max;
    scheduleApplyFilters();
}

/**
 * 應用篩選條件
 */
let rAFScheduled = false;
function scheduleApplyFilters() {
    if (rAFScheduled) return;
    rAFScheduled = true;
    requestAnimationFrame(() => {
        rAFScheduled = false;
        applyFilters();
    });
}

function applyFilters() {
    // 減少高頻 log 以降低卡頓
    
    let filtered = [...AppState.vocabIndex];
    
    // 頻率過濾（基於單字計數）
    const { freqMin, freqMax } = AppState.currentFilters;
    filtered = filtered.filter(word => {
        return word.count >= freqMin && word.count <= freqMax;
    });
    
    // 搜索過濾
    if (AppState.currentFilters.searchTerm) {
        filtered = filtered.filter(word => 
            word.lemma.toLowerCase().startsWith(AppState.currentFilters.searchTerm)
        );
    }
    
    // 詞性過濾
    if (AppState.currentFilters.pos !== 'all') {
        if (AppState.searchIndex && AppState.searchIndex.by_pos) {
            const posWords = new Set(AppState.searchIndex.by_pos[AppState.currentFilters.pos] || []);
            filtered = filtered.filter(word => posWords.has(word.lemma));
        } else {
            // 本地模式：檢查 primary_pos
            filtered = filtered.filter(word => word.primary_pos === AppState.currentFilters.pos);
        }
    }
    
    DOM.resultsCount.textContent = `找到 ${filtered.length} 個符合條件的單詞`;
    
    renderWordList(filtered);
}

/**
 * 渲染單字列表
 */
function renderWordList(words = null) {
    console.log('renderWordList 被調用，words:', words ? words.length : 'null');
    
    if (!words) {
        // 重新應用篩選
        console.log('words 為 null，重新應用篩選');
        applyFilters();
        return;
    }
    
    DOM.wordList.innerHTML = '';
    
    if (words.length === 0) {
        console.log('⚠️  沒有單詞可顯示');
        DOM.wordList.innerHTML = '<p class="p-4 text-slate-500 text-center">找不到符合條件的單詞</p>';
        return;
    }
    
    console.log('開始渲染', words.length, '個單詞，模式:', AppState.browseState.isGridMode ? '網格' : '列表');
    
    if (AppState.browseState.isGridMode) {
        renderBrowseGrid(words);
    } else {
        renderNormalList(words);
    }
    
    console.log('✓ 單詞列表渲染完成');
}

/**
 * 根據載入的詞彙數據，設置頻率篩選器
 */
function setupFrequencyFilter() {
    if (AppState.vocabIndex.length === 0) return;

    // 獲取實際的 count 範圍
    const counts = AppState.vocabIndex.map(word => word.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    
    console.log(`詞彙頻率範圍: ${minCount} - ${maxCount}`);
    
    // 更新滑桿的 min, max（保留使用者當前值，若未設定則維持 1-20 初值）
    DOM.freqSliderMin.min = minCount;
    DOM.freqSliderMin.max = maxCount;
    DOM.freqSliderMax.min = minCount;
    DOM.freqSliderMax.max = maxCount;

    // 若目前值超出新範圍，夾回；否則沿用現值
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    let curMin = parseInt(DOM.freqSliderMin.value || '1');
    let curMax = parseInt(DOM.freqSliderMax.value || '20');
    curMin = clamp(curMin, minCount, maxCount);
    curMax = clamp(curMax, minCount, maxCount);
    if (curMin > curMax) [curMin, curMax] = [curMax, curMin];
    DOM.freqSliderMin.value = String(curMin);
    DOM.freqSliderMax.value = String(curMax);

    AppState.currentFilters.freqMin = curMin;
    AppState.currentFilters.freqMax = curMax;
    scheduleApplyFilters();
}

/**
 * 渲染普通列表模式
 */
function renderNormalList(words) {
    const fragment = document.createDocumentFragment();
    
    words.forEach((word, index) => {
        const item = document.createElement('div');
        item.className = 'word-item list-item flex justify-between items-center p-3 px-4 cursor-pointer border-b border-slate-100 hover:bg-slate-100 transition-colors duration-150';
        item.dataset.lemma = word.lemma;
        item.dataset.index = index;
        
        const rank = AppState.vocabIndex.indexOf(word) + 1;
        
        item.innerHTML = `
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <span class="font-semibold text-slate-800">${escapeHtml(word.lemma)}</span>
                    <span class="text-xs font-medium text-slate-500">${escapeHtml(word.primary_pos)}</span>
                    ${word.meaning_count > 1 ? `<span class="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">${escapeHtml(word.meaning_count)}義</span>` : ''}
                </div>
                ${word.zh_preview ? `<p class="text-xs text-slate-600 mt-1 truncate">${escapeHtml(word.zh_preview.slice(0, 40))}...</p>` : ''}
            </div>
            <div class="flex items-center gap-3">
                <span class="text-xs text-slate-400">#${rank}</span>
                <span class="text-sm font-mono bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">${escapeHtml(word.count)}</span>
            </div>
        `;
        
        fragment.appendChild(item);
    });
    
    DOM.wordList.appendChild(fragment);
}

/**
 * 渲染網格瀏覽模式
 */
function renderBrowseGrid(words) {
    const fragment = document.createDocumentFragment();
    
    words.forEach((word, index) => {
        const item = document.createElement('div');
        item.className = 'word-item browse-cell';
        item.dataset.lemma = word.lemma;
        item.dataset.index = index;
        // textContent 自動轉義，所以這裡不需要 escapeHtml
        item.textContent = word.lemma;
        
        fragment.appendChild(item);
    });
    
    DOM.wordList.appendChild(fragment);
}

// ============================================================================
// 單字詳情
// ============================================================================

/**
 * 顯示單字詳情
 */
async function showWordDetail(lemma, itemElement) {
    if (AppLocks.loadingDetail) return;
    AppLocks.loadingDetail = true;
    console.log('🔍 showWordDetail 被調用，單字:', lemma);
    showLoading('載入單字詳情...');
    
    try {
        let wordData = null;
        
        // 嘗試從 API 獲取
        try {
            const url = `${CONFIG.API_BASE}/api/vocab/detail/${lemma}`;
            console.log('  發送 API 請求:', url);
            
            const response = await fetch(url);
            console.log('  API 響應狀態:', response.status, response.statusText);
            
            if (response.ok) {
                wordData = await response.json();
                console.log('  ✓ 成功獲取單字數據:', wordData);
                console.log('  - 數據結構:', {
                    hasLemma: !!wordData.lemma,
                    hasCount: !!wordData.count,
                    hasDefinition: !!wordData.definition,
                    hasMeanings: !!wordData.meanings,
                    meaningCount: wordData.meanings?.length || 0,
                    hasSentences: !!wordData.sentences,
                    sentenceCount: wordData.sentences?.length || 0
                });
            } else {
                // 如果 API 請求失敗，直接拋出錯誤
                throw new Error(`API request failed with status ${response.status}`);
            }
        } catch (apiError) {
            console.error('  ❌ API 請求失敗:', apiError);
            throw apiError;
        }
        
        if (!wordData) {
            throw new Error('Word not found');
        }
        
        console.log('  開始顯示單字詳情...');
        displayWordDetails(wordData);
        console.log('  ✓ 單字詳情渲染完成');
        
        updateActiveItem(itemElement);
        DOM.app.classList.add('mobile-detail-view-active');
        
        hideLoading();
    } catch (error) {
        console.error('❌ 載入單字詳情失敗:', error);
        console.error('  錯誤堆棧:', error.stack);
        alert('無法載入單詞詳情: ' + error.message);
        hideLoading();
    }
    finally {
        AppLocks.loadingDetail = false;
    }
}

/**
 * 顯示單字詳情內容
 */
function displayWordDetails(word) {
    console.log('📝 displayWordDetails 開始渲染');
    console.log('  - 單字:', word.lemma);
    
    try {
        // 隱藏歡迎頁面
        DOM.welcomeView.style.display = 'none';
        
        // 顯示詳情視圖（移除 hidden 類並設置 display）
        DOM.detailView.classList.remove('hidden');
        DOM.detailView.style.display = 'block';
        console.log('  ✓ 切換視圖顯示狀態（移除 hidden 類）');
        
        const rank = AppState.vocabIndex.findIndex(w => w.lemma === word.lemma) + 1;
        console.log('  - 頻率排名:', rank);
        
        console.log('  開始渲染各個區塊...');
        
        // 渲染各個區塊
        let meaningsHtml, posDistHtml, sentencesHtml;
        
        try {
            meaningsHtml = renderMeaningsSection(word);
            console.log('  ✓ 釋義區塊渲染完成，長度:', meaningsHtml.length);
        } catch (e) {
            console.error('  ❌ 釋義區塊渲染失敗:', e);
            meaningsHtml = '<div class="text-red-500">釋義渲染失敗</div>';
        }
        
        try {
            posDistHtml = renderPosDistSection(word);
            console.log('  ✓ 詞性分佈區塊渲染完成，長度:', posDistHtml.length);
        } catch (e) {
            console.error('  ❌ 詞性分佈區塊渲染失敗:', e);
            posDistHtml = '';
        }
        
        try {
            sentencesHtml = renderSentencesSection(word);
            console.log('  ✓ 例句區塊渲染完成，長度:', sentencesHtml.length);
        } catch (e) {
            console.error('  ❌ 例句區塊渲染失敗:', e);
            sentencesHtml = '<div class="text-red-500">例句渲染失敗</div>';
        }
        
        // 組合 HTML
        DOM.detailView.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <h2 class="text-4xl lg:text-5xl font-bold text-indigo-700">${escapeHtml(word.lemma)}</h2>
                ${CONFIG.AUDIO_ENABLED ? `
                    <button class="play-audio-btn p-2 rounded-full hover:bg-slate-200 active:bg-slate-300 transition" data-lemma="${escapeHtml(word.lemma)}" title="播放發音">
                        <svg class="w-6 h-6 text-slate-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                        </svg>
                    </button>
                ` : ''}
            </div>
            <p class="text-slate-500 mb-6">
                總出現次數: <span class="font-semibold text-slate-700">${escapeHtml(word.count)}</span>
                ${rank > 0 ? ` | 頻率排名: <span class="font-semibold text-slate-700">#${rank}</span>` : ''}
            </p>
            
            ${meaningsHtml}
            ${posDistHtml}
            ${sentencesHtml}
        `;
        
        console.log('  ✓ HTML 注入完成');
        console.log('  - detailView.innerHTML 長度:', DOM.detailView.innerHTML.length);
        
        // 添加音頻播放事件
        const audioBtn = DOM.detailView.querySelector('.play-audio-btn');
        if (audioBtn) {
            audioBtn.addEventListener('click', () => {
                playAudio(word.lemma);
            });
            console.log('  ✓ 音頻按鈕事件綁定完成');
        }
        
        // 綁定例句音頻播放事件（當前已渲染）
        bindSentenceAudioButtons();

        // 綁定「載入更多例句」按鈕事件
        const loadMoreBtn = DOM.detailView.querySelector('.load-more-sentences');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', async () => {
                const lemma = loadMoreBtn.dataset.lemma || word.lemma;
                let offset = parseInt(loadMoreBtn.dataset.offset || '0');
                const limit = parseInt(loadMoreBtn.dataset.limit || '30');
                if (!lemma) return;
                loadMoreBtn.disabled = true;
                loadMoreBtn.classList.add('opacity-50', 'cursor-not-allowed');
                await loadMoreSentences(lemma, offset, limit);
                // offset 會在 loadMoreSentences 完成後由回傳更新
                const next = loadMoreBtn.dataset.offset;
                // 若沒有更多，按鈕在函式內已隱藏
                loadMoreBtn.disabled = false;
                loadMoreBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                console.log('  ✓ 載入更多例句完成，下一個 offset:', next);
            });
        }
        
        DOM.detailPanel.scrollTop = 0;
        console.log('  ✓ 滾動位置重置');
        
        console.log('✅ displayWordDetails 渲染完成');
        
    } catch (error) {
        console.error('❌ displayWordDetails 渲染過程出錯:', error);
        console.error('  錯誤堆棧:', error.stack);
        throw error;
    }
}

/**
 * 渲染釋義區塊
 */
function renderMeaningsSection(word) {
    const meanings = word.meanings || [];
    
    if (meanings.length === 0 && word.definition) {
        // 舊格式：單一定義
        return `
            <div class="space-y-4 bg-slate-200/50 p-4 rounded-lg mb-6">
                <div>
                    <p class="text-sm font-semibold text-slate-600 mb-1">英文釋義</p>
                    <p class="text-slate-800">${escapeHtml(word.definition.en_def || 'N/A')}</p>
                </div>
                <div>
                    <p class="text-sm font-semibold text-slate-600 mb-1">中文釋義</p>
                    <p class="text-slate-800">${escapeHtml(word.definition.zh_def || 'N/A')}</p>
                </div>
                ${word.definition.example ? `
                    <div class="border-t border-slate-300 pt-3">
                        <p class="text-sm font-semibold text-slate-600 mb-1">AI 範例</p>
                        <p class="text-slate-800 italic">${escapeHtml(word.definition.example)}</p>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    if (meanings.length === 0) {
        return '<div class="mb-6"><p class="text-slate-500">暫無釋義</p></div>';
    }
    
    // 新格式：多義項
    return `
        <div class="mb-8">
            <h3 class="text-lg font-semibold text-slate-800 mb-3">釋義</h3>
            <div class="space-y-4">
                ${meanings.map((meaning, index) => `
                    <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-sm font-semibold text-indigo-600">${index + 1}.</span>
                            <span class="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded font-medium">${escapeHtml(meaning.pos)}</span>
                        </div>
                        <p class="text-slate-800 mb-1"><strong>中文：</strong>${escapeHtml(meaning.zh_def)}</p>
                        <p class="text-slate-600 text-sm"><strong>English:</strong> ${escapeHtml(meaning.en_def)}</p>
                        ${meaning.usage_note ? `<p class="text-sm text-slate-500 mt-2 italic border-l-2 border-indigo-300 pl-2">${escapeHtml(meaning.usage_note)}</p>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * 渲染詞性分佈區塊
 */
function renderPosDistSection(word) {
    const posDist = word.pos_dist || {};
    const entries = Object.entries(posDist);
    
    if (entries.length === 0) {
        return '';
    }
    
    const total = Math.max(1, entries.reduce((sum, [, count]) => sum + count, 0));
    
    return `
        <div class="mt-8">
            <h3 class="text-lg font-semibold text-slate-800 mb-3">詞性分佈</h3>
            <div class="space-y-3">
                ${entries.map(([pos, count]) => {
                    const percentage = (count / total * 100).toFixed(1);
                    return `
                        <div class="mb-3">
                            <div class="flex justify-between items-center mb-1">
                                <span class="text-sm font-medium text-slate-600">${escapeHtml(pos)}</span>
                                <span class="text-sm font-mono text-slate-500">${escapeHtml(count)} (${escapeHtml(percentage)}%)</span>
                            </div>
                            <div class="w-full bg-slate-200 rounded-full h-2">
                                <div class="bg-gradient-to-r from-sky-500 to-indigo-500 h-2 rounded-full transition-all duration-500" style="width: ${escapeHtml(percentage)}%"></div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

/**
 * 渲染例句區塊
 */
function renderSentencesSection(word) {
    const preview = Array.isArray(word.sentences_preview) ? word.sentences_preview : [];
    const totalCount = Number(word.sentences_total || 0);
    const nextOffset = Number(word.sentences_next_offset || preview.length || 0);

    console.log('  📖 renderSentencesSection 開始渲染');
    console.log(`    - 例句總數: ${totalCount}，預覽: ${preview.length}，nextOffset: ${nextOffset}`);
    
    if (totalCount === 0) {
        return `
            <div class="mt-8">
                <h3 class="text-lg font-semibold text-slate-800 mb-3">原文例句</h3>
                <p class="text-slate-500">暫無原文例句。</p>
            </div>
        `;
    }

    const previewHtml = preview.map(s => generateSentenceHtml(word.lemma, s)).join('');
    const hasMore = nextOffset < totalCount;
    const html = `
        <div class="mt-8">
            <h3 class="text-lg font-semibold text-slate-800 mb-3">原文例句</h3>
            <div id="sentences-list" class="space-y-4">
                ${previewHtml.length > 0 ? previewHtml : '<p class="text-slate-500">暫無原文例句。</p>'}
            </div>
            ${hasMore ? `
            <div class="mt-4">
                <button class="load-more-sentences w-full text-center py-2 px-4 rounded-lg bg-slate-200 hover:bg-slate-300 text-sm font-medium text-slate-700 transition" data-lemma="${escapeHtml(word.lemma)}" data-offset="${String(nextOffset)}" data-limit="30">
                    載入更多（剩餘 ${escapeHtml(totalCount - nextOffset)}）
                </button>
            </div>
            ` : ''}
        </div>
    `;
    
    console.log('    ✓ 例句區塊 HTML 長度:', html.length);
    return html;
}

// 加載更多例句並追加至列表
async function loadMoreSentences(lemma, offset, limit = 30) {
    try {
        const url = `${CONFIG.API_BASE}/api/vocab/sentences?lemma=${encodeURIComponent(lemma)}&offset=${encodeURIComponent(String(offset))}&limit=${encodeURIComponent(String(limit))}&t=${Date.now()}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const list = DOM.detailView.querySelector('#sentences-list');
        if (!list) return;
        const frag = document.createDocumentFragment();
        items.forEach(s => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = generateSentenceHtml(lemma, s);
            const node = wrapper.firstElementChild;
            if (node) frag.appendChild(node);
        });
        list.appendChild(frag);

        // 重新綁定新加入的音頻按鈕
        bindSentenceAudioButtons();

        // 更新按鈕狀態
        const btn = DOM.detailView.querySelector('.load-more-sentences');
        if (btn) {
            const next = Number(data.next_offset || (offset + items.length));
            const total = Number(data.total || 0);
            const hasMore = !!data.has_more && next < total;
            if (hasMore) {
                btn.dataset.offset = String(next);
                btn.textContent = `載入更多（剩餘 ${total - next}）`;
            } else {
                btn.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('載入更多例句失敗:', e);
        alert('載入更多例句失敗，請稍後重試');
    }
}

// 綁定例句音頻播放按鈕（避免重複綁定）
function bindSentenceAudioButtons() {
    const btns = DOM.detailView.querySelectorAll('.play-sentence-audio');
    btns.forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.addEventListener('click', () => {
            const audioFile = btn.dataset.audio;
            playSentenceAudio(audioFile);
        });
        btn.dataset.bound = '1';
    });
}

// 產生單一例句 HTML，含關鍵字高亮與播放按鈕
function generateSentenceHtml(lemma, s) {
    const text = s.text || '';
    const source = s.source || '';
    const audioFile = s.audio_file || '';
    const variants = getInflectionVariants(lemma);
    const pattern = `\\b(${variants.map(v => v.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')).join('|')})\\b`;
    const regex = new RegExp(pattern, 'gi');
    const escapedText = escapeHtml(text);
    const highlightedText = escapedText.replace(regex, (m) => `<span class=\"highlight\">${m}</span>`);
    return `
        <div class=\"bg-white border border-slate-200 p-3 rounded-lg\">
            <div class=\"flex justify-between items-start gap-2\">
                <p class=\"flex-1 text-slate-700 leading-relaxed\">${highlightedText}</p>
                ${audioFile && CONFIG.AUDIO_ENABLED ? `
                    <button class=\"play-sentence-audio flex-shrink-0 p-2 rounded-full hover:bg-slate-100\" data-audio=\"${escapeHtml(audioFile)}\" title=\"播放例句\">
                        <svg class=\"w-5 h-5 text-slate-600\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\" stroke-width=\"1.5\" stroke=\"currentColor\">
                            <path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z\" />
                        </svg>
                    </button>
                ` : ''}
            </div>
            ${source ? `<p class=\"text-xs text-slate-400 mt-2\">${escapeHtml(source)}</p>` : ''}
        </div>
    `;
}

// ============================================================================
// 隨機單字
// ============================================================================

/**
 * 獲取隨機單字
 */
async function getRandomWord() {
    if (AppLocks.fetchingRandom) return;
    AppLocks.fetchingRandom = true;
    DOM.randomWordBtn?.setAttribute('disabled', 'true');
    showLoading('獲取隨機單詞...');
    
    try {
        // 嘗試使用 API
        const params = new URLSearchParams();
        const { freqMin, freqMax, pos } = AppState.currentFilters;
        params.append('freq_min', String(freqMin));
        params.append('freq_max', String(freqMax));
        if (pos && pos !== 'all') params.append('pos', pos);
        if (pos !== 'PROPN') params.append('exclude_propn', 'true');
        
        params.append('t', Date.now());
        const response = await fetch(`${CONFIG.API_BASE}/api/vocab/random?${params}`, { cache: 'no-store' });
        
        if (response.ok) {
            const wordData = await response.json();
            displayWordDetails(wordData);
            DOM.app.classList.add('mobile-detail-view-active');
            hideLoading();
            // 冷卻 600ms 後允許下一次
            setTimeout(() => {
                AppLocks.fetchingRandom = false;
                DOM.randomWordBtn?.removeAttribute('disabled');
            }, 600);
            return;
        }
    } catch (error) {
        console.log('API random failed, using local');
    }
    
    // 回退到本地隨機
    let candidates = [...AppState.vocabIndex];
    
    // 應用篩選（使用 count 值）
    const { freqMin, freqMax, pos } = AppState.currentFilters;
    candidates = candidates.filter(word => {
        return word.count >= freqMin && word.count <= freqMax;
    });
    
    if (pos !== 'all') {
        candidates = candidates.filter(word => word.primary_pos === pos);
    }
    
    if (candidates.length === 0) {
        alert('沒有符合條件的單詞');
        hideLoading();
        return;
    }
    
    const randomWord = candidates[Math.floor(Math.random() * candidates.length)];
    await showWordDetail(randomWord.lemma);
    
    hideLoading();
    setTimeout(() => {
        AppLocks.fetchingRandom = false;
        DOM.randomWordBtn?.removeAttribute('disabled');
    }, 600);
}

// ============================================================================
// 音頻播放
// ============================================================================

let audioPlayer = new Audio();
audioPlayer.preload = 'auto';
// 全域播放請求序號，用於避免交錯請求造成的中斷
let AUDIO_REQUEST_ID = 0;

/**
 * 播放單字音頻
 */
function playAudio(lemma) {
    if (!CONFIG.AUDIO_ENABLED) return;
    const url = `${CONFIG.API_BASE}/audio/${lemma}.mp3`;
    startAudioPlayback(url);
}

/**
 * 預取單字音頻（使用隱形 Audio 或 fetch 預熱）
 */
function prefetchAudio(lemma) {
    if (!CONFIG.AUDIO_ENABLED) return;
    if (!lemma || PrefetchState.prefetchedAudio.has(lemma)) return;
    const url = `${CONFIG.API_BASE}/audio/${lemma}.mp3`;
    try {
        // 方式 A：使用 fetch 預熱瀏覽器快取
        fetch(url, { mode: 'no-cors' }).catch(() => {});
        PrefetchState.prefetchedAudio.add(lemma);
    } catch (_) {}
}

/**
 * 播放例句音頻
 */
function playSentenceAudio(filename) {
    if (!CONFIG.AUDIO_ENABLED) return;
    const base = (filename || '').split('/').pop();
    const url = `${CONFIG.API_BASE}/audio/sentences/${base}`;
    startAudioPlayback(url);
}

// 更穩定的音訊播放：單一音源、請求序號、被打斷時短延遲重試
function startAudioPlayback(url) {
    AUDIO_REQUEST_ID++;
    const myId = AUDIO_REQUEST_ID;
    try { audioPlayer.pause(); } catch (_) {}
    try { audioPlayer.currentTime = 0; } catch (_) {}
    audioPlayer.src = url;
    try { audioPlayer.load(); } catch (_) {}

    const tryPlay = (attempt = 1) => {
        if (myId !== AUDIO_REQUEST_ID) return; // 已有更新的播放請求
        const p = audioPlayer.play();
        if (!p || typeof p.catch !== 'function') return;
        p.catch(err => {
            // Autoplay 限制：忽略（待使用者互動後自然恢復）
            if (err && (err.name === 'NotAllowedError')) return;
            // 被 pause/新請求打斷：短延遲重試 2 次
            const isAbort = err && (err.name === 'AbortError' || /interrupted by a call to pause/i.test(String(err.message)));
            if (isAbort && attempt < 3 && myId === AUDIO_REQUEST_ID) {
                setTimeout(() => tryPlay(attempt + 1), 80 * attempt);
                return;
            }
            console.error('Failed to play audio:', err);
        });
    };

    // 立即嘗試播放（呼應已於 loadFlashcard 中使用 rAF 之時機）
    tryPlay(1);
}

// ============================================================================
// 模式切換
// ============================================================================

/**
 * 切換應用模式
 */
function switchMode(mode) {
    AppState.currentMode = mode;
    
    // 更新按鈕狀態
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.remove('bg-indigo-100');
    });
    
    // 隱藏所有模式容器
    DOM.browseContainer.classList.add('hidden');
    DOM.flashcardContainer.classList.add('hidden');
    DOM.quizContainer.classList.add('hidden');
    
    // 顯示對應模式
    switch (mode) {
        case 'browse':
            DOM.browseModeBtn.classList.add('bg-indigo-100');
            DOM.browseContainer.classList.remove('hidden');
            // 顯示側邊欄與右上角按鈕
            if (DOM.controlPanel) DOM.controlPanel.classList.remove('hidden');
            if (DOM.gridToggleBtn) DOM.gridToggleBtn.classList.remove('hidden');
            if (DOM.showFiltersBtn) DOM.showFiltersBtn.classList.remove('hidden');
            break;
        case 'flashcard':
            DOM.flashcardModeBtn.classList.add('bg-indigo-100');
            DOM.flashcardContainer.classList.remove('hidden');
            // 隱藏側邊欄與右上角按鈕
            if (DOM.controlPanel) DOM.controlPanel.classList.add('hidden');
            if (DOM.gridToggleBtn) DOM.gridToggleBtn.classList.add('hidden');
            if (DOM.showFiltersBtn) DOM.showFiltersBtn.classList.add('hidden');
            openFlashcardSetup();
            break;
        case 'quiz':
            DOM.quizModeBtn.classList.add('bg-indigo-100');
            DOM.quizContainer.classList.remove('hidden');
            // 隱藏側邊欄與遮罩
            if (DOM.controlPanel) DOM.controlPanel.classList.add('hidden');
            if (DOM.gridToggleBtn) DOM.gridToggleBtn.classList.add('hidden');
            if (DOM.showFiltersBtn) DOM.showFiltersBtn.classList.add('hidden');
            if (DOM.overlay) DOM.overlay.classList.add('hidden');
            showQuizSelection();
            break;
    }
}

// ============================================================================
// 字卡模式
// ============================================================================

/**
 * 初始化字卡模式
 */
function initFlashcardMode() {
    let words = [...AppState.vocabIndex];
    
    // 應用頻率篩選（使用 count 值）
    const { freqMin, freqMax } = AppState.currentFilters;
    words = words.filter(word => {
        return word.count >= freqMin && word.count <= freqMax;
    });
    
    // 應用詞性篩選
    if (AppState.currentFilters.pos !== 'all') {
        words = words.filter(word => word.primary_pos === AppState.currentFilters.pos);
    }
    
    if (words.length === 0) {
        alert('沒有符合條件的單詞');
        switchMode('browse');
        return;
    }
    
    // 打亂順序
    AppState.flashcardState.words = shuffleArray(words);
    AppState.flashcardState.currentIndex = 0;
    
    loadFlashcard();
}

// 以 UI 設定開啟字卡
function openFlashcardSetup() {
    if (!DOM.flashcardSetup) return;
    // 預設 1-10
    if (DOM.flashcardFreqMin) DOM.flashcardFreqMin.value = '1';
    if (DOM.flashcardFreqMax) DOM.flashcardFreqMax.value = '10';
    // 自動發音：讀取持久化設定，預設 true
    try {
        const saved = localStorage.getItem('gsat_vocab_auto_speak_flashcard');
        const val = saved == null ? true : saved === 'true';
        if (DOM.flashcardAutoSpeak) DOM.flashcardAutoSpeak.checked = val;
        AppState.flashcardState.autoSpeak = val;
    } catch (_) {
        if (DOM.flashcardAutoSpeak) DOM.flashcardAutoSpeak.checked = true;
        AppState.flashcardState.autoSpeak = true;
    }
    populateFlashcardManualList();
    DOM.flashcardSetup.classList.remove('hidden');
}

function closeFlashcardSetup() {
    if (!DOM.flashcardSetup) return;
    DOM.flashcardSetup.classList.add('hidden');
}

function populateFlashcardManualList() {
    if (!DOM.flashcardManualList) return;
    // 記錄已選
    const pickedSet = new Set(Array.from(DOM.flashcardManualList.querySelectorAll('.fc-pick:checked')).map(i => i.value));

    // 讀取設定（優先使用視窗內的設定，不用全域 AppState）
    const chips = Array.from(DOM.flashcardPosGroup?.querySelectorAll('.pos-chip.active') || []);
    const posValues = chips.map(c => c.dataset.pos);
    const excludePropn = false;
    const fmin = parseInt(DOM.flashcardFreqMin?.value || '');
    const fmax = parseInt(DOM.flashcardFreqMax?.value || '');
    const term = (DOM.flashcardManualSearch?.value || '').trim().toLowerCase();

    let pool = [...AppState.vocabIndex];
    if (!isNaN(fmin) || !isNaN(fmax)) {
        const min = isNaN(fmin) ? -Infinity : fmin;
        const max = isNaN(fmax) ? Infinity : fmax;
        pool = pool.filter(w => w.count >= min && w.count <= max);
    }
    if (posValues.length) {
        const posSet = new Set(posValues);
        pool = pool.filter(w => posSet.has(w.primary_pos));
    }
    if (term) {
        pool = pool.filter(w => w.lemma.toLowerCase().startsWith(term));
    }

    const top = pool.slice(0, 100);
    DOM.flashcardManualList.innerHTML = top.map(w => `
        <label class="flex items-center gap-2 py-1">
            <input type="checkbox" class="fc-pick" value="${escapeHtml(w.lemma)}" ${pickedSet.has(w.lemma) ? 'checked' : ''} />
            <span class="flex-1 truncate">${escapeHtml(w.lemma)}</span>
            <span class="text-xs text-slate-500">${escapeHtml(w.primary_pos)}</span>
            <span class="text-xs bg-slate-200 rounded px-1">${escapeHtml(w.count)}</span>
        </label>
    `).join('');
}

function filterFlashcardManualList(term) {
    if (!DOM.flashcardManualList) return;
    term = (term || '').toLowerCase();
    const labels = Array.from(DOM.flashcardManualList.querySelectorAll('label'));
    if (!term) {
        labels.forEach(l => l.classList.remove('hidden'));
        return;
    }
    labels.forEach(l => {
        const text = (l.querySelector('span')?.textContent || '').toLowerCase();
        l.classList.toggle('hidden', !text.startsWith(term));
    });
}

function startFlashcardWithSetup() {
    const count = Math.min(100, Math.max(1, parseInt(DOM.flashcardCount?.value || '20')));
    const excludePropn = !!DOM.flashcardExcludePropn?.checked;
    const posValues = Array.from(DOM.flashcardPosGroup?.querySelectorAll('.pos-chip.active') || []).map(c => c.dataset.pos);
    const fmin = parseInt(DOM.flashcardFreqMin?.value || '');
    const fmax = parseInt(DOM.flashcardFreqMax?.value || '');
    const picked = Array.from(DOM.flashcardManualList?.querySelectorAll('.fc-pick:checked') || []).map(i => i.value);
    // 讀取自動發音選項
    if (DOM.flashcardAutoSpeak) {
        AppState.flashcardState.autoSpeak = !!DOM.flashcardAutoSpeak.checked;
        try { localStorage.setItem('gsat_vocab_auto_speak_flashcard', String(AppState.flashcardState.autoSpeak)); } catch (_) {}
    }

    let pool = [...AppState.vocabIndex];
    if (!isNaN(fmin) || !isNaN(fmax)) {
        const min = isNaN(fmin) ? -Infinity : fmin;
        const max = isNaN(fmax) ? Infinity : fmax;
        pool = pool.filter(w => w.count >= min && w.count <= max);
    }
    if (posValues.length) {
        const posSet = new Set(posValues);
        pool = pool.filter(w => posSet.has(w.primary_pos));
    }
    if (excludePropn) {
        pool = pool.filter(w => w.primary_pos !== 'PROPN');
    }

    let chosen;
    if (picked.length) {
        const pickedSet = new Set(picked);
        chosen = pool.filter(w => pickedSet.has(w.lemma));
    } else {
        chosen = shuffleArray(pool).slice(0, count);
    }

    if (!chosen.length) {
        alert('沒有符合條件的單詞');
        return;
    }

    AppState.flashcardState.words = chosen;
    AppState.flashcardState.currentIndex = 0;
    closeFlashcardSetup();
    DOM.flashcardContainer.classList.remove('hidden');
    // 確保結算畫面關閉，字卡顯示
    if (DOM.flashcardSummary) DOM.flashcardSummary.classList.add('hidden');
    if (DOM.flashcard) DOM.flashcard.classList.remove('hidden');
    loadFlashcard();
}

function showFlashcardSummary() {
    // 統計
    const words = AppState.flashcardState.words.map(w => w.lemma);
    const known = words.filter(l => AppState.flashcardState.knownWords.has(l));
    const review = words.filter(l => AppState.flashcardState.reviewWords.has(l));
    if (DOM.fcTotal) DOM.fcTotal.textContent = String(words.length);
    if (DOM.fcKnown) DOM.fcKnown.textContent = String(known.length);
    if (DOM.fcReview) DOM.fcReview.textContent = String(review.length);
    // 切換視圖
    if (DOM.flashcard) DOM.flashcard.classList.add('hidden');
    if (DOM.flashcardSummary) DOM.flashcardSummary.classList.remove('hidden');
    // 綁定按鈕（去除舊事件）
    if (DOM.fcRestartAll) {
        DOM.fcRestartAll.replaceWith(DOM.fcRestartAll.cloneNode(true));
        const btn = document.getElementById('fc-restart-all');
        btn.addEventListener('click', () => {
            AppState.flashcardState.currentIndex = 0;
            if (DOM.flashcardSummary) DOM.flashcardSummary.classList.add('hidden');
            if (DOM.flashcard) DOM.flashcard.classList.remove('hidden');
            loadFlashcard();
        });
    }
    if (DOM.fcRestartReview) {
        DOM.fcRestartReview.replaceWith(DOM.fcRestartReview.cloneNode(true));
        const btn = document.getElementById('fc-restart-review');
        btn.addEventListener('click', () => {
            const reviewSet = AppState.flashcardState.reviewWords;
            const pool = AppState.flashcardState.words.filter(w => reviewSet.has(w.lemma));
            if (!pool.length) {
                alert('目前沒有「需複習」單字');
                return;
            }
            AppState.flashcardState.words = pool;
            AppState.flashcardState.currentIndex = 0;
            if (DOM.flashcardSummary) DOM.flashcardSummary.classList.add('hidden');
            if (DOM.flashcard) DOM.flashcard.classList.remove('hidden');
            loadFlashcard();
        });
    }
    if (DOM.fcExportReview) {
        DOM.fcExportReview.replaceWith(DOM.fcExportReview.cloneNode(true));
        const btn = document.getElementById('fc-export-review');
        btn.addEventListener('click', () => {
            const review = words.filter(l => AppState.flashcardState.reviewWords.has(l));
            const blob = new Blob([review.join('\n')], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'review_words.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }
    if (DOM.fcBackToSetup) {
        DOM.fcBackToSetup.replaceWith(DOM.fcBackToSetup.cloneNode(true));
        const btn = document.getElementById('fc-back-to-setup');
        btn.addEventListener('click', () => {
            openFlashcardSetup();
        });
    }
}

/**
 * 載入當前字卡
 */
async function loadFlashcard() {
    if (AppLocks.loadingFlashcard) return;
    AppLocks.loadingFlashcard = true;
    setFlashcardControlsEnabled(false);
    const { words, currentIndex } = AppState.flashcardState;
    
    if (currentIndex >= words.length) {
        showFlashcardSummary();
        AppLocks.loadingFlashcard = false;
        return;
    }
    
    const word = words[currentIndex];
    
    // 更新進度
    DOM.flashcardProgress.textContent = `${currentIndex + 1} / ${words.length}`;
    
    // 移除翻轉狀態
    DOM.flashcard.classList.remove('flipped');
    
    // 顯示正面
    DOM.flashcardWord.textContent = word.lemma;
    DOM.flashcardPos.textContent = word.primary_pos;
    
    // 立即安排自動發音：等下一幀，確保新單字已完成渲染後立刻播放
    try {
        if (AppState.flashcardState.autoSpeak) {
            const lemmaToSpeak = word.lemma;
            requestAnimationFrame(() => {
                // 確認仍停留在同一張卡，避免快速切換時誤播前一張
                const { words: currentWords, currentIndex: idx } = AppState.flashcardState;
                if (currentWords[idx] && currentWords[idx].lemma === lemmaToSpeak) {
                    playAudio(lemmaToSpeak);
                }
            });
        }
    } catch (_) {}
    
    // 加載完整數據
    try {
        let wordData = null;
        
        // 嘗試從 API
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/vocab/detail/${word.lemma}`);
            if (response.ok) {
                wordData = await response.json();
            }
        } catch (e) {
            console.log('API failed, using local');
        }
        
        // 回退到本地
        if (!wordData) {
            // 如果 API 請求失敗，直接拋出錯誤
            throw new Error(`API request failed with status ${response.status}`);
        }
        
        // 顯示背面
        DOM.flashcardDefinitions.innerHTML = '';
        
        if (wordData) {
            const meanings = wordData.meanings || [];
            
            if (meanings.length > 0) {
                meanings.forEach((meaning, index) => {
                    const meaningDiv = document.createElement('div');
                    meaningDiv.className = 'mb-4 text-left';
                    meaningDiv.innerHTML = `
                        <div class="text-sm text-indigo-600 font-semibold mb-1">${escapeHtml(meaning.pos)}</div>
                        <div class="text-lg font-semibold text-slate-800 mb-1">${escapeHtml(meaning.zh_def)}</div>
                        <div class="text-sm text-slate-600">${escapeHtml(meaning.en_def)}</div>
                    `;
                    DOM.flashcardDefinitions.appendChild(meaningDiv);
                });
            } else if (wordData.definition) {
                DOM.flashcardDefinitions.innerHTML = `
                    <div class="text-lg font-semibold text-slate-800 mb-2">${escapeHtml(wordData.definition.zh_def || '暫無釋義')}</div>
                    <div class="text-sm text-slate-600">${escapeHtml(wordData.definition.en_def || '')}</div>
                `;
            } else {
                DOM.flashcardDefinitions.innerHTML = `<p class="text-slate-600">${escapeHtml(word.zh_preview || '暫無釋義')}</p>`;
            }
        } else {
            DOM.flashcardDefinitions.innerHTML = `<p class="text-slate-600">${escapeHtml(word.zh_preview || '暫無釋義')}</p>`;
        }
    } catch (error) {
        console.error('Failed to load flashcard data:', error);
        DOM.flashcardDefinitions.innerHTML = `<p class="text-slate-600">${escapeHtml(word.zh_preview || '暫無釋義')}</p>`;
    }
    // 自動發音已提前於此在渲染後下一幀觸發

    // 音頻預載入：預取當前後續 N 張
    try {
        const n = Math.max(0, Number(CONFIG.AUDIO_PREFETCH_COUNT || 0));
        if (n > 0) {
            const { words, currentIndex } = AppState.flashcardState;
            for (let i = 0; i <= n; i++) {
                const idx = currentIndex + i;
                if (idx < words.length) prefetchAudio(words[idx].lemma);
            }
        }
    } catch (_) {}
    setFlashcardControlsEnabled(true);
    AppLocks.loadingFlashcard = false;
}

/**
 * 上一張字卡
 */
function previousFlashcard() {
    if (AppLocks.loadingFlashcard) return;
    if (AppState.flashcardState.currentIndex > 0) {
        AppState.flashcardState.currentIndex--;
        loadFlashcard();
    }
}

/**
 * 下一張字卡
 */
function nextFlashcard() {
    if (AppLocks.loadingFlashcard) return;
    AppState.flashcardState.currentIndex++;
    loadFlashcard();
}

/**
 * 標記字卡
 */
function markFlashcard(type) {
    if (AppLocks.loadingFlashcard) return;
    const { words, currentIndex } = AppState.flashcardState;
    const currentWord = words[currentIndex].lemma;
    
    if (type === 'known') {
        AppState.flashcardState.knownWords.add(currentWord);
        AppState.flashcardState.reviewWords.delete(currentWord);
    } else {
        AppState.flashcardState.reviewWords.add(currentWord);
        AppState.flashcardState.knownWords.delete(currentWord);
    }
    
    saveProgress();
    nextFlashcard();
}

// ============================================================================
// 測驗模式
// ============================================================================

function showQuizSelection() {
    DOM.quizSelection.classList.remove('hidden');
    DOM.quizActive.classList.add('hidden');
    DOM.quizResults.classList.add('hidden');
    // 重置按鈕鎖定狀態，避免退出後無法再次開始
    AppLocks.generatingQuiz = false;
    document.querySelectorAll('.quiz-type-btn').forEach(b => b.removeAttribute('disabled'));
    const qc = document.getElementById('quiz-question-container');
    if (qc) qc.innerHTML = '';
}

async function startQuiz(type) {
    if (AppLocks.generatingQuiz) return;
    AppLocks.generatingQuiz = true;
    document.querySelectorAll('.quiz-type-btn').forEach(b => b.setAttribute('disabled', 'true'));
    const count = Math.min(100, Math.max(1, parseInt(DOM.quizCount.value) || 10));
    // 從晶片組讀取選中詞性
    let posValues = [];
    const quizPosGroup = document.getElementById('quiz-pos-group');
    if (quizPosGroup) {
        posValues = Array.from(quizPosGroup.querySelectorAll('.pos-chip.active')).map(c => c.dataset.pos);
    } else {
        posValues = Array.from(DOM.quizPos?.selectedOptions || []).map(o => o.value).filter(Boolean);
    }
    const excludePropn = !!DOM.quizExcludePropn?.checked;
    const freqMin = parseInt(DOM.quizFreqMin?.value || '');
    const freqMax = parseInt(DOM.quizFreqMax?.value || '');
    // 方向：word_to_def or def_to_word
    let choiceDirection = 'word_to_def';
    if (DOM.quizChoiceDirectionInputs && DOM.quizChoiceDirectionInputs.length) {
        const selected = Array.from(DOM.quizChoiceDirectionInputs).find(i => i.checked);
        if (selected && (selected.value === 'word_to_def' || selected.value === 'def_to_word')) {
            choiceDirection = selected.value;
        }
    }
    
    if (count < 5 || count > 50) {
        alert('題目數量應在 5-50 之間');
        AppLocks.generatingQuiz = false;
        document.querySelectorAll('.quiz-type-btn').forEach(b => b.removeAttribute('disabled'));
        return;
    }
    
    showLoading('生成測驗題目...');
    
    try {
        const params = new URLSearchParams({ type, count });
        if (posValues.length) params.append('pos', posValues.join(','));
        if (excludePropn) params.append('exclude_propn', 'true');
        if (!isNaN(freqMin)) params.append('freq_min', String(freqMin));
        if (!isNaN(freqMax)) params.append('freq_max', String(freqMax));
        params.append('t', Date.now());

        const response = await fetch(`${CONFIG.API_BASE}/api/quiz/generate?${params}`);
        
        if (response.ok) {
            const data = await response.json();
            
            AppState.quizState.type = type;
            AppState.quizState.questions = (type === 'choice') ? transformChoiceQuestions(data.questions, choiceDirection) : data.questions;
            AppState.quizState.currentQuestion = 0;
            AppState.quizState.answers = [];
            AppState.quizState.score = 0;
            
            hideLoading();
            showQuizActive();
            return;
        }
    } catch (error) {
        console.log('API quiz generation failed');
    }
    
    hideLoading();
    alert('測驗功能需要 API 支持，請確保 Worker 正常運行');
    AppLocks.generatingQuiz = false;
    document.querySelectorAll('.quiz-type-btn').forEach(b => b.removeAttribute('disabled'));
}

function showQuizActive() {
    DOM.quizSelection.classList.add('hidden');
    DOM.quizActive.classList.remove('hidden');
    DOM.quizResults.classList.add('hidden');
    
    renderQuestion();
}

function renderQuestion() {
    const { questions, currentQuestion } = AppState.quizState;
    const question = questions[currentQuestion];
    
    document.getElementById('quiz-current').textContent = currentQuestion + 1;
    document.getElementById('quiz-total').textContent = questions.length;
    
    const container = document.getElementById('quiz-question-container');
    
    if (question.type === 'choice') {
        container.innerHTML = `
            <div class="mb-6">
                <h3 class="text-xl font-semibold text-slate-800 mb-4">${escapeHtml(question.promptTitle || '選擇正確的定義：')}</h3>
                <p class="text-lg text-slate-700 bg-slate-50 p-4 rounded font-bold">${escapeHtml(question.prompt)}</p>
            </div>
            <div class="space-y-3">
                ${question.options.map((option, index) => `
                    <button class="quiz-option w-full p-4 text-left border-2 border-slate-200 rounded-lg hover:border-indigo-300 transition" data-value="${escapeHtml(option.value)}" data-index="${index}">
                        <span class="font-semibold">${String.fromCharCode(65 + index)}.</span> ${escapeHtml(option.label)}
                    </button>
                `).join('')}
            </div>
        `;
    } else if (question.type === 'spelling') {
        container.innerHTML = `
            <div class="mb-6">
                <h3 class="text-xl font-semibold text-slate-800 mb-4">拼寫單詞：</h3>
                <p class="text-lg text-slate-700 bg-slate-50 p-4 rounded mb-4">${escapeHtml(question.question)}</p>
                ${question.hint ? `<p class="text-sm text-slate-500">${escapeHtml(question.hint)}</p>` : ''}
            </div>
            <div>
                <input type="text" id="spelling-input" class="w-full p-4 text-lg border-2 border-slate-300 rounded-lg focus:border-indigo-500 focus:outline-none" placeholder="請輸入單詞" autocomplete="off">
                <button id="spelling-submit" class="mt-4 w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">提交答案</button>
            </div>
        `;
        
        const input = document.getElementById('spelling-input');
        const submitBtn = document.getElementById('spelling-submit');
        
        submitBtn.addEventListener('click', () => {
            const answer = input.value.trim().toLowerCase();
            if (answer) {
                checkAnswer(answer);
            } else {
                input.focus();
            }
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const answer = input.value.trim().toLowerCase();
                if (answer) {
                    checkAnswer(answer);
                }
            }
        });
        
        input.focus();
    } else if (question.type === 'fill') {
        container.innerHTML = `
            <div class="mb-6">
                <h3 class="text-xl font-semibold text-slate-800 mb-4">選擇正確的單詞填入空格：</h3>
                <p class="text-lg text-slate-700 bg-slate-50 p-4 rounded">${escapeHtml(question.sentence)}</p>
            </div>
            <div class="space-y-3">
                ${question.options.map((option, index) => `
                    <button class="quiz-option w-full p-4 text-left border-2 border-slate-200 rounded-lg hover:border-indigo-300 transition" data-value="${escapeHtml(option.value)}" data-index="${index}">
                        <span class="font-semibold">${String.fromCharCode(65 + index)}.</span> ${escapeHtml(option.value)}
                    </button>
                `).join('')}
            </div>
        `;
    }
    
    // 添加選項點擊事件
    container.querySelectorAll('.quiz-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const answer = btn.dataset.value;
            const index = Number(btn.dataset.index || '0');
            checkAnswer(answer);
            // 顯示正確代號 + 增加每選項附加說明
            const { questions, currentQuestion } = AppState.quizState;
            const q = questions[currentQuestion];
            const correctValue = (q.correct || q.answer || '').toLowerCase();
            const correctIndex = (q.options || []).findIndex(o => (o.value || '').toLowerCase() === correctValue);
            if (correctIndex >= 0) {
                const nodes = container.querySelectorAll('.quiz-option');
                nodes.forEach((n, i) => {
                    if (i === correctIndex) n.classList.add('correct');
                    if (i !== correctIndex && n.dataset.value && n.dataset.value.toLowerCase() === answer.toLowerCase()) n.classList.add('incorrect');
                    // 作答後才在同一行尾端顯示對應英文/中文
                    const opt = (q.options || [])[i];
                    if (opt && !n.querySelector('.post-ans-detail')) {
                        const s = document.createElement('span');
                        s.className = 'post-ans-detail text-xs text-slate-500 ml-2';
                        const text = q.type === 'choice' ? (opt.value || '') : (opt.label || '');
                        s.textContent = text ? `（${text}）` : '';
                        n.appendChild(s);
                    }
                });
                const feedback = document.createElement('div');
                feedback.className = 'mt-4 text-sm text-slate-600';
                const letter = String.fromCharCode(65 + correctIndex);
                feedback.innerHTML = `正確答案：<strong>${letter}</strong>`;
                container.appendChild(feedback);
            }
        });
    });
    
    // 添加退出按鈕事件
    const exitBtn = document.getElementById('quiz-exit');
    if (exitBtn) {
        exitBtn.replaceWith(exitBtn.cloneNode(true)); // 移除舊事件
        document.getElementById('quiz-exit').addEventListener('click', () => {
            if (confirm('確定要離開測驗嗎？進度將不會保存。')) {
                showQuizSelection();
            }
        });
    }
}

// 轉換 choice 題目：支援單字考定義 (word_to_def) 與 定義考單字 (def_to_word)
function transformChoiceQuestions(questions, direction) {
    if (!Array.isArray(questions)) return [];
    if (direction === 'word_to_def') {
        return questions.map(q => ({
            ...q,
            type: 'choice',
            promptTitle: '選擇正確的定義：',
            prompt: q.word,
            // options: label=定義, value=單字（保持後續判斷一致）
            options: (q.options || []).map(o => ({ label: o.label, value: o.value })),
            correct: q.correct || q.answer
        }));
    }
    // def_to_word：顛倒
    return questions.map(q => ({
        ...q,
        type: 'choice',
        promptTitle: '選擇正確的單字：',
        // 以「定義」作為題目內容
        prompt: q.options?.find(o => (o.value || '').toLowerCase() === (q.correct || q.answer || '').toLowerCase())?.label || q.question || q.word || '',
        // 選項：顯示單字，value 仍為單字，label 改顯示單字
        options: (q.options || []).map(o => ({ label: o.value, value: o.value })),
        correct: q.correct || q.answer
    }));
}

function checkAnswer(answer) {
    const { questions, currentQuestion } = AppState.quizState;
    const question = questions[currentQuestion];
    if (!question) return;

    const correctValue = (question.correct || question.answer || '').toLowerCase();
    const correct = answer.toLowerCase() === correctValue;
    
    AppState.quizState.answers.push({
        question: question,
        answer: answer,
        correct: correct
    });
    
    if (correct) {
        AppState.quizState.score++;
    }
    
    let correctOptionLabel = question.correct || question.answer || '';
    if (question.options) {
        const correctOption = question.options.find(opt => (opt.value || '').toLowerCase() === correctValue);
        if (correctOption) {
            correctOptionLabel = correctOption.label;
        }
    }
    
    showAnswerFeedback(correct, correctOptionLabel);
    
    setTimeout(() => {
        AppState.quizState.currentQuestion++;
        
        if (AppState.quizState.currentQuestion >= questions.length) {
            showQuizResults();
        } else {
            renderQuestion();
        }
    }, 1500);
}

function showAnswerFeedback(correct, correctAnswer) {
    const container = document.getElementById('quiz-question-container');
    const feedback = document.createElement('div');
    feedback.className = `mt-4 p-4 rounded-lg ${correct ? 'bg-green-100 border-2 border-green-500' : 'bg-red-100 border-2 border-red-500'}`;
    feedback.innerHTML = `
        <p class="font-semibold ${correct ? 'text-green-700' : 'text-red-700'}">
            ${correct ? '✓ 正確！' : '✗ 錯誤'}
        </p>
        ${!correct ? `<p class="text-red-600 mt-1">正確答案：<strong>${escapeHtml(correctAnswer)}</strong></p>` : ''}
    `;
    container.appendChild(feedback);
    
    container.querySelectorAll('button, input').forEach(el => {
        el.disabled = true;
        if (el.tagName === 'BUTTON') {
            el.classList.add('opacity-50', 'cursor-not-allowed');
        }
    });
}

function showQuizResults() {
    DOM.quizSelection.classList.add('hidden');
    DOM.quizActive.classList.add('hidden');
    DOM.quizResults.classList.remove('hidden');
    
    const { questions, answers, score } = AppState.quizState;
    const percentage = Math.round((score / questions.length) * 100);
    
    document.getElementById('quiz-score').textContent = `${percentage}%`;
    document.getElementById('quiz-correct-count').textContent = score;
    document.getElementById('quiz-incorrect-count').textContent = questions.length - score;
    document.getElementById('quiz-total-count').textContent = questions.length;
    
    // 顯示錯題列表
    const reviewList = document.getElementById('quiz-review-list');
    reviewList.innerHTML = '';
    
    const incorrectAnswers = answers.filter(item => !item.correct);
    
    if (incorrectAnswers.length === 0) {
        reviewList.innerHTML = '<p class="text-center text-green-600 font-semibold py-4">全部正確！太棒了！🎉</p>';
    } else {
        incorrectAnswers.forEach((item, index) => {
            const reviewItem = document.createElement('div');
            reviewItem.className = 'bg-red-50 p-3 rounded border border-red-200';
            const questionIndex = answers.indexOf(item) + 1;
            reviewItem.innerHTML = `
                <p class="text-sm font-semibold text-red-800">題目 ${questionIndex}</p>
                <p class="text-sm text-slate-700 mt-1">${escapeHtml(item.question.question || item.question.sentence || item.question.word)}</p>
                <p class="text-sm text-red-600 mt-1">你的答案：${escapeHtml(item.answer)}</p>
                <p class="text-sm text-green-600">正確答案：${escapeHtml(item.question.correct)}</p>
            `;
            reviewList.appendChild(reviewItem);
        });
    }
    
    // 添加按鈕事件
    const restartBtn = document.getElementById('quiz-restart');
    const backBtn = document.getElementById('quiz-back');
    const retryIncorrectBtn = document.getElementById('quiz-retry-incorrect');
    
    restartBtn.replaceWith(restartBtn.cloneNode(true));
    backBtn.replaceWith(backBtn.cloneNode(true));
    
    document.getElementById('quiz-restart').addEventListener('click', () => {
        startQuiz(AppState.quizState.type);
    });
    
    document.getElementById('quiz-back').addEventListener('click', () => {
        showQuizSelection();
    });

    if (retryIncorrectBtn) {
        retryIncorrectBtn.replaceWith(retryIncorrectBtn.cloneNode(true));
        document.getElementById('quiz-retry-incorrect').addEventListener('click', async () => {
            const incorrect = AppState.quizState.answers.filter(a => !a.correct);
            const lemmas = Array.from(new Set(incorrect.map(a => (a.question.word || a.question.correct || '').toLowerCase()))).filter(Boolean);
            if (lemmas.length === 0) {
                alert('沒有可重測的錯題');
                return;
            }
            showLoading('生成錯題重測...');
            try {
                const params = new URLSearchParams({ type: AppState.quizState.type, count: String(lemmas.length), lemmas: lemmas.join(','), t: Date.now() });
                const response = await fetch(`${CONFIG.API_BASE}/api/quiz/generate?${params}`);
                if (response.ok) {
                    const data = await response.json();
                    AppState.quizState.questions = data.questions;
                    AppState.quizState.currentQuestion = 0;
                    AppState.quizState.answers = [];
                    AppState.quizState.score = 0;
                    hideLoading();
                    showQuizActive();
                } else {
                    throw new Error('重測生成失敗');
                }
            } catch (e) {
                hideLoading();
                alert('重測生成失敗');
            }
        });
    }
}

// ============================================================================
// UI 輔助函數
// ============================================================================

/**
 * 切換側邊欄（移動版）
 */
function toggleSidebar() {
    DOM.controlPanel.classList.toggle('-translate-x-full');
    DOM.overlay.classList.toggle('hidden');
}

/**
 * 更新激活的按鈕
 */
function updateActiveButton(group, activeButton) {
    group.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (activeButton) {
        activeButton.classList.add('active');
    }
}

/**
 * 更新活躍項目
 */
function updateActiveItem(newItem) {
    if (AppState.browseState.activeItem) {
        AppState.browseState.activeItem.classList.remove('active-item');
    }
    if (newItem) {
        newItem.classList.add('active-item');
        AppState.browseState.activeItem = newItem;
    } else {
        AppState.browseState.activeItem = null;
    }
}

/**
 * 顯示加載遮罩
 */
function showLoading(text = '載入中...') {
    DOM.loadingText.textContent = text;
    DOM.loadingOverlay.classList.remove('hidden');
}

/**
 * 隱藏加載遮罩
 */
function hideLoading() {
    DOM.loadingOverlay.classList.add('hidden');
}

function setFlashcardControlsEnabled(enabled) {
    const controls = [DOM.flashcardPrev, DOM.flashcardNext, DOM.flashcardKnown, DOM.flashcardReview, DOM.flashcardPlay];
    controls.forEach(btn => {
        if (!btn) return;
        btn.disabled = !enabled;
        btn.classList.toggle('opacity-50', !enabled);
        btn.classList.toggle('cursor-not-allowed', !enabled);
    });
}

// 預熱 UI（離屏構建常見列表節點，觸發樣式/字型/佈局快取）
function prewarmUI() {
    try {
        const off = document.createElement('div');
        off.style.position = 'absolute';
        off.style.left = '-9999px';
        off.style.top = '0';
        off.style.width = '640px';
        off.style.pointerEvents = 'none';
        off.style.opacity = '0';

        // 模擬列表項結構（與 renderNormalList 類似），渲染 ~80 個以預熱樣式與 DOM 建置
        const item = (lemma, pos, count, rank) => `
            <div class="word-item list-item flex justify-between items-center p-3 px-4 cursor-pointer border-b border-slate-100">
                <div class="flex-1">
                    <div class="flex items-center gap-2">
                        <span class="font-semibold text-slate-800">${lemma}</span>
                        <span class="text-xs font-medium text-slate-500">${pos}</span>
                        <span class="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">2義</span>
                    </div>
                    <p class="text-xs text-slate-600 mt-1 truncate">example preview...</p>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-xs text-slate-400">#${rank}</span>
                    <span class="text-sm font-mono bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">${count}</span>
                </div>
            </div>`;

        let html = '';
        for (let i = 1; i <= 80; i++) {
            html += item(`lemma-${i}`, 'NOUN', 10 + (i % 5), i);
        }
        off.innerHTML = html;
        document.body.appendChild(off);
        // 觸發一次 reflow 以完成佈局快取
        void off.offsetHeight;
        document.body.removeChild(off);
    } catch (_) {}
}

// ============================================================================
// 進度保存與加載
// ============================================================================

/**
 * 保存學習進度
 */
function saveProgress() {
    const progress = {
        knownWords: Array.from(AppState.flashcardState.knownWords),
        reviewWords: Array.from(AppState.flashcardState.reviewWords),
        lastUpdated: Date.now()
    };
    localStorage.setItem('gsat_vocab_progress', JSON.stringify(progress));
}

/**
 * 加載學習進度
 */
function loadProgress() {
    try {
        const saved = localStorage.getItem('gsat_vocab_progress');
        if (saved) {
            const progress = JSON.parse(saved);
            AppState.flashcardState.knownWords = new Set(progress.knownWords || []);
            AppState.flashcardState.reviewWords = new Set(progress.reviewWords || []);
        }
    } catch (error) {
        console.error('Failed to load progress:', error);
    }
}

// ============================================================================
// 工具函數
// ============================================================================

/**
 * HTML 轉義函數 - 防止 XSS 和 HTML 解析錯誤
 */
function escapeHtml(text) {
    if (text == null || text === '') return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * 防抖函數
 */
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * 數組洗牌
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}


// 產生常見詞形變化（極簡規則，處理複數 / 第三人稱單數等）
function getInflectionVariants(lemma) {
    const forms = new Set([lemma]);
    const lower = lemma.toLowerCase();

    // 名詞複數（粗略）
    if (/[sxz]$/.test(lower) || /(ch|sh)$/.test(lower)) {
        forms.add(`${lower}es`);
    } else if (/y$/.test(lower) && !/[aeiou]y$/.test(lower)) {
        forms.add(`${lower.slice(0, -1)}ies`);
    } else {
        forms.add(`${lower}s`);
    }

    // 動詞第三人稱單數
    if (/[sxz]$/.test(lower) || /(ch|sh)$/.test(lower)) {
        forms.add(`${lower}es`);
    } else if (/y$/.test(lower) && !/[aeiou]y$/.test(lower)) {
        forms.add(`${lower.slice(0, -1)}ies`);
    } else {
        forms.add(`${lower}s`);
    }

    return Array.from(forms);
}

// ============================================================================
// 網格瀏覽懸浮預覽
// ============================================================================

/**
 * 初始化網格預覽功能
 */
function initBrowsePreview() {
    // 檢測是否為手機
    BrowsePreviewState.isMobile = window.innerWidth < 1024;
    window.addEventListener('resize', debounce(() => {
        BrowsePreviewState.isMobile = window.innerWidth < 1024;
    }, 200));
    
    // 創建懸浮提示框
    BrowsePreviewState.tooltip = document.createElement('div');
    BrowsePreviewState.tooltip.className = 'browse-preview-tooltip';
    document.body.appendChild(BrowsePreviewState.tooltip);
    
    // 桌面版：懸停事件（使用事件委派）
    DOM.wordList.addEventListener('mouseenter', (e) => {
        if (BrowsePreviewState.isMobile) return;
        const cell = e.target.closest('.browse-cell');
        if (cell && AppState.browseState.isGridMode) {
            const lemma = cell.dataset.lemma;
            if (lemma) {
                clearTimeout(BrowsePreviewState.previewTimeout);
                BrowsePreviewState.previewTimeout = setTimeout(() => {
                    showBrowsePreviewTooltip(cell, lemma);
                }, 150); // 輕微延遲避免快速掃過觸發
            }
        }
    }, true);
    
    DOM.wordList.addEventListener('mouseleave', (e) => {
        if (BrowsePreviewState.isMobile) return;
        const cell = e.target.closest('.browse-cell');
        if (cell) {
            clearTimeout(BrowsePreviewState.previewTimeout);
            hideBrowsePreviewTooltip();
        }
    }, true);
    
    // 文檔點擊：清除手機版預覽狀態
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.browse-cell') && BrowsePreviewState.lastPreviewedCell) {
            hideBrowsePreview();
        }
    });
}

/**
 * 顯示桌面版懸浮提示框
 */
async function showBrowsePreviewTooltip(cell, lemma) {
    const data = await getCachedWordPreview(lemma);
    if (!data) return;
    
    const tooltip = BrowsePreviewState.tooltip;
    const defHtml = data.zh_def ? `<div class="browse-preview-def">${escapeHtml(data.zh_def)}</div>` : '';
    
    tooltip.innerHTML = `
        <div class="browse-preview-word">${escapeHtml(data.lemma)}</div>
        <div class="browse-preview-pos">${escapeHtml(data.pos)}</div>
        ${defHtml}
        <div class="browse-preview-count">出現 ${escapeHtml(data.count)} 次</div>
    `;
    
    // 定位（在單元格上方居中）
    const rect = cell.getBoundingClientRect();
    const tooltipHeight = data.zh_def ? 140 : 100; // 有中文定義時較高
    let left = rect.left + rect.width / 2;
    let top = rect.top - tooltipHeight - 10;
    
    // 防止超出視口
    const tooltipWidth = 320;
    if (left + tooltipWidth / 2 > window.innerWidth) {
        left = window.innerWidth - tooltipWidth / 2 - 10;
    }
    if (left - tooltipWidth / 2 < 0) {
        left = tooltipWidth / 2 + 10;
    }
    if (top < 10) {
        top = rect.bottom + 10; // 改為下方顯示
    }
    
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = 'translateX(-50%)';
    
    // 顯示動畫
    requestAnimationFrame(() => {
        tooltip.classList.add('show');
    });
}

/**
 * 隱藏桌面版懸浮提示框
 */
function hideBrowsePreviewTooltip() {
    const tooltip = BrowsePreviewState.tooltip;
    if (tooltip) {
        tooltip.classList.remove('show');
    }
}

/**
 * 顯示手機版預覽（兩段式第一段）
 */
async function showBrowsePreview(cell, lemma) {
    // 移除舊的預覽狀態
    if (BrowsePreviewState.lastPreviewedCell) {
        BrowsePreviewState.lastPreviewedCell.classList.remove('preview-active');
        BrowsePreviewState.lastPreviewedCell.removeAttribute('data-preview-text');
    }
    
    // 獲取中文解釋
    const data = await getCachedWordPreview(lemma);
    const previewText = data && data.zh_def ? data.zh_def : (data ? `${data.pos} · ${data.count}次` : '');
    
    // 加入新的預覽狀態
    cell.classList.add('preview-active');
    if (previewText) {
        cell.setAttribute('data-preview-text', previewText);
    }
    BrowsePreviewState.lastPreviewedCell = cell;
    
    // 可選：震動反饋（支援的設備）
    if (navigator.vibrate) {
        navigator.vibrate(10);
    }
}

/**
 * 隱藏手機版預覽
 */
function hideBrowsePreview() {
    if (BrowsePreviewState.lastPreviewedCell) {
        BrowsePreviewState.lastPreviewedCell.classList.remove('preview-active');
        BrowsePreviewState.lastPreviewedCell.removeAttribute('data-preview-text');
        BrowsePreviewState.lastPreviewedCell = null;
    }
}

/**
 * 獲取快取的單字預覽資料（含中文解釋）
 */
async function getCachedWordPreview(lemma) {
    // 先查快取
    if (BrowsePreviewState.cache.has(lemma)) {
        return BrowsePreviewState.cache.get(lemma);
    }
    
    // 從 vocabIndex 查找基本資料
    const word = AppState.vocabIndex.find(w => w.lemma === lemma);
    if (!word) return null;
    
    const preview = {
        lemma: word.lemma,
        pos: word.primary_pos || 'N/A',
        count: word.count || 0,
        zh_def: word.zh_preview || '' // 優先使用 zh_preview
    };
    
    // 若沒有預覽，嘗試從 API 快速獲取（僅第一個定義）
    if (!preview.zh_def) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/vocab/detail/${lemma}`);
            if (response.ok) {
                const data = await response.json();
                if (data.meanings && data.meanings.length > 0) {
                    preview.zh_def = data.meanings[0].zh_def || '';
                } else if (data.definition && data.definition.zh_def) {
                    preview.zh_def = data.definition.zh_def;
                }
            }
        } catch (e) {
            // 靜默失敗，不影響預覽顯示
        }
    }
    
    // 快取（限制大小）
    if (BrowsePreviewState.cache.size > 500) {
        const firstKey = BrowsePreviewState.cache.keys().next().value;
        BrowsePreviewState.cache.delete(firstKey);
    }
    BrowsePreviewState.cache.set(lemma, preview);
    
    return preview;
}
