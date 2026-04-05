/* ==============================================
   NotebookLM Prompt Generator — app.js
   werisupp リポジトリ (article1〜16) 専用版
   ============================================== */

'use strict';

// ── Config ───────────────────────────────────────
const REPO_OWNER   = 'werisupp';
const REPO_NAME    = 'werisupp';
const TOTAL_ARTICLES = 16;
// GitHub Raw ベースURL
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/`;
// CORS プロキシ（Raw GitHub HTMLをフェッチするために使用）
const PROXY = 'https://api.allorigins.win/get?url=';

// ── State ────────────────────────────────────────
const state = {
  articles: [],      // [{ num, title, url, loaded }]  全16件
  headlines: [],     // [{ id, title, source, url }]   選択済み
  groups: [],
  minSlides: 10,
  maxSlides: 15,
};

// ── DOM refs ─────────────────────────────────────
const $ = (id) => document.getElementById(id);
const articleLoading   = $('articleLoading');
const articleChecklist = $('articleChecklist');
const bulkActions      = $('bulkActions');
const selectedCount    = $('selectedCount');
const fetchBtn         = $('fetchBtn');
const loadingArea      = $('loadingArea');
const errorArea        = $('errorArea');
const errorMsg         = $('errorMsg');
const resultCard       = $('resultCard');
const headlinesList    = $('headlinesList');
const generateBtn      = $('generateBtn');
const selectAllBtn     = $('selectAllBtn');
const deselectAllBtn   = $('deselectAllBtn');
const promptCard       = $('promptCard');
const promptOutput     = $('promptOutput');
const groupSummary     = $('groupSummary');
const slidePreview     = $('slidePreview');
const copyBtn          = $('copyBtn');
const regenBtn         = $('regenBtn');
const resetBtn         = $('resetBtn');
const minCount         = $('minCount');
const maxCount         = $('maxCount');
const minusBtn         = $('minusBtn');
const plusBtn          = $('plusBtn');

// ── Theme toggle ─────────────────────────────────
(function(){
  const toggle = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  let dark = matchMedia('(prefers-color-scheme:dark)').matches;
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

// ── 起動時: 記事一覧を並列取得 ───────────────────
async function loadArticleList() {
  articleLoading.removeAttribute('hidden');
  articleChecklist.setAttribute('hidden', '');
  bulkActions.setAttribute('hidden', '');

  const nums = Array.from({ length: TOTAL_ARTICLES }, (_, i) => i + 1);

  const results = await Promise.allSettled(
    nums.map(async (num) => {
      const url = RAW_BASE + `article${num}.html`;
      const html = await fetchProxy(url);
      const title = extractHTMLTitle(html) || extractOGTitle(html) || `記事 ${num}`;
      return { num, title, url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/article${num}.html` };
    })
  );

  state.articles = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { num: i + 1, title: `記事 ${i + 1}（取得失敗）`, url: RAW_BASE + `article${i+1}.html`, failed: true };
  });

  articleLoading.setAttribute('hidden', '');
  renderArticleChecklist();
  articleChecklist.removeAttribute('hidden');
  bulkActions.removeAttribute('hidden');
}

// ── 記事チェックリストを描画 ──────────────────────
function renderArticleChecklist() {
  articleChecklist.innerHTML = '';
  state.articles.forEach((a) => {
    const label = document.createElement('label');
    label.className = 'article-check-item' + (a.failed ? ' article-check-item--failed' : '');
    label.innerHTML = `
      <input type="checkbox" class="article-checkbox" data-num="${a.num}"${a.failed ? ' disabled' : ''}>
      <span class="article-check-num">記事${a.num}</span>
      <span class="article-check-title">${escapeHtml(a.title)}</span>
      ${a.failed ? '<span class="article-check-badge">取得失敗</span>' : ''}
    `;
    articleChecklist.appendChild(label);
  });

  // チェック変化 → ボタン状態更新
  articleChecklist.addEventListener('change', updateFetchBtnState);
  updateFetchBtnState();
}

function updateFetchBtnState() {
  const checked = articleChecklist.querySelectorAll('.article-checkbox:checked').length;
  selectedCount.textContent = `${checked}件選択中`;
  fetchBtn.disabled = checked === 0;
}

