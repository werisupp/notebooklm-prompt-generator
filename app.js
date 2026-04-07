/* ==============================================
   NotebookLM Prompt Generator — app.js
   werisupp リポジトリ (step1～16) 専用版
   ============================================== */

'use strict';

// ── Config ────────────────────────────────────
const REPO_OWNER     = 'werisupp';
const REPO_NAME      = 'werisupp';
const TOTAL_ARTICLES = 16;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/`;

// ── CORSプロキシ（優先順に試行） ─────────────────
const PROXIES = [
  (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];
const FETCH_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS   = 600;

// 1パターン当たりの最大見出し数
const PATTERN_SIZE = 15;

// ── State ────────────────────────────────────
const state = {
  headlines: [],
  patterns: [],
  currentPattern: 0,
};

// ── DOM refs ─────────────────────────────────
const $ = (id) => document.getElementById(id);
const articleChecklist  = $('articleChecklist');
const bulkActions       = $('bulkActions');
const selectedCount     = $('selectedCount');
const fetchBtn          = $('fetchBtn');
const loadingArea       = $('loadingArea');
const errorArea         = $('errorArea');
const errorMsg          = $('errorMsg');
const resultCard        = $('resultCard');
const headlinesList     = $('headlinesList');
const generateBtn       = $('generateBtn');
const selectAllBtn      = $('selectAllBtn');
const deselectAllBtn    = $('deselectAllBtn');
const promptCard        = $('promptCard');
const promptOutput      = $('promptOutput');
const promptLabel       = $('promptLabel');
const patternTabs       = $('patternTabs');
const copyBtn           = $('copyBtn');
const downloadJsonBtn   = $('downloadJsonBtn');
const resetBtn          = $('resetBtn');

// ── Theme toggle ─────────────────────────────
(function(){
  const toggle = document.querySelector('[data-theme-toggle]');
  const root   = document.documentElement;
  let dark     = matchMedia('(prefers-color-scheme:dark)').matches;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (toggle) toggle.addEventListener('click', () => {
    dark = !dark;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    toggle.setAttribute('aria-label', dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
    toggle.innerHTML = dark
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
  });
})();

// ── fetchWithTimeout ─────────────────────────
function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── fetchViaProxies ───────────────────────────
async function fetchViaProxies(rawUrl) {
  for (const makeProxyUrl of PROXIES) {
    const proxyUrl = makeProxyUrl(rawUrl);
    try {
      const res = await fetchWithTimeout(proxyUrl, FETCH_TIMEOUT_MS);
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || '';
      let html;
      if (contentType.includes('application/json')) {
        const json = await res.json();
        html = json.contents ?? null;
      } else {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          html = (typeof json === 'object' && json !== null)
            ? (json.contents ?? text)
            : text;
        } catch (_) {
          html = text;
        }
      }
      if (html && html.length > 0) return html;
    } catch (_) {}
    await sleep(RETRY_DELAY_MS);
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 起動時: チェックリストを静的に描画 ──────────
function buildArticleChecklist() {
  articleChecklist.innerHTML = '';
  for (let num = 1; num <= TOTAL_ARTICLES; num++) {
    const label = document.createElement('label');
    label.className = 'article-check-item';
    label.innerHTML = `
      <input type="radio" name="articleRadio" class="article-checkbox" data-num="${num}">
      <span class="article-check-num">ステップ${num}</span>
      <span class="article-check-title">step${num}.html</span>
    `;
    articleChecklist.appendChild(label);
  }
  articleChecklist.removeAttribute('hidden');
  bulkActions.removeAttribute('hidden');
  articleChecklist.addEventListener('change', updateFetchBtnState);
  updateFetchBtnState();
}

function updateFetchBtnState() {
  const checked = articleChecklist.querySelectorAll('.article-checkbox:checked').length;
  selectedCount.textContent = `${checked}件選択中`;
  fetchBtn.disabled = checked === 0;
}

// ── 一括選択 / 解除 ───────────────────────────
$('selectAllArticles').addEventListener('click', () => { updateFetchBtnState(); });
$('deselectAllArticles').addEventListener('click', () => {
  articleChecklist.querySelectorAll('.article-checkbox').forEach(cb => cb.checked = false);
  updateFetchBtnState();
});

// ── 「見出しを取得してプロンプト生成」ボタン ──────
fetchBtn.addEventListener('click', async () => {
  const checkedNums = [...articleChecklist.querySelectorAll('.article-checkbox:checked')]
    .map(cb => +cb.dataset.num);
  if (checkedNums.length === 0) { showError('1件以上のステップを選択してください。'); return; }

  setLoading(true);
  hideError();
  state.headlines = [];

  try {
    let idCounter = 0;
    const failedArticles = [];

    for (const num of checkedNums) {
      const rawUrl  = RAW_BASE + `step${num}.html`;
      const pageUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/step${num}.html`;
      const html = await fetchViaProxies(rawUrl);
      if (!html) { failedArticles.push(`step${num}`); continue; }
      const headings = extractHeadings(html);
      if (headings.length === 0) failedArticles.push(`step${num}（見出し0件）`);
      headings.forEach(({ tag, text }) => {
        state.headlines.push({ id: idCounter++, tag, text, source: `step${num}`, url: pageUrl });
      });
    }

    if (state.headlines.length === 0) {
      const detail = failedArticles.length > 0 ? `\n失敗したステップ: ${failedArticles.join(', ')}` : '';
      throw new Error('選択したステップから見出し（h2～h4）を取得できませんでした。' + detail);
    }
    if (failedArticles.length > 0) showError(`以下のステップの取得に失敗しました:\n${failedArticles.join(', ')}`);

    renderHeadlines();
    resultCard.removeAttribute('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
});

