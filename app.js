/* ==============================================
   NotebookLM Prompt Generator — app.js
   ============================================== */

'use strict';

// ── State ────────────────────────────────────────
const state = {
  media: 'note',
  headlines: [],     // [{ id, title, source, url }]
  groups: [],        // [[headline, ...], ...]
  minSlides: 10,
  maxSlides: 15,
};

// ── CORS Proxy (public) ───────────────────────────
const PROXY = 'https://api.allorigins.win/get?url=';

// ── Media configs ────────────────────────────────
const MEDIA_CONFIG = {
  note: {
    label: 'article番号（例: m1234567890ab）',
    hint:  'note.com の記事番号を改行区切りで入力',
    placeholder: 'm1234567890ab\n4567890abcde',
    resolve: (raw) => {
      raw = raw.trim();
      if (raw.startsWith('http')) {
        const m = raw.match(/note\.com\/[^/]+\/n\/([a-zA-Z0-9]+)/);
        return m ? `https://note.com/api/v1/note/${m[1]}` : null;
      }
      const id = raw.replace(/^n/, '');
      return `https://note.com/api/v1/note/n${id}`;
    },
    parse: async (raw) => {
      const url = MEDIA_CONFIG.note.resolve(raw);
      if (!url) throw new Error(`解析できないinput: ${raw}`);
      const res = await fetchProxy(url);
      const data = JSON.parse(res);
      const d = data.data || data;
      return { title: d.name || d.title || '(タイトル不明)', url: d.noteUrl || url, source: 'note' };
    },
  },
  qiita: {
    label: 'article ID（例: 1234567890abcdef0123）',
    hint:  'Qiita の記事IDを改行区切りで入力',
    placeholder: '1234567890abcdef0123',
    parse: async (raw) => {
      raw = raw.trim();
      let id = raw;
      if (raw.startsWith('http')) {
        const m = raw.match(/qiita\.com\/[^/]+\/items\/([a-zA-Z0-9]+)/);
        if (!m) throw new Error(`解析できないURL: ${raw}`);
        id = m[1];
      }
      const res = await fetchProxy(`https://qiita.com/api/v2/items/${id}`);
      const data = JSON.parse(res);
      return { title: data.title || '(タイトル不明)', url: data.url || raw, source: 'Qiita' };
    },
  },
  zenn: {
    label: 'スラッグ または URL（例: my-article-slug）',
    hint:  'Zenn の記事スラッグまたはURLを改行区切りで入力',
    placeholder: 'my-article-slug',
    parse: async (raw) => {
      raw = raw.trim();
      let slug = raw;
      if (raw.startsWith('http')) {
        const m = raw.match(/zenn\.dev\/[^/]+\/articles\/([a-zA-Z0-9_-]+)/);
        if (!m) throw new Error(`解析できないURL: ${raw}`);
        slug = m[1];
      }
      const res = await fetchProxy(`https://zenn.dev/api/articles/${slug}`);
      const data = JSON.parse(res);
      const a = data.article || data;
      return { title: a.title || '(タイトル不明)', url: `https://zenn.dev${a.path || ''}`, source: 'Zenn' };
    },
  },
  url: {
    label: 'URL（例: https://example.com/article/1）',
    hint:  '任意のURLを改行区切りで入力（OGP titleを取得）',
    placeholder: 'https://example.com/article/123\nhttps://example.com/article/456',
    parse: async (raw) => {
      raw = raw.trim();
      if (!raw.startsWith('http')) throw new Error(`URLの形式が正しくありません: ${raw}`);
      const html = await fetchProxy(raw);
      const title = extractOGTitle(html) || extractHTMLTitle(html) || raw;
      return { title, url: raw, source: new URL(raw).hostname };
    },
  },
};