// ── 一括選択 / 解除 ───────────────────────────────
$('selectAllArticles').addEventListener('click', () => {
  articleChecklist.querySelectorAll('.article-checkbox:not(:disabled)').forEach(cb => cb.checked = true);
  updateFetchBtnState();
});
$('deselectAllArticles').addEventListener('click', () => {
  articleChecklist.querySelectorAll('.article-checkbox').forEach(cb => cb.checked = false);
  updateFetchBtnState();
});

// ── スライド枚数コントロール ──────────────────────
minusBtn.addEventListener('click', () => {
  if (state.minSlides > 5) {
    state.minSlides -= 1;
    state.maxSlides -= 1;
    minCount.textContent = state.minSlides;
    maxCount.textContent = state.maxSlides;
  }
});
plusBtn.addEventListener('click', () => {
  if (state.maxSlides < 30) {
    state.minSlides += 1;
    state.maxSlides += 1;
    minCount.textContent = state.minSlides;
    maxCount.textContent = state.maxSlides;
  }
});

// ── 「見出しを取得してプロンプト生成」ボタン ────────
fetchBtn.addEventListener('click', async () => {
  const checkedNums = [...articleChecklist.querySelectorAll('.article-checkbox:checked')]
    .map(cb => +cb.dataset.num);

  if (checkedNums.length === 0) {
    showError('1件以上の記事を選択してください。');
    return;
  }

  setLoading(true);
  hideError();

  try {
    const selected = state.articles.filter(a => checkedNums.includes(a.num));
    state.headlines = selected.map((a, i) => ({
      id: i,
      title: a.title,
      url: a.url,
      source: `article${a.num}`,
    }));

    if (state.headlines.length === 0) {
      throw new Error('見出しを取得できませんでした。');
    }

    renderHeadlines();
    resultCard.removeAttribute('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
});

// ── 見出しリストを描画 ────────────────────────────
function renderHeadlines() {
  headlinesList.innerHTML = '';
  state.headlines.forEach(h => {
    const item = document.createElement('label');
    item.className = 'headline-item';
    item.innerHTML = `
      <input type="checkbox" checked data-id="${h.id}">
      <div style="flex:1">
        <div class="headline-meta">${escapeHtml(h.source)}
          ${h.url ? ` — <a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--color-text-faint)">${escapeHtml(h.url.slice(0,70))}...</a>` : ''}
        </div>
        <div class="headline-text">${escapeHtml(h.title)}</div>
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

// ── プロンプト生成 ────────────────────────────────
generateBtn.addEventListener('click', () => {
  const checked = [...headlinesList.querySelectorAll('input[type=checkbox]:checked')]
    .map(cb => state.headlines.find(h => h.id === +cb.dataset.id))
    .filter(Boolean);

  if (checked.length === 0) { showToast('最低1件の見出しを選択してください'); return; }

  state.groups = groupHeadlines(checked, state.minSlides, state.maxSlides);
  const prompt = buildPrompt(state.groups);

  promptOutput.textContent = prompt;
  renderGroupSummary(state.groups);
  renderSlidePreview(state.groups);
  promptCard.removeAttribute('hidden');
  promptCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── グループ分けアルゴリズム ───────────────────────
function groupHeadlines(headlines, minS, maxS) {
  const n = headlines.length;
  if (n <= maxS) return headlines.map(h => [h]);
  const targetGroups = Math.min(maxS, Math.max(minS, Math.round(n / 2)));
  return splitIntoGroups(headlines, targetGroups);
}

function splitIntoGroups(items, k) {
  const n = items.length;
  const groups = [];
  const base = Math.floor(n / k);
  let remainder = n % k;
  let idx = 0;
  for (let i = 0; i < k; i++) {
    const size = base + (remainder-- > 0 ? 1 : 0);
    if (size > 0) groups.push(items.slice(idx, idx + size));
    idx += size;
  }
  return groups;
}

// ── プロンプト文字列を構築 ────────────────────────
function buildPrompt(groups) {
  const totalSlides = groups.reduce((s, g) => s + g.length, 0);
  const lines = [];
  lines.push('以下の構成でNotebookLMのスライドを作成してください。');
  lines.push(`全体を${totalSlides}枚のスライドに収めてください。`);
  lines.push('各スライドには見出しと要点を3〜5箇条書きで記載してください。');
  lines.push('最後のスライドはまとめ・結論にしてください。');
  lines.push('');
  lines.push('【スライド構成】');
  lines.push('');
  let slideNum = 1;
  groups.forEach((group, gi) => {
    if (group.length === 1) {
      const h = group[0];
      lines.push(`スライド${slideNum}：${h.title}`);
      lines.push(`  出典：${h.url || h.source}`);
      lines.push('');
    } else {
      lines.push(`スライド${slideNum}：グループ${gi + 1}（${group.length}記事）`);
      group.forEach((h, hi) => {
        lines.push(`  ${hi + 1}. ${h.title}`);
        lines.push(`     出典：${h.url || h.source}`);
      });
      lines.push('');
    }
    slideNum++;
  });
  lines.push('【作成条件】');
  lines.push('- 各スライドは簡潔にまとめ、1スライドに詰め込みすぎないこと');
  lines.push('- 専門用語には簡単な説明を加えること');
  lines.push('- 聴衆はこのテーマの初学者を想定すること');
  lines.push('- 日本語で出力すること');
  return lines.join('\n');
}

// ── グループサマリー描画 ───────────────────────────
const GROUP_COLORS = ['#01696f','#437a22','#006494','#7a39bb','#da7101','#a12c7b'];
function renderGroupSummary(groups) {
  groupSummary.innerHTML = groups.map((g, i) => {
    const color = GROUP_COLORS[i % GROUP_COLORS.length];
    return `<div class="group-chip">
      <span class="group-chip-dot" style="background:${color}"></span>
      グループ${i+1}：${g.length}件
    </div>`;
  }).join('');
}

// ── スライドプレビュー描画 ─────────────────────────
function renderSlidePreview(groups) {
  slidePreview.innerHTML = '<p style="font-size:var(--text-sm);font-weight:600;margin-bottom:var(--space-3)">スライド構成プレビュー</p>' +
    groups.map((g, i) => {
      const color = GROUP_COLORS[i % GROUP_COLORS.length];
      const slidesHtml = g.map((h, hi) => `
        <div class="slide-item">
          <span class="slide-num" style="background:${color}20;color:${color}">${i+1}${g.length > 1 ? '-'+(hi+1) : ''}</span>
          <span>${escapeHtml(h.title)}</span>
        </div>`).join('');
      return `<div class="slide-group-block">
        <div class="slide-group-header">
          <span style="color:${color}">● グループ ${i+1}</span>
          <span style="color:var(--color-text-faint)">${g.length}件</span>
        </div>
        <div class="slide-group-slides">${slidesHtml}</div>
      </div>`;
    }).join('');
}

// ── コピー ────────────────────────────────────────
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
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('コピーしました！');
  });
});

// ── Regen / Reset ─────────────────────────────────
regenBtn.addEventListener('click', () => generateBtn.click());
resetBtn.addEventListener('click', () => {
  state.headlines = [];
  state.groups = [];
  resultCard.setAttribute('hidden', '');
  promptCard.setAttribute('hidden', '');
  hideError();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Helpers ───────────────────────────────────────
async function fetchProxy(url) {
  const res = await fetch(PROXY + encodeURIComponent(url));
  if (!res.ok) throw new Error(`HTTPエラー: ${res.status}`);
  const json = await res.json();
  return json.contents;
}

function extractHTMLTitle(html) {
  const m = html && html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}
function extractOGTitle(html) {
  const m = html && html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setLoading(on) {
  if (on) { loadingArea.removeAttribute('hidden'); fetchBtn.disabled = true; }
  else    { loadingArea.setAttribute('hidden','');  fetchBtn.disabled = false; }
}
function showError(msg) { errorMsg.textContent = msg; errorArea.removeAttribute('hidden'); }
function hideError()    { errorArea.setAttribute('hidden',''); }
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('toastContainer').appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ── 初期化 ────────────────────────────────────────
loadArticleList();