// ── h2/h3/h4 見出し抽出 ─────────────────────
function extractHeadings(rawHtml) {
  let html = rawHtml;
  try {
    if (rawHtml.includes('\\u')) {
      html = JSON.parse('"' + rawHtml.replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"');
    }
  } catch (_) {}
  const results = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('h2, h3, h4').forEach((el) => {
      const tag  = el.tagName.toLowerCase();
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (text && text !== 'この記事の内容') results.push({ tag, text });
    });
  } catch (e) {
    const re = /<(h[234])[^>]*>([\S\s]*?)<\/h[234]>/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
      const tag  = match[1].toLowerCase();
      const text = match[2].replace(/<[^>]+>/g, '')
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
        .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
        .replace(/&[a-z]+;/g,'').replace(/\s+/g,' ').trim();
      if (text && text !== 'この記事の内容') results.push({ tag, text });
    }
  }
  return results;
}

// ── 見出しリストを描画 ────────────────────────
const TAG_LABEL = { h2: 'H2', h3: 'H3', h4: 'H4' };
const TAG_COLOR = {
  h2: 'var(--color-primary)',
  h3: 'var(--color-success)',
  h4: 'var(--color-text-muted)',
};

function renderHeadlines() {
  headlinesList.innerHTML = '';
  state.headlines.forEach(h => {
    const item = document.createElement('label');
    item.className = 'headline-item';
    const tagColor = TAG_COLOR[h.tag] || 'var(--color-text-muted)';
    const tagLabel = TAG_LABEL[h.tag] || h.tag.toUpperCase();
    item.innerHTML = `
      <input type="checkbox" checked data-id="${h.id}">
      <div style="flex:1;min-width:0">
        <div class="headline-meta">
          <span style="font-weight:600;color:${tagColor};margin-right:4px">${tagLabel}</span>
          ${escapeHtml(h.source)}
          ${h.url ? ` — <a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--color-text-faint)">${escapeHtml(h.url.slice(0,70))}...</a>` : ''}
        </div>
        <div class="headline-text">${escapeHtml(h.text)}</div>
      </div>
      <span class="headline-tag">#${h.id + 1}</span>
    `;
    headlinesList.appendChild(item);
  });
}

selectAllBtn.addEventListener('click', () => {
  headlinesList.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
});
deselectAllBtn.addEventListener('click', () => {
  headlinesList.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
});

// ── プロンプト生成 ──────────────────────────────
generateBtn.addEventListener('click', () => {
  const checked = [...headlinesList.querySelectorAll('input[type=checkbox]:checked')]
    .map(cb => state.headlines.find(h => h.id === +cb.dataset.id))
    .filter(Boolean);
  if (checked.length === 0) { showToast('最低1件の見出しを選択してください'); return; }

  state.patterns = splitIntoPatterns(checked, PATTERN_SIZE);
  state.currentPattern = 0;

  renderPatternTabs();
  showPattern(0);

  promptCard.removeAttribute('hidden');
  promptCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── 15件ずつパターンに分割 ──────────────────────
function splitIntoPatterns(headlines, size) {
  const patterns = [];
  for (let i = 0; i < headlines.length; i += size) {
    patterns.push(headlines.slice(i, i + size));
  }
  return patterns;
}

// ── パターンタブ描画 ─────────────────────────────
function renderPatternTabs() {
  if (state.patterns.length <= 1) {
    patternTabs.setAttribute('hidden', '');
    patternTabs.innerHTML = '';
    return;
  }
  patternTabs.innerHTML = '';
  state.patterns.forEach((pattern, i) => {
    const startNum = getGlobalStartNum(i);
    const endNum   = startNum + pattern.length - 1;
    const btn = document.createElement('button');
    btn.className = 'pattern-tab-btn' + (i === 0 ? ' active' : '');
    btn.textContent = `パターン${i + 1}  #${startNum}～#${endNum}`;
    btn.dataset.index = i;
    btn.addEventListener('click', () => {
      state.currentPattern = i;
      patternTabs.querySelectorAll('.pattern-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showPattern(i);
    });
    patternTabs.appendChild(btn);
  });
  patternTabs.removeAttribute('hidden');
}