// ── DOM refs ─────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fetchBtn     = $('fetchBtn');
const articleInput = $('articleInput');
const loadingArea  = $('loadingArea');
const errorArea    = $('errorArea');
const errorMsg     = $('errorMsg');
const resultCard   = $('resultCard');
const headlinesList= $('headlinesList');
const generateBtn  = $('generateBtn');
const selectAllBtn = $('selectAllBtn');
const deselectAllBtn=$('deselectAllBtn');
const promptCard   = $('promptCard');
const promptOutput = $('promptOutput');
const groupSummary = $('groupSummary');
const slidePreview = $('slidePreview');
const copyBtn      = $('copyBtn');
const regenBtn     = $('regenBtn');
const resetBtn     = $('resetBtn');
const minCount     = $('minCount');
const maxCount     = $('maxCount');
const minusBtn     = $('minusBtn');
plusBtn            = $('plusBtn');

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

// ── Media tab switching ───────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    state.media = btn.dataset.media;
    const cfg = MEDIA_CONFIG[state.media];
    $('inputLabel').textContent = cfg.label;
    $('inputHint').textContent  = cfg.hint;
    articleInput.placeholder    = cfg.placeholder;
  });
});

// ── Slide count controls ──────────────────────────
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

// ── Fetch & parse articles ────────────────────────
fetchBtn.addEventListener('click', async () => {
  const raw = articleInput.value.trim();
  if (!raw) { showError('article番号またはURLを入力してください。'); return; }

  const lines = raw.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
  setLoading(true);
  hideError();

  try {
    const parser = MEDIA_CONFIG[state.media].parse;
    const results = await Promise.allSettled(lines.map(line => parser(line)));

    state.headlines = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        state.headlines.push({ id: i, ...r.value });
      } else {
        failed.push(lines[i]);
      }
    });

    if (state.headlines.length === 0) {
      throw new Error('見出しを取得できませんでした。article番号・URLを確認してください。');
    }

    if (failed.length > 0) {
      showToast(`⚠️ ${failed.length}件の取得に失敗しました`);
    }

    renderHeadlines();
    resultCard.removeAttribute('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
});

// ── Render headlines ──────────────────────────────
function renderHeadlines() {
  headlinesList.innerHTML = '';
  state.headlines.forEach(h => {
    const item = document.createElement('label');
    item.className = 'headline-item';
    item.innerHTML = `
      <input type="checkbox" checked data-id="${h.id}">
      <div style="flex:1">
        <div class="headline-meta">${escapeHtml(h.source)} ${h.url ? `— <a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--color-text-faint)">${escapeHtml(h.url.slice(0,60))}...</a>` : ''}</div>
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

// ── Generate prompt ───────────────────────────────
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

// ── Auto grouping algorithm ───────────────────────
/**
 * headlines を minSlides〜maxSlides 枚に収まるようグループ分けする。
 * 1スライド = 1見出し原則。過多の場合は関連見出しを1グループにまとめる。
 */
function groupHeadlines(headlines, minS, maxS) {
  const n = headlines.length;

  // 件数が範囲内ならそのまま1件ずつ
  if (n >= minS && n <= maxS) {
    return headlines.map(h => [h]);
  }

  // 件数が少なすぎる場合もそのまま
  if (n < minS) {
    return headlines.map(h => [h]);
  }

  // 件数が多すぎる場合: グループ数をmaxS以内に収める
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

// ── Build prompt ──────────────────────────────────
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
      const groupTitle = `グループ${gi + 1}（${group.length}記事）`;
      lines.push(`スライド${slideNum}：${groupTitle}`);
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

// ── Render group summary ──────────────────────────
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

// ── Render slide preview ──────────────────────────
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

// ── Copy ─────────────────────────────────────────
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
    // fallback
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
regenBtn.addEventListener('click', () => {
  generateBtn.click();
});
resetBtn.addEventListener('click', () => {
  state.headlines = [];
  state.groups = [];
  articleInput.value = '';
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

function extractOGTitle(html) {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/);
  return m ? m[1] : null;
}
function extractHTMLTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/);
  return m ? m[1].trim() : null;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setLoading(on) {
  if (on) { loadingArea.removeAttribute('hidden'); fetchBtn.disabled = true; }
  else    { loadingArea.setAttribute('hidden',''); fetchBtn.disabled = false; }
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