function getGlobalStartNum(patternIndex) {
  let n = 1;
  for (let i = 0; i < patternIndex; i++) n += state.patterns[i].length;
  return n;
}

// ── 指定パターンのプロンプトを表示 ────────────────
function showPattern(index) {
  const pattern  = state.patterns[index];
  const startNum = getGlobalStartNum(index);
  const endNum   = startNum + pattern.length - 1;
  promptOutput.textContent = buildPrompt(pattern, startNum);
  promptLabel.textContent = state.patterns.length > 1
    ? `プロンプト （#${startNum}～#${endNum}）`
    : 'プロンプト';
}

// ── プロンプト文字列を構築 ──────────────────────
function buildPrompt(headlines, startNum) {
  const headlineLines = headlines.map((h, i) => {
    const tag    = (h.tag || 'h2').toUpperCase();
    const num    = startNum + i;
    const numStr = String(num).padStart(2, '0');
    return `・${numStr}_ ${tag}_${h.text}`;
  });

  const lines = [];
  lines.push('# プロンプト構成');
  lines.push('「# 目的」のために「# タスク」を実行してください。');
  lines.push('');
  lines.push('# 目的');
  lines.push('・記事の各見出しの直下に概要を示した図解の差し込み');
  lines.push('');
  lines.push('# タスク');
  lines.push('・positive：「# 各見出し」に記載の各h2、h3、h4についての要点を、単語とイラストのみでまとめたスライドを「# デザイン条件」に従って作成。');
  lines.push('・negative：見出し（タイトル）の記載');
  lines.push('');
  lines.push('# 各見出し');
  headlineLines.forEach((l) => lines.push(l));
  lines.push('');
  lines.push('# デザイン条件');
  lines.push('■ デザインスタイル（スタイル指定）');
  lines.push('・全体は、白背景ベースのクリーンでモダンなビジネス向けインフォグラフィックにしてください。');
  lines.push('・情報はカード状のボックスに分割し、「見出し」「本文」「箇条書き」「図解」が論理的な階層構造で並ぶレイアウトにしてください。');
  lines.push('');
  lines.push('■カラーテーマ（カラー指定）');
  lines.push('・プライマリカラー（信頼感・見出し・リンク・囲い枠などの基調色）');
  lines.push('　-メインブルー：#005BAC');
  lines.push('　-ダークブルー：#004A8A（強調見出しに使用）');
  lines.push('・セカンダリカラー（成功・ポジティブ・Good例）：');
  lines.push('　-グリーン：#28A745');
  lines.push('　-ダークグリーン：#218838');
  lines.push('・背景・テキスト：');
  lines.push('　-全体背景：#EEF4FB（薄いブルーホワイト）');
  lines.push('　-カードの淡い背景：#F8F9FA（light）、#E9ECEF（medium）');
  lines.push('　-文字メイン：#333333');
  lines.push('　-文字サブ：#6C757D');
  lines.push('　-補助的な淡い文字・アイコン：#B2BEC3');
  lines.push('');
  lines.push('■全体トーン');
  lines.push('・「信頼感」「プロフェッショナル」「読みやすさ」を重視したビジネスインフォグラフィックにしてください。');
  lines.push('・配色は上記パレットを基本とし、不要な色は増やさず、コントラストが高く可読性の良いデザインを優先してください。');
  lines.push('');
  lines.push('■ コンテンツ配置の制約（重要）');
  lines.push('・スライド最上部にごく薄い余白帯（背景色のみ）を設け、その直下からコンテンツを開始してください。');
  lines.push('・スライドの主要コンテンツ配置エリアは上部余白の直下から始まり、最下部の余白帯の直前までです。すべての要素（図解・アイコン・ボックス・キーワード等）はこのエリアに収めてください。');
  lines.push('・コンテンツ配置エリアは上から下へ均等に使い切るようにデザインしてください。コンテンツ量が少ない場合でも、図解・強調ボックス・区切り装飾などを追加してエリア全体を埋めてください。');
  lines.push('・コンテンツ配置エリアの先頭（上部余白の直下）から要素の配置を開始し、上部エリアが空白のままになることは禁止します。');
  lines.push('・スライド最下部にもごく薄い余白帯（背景色のみ）を設け、いかなる要素も配置しないでください。');
  lines.push('');
  lines.push('【禁止パターン】');
  lines.push('・スライド上部から全体の約五分の一の範囲が空白・背景色のみになっている');
  lines.push('・コンテンツがスライド中央～下半分にかたまっている');
  lines.push('・最初の要素（最上段のボックス・アイコン・キーワード等）がスライド中央より下から始まっている');
  return lines.join('\n');
}

// ── 現在パターンのJSON生成 ─────────────────────
function buildPatternJson(patternIndex) {
  const pattern  = state.patterns[patternIndex];
  const startNum = getGlobalStartNum(patternIndex);
  return {
    pattern: patternIndex + 1,
    total_patterns: state.patterns.length,
    start_num: startNum,
    end_num: startNum + pattern.length - 1,
    headlines: pattern.map((h, i) => ({
      num: startNum + i,
      tag: (h.tag || 'h2').toUpperCase(),
      text: h.text,
      source: h.source || '',
    })),
  };
}

// ── JSONダウンロード ──────────────────────────
downloadJsonBtn.addEventListener('click', () => {
  const idx  = state.currentPattern;
  const data = buildPatternJson(idx);
  const startNum = data.start_num;
  const endNum   = data.end_num;
  const filename = `pattern${idx + 1}_headlines_${startNum}-${endNum}.json`;

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`📥 ${filename} をダウンロードしました`);
});

// ── コピー ──────────────────────────────────
copyBtn.addEventListener('click', () => {
  const text = promptOutput.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.classList.add('copied');
    copyBtn.textContent = '✓ コピー済み';
    showToast('クリップボードにコピーしました！');
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> コピー';
    }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('コピーしました！');
  });
});

// ── Reset ────────────────────────────────────
resetBtn.addEventListener('click', () => {
  state.headlines = [];
  state.patterns  = [];
  resultCard.setAttribute('hidden', '');
  promptCard.setAttribute('hidden', '');
  hideError();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Helpers ───────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setLoading(on) {
  if (on) { loadingArea.removeAttribute('hidden'); fetchBtn.disabled = true; }
  else    { loadingArea.setAttribute('hidden', ''); updateFetchBtnState(); }
}
function showError(msg) { errorMsg.textContent = msg; errorArea.removeAttribute('hidden'); }
function hideError()    { errorArea.setAttribute('hidden', ''); }
function showToast(msg) {
  const t = document.createElement('div');
  t.className   = 'toast';
  t.textContent = msg;
  $('toastContainer').appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ── 初期化 ──────────────────────────────────
buildArticleChecklist();
