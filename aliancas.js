/* ============================================================================
 * Central de Alianças — página dedicada (aba do navegador)
 * Reaproveita a sessão do Hub salva em chrome.storage.local['sp_hub_session'].
 * Quadro compartilhado entre os usuários autenticados.
 * ========================================================================== */

const CFG = {
  supabaseUrl: 'https://dqiosohjicnruwrhxeou.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxaW9zb2hqaWNucnV3cmh4ZW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTI0NzcsImV4cCI6MjA4ODA2ODQ3N30.y5LVH3Lb9xDuHLDVvDaNCrzuS2RsJenI0EqgVtHBWfM'
};
const HUB_SESSION_KEY = 'sp_hub_session';
const ADMIN_EMAIL = 'alcsolha@gmail.com';

let auth = { user: null, token: null, refreshToken: null };
let seletores = [];   // [{id,label,sort_order,is_active}]
let casos = [];       // casos ativos (não arquivados)
let regras = [];      // [{id,seletores:[],label,sort_order}] — regras do resumo
let currentView = 'ativos';
let dragSeletorId = null; // arraste no gerenciador de seletores
let editingRegraId = null; // regra em edição no formulário de regras

/* ── Tema (o mesmo da extensão: chrome.storage 'sp.ui.theme') ─────────── */
const THEME_KEY = 'sp.ui.theme';
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
let themePref = 'system';
function applyTheme() {
  const dark = themePref === 'dark' || (themePref === 'system' && darkMedia.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  chrome.storage.local.get(THEME_KEY, (d) => { themePref = d?.[THEME_KEY] || 'system'; applyTheme(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[THEME_KEY]) { themePref = changes[THEME_KEY].newValue || 'system'; applyTheme(); }
  });
}
darkMedia.addEventListener?.('change', applyTheme);
applyTheme();

/* ── Diálogos no padrão da extensão (em vez de alert/confirm/prompt) ─── */
function uiDialog({ title, body = '', input = null, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'al-dialog';
    wrap.innerHTML = `
      <div class="al-dialog__box" role="alertdialog" aria-modal="true">
        <div class="al-dialog__title"></div>
        ${body ? '<div class="al-dialog__body"></div>' : ''}
        ${input !== null ? '<input class="al-input al-dialog__input" maxlength="120" />' : ''}
        <div class="al-dialog__actions">
          ${cancelLabel ? '<button type="button" class="al-btn al-btn--ghost" data-r="0"></button>' : ''}
          <button type="button" class="al-btn ${danger ? 'al-btn--danger-solid' : 'al-btn--primary'}" data-r="1"></button>
        </div>
      </div>`;
    wrap.querySelector('.al-dialog__title').textContent = title;
    if (body) wrap.querySelector('.al-dialog__body').textContent = body;
    if (cancelLabel) wrap.querySelector('[data-r="0"]').textContent = cancelLabel;
    wrap.querySelector('[data-r="1"]').textContent = confirmLabel;
    const field = wrap.querySelector('.al-dialog__input');
    if (field) field.value = input;
    const done = (ok) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(input !== null ? (ok ? field.value : null) : ok);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      if (e.key === 'Enter' && (field || document.activeElement?.dataset?.r !== '0')) { e.preventDefault(); done(true); }
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) done(false);
      const r = e.target.closest?.('[data-r]');
      if (r) done(r.dataset.r === '1');
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    (field || wrap.querySelector('[data-r="1"]')).focus();
    field?.select();
  });
}
const uiConfirm = (title, body, confirmLabel = 'Excluir') => uiDialog({ title, body, confirmLabel, danger: true });
const uiAlert = (title, body) => uiDialog({ title, body, confirmLabel: 'Entendi', cancelLabel: null });

/* ── Sessão / storage ──────────────────────────────────────────────────── */
function hasStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}
function getSession() {
  return new Promise((resolve) => {
    if (!hasStorage()) { resolve(null); return; }
    chrome.storage.local.get(HUB_SESSION_KEY, (data) => resolve(data?.[HUB_SESSION_KEY] || null));
  });
}
function saveSession(session) {
  return new Promise((resolve) => {
    if (!hasStorage()) { resolve(); return; }
    chrome.storage.local.set({ [HUB_SESSION_KEY]: session }, resolve);
  });
}

function isAdmin() {
  return auth.user?.email === ADMIN_EMAIL;
}

/* ── Supabase REST ─────────────────────────────────────────────────────── */
// A renovação do token é feita só pelo background (uma por vez), para não
// derrubar a sessão quando várias abas renovam ao mesmo tempo.
async function refreshSession() {
  if (!auth.refreshToken) throw new Error('Sem refresh token.');
  const reply = await chrome.runtime.sendMessage({
    __sp: 'auth.refresh',
    payload: { staleRefreshToken: auth.refreshToken }
  });
  const session = reply && reply.ok ? reply.data : null;
  if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente pela extensão.');
  auth.token = session.access_token;
  auth.refreshToken = session.refresh_token;
  return session;
}

async function sbFetch(path, opts = {}) {
  const headers = {
    apikey: CFG.supabaseKey,
    Authorization: `Bearer ${auth.token || CFG.supabaseKey}`,
    'Content-Type': 'application/json',
    ...(opts.headers || {})
  };
  let res = await fetch(`${CFG.supabaseUrl}${path}`, { ...opts, headers });

  if (res.status === 401 && auth.refreshToken) {
    await refreshSession();
    headers.Authorization = `Bearer ${auth.token}`;
    res = await fetch(`${CFG.supabaseUrl}${path}`, { ...opts, headers });
  }

  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try { const j = await res.json(); msg = j.message || j.error_description || msg; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ── Data helpers ──────────────────────────────────────────────────────── */
async function loadSeletores() {
  const rows = await sbFetch('/rest/v1/aliancas_seletores?order=sort_order.asc,label.asc&select=*');
  seletores = Array.isArray(rows) ? rows : [];
}
async function loadCasos() {
  const rows = await sbFetch('/rest/v1/aliancas_casos?is_archived=eq.false&order=created_at.desc&select=*');
  casos = Array.isArray(rows) ? rows : [];
}
async function loadArquivados() {
  const rows = await sbFetch('/rest/v1/aliancas_casos?is_archived=eq.true&order=archived_at.desc&select=*');
  return Array.isArray(rows) ? rows : [];
}
async function loadRegras() {
  try {
    const rows = await sbFetch('/rest/v1/aliancas_resumo_regras?order=sort_order.asc,id.asc&select=*');
    regras = Array.isArray(rows) ? rows : [];
  } catch (_) {
    regras = []; // tabela ausente (migration não aplicada) → resumo usa o padrão
  }
}
async function createRegra(fields) {
  await sbFetch('/rest/v1/aliancas_resumo_regras', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(fields)
  });
}
async function updateRegra(id, fields) {
  await sbFetch(`/rest/v1/aliancas_resumo_regras?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(fields)
  });
}
async function deleteRegra(id) {
  await sbFetch(`/rest/v1/aliancas_resumo_regras?id=eq.${id}`, { method: 'DELETE' });
}

async function createCaso(fields) {
  const rows = await sbFetch('/rest/v1/aliancas_casos', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ created_by: auth.user.id, created_by_name: displayName(), ...fields })
  });
  return rows?.[0] || null;
}
async function updateCaso(id, fields) {
  await sbFetch(`/rest/v1/aliancas_casos?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
  });
}
async function deleteCaso(id) {
  await sbFetch(`/rest/v1/aliancas_casos?id=eq.${id}`, { method: 'DELETE' });
}

async function createSeletor(label) {
  const maxOrder = seletores.reduce((m, s) => Math.max(m, s.sort_order || 0), 0);
  await sbFetch('/rest/v1/aliancas_seletores', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ label, sort_order: maxOrder + 10 })
  });
}
async function updateSeletor(id, fields) {
  await sbFetch(`/rest/v1/aliancas_seletores?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(fields)
  });
}
async function deleteSeletor(id) {
  await sbFetch(`/rest/v1/aliancas_seletores?id=eq.${id}`, { method: 'DELETE' });
}

/* ── Util ──────────────────────────────────────────────────────────────── */
function displayName() {
  return (
    auth.user?.user_metadata?.display_name ||
    auth.user?.user_metadata?.name ||
    (auth.user?.email ? auth.user.email.split('@')[0] : 'Usuário')
  );
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function normLabel(s) { return String(s || '').trim().toLowerCase(); }
function setKey(labels) { return (labels || []).map(normLabel).sort().join('|'); }

// Ordena labels conforme a sequência definida no "Gerenciar seletores"
// (sort_order, ajustável por arrastar). Labels desconhecidos vão para o fim.
function orderLabels(labels) {
  const pos = new Map();
  seletores.forEach((s, i) => pos.set(normLabel(s.label), s.sort_order ?? i));
  return [...(labels || [])].sort((a, b) => {
    const oa = pos.has(normLabel(a)) ? pos.get(normLabel(a)) : 1e9;
    const ob = pos.has(normLabel(b)) ? pos.get(normLabel(b)) : 1e9;
    return oa - ob || a.localeCompare(b, 'pt-BR');
  });
}
function comboKey(labels) {
  return orderLabels(labels).join(' + ');
}

// Regras do resumo: uma regra casa quando seu conjunto de seletores é
// SUBCONJUNTO dos seletores do caso. Vence a regra com mais seletores (mais
// específica); em empate, a de maior prioridade (ordem definida no gerenciador
// de regras). Seletores extras do caso são anexados com " + " após o rótulo.
function regraMatch(labels) {
  const caseSet = new Set((labels || []).map(normLabel));
  let best = null;
  let bestSize = 0;
  regras.forEach((r) => {
    const rs = (r.seletores || []).map(normLabel);
    if (!rs.length) return;
    if (rs.every((x) => caseSet.has(x)) && rs.length > bestSize) {
      best = r;
      bestSize = rs.length;
    }
  });
  return best;
}
function el(id) { return document.getElementById(id); }
function setStatus(msg, kind) {
  const s = el('al-status');
  if (!msg) { s.hidden = true; return; }
  s.hidden = false;
  s.textContent = msg;
  s.className = 'al-status' + (kind ? ` al-status--${kind}` : '');
  if (kind === 'success') setTimeout(() => { s.hidden = true; }, 3500);
}

/* ── Consolidação ──────────────────────────────────────────────────────── */
function consolidate(list) {
  const groups = new Map();
  let totalAliancas = 0;
  let totalCasos = 0;
  list.forEach((c) => {
    const labels = c.seletores || [];
    const key = comboKey(labels) || '(sem classificação)';
    const qtd = Number(c.quantidade) || 1;
    if (!groups.has(key)) groups.set(key, { key, labels, aliancas: 0, casos: 0 });
    const g = groups.get(key);
    g.aliancas += qtd;
    g.casos += 1;
    totalAliancas += qtd;
    totalCasos += 1;
  });
  const rows = [...groups.values()].map((g) => {
    const regra = regraMatch(g.labels);
    let order, display;
    if (regra) {
      // Regra casada: mantém o rótulo e anexa os seletores extras do caso com " + ".
      const rset = new Set((regra.seletores || []).map(normLabel));
      const extras = orderLabels((g.labels || []).filter((l) => !rset.has(normLabel(l))));
      display = regra.label + (extras.length ? ' + ' + extras.join(' + ') : '');
      order = regras.indexOf(regra);
    } else {
      display = g.key;
      order = 1000;
    }
    return { ...g, order, display };
  }).sort((a, b) =>
    a.order - b.order ||
    b.aliancas - a.aliancas ||
    a.display.localeCompare(b.display, 'pt-BR')
  );
  return { rows, totalAliancas, totalCasos };
}
function resumoTexto(list, titulo) {
  const { rows, totalAliancas, totalCasos } = consolidate(list);
  const lines = [titulo || 'Resumo de alianças', ''];
  rows.forEach((r) => {
    lines.push(`• ${r.aliancas} aliança${r.aliancas !== 1 ? 's' : ''} — ${r.display}` + (r.casos !== r.aliancas ? ` (${r.casos} caso${r.casos !== 1 ? 's' : ''})` : ''));
  });
  lines.push('');
  lines.push(`Total: ${totalAliancas} aliança${totalAliancas !== 1 ? 's' : ''} em ${totalCasos} caso${totalCasos !== 1 ? 's' : ''}.`);
  return lines.join('\n');
}

/* ── Render: casos ─────────────────────────────────────────────────────── */
function renderCounters() {
  const totalAliancas = casos.reduce((s, c) => s + (Number(c.quantidade) || 1), 0);
  el('al-counters').textContent = `${casos.length} caso${casos.length === 1 ? '' : 's'} · ${totalAliancas} aliança${totalAliancas === 1 ? '' : 's'}`;
  const count = el('al-tab-count');
  if (count) count.textContent = String(casos.length);
}

/* Cor da bolinha de cada seletor: fixa pelo nome (mesma cor em todos os cartões e computadores). */
const TAG_COLORS = ['#3b82f6', '#ef4444', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#14b8a6', '#64748b'];
const KNOWN_TAG_COLORS = { troca: '#3b82f6', defeito: '#ef4444', 'sem defeito': '#10b981', 'nova gravação': '#8b5cf6', regravação: '#f59e0b', aro: '#64748b' };
function tagColor(label) {
  if (KNOWN_TAG_COLORS[normLabel(label)]) return KNOWN_TAG_COLORS[normLabel(label)];
  let h = 0;
  for (const ch of normLabel(label)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}
function chipsHTML(labels) {
  const ordered = orderLabels(labels);
  return (ordered && ordered.length)
    ? ordered.map((s) => `<span class="al-chip"><span class="al-dot" style="background:${tagColor(s)}"></span>${esc(s)}</span>`).join('')
    : '<span class="al-chip al-chip--none">Sem classificação</span>';
}
function qtdText(c) {
  const n = Number(c.quantidade) || 1;
  return `${n} aliança${n === 1 ? '' : 's'}`;
}

function cardHTML(c) {
  return `
    <article class="al-card" data-id="${c.id}">
      <div class="al-card__top">
        <div class="al-card__title ${c.titulo ? '' : 'is-empty'}">${c.titulo ? esc(c.titulo) : 'Sem título'}</div>
        <span class="al-card__qtd">${qtdText(c)}</span>
      </div>
      <div class="al-chips">${portalChipCaso(c.id)}${chipsHTML(c.seletores)}</div>
      ${c.observacao ? `<div class="al-card__obs">${esc(c.observacao)}</div>` : ''}
      <div class="al-card__foot">
        <span class="al-card__meta">${esc(c.created_by_name || '—')} · ${fmtDate(c.created_at)}</span>
        <span class="al-grow"></span>
        <button class="al-link" data-act="edit" data-id="${c.id}">Editar</button>
        <button class="al-link al-link--danger" data-act="delete" data-id="${c.id}">Excluir</button>
      </div>
    </article>
  `;
}

// Card criado a partir de uma troca do portal: chip com o código, abre a troca.
function portalChipCaso(casoId) {
  const i = portal.itens.find((x) => x.caso_id === casoId);
  return i ? `<button type="button" class="al-chip al-chip--portal" data-portal-item="${i.id}" title="Abrir a troca do portal">${esc(i.codigo)}</button>` : '';
}

function renderCasos() {
  renderCounters();
  const wrap = el('al-cards');
  const empty = el('al-empty');
  if (!casos.length) {
    wrap.innerHTML = '';
    wrap.className = 'al-cards';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  // agrupa por usuário (created_by)
  const byUser = new Map();
  casos.forEach((c) => {
    const key = c.created_by || 'sem-user';
    if (!byUser.has(key)) byUser.set(key, { name: c.created_by_name || '—', list: [] });
    byUser.get(key).list.push(c);
  });

  // 1 usuário só → grade normal (comportamento anterior)
  if (byUser.size <= 1) {
    wrap.className = 'al-cards';
    wrap.innerHTML = casos.map(cardHTML).join('');
    return;
  }

  // 2+ usuários → colunas (cascata) por usuário; a sua coluna vem primeiro
  wrap.className = 'al-cards al-cards--cols';
  const cols = [...byUser.entries()].sort((a, b) => {
    if (a[0] === auth.user.id) return -1;
    if (b[0] === auth.user.id) return 1;
    return a[1].name.localeCompare(b[1].name, 'pt-BR');
  });
  wrap.innerHTML = cols.map(([key, info]) => {
    const totalAl = info.list.reduce((s, c) => s + (Number(c.quantidade) || 1), 0);
    return `
      <div class="al-col">
        <div class="al-col__head">
          <span class="al-col__name">${key === auth.user.id ? `Você (${esc(info.name)})` : esc(info.name)}</span>
          <span class="al-col__count">${info.list.length} caso${info.list.length === 1 ? '' : 's'} · ${totalAl} aliança${totalAl === 1 ? '' : 's'}</span>
        </div>
        <div class="al-col__cards">${info.list.map(cardHTML).join('')}</div>
      </div>`;
  }).join('');
}

/* ── Render: histórico ─────────────────────────────────────────────────── */
function historicoCasoHTML(c) {
  return `
    <div class="al-hist-caso">
      <div class="al-hist-caso__head">
        <span class="al-hist-caso__title ${c.titulo ? '' : 'is-empty'}">${c.titulo ? esc(c.titulo) : 'Sem título'}</span>
        <span class="al-hist-caso__qtd">${qtdText(c)}</span>
      </div>
      <div class="al-chips">${chipsHTML(c.seletores)}</div>
      ${c.observacao ? `<div class="al-card__obs">${esc(c.observacao)}</div>` : ''}
      <div class="al-card__meta">${esc(c.created_by_name || '—')} · ${fmtDate(c.created_at)}</div>
    </div>
  `;
}

async function renderHistorico() {
  const wrap = el('al-historico');
  wrap.innerHTML = '<div class="al-loading">Carregando histórico…</div>';
  let arquivados;
  try {
    arquivados = await loadArquivados();
  } catch (e) {
    wrap.innerHTML = `<div class="al-status al-status--error">${esc(e.message)}</div>`;
    return;
  }
  if (!arquivados.length) {
    wrap.innerHTML = '<div class="al-empty"><p>Nenhuma semana arquivada ainda.</p></div>';
    return;
  }
  const batches = new Map();
  arquivados.forEach((c) => {
    const key = c.batch_label || 'Sem rótulo';
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(c);
  });
  const html = [...batches.entries()].map(([label, list], idx) => {
    const { rows, totalAliancas, totalCasos } = consolidate(list);
    const lines = rows.map((r) => `
      <div class="al-resumo-line"><b>${r.aliancas}</b><span>${esc(r.display)}${r.casos !== r.aliancas ? ` · ${r.casos} caso(s)` : ''}</span></div>
    `).join('');
    const casosList = list.map(historicoCasoHTML).join('');
    return `
      <section class="al-batch">
        <div class="al-batch__head" data-batch="${idx}">
          <h3>${esc(label)}</h3>
          <div class="al-batch__head-right">
            <span>${totalAliancas} aliança(s) · ${totalCasos} caso(s)</span>
            ${isAdmin() ? `<button class="al-btn al-btn--sm al-btn--danger" data-del-batch="${idx}" title="Excluir este histórico">Excluir lote</button>` : ''}
          </div>
        </div>
        <div class="al-batch__body" id="al-batch-body-${idx}" hidden>
          <div class="al-batch__section">Resumo</div>
          ${lines}
          <div class="al-batch__section">Casos (${list.length})</div>
          <div class="al-hist-casos">${casosList}</div>
        </div>
      </section>
    `;
  }).join('');
  wrap.innerHTML = html;
  const entries = [...batches.entries()];
  wrap.querySelectorAll('.al-batch__head').forEach((h) => {
    h.addEventListener('click', () => {
      const body = el(`al-batch-body-${h.dataset.batch}`);
      if (body) body.hidden = !body.hidden;
    });
  });
  wrap.querySelectorAll('[data-del-batch]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const [label, list] = entries[Number(b.dataset.delBatch)];
      deleteBatch(label, list.map((c) => c.id));
    });
  });
}

async function deleteBatch(label, ids) {
  if (!ids || !ids.length) return;
  if (!(await uiConfirm(`Excluir o histórico "${label}"?`, `Apaga ${ids.length} caso(s) arquivado(s) dessa semana. Não dá para desfazer.`))) return;
  try {
    await sbFetch(`/rest/v1/aliancas_casos?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    setStatus(`Histórico "${label}" excluído.`, 'success');
    renderHistorico();
  } catch (e) {
    uiAlert('Não foi possível excluir o histórico', e.message);
  }
}

/* ── Modal: novo/editar caso ───────────────────────────────────────────── */
function openCasoModal(caso) {
  el('al-modal-title').textContent = caso ? 'Editar caso' : 'Novo caso';
  el('al-form-id').value = caso ? caso.id : '';
  el('al-form-titulo').value = caso ? (caso.titulo || '') : '';
  el('al-form-qtd').value = caso ? (Number(caso.quantidade) || 1) : 1;
  el('al-form-obs').value = caso ? (caso.observacao || '') : '';

  const active = seletores.filter((s) => s.is_active);
  // garante que labels já usados no caso (mesmo inativos) apareçam ao editar
  const usados = new Set(caso?.seletores || []);
  const extras = seletores.filter((s) => !s.is_active && usados.has(s.label));
  const list = [...active, ...extras];
  el('al-form-seletores').innerHTML = list.map((s) => {
    const checked = usados.has(s.label);
    return `<label class="al-check ${checked ? 'is-checked' : ''}">
      <input type="checkbox" value="${esc(s.label)}" ${checked ? 'checked' : ''}/>${esc(s.label)}
    </label>`;
  }).join('') || '<span class="al-hint">Nenhum seletor cadastrado.</span>';

  el('al-modal').hidden = false;
  el('al-form-titulo').focus();
}

async function submitCaso(e) {
  e.preventDefault();
  const id = el('al-form-id').value;
  const titulo = el('al-form-titulo').value.trim();
  const quantidade = Math.max(1, parseInt(el('al-form-qtd').value, 10) || 1);
  const observacao = el('al-form-obs').value.trim();
  const sel = [...el('al-form-seletores').querySelectorAll('input:checked')].map((i) => i.value);

  const saveBtn = el('al-form-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Salvando…';
  try {
    if (id) {
      await updateCaso(id, { titulo, quantidade, observacao, seletores: sel });
    } else {
      await createCaso({ titulo, quantidade, observacao, seletores: sel, status: 'aberto' });
    }
    closeModals();
    await loadCasos();
    renderCasos();
    setStatus(id ? 'Caso atualizado.' : 'Caso adicionado.', 'success');
  } catch (err) {
    setStatus('Erro ao salvar: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Salvar caso';
  }
}

/* ── Ações nos cards ───────────────────────────────────────────────────── */
async function handleCardAction(act, id) {
  const caso = casos.find((c) => String(c.id) === String(id));
  if (!caso) return;
  if (act === 'edit') { openCasoModal(caso); return; }
  if (act === 'delete') {
    if (!(await uiConfirm('Excluir este caso?', caso.titulo || 'Sem título'))) return;
    try {
      await deleteCaso(id);
      await loadCasos();
      renderCasos();
      setStatus('Caso excluído.', 'success');
    } catch (e) { setStatus('Erro ao excluir: ' + e.message, 'error'); }
  }
}

/* ── Resumo ────────────────────────────────────────────────────────────── */
function openResumo() {
  const { rows, totalAliancas, totalCasos } = consolidate(casos);
  const body = el('al-resumo-body');
  if (!casos.length) {
    body.innerHTML = '<div class="al-resumo__empty">Nenhum caso na semana para resumir.</div>';
  } else {
    body.innerHTML = rows.map((r) => `
      <div class="al-resumo-line"><b>${r.aliancas}</b><span>${esc(r.display)}${r.casos !== r.aliancas ? ` · ${r.casos} caso(s)` : ''}</span></div>
    `).join('') + `
      <div class="al-resumo__total"><span>Total</span><b>${totalAliancas} aliança(s) · ${totalCasos} caso(s)</b></div>`;
  }
  el('al-modal-resumo').hidden = false;
}

/* ── Fechar semana ─────────────────────────────────────────────────────── */
async function fecharSemana() {
  if (!casos.length) { setStatus('Não há casos para arquivar.', 'error'); return; }
  const hoje = new Date().toLocaleDateString('pt-BR');
  const padrao = `Semana de ${hoje}`;
  let label = await uiDialog({ title: `Fechar a semana (${casos.length} caso${casos.length === 1 ? '' : 's'})`, body: 'Os casos vão para o Histórico com este nome:', input: padrao, confirmLabel: 'Fechar semana' });
  if (label === null) return;
  label = label.trim() || padrao;

  setStatus('Arquivando semana…');
  const nowIso = new Date().toISOString();
  try {
    // Arquiva todos os casos ativos de uma vez
    await sbFetch('/rest/v1/aliancas_casos?is_archived=eq.false', {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ is_archived: true, archived_at: nowIso, batch_label: label, updated_at: nowIso })
    });
    await loadCasos();
    renderCasos();
    setStatus(`Semana "${label}" arquivada. Consulte no Histórico.`, 'success');
  } catch (e) {
    setStatus('Erro ao arquivar: ' + e.message, 'error');
  }
}

/* ── Gerenciar seletores (admin) ───────────────────────────────────────── */
function openSeletoresModal() {
  renderSeletoresList();
  el('al-modal-seletores').hidden = false;
}
function renderSeletoresList() {
  el('al-seletores-list').innerHTML = seletores.map((s) => `
    <div class="al-seletor-row ${s.is_active ? '' : 'is-inactive'}" data-id="${s.id}" draggable="true">
      <span class="al-drag-handle" title="Arraste para reordenar">⠿</span>
      <span class="al-seletor-label">${esc(s.label)}</span>
      <div class="al-seletor-row__actions">
        <button class="al-btn al-btn--sm al-btn--ghost" data-sel-act="edit" data-id="${s.id}">Editar</button>
        <button class="al-btn al-btn--sm al-btn--ghost" data-sel-act="toggle" data-id="${s.id}">${s.is_active ? 'Desativar' : 'Ativar'}</button>
        <button class="al-btn al-btn--sm al-btn--danger" data-sel-act="delete" data-id="${s.id}">Excluir</button>
      </div>
    </div>
  `).join('') || '<span class="al-hint">Nenhum seletor cadastrado.</span>';
}
// Reordena por arraste e persiste sort_order — define a sequência dos chips no card.
async function reorderSeletores(fromId, targetId, after) {
  if (String(fromId) === String(targetId)) return;
  const arr = [...seletores];
  const fromIdx = arr.findIndex((s) => String(s.id) === String(fromId));
  if (fromIdx < 0) return;
  const [moved] = arr.splice(fromIdx, 1);
  const toIdx = arr.findIndex((s) => String(s.id) === String(targetId));
  if (toIdx < 0) return;
  arr.splice(toIdx + (after ? 1 : 0), 0, moved);
  seletores = arr;
  renderSeletoresList(); // otimista
  try {
    await Promise.all(arr.map((s, i) => updateSeletor(s.id, { sort_order: (i + 1) * 10 })));
    await loadSeletores();
  } catch (e) {
    uiAlert('Não foi possível salvar a ordem', e.message);
    await loadSeletores();
  }
  renderSeletoresList();
  renderCasos(); // atualiza a ordem dos chips nos cards ativos
}
async function handleSeletorAction(act, id) {
  const s = seletores.find((x) => String(x.id) === String(id));
  if (!s) return;
  if (act === 'edit') { await editSeletorLabel(s); return; }
  try {
    if (act === 'toggle') {
      await updateSeletor(id, { is_active: !s.is_active });
    } else if (act === 'delete') {
      if (!(await uiConfirm(`Excluir o seletor "${s.label}"?`, 'Casos antigos que já o usam continuam intactos.'))) return;
      await deleteSeletor(id);
    }
    await loadSeletores();
    renderSeletoresList();
  } catch (e) {
    // se falhar por casos usando o label, orienta desativar
    uiAlert('Não foi possível excluir agora', `${e.message}. Use "Desativar".`);
  }
}

// Renomeia um seletor e propaga o novo nome para os casos ATIVOS e as regras
// que o usam (arquivados mantêm o nome antigo — são registro histórico).
async function editSeletorLabel(s) {
  const novo = await uiDialog({ title: 'Renomear seletor', input: s.label, confirmLabel: 'Salvar' });
  if (novo === null) return;
  const label = novo.trim();
  if (!label || label === s.label) return;
  if (seletores.some((x) => String(x.id) !== String(s.id) && x.label.toLowerCase() === label.toLowerCase())) {
    uiAlert('Já existe um seletor com esse nome.');
    return;
  }
  const antigo = s.label;
  try {
    await updateSeletor(s.id, { label });
    const casosAfetados = casos.filter((c) => (c.seletores || []).includes(antigo));
    const regrasAfetadas = regras.filter((r) => (r.seletores || []).includes(antigo));
    await Promise.all([
      ...casosAfetados.map((c) => updateCaso(c.id, { seletores: (c.seletores || []).map((l) => (l === antigo ? label : l)) })),
      ...regrasAfetadas.map((r) => updateRegra(r.id, { seletores: (r.seletores || []).map((l) => (l === antigo ? label : l)) }))
    ]);
    await Promise.all([loadSeletores(), loadRegras(), loadCasos()]);
    renderSeletoresList();
    renderCasos();
    const extra = (casosAfetados.length || regrasAfetadas.length)
      ? ` (${casosAfetados.length} caso(s) e ${regrasAfetadas.length} regra(s) atualizados)` : '';
    setStatus(`Seletor renomeado para "${label}"${extra}.`, 'success');
  } catch (e) {
    uiAlert('Não foi possível renomear o seletor', e.message);
    await loadSeletores();
    renderSeletoresList();
  }
}
async function submitSeletor(e) {
  e.preventDefault();
  const input = el('al-seletor-novo');
  const label = input.value.trim();
  if (!label) return;
  if (seletores.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
    uiAlert('Esse seletor já existe.'); return;
  }
  try {
    await createSeletor(label);
    input.value = '';
    await loadSeletores();
    renderSeletoresList();
  } catch (err) {
    uiAlert('Não foi possível adicionar', err.message);
  }
}

/* ── Modais util ───────────────────────────────────────────────────────── */
function closeModals() {
  el('al-modal').hidden = true;
  el('al-modal-resumo').hidden = true;
  el('al-modal-seletores').hidden = true;
  el('al-modal-regras').hidden = true;
  el('al-modal-portal').hidden = true;
  portalModal = null;
}

/* ── Regras do resumo (admin) ──────────────────────────────────────────── */
function openRegrasModal() {
  resetRegraForm();
  renderRegrasList();
  el('al-modal-regras').hidden = false;
}
function renderRegraChecks(preselected = new Set()) {
  const active = seletores.filter((s) => s.is_active);
  // inclui seletores inativos que a regra em edição já usa, pra não perdê-los
  const extras = seletores.filter((s) => !s.is_active && preselected.has(s.label));
  const list = [...active, ...extras];
  el('al-regra-seletores').innerHTML = list.map((s) => {
    const checked = preselected.has(s.label);
    return `<label class="al-check ${checked ? 'is-checked' : ''}"><input type="checkbox" value="${esc(s.label)}" ${checked ? 'checked' : ''}/>${esc(s.label)}</label>`;
  }).join('') || '<span class="al-hint">Cadastre seletores primeiro.</span>';
}
function resetRegraForm() {
  editingRegraId = null;
  el('al-regra-label').value = '';
  renderRegraChecks();
  el('al-regra-submit').textContent = 'Adicionar regra';
  el('al-regra-cancel').hidden = true;
  el('al-regra-form-title').textContent = 'Nova regra';
}
function startEditRegra(r) {
  editingRegraId = r.id;
  renderRegraChecks(new Set(r.seletores || []));
  el('al-regra-label').value = r.label || '';
  el('al-regra-submit').textContent = 'Salvar alterações';
  el('al-regra-cancel').hidden = false;
  el('al-regra-form-title').textContent = 'Editando regra';
  el('al-regra-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  el('al-regra-label').focus();
}
function renderRegrasList() {
  if (!regras.length) {
    el('al-regras-list').innerHTML = '<p class="al-hint">Nenhuma regra ainda. O resumo usa o padrão (Troca em 1º, por quantidade).</p>';
    return;
  }
  el('al-regras-list').innerHTML = regras.map((r, i) => `
    <div class="al-regra-row" data-id="${r.id}">
      <div class="al-regra-row__ord">
        <button class="al-icon-btn" data-regra-act="up" data-id="${r.id}" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>
        <button class="al-icon-btn" data-regra-act="down" data-id="${r.id}" ${i === regras.length - 1 ? 'disabled' : ''} title="Descer">▼</button>
      </div>
      <div class="al-regra-row__info">
        <strong>${esc(r.label)}</strong>
        <div class="al-chips">${(r.seletores || []).map((s) => `<span class="al-chip">${esc(s)}</span>`).join('') || '<span class="al-chip al-chip--none">sem seletor</span>'}</div>
      </div>
      <div class="al-regra-row__actions">
        <button class="al-btn al-btn--sm al-btn--ghost" data-regra-act="edit" data-id="${r.id}">Editar</button>
        <button class="al-btn al-btn--sm al-btn--danger" data-regra-act="delete" data-id="${r.id}">Excluir</button>
      </div>
    </div>
  `).join('');
}
async function handleRegraAction(act, id) {
  const idx = regras.findIndex((r) => String(r.id) === String(id));
  if (idx < 0) return;
  if (act === 'edit') { startEditRegra(regras[idx]); return; }
  try {
    if (act === 'delete') {
      if (!(await uiConfirm(`Excluir a regra "${regras[idx].label}"?`))) return;
      if (String(editingRegraId) === String(id)) resetRegraForm();
      await deleteRegra(id);
    } else if (act === 'up' && idx > 0) {
      await swapRegras(idx, idx - 1);
    } else if (act === 'down' && idx < regras.length - 1) {
      await swapRegras(idx, idx + 1);
    } else {
      return;
    }
    await loadRegras();
    renderRegrasList();
  } catch (e) {
    uiAlert('Não deu certo', e.message);
  }
}
async function swapRegras(i, j) {
  const a = regras[i], b = regras[j];
  // troca os sort_order das duas regras
  await Promise.all([
    updateRegra(a.id, { sort_order: j * 10 }),
    updateRegra(b.id, { sort_order: i * 10 })
  ]);
}
async function submitRegra(e) {
  e.preventDefault();
  const label = el('al-regra-label').value.trim();
  const sel = [...el('al-regra-seletores').querySelectorAll('input:checked')].map((i) => i.value);
  if (!label) { uiAlert('Escreva o rótulo da regra.'); return; }
  if (!sel.length) { uiAlert('Marque ao menos um seletor.'); return; }
  // duplicata: mesma combinação, ignorando a própria regra em edição
  if (regras.some((r) => String(r.id) !== String(editingRegraId) && setKey(r.seletores) === setKey(sel))) {
    uiAlert('Já existe uma regra para essa combinação de seletores.'); return;
  }
  try {
    if (editingRegraId) {
      await updateRegra(editingRegraId, { seletores: sel, label });
    } else {
      const maxOrder = regras.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
      await createRegra({ seletores: sel, label, sort_order: maxOrder + 10 });
    }
    resetRegraForm();
    await loadRegras();
    renderRegrasList();
  } catch (err) {
    uiAlert('Não foi possível salvar a regra', `${err.message} (verifique se a migration de regras foi aplicada no Supabase).`);
  }
}

/* ── Portal de trocas (cliente externa, medievaljoias.com.br/pedidos) ──── */
// A cliente cadastra as trocas no portal; aqui a equipe confere, conclui e devolve.
// Quem fez cada ação fica em portal_eventos (só a equipe lê); no papel não sai nome.
const PORTAL_TIPOS = {
  troca_aro: 'Troca de aro',
  troca_modelo: 'Troca de modelo',
  defeito: 'Defeito',
  nova_gravacao: 'Nova gravação',
  regravacao: 'Regravação'
};
const PORTAL_ORDEM = Object.keys(PORTAL_TIPOS);
// Seletores sugeridos ao conferir. Só marca os que existem e estão ativos. Ajuste aqui.
const PORTAL_MAPA_SELETORES = {
  troca_aro: ['Troca', 'Aro'],
  troca_modelo: ['Troca'],
  defeito: ['Defeito'],
  nova_gravacao: ['Nova gravação'],
  regravacao: ['Regravação']
};
const PORTAL_SEM_DEFEITO = 'Sem defeito'; // troca de aro/modelo sem "Defeito" marcado
const PORTAL_STATUS = {
  rascunho: { t: 'Rascunho', k: 'done' },
  enviada: { t: 'A conferir', k: 'info' },
  recebida: { t: 'Recebida', k: 'warn' },
  concluida: { t: 'Concluída', k: 'ok' },
  devolvida: { t: 'Devolvida', k: 'done' },
  cancelada: { t: 'Cancelada', k: 'done' }
};
const PORTAL_CODIGO_RE = /TR-\d{4,}(?:-\d{2,})?/i;

let portal = { disponivel: false, erro: '', clientes: [], lotes: [], itens: [] };
let portalModal = null; // { tipo: 'lote'|'item', id }

async function loadPortal() {
  try {
    const [lotes, clientes] = await Promise.all([
      sbFetch('/rest/v1/portal_lotes?status=in.(enviado,devolvido)&order=fechado_em.desc&limit=80&select=*'),
      sbFetch('/rest/v1/portal_clientes?select=id,nome,ativo')
    ]);
    const ids = (lotes || []).map((l) => l.id);
    const itens = ids.length
      ? await sbFetch(`/rest/v1/portal_itens?lote_id=in.(${ids.join(',')})&order=seq.asc&select=*`)
      : [];
    portal = { disponivel: true, erro: '', clientes: clientes || [], lotes: lotes || [], itens: itens || [] };
  } catch (e) {
    portal = { disponivel: false, erro: e.message, clientes: [], lotes: [], itens: [] };
  }
}

const portalCliente = (id) => portal.clientes.find((c) => c.id === id)?.nome || 'Cliente';
const portalItensDo = (loteId) => portal.itens.filter((i) => i.lote_id === loteId);
const portalLote = (id) => portal.lotes.find((l) => l.id === id);
const portalItem = (id) => portal.itens.find((i) => i.id === id);
const portalOrdenarTipos = (tipos) => [...(tipos || [])].sort((a, b) => PORTAL_ORDEM.indexOf(a) - PORTAL_ORDEM.indexOf(b));
const portalAliancas = (itens) => itens.reduce((s, i) => s + Math.max(1, (i.aneis || []).length), 0);
function portalPill(status) {
  const s = PORTAL_STATUS[status] || { t: status, k: 'done' };
  return `<span class="al-pill al-pill--${s.k}">${esc(s.t)}</span>`;
}
function portalVersaoAviso(i) {
  if (i.impressa_versao == null) return '<span class="al-pill al-pill--warn">Canhoto não impresso</span>';
  if (i.impressa_versao !== i.versao) return `<span class="al-pill al-pill--warn">v${i.versao} não impressa · papel pode estar na v${i.impressa_versao}</span>`;
  return '';
}
function portalPluralStatus(st, n) {
  const t = (PORTAL_STATUS[st]?.t || st).toLowerCase();
  return `${n} ${n > 1 && !t.startsWith('a ') ? t + 's' : t}`;
}

function portalAtualizarAba() {
  const nome = portal.clientes.length === 1 ? portal.clientes[0].nome : '';
  el('al-tab-portal-label').textContent = nome ? `Portal · ${nome}` : 'Portal';
  const pend = portal.itens.filter((i) => i.status === 'enviada').length;
  const c = el('al-portal-count');
  c.textContent = String(pend);
  c.hidden = !pend;
}

function portalBarra(itens) {
  const ordem = ['devolvida', 'concluida', 'recebida', 'enviada'];
  const n = itens.length || 1;
  const cont = {};
  itens.forEach((i) => { cont[i.status] = (cont[i.status] || 0) + 1; });
  const bar = ordem.filter((s) => cont[s]).map((s) => `<span class="al-pbar__s al-pbar__s--${PORTAL_STATUS[s].k}" style="width:${(cont[s] / n) * 100}%"></span>`).join('');
  const leg = ordem.filter((s) => cont[s]).map((s) => portalPluralStatus(s, cont[s])).join(' · ');
  return `<div class="al-pbar" aria-hidden="true">${bar}</div><div class="al-card__meta">${esc(leg)}</div>`;
}

function portalLoteCard(l) {
  const itens = portalItensDo(l.id);
  const recebido = l.recebido_em
    ? `<span class="al-badge">Chegou ${fmtDate(l.recebido_em)}</span>`
    : (l.status === 'enviado' ? '<span class="al-pill al-pill--info">A caminho</span>' : '');
  return `
    <article class="al-card al-plote">
      <div class="al-card__top">
        <span class="al-mono al-plote__cod">${esc(l.codigo)}</span>
        <span class="al-grow"></span>${recebido}
      </div>
      <div class="al-card__meta">${esc(portalCliente(l.cliente_id))} · fechado ${fmtDate(l.fechado_em)} · ${itens.length} troca${itens.length === 1 ? '' : 's'} · ${portalAliancas(itens)} aliança${portalAliancas(itens) === 1 ? '' : 's'}</div>
      ${portalBarra(itens)}
      <div class="al-card__foot"><span class="al-grow"></span><button class="al-btn al-btn--sm" data-portal-act="abrir-lote" data-id="${l.id}">Abrir pacote</button></div>
    </article>`;
}

function renderPortal() {
  portalAtualizarAba();
  const wrap = el('al-portal-body');
  if (!wrap) return;
  if (!portal.disponivel) {
    wrap.innerHTML = `<div class="al-empty"><p>O portal de trocas ainda não está ativo neste Supabase.</p>
      <p class="al-hint">Rode a migration <code>supabase/migrations/20261125120000_portal_trocas.sql</code> no SQL Editor. (${esc(portal.erro)})</p></div>`;
    return;
  }
  const ativos = portal.lotes.filter((l) => l.status === 'enviado');
  const devolvidos = portal.lotes.filter((l) => l.status === 'devolvido');
  wrap.innerHTML = `
    <section class="al-psec">
      <h3 class="al-psec__t">Pacotes em andamento <span class="al-count">${ativos.length}</span></h3>
      ${ativos.length ? `<div class="al-cards">${ativos.map(portalLoteCard).join('')}</div>`
        : '<div class="al-empty"><p>Nenhum pacote em andamento. Quando a cliente fechar um pacote, ele aparece aqui.</p></div>'}
    </section>
    ${devolvidos.length ? `<details class="al-psec al-psec--dev"><summary class="al-psec__t">Devolvidos <span class="al-count">${devolvidos.length}</span></summary>
      <div class="al-cards">${devolvidos.map(portalLoteCard).join('')}</div></details>` : ''}`;
}

/* Modal do pacote */
function portalAbrirLote(id) {
  const l = portalLote(id);
  if (!l) return;
  portalModal = { tipo: 'lote', id };
  const itens = portalItensDo(id);
  el('al-portal-modal-title').textContent = `Pacote ${l.codigo}`;
  el('al-portal-modal-body').innerHTML = `
    <div class="al-pmeta">
      <span>${esc(portalCliente(l.cliente_id))}</span>
      <span>Fechado ${fmtDate(l.fechado_em)}</span>
      <span>${l.recebido_em ? `Chegou ${fmtDate(l.recebido_em)}` : 'Ainda não chegou'}</span>
      <span>${itens.length} troca${itens.length === 1 ? '' : 's'} · ${portalAliancas(itens)} alianças</span>
    </div>
    ${portalBarra(itens)}
    <div class="al-pacoes">
      ${!l.recebido_em && l.status === 'enviado' ? `<button class="al-btn al-btn--primary" data-portal-act="lote-recebido" data-id="${l.id}">Marcar pacote como recebido</button>` : ''}
      <button class="al-btn" data-portal-act="devolver" data-id="${l.id}" id="al-portal-devolver" disabled>Devolver marcadas</button>
      <span class="al-hint">Marque as trocas concluídas que voltam para a cliente.</span>
    </div>
    <div class="al-plist">
      ${itens.map((i) => `
        <div class="al-prow">
          <input type="checkbox" class="al-pcheck" data-id="${i.id}" ${i.status === 'concluida' ? '' : 'disabled'} aria-label="Devolver ${esc(i.codigo)}" />
          <span class="al-mono">${esc(i.codigo)}</span>
          <span class="al-prow__main">
            <span class="al-prow__ref">${esc(i.referencia || 'Sem referência')}</span>
            <span class="al-card__meta">${i.peca === 'par' ? 'Par' : 'Avulsa'} · ${portalOrdenarTipos(i.tipos).map((k) => PORTAL_TIPOS[k]).join(', ')} · v${i.versao}</span>
          </span>
          <span class="al-prow__pills">${portalPill(i.status)}${i.status === 'enviada' ? portalVersaoAviso(i) : ''}</span>
          <button class="al-btn al-btn--sm" data-portal-act="abrir-item" data-id="${i.id}">${i.status === 'enviada' ? 'Conferir' : 'Abrir'}</button>
        </div>`).join('')}
    </div>`;
  el('al-modal-portal').hidden = false;
}

/* Modal da troca: conferir / concluir / devolver */
function portalTextoGravacao(g) {
  const txt = g.texto || '';
  if (!txt) return '<span class="al-hint">(desenho do anexo)</span>';
  return `<span class="al-pgrav">${esc(txt).split('\n').join('<span class="al-pret" title="quebra de linha">↵</span>\n')}</span>`;
}
function portalAneisHTML(i) {
  const temGrav = (i.tipos || []).some((k) => k === 'nova_gravacao' || k === 'regravacao');
  return `<table class="al-ptab"><thead><tr><th>Aliança</th><th>Aro</th><th>Gravação</th></tr></thead><tbody>${(i.aneis || []).map((a, ai) => {
    const nome = a.identificacao === 'masculina' ? 'Masculina' : 'Feminina';
    const trocaAro = (i.tipos || []).includes('troca_aro');
    const aro = a.aro_atual == null ? '?' : (trocaAro && a.aro_novo != null
      ? (a.aro_novo === a.aro_atual ? `${a.aro_atual} (mantém)` : `<b>${a.aro_atual} → ${a.aro_novo}</b>`)
      : `${a.aro_atual}`);
    const gravs = temGrav && (a.gravacoes || []).length
      ? a.gravacoes.map((g, gi) => `
          <div class="al-pgv">
            <div class="al-pgv__top"><span class="al-badge">${g.local === 'externa' ? 'Externa' : 'Interna'}</span>
              ${g.texto ? `<button class="al-link" data-portal-act="copiar" data-a="${ai}" data-g="${gi}">Copiar texto</button>` : ''}</div>
            ${portalTextoGravacao(g)}
            <div class="al-card__meta">Fonte: <b class="${(g.fonte || 'Arial') !== 'Arial' ? 'al-pdest' : ''}">${esc(g.texto ? (g.fonte || 'Arial') : '—')}</b></div>
            ${(g.anexos || []).length ? `<div class="al-panexos">${g.anexos.map((x) => `
              <a class="al-panexo" data-path="${esc(x.path)}" href="#" title="Baixar ${esc(x.nome)}">
                <span class="al-panexo__th" data-thumb="${esc(x.path)}" data-tipo="${esc(x.tipo || '')}">${String(x.tipo || '').startsWith('image/') ? '' : 'PDF'}</span>
                <span class="al-panexo__nm">${esc(x.nome)}</span>
              </a>`).join('')}</div>` : ''}
          </div>`).join('')
      : '<span class="al-hint">sem gravação</span>';
    return `<tr><td><b>${nome}</b>${a.pedra ? '<br><span class="al-pill al-pill--warn">com pedra</span>' : ''}</td><td>${aro}</td><td>${gravs}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function portalSeletoresSugeridos(i) {
  if (i.seletores_confirmados && i.seletores_confirmados.length) return new Set(i.seletores_confirmados.map(normLabel));
  const sug = new Set();
  (i.tipos || []).forEach((k) => (PORTAL_MAPA_SELETORES[k] || []).forEach((l) => sug.add(normLabel(l))));
  const troca = (i.tipos || []).some((k) => k === 'troca_aro' || k === 'troca_modelo');
  if (troca && !(i.tipos || []).includes('defeito')) sug.add(normLabel(PORTAL_SEM_DEFEITO));
  return sug;
}
function portalEventoTxt(ev) {
  const [acao, valor] = String(ev.acao || '').split(':');
  const status = { enviada: 'Fechou o pacote (troca enviada)', recebida: 'Conferiu e recebeu', concluida: 'Concluiu', devolvida: 'Devolveu', cancelada: 'Cancelou' };
  if (acao === 'criada') return 'Cadastrou a troca';
  if (acao === 'excluida') return 'Excluiu a troca';
  if (acao === 'versao') return `Alterou a troca depois de imprimir (virou v${valor})`;
  if (acao === 'impressa') return `Imprimiu o canhoto v${valor}`;
  if (acao === 'status') return status[valor] || `Status: ${valor}`;
  if (acao === 'alterada') return ev.da_cliente ? 'Alterou a troca' : 'Atualizou a conferência';
  return acao;
}

async function portalAbrirItem(id) {
  const i = portalItem(id) || (await portalBuscarItem({ id }));
  if (!i) return;
  const l = portalLote(i.lote_id);
  portalModal = { tipo: 'item', id: i.id };
  el('al-portal-modal-title').textContent = `Troca ${i.codigo}`;
  const body = el('al-portal-modal-body');
  const ativos = seletores.filter((s) => s.is_active);
  const sug = portalSeletoresSugeridos(i);
  const qtd = Math.max(1, (i.aneis || []).length);
  const voltar = l ? `<button class="al-link" data-portal-act="abrir-lote" data-id="${l.id}">← Pacote ${esc(l.codigo)}</button>` : '';

  let acao = '';
  if (i.status === 'enviada' || i.status === 'recebida') {
    acao += `
      <section class="al-pbox">
        <h4>${i.status === 'enviada' ? 'Conferir e receber' : 'Card nos Casos da semana'}</h4>
        <div class="al-field"><span>Tipo (seletores do card)</span>
          <div class="al-checks" id="al-portal-sel">${ativos.map((s) => {
            const on = sug.has(normLabel(s.label));
            return `<label class="al-check ${on ? 'is-checked' : ''}"><input type="checkbox" value="${esc(s.label)}" ${on ? 'checked' : ''}/>${esc(s.label)}</label>`;
          }).join('') || '<span class="al-hint">Nenhum seletor cadastrado.</span>'}</div></div>
        <label class="al-field al-field--qtd"><span>Quantidade de alianças</span><input type="number" id="al-portal-qtd" min="1" step="1" value="${qtd}" /></label>
        <button class="al-btn al-btn--primary" data-portal-act="receber" data-id="${i.id}">${i.status === 'enviada' ? 'Confirmar recebimento' : 'Atualizar card'}</button>
        ${i.status === 'enviada' ? '<span class="al-hint">Cria o card nos Casos da semana com estes seletores.</span>' : ''}
      </section>`;
  }
  if (i.status === 'recebida') {
    acao += `
      <section class="al-pbox">
        <h4>Concluir</h4>
        <label class="al-field"><span>O que foi feito <em>(a cliente vê no portal)</em></span>
          <textarea id="al-portal-nota" rows="3" placeholder="Ex.: Feminina ajustada para 17, masculina mantida.">${esc(i.nota_equipe || '')}</textarea></label>
        <label class="al-check ${i.divergencia ? 'is-checked' : ''}" style="align-self:flex-start"><input type="checkbox" id="al-portal-div" ${i.divergencia ? 'checked' : ''}/>Diferente do que a cliente descreveu</label>
        <label class="al-field" id="al-portal-div-box" ${i.divergencia ? '' : 'hidden'}><span>O que estava diferente <em>(a cliente vê)</em></span>
          <textarea id="al-portal-div-nota" rows="2">${esc(i.divergencia_nota || '')}</textarea></label>
        <button class="al-btn al-btn--primary" data-portal-act="concluir" data-id="${i.id}">Concluir troca</button>
      </section>`;
  }
  if (i.status === 'concluida' || i.status === 'devolvida') {
    acao += `
      <section class="al-pbox">
        <h4>${i.status === 'concluida' ? 'Concluída' : 'Devolvida'}</h4>
        ${i.nota_equipe ? `<p class="al-pnota">${esc(i.nota_equipe)}</p>` : '<p class="al-hint">Sem nota.</p>'}
        ${i.divergencia ? `<p class="al-pnota al-pnota--warn"><b>Diferente do descrito:</b> ${esc(i.divergencia_nota)}</p>` : ''}
        ${i.status === 'concluida' ? `<button class="al-btn al-btn--primary" data-portal-act="devolver-um" data-id="${i.id}">Devolver para a cliente</button>` : ''}
      </section>`;
  }

  body.innerHTML = `
    ${voltar}
    <div class="al-pmeta">
      ${portalPill(i.status)}
      <span>${esc(i.referencia || 'Sem referência')}</span>
      <span>${l ? esc(portalCliente(l.cliente_id)) : ''}</span>
    </div>
    <div class="al-pversao">
      <div><b>Versão atual: v${i.versao}</b> · salva em ${fmtDate(i.versao_em)} ${portalVersaoAviso(i)}</div>
      <div class="al-hint">Confira o rodapé do canhoto: ele deve dizer “Versão ${i.versao}”. Versão menor = papel desatualizado; a troca vale como está aqui.</div>
    </div>
    <div class="al-pgrid">
      <section class="al-pbox">
        <h4>O que a cliente pediu</h4>
        <dl class="al-pdl">
          <dt>Peça</dt><dd>${i.peca === 'par' ? 'Par' : 'Avulsa'}</dd>
          <dt>Tipo</dt><dd><div class="al-chips">${portalOrdenarTipos(i.tipos).map((k) => `<span class="al-chip">${esc(PORTAL_TIPOS[k])}</span>`).join('')}</div></dd>
          <dt>Modelo</dt><dd>${esc(i.modelo_atual)}${(i.tipos || []).includes('troca_modelo') && i.modelo_novo ? ` → <b>${esc(i.modelo_novo)}</b>` : ''}</dd>
          ${(i.tipos || []).includes('defeito') ? `<dt>Defeito</dt><dd>${esc(i.defeito_descricao)}</dd>` : ''}
          ${i.observacao ? `<dt>Obs.</dt><dd>${esc(i.observacao)}</dd>` : ''}
        </dl>
        ${portalAneisHTML(i)}
      </section>
      <div class="al-pcol">${acao}
        <section class="al-pbox">
          <h4>Histórico</h4>
          <ol class="al-ptl" id="al-portal-tl"><li class="al-hint">Carregando…</li></ol>
        </section>
      </div>
    </div>`;
  el('al-modal-portal').hidden = false;
  portalCarregarMiniaturas(body);
  portalCarregarHistorico(i);
}

async function portalCarregarHistorico(i) {
  const tl = el('al-portal-tl');
  try {
    const evs = await sbFetch(`/rest/v1/portal_eventos?item_id=eq.${i.id}&order=criado_em.asc&select=*`);
    const lote = await sbFetch(`/rest/v1/portal_eventos?lote_id=eq.${i.lote_id}&item_id=is.null&acao=eq.pacote_recebido&select=*`).catch(() => []);
    const lista = [...(evs || []), ...(lote || []).map((e) => ({ ...e, acao: 'pacote' }))]
      .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
    if (!tl || portalModal?.id !== i.id) return;
    tl.innerHTML = lista.length ? lista.map((e) => `
      <li><span class="al-ptl__q">${esc(e.autor_nome || (e.da_cliente ? 'Cliente' : 'Equipe'))}${e.da_cliente ? ' <span class="al-badge">cliente</span>' : ''}</span>
        <span>${esc(e.acao === 'pacote' ? 'Marcou o pacote como recebido' : portalEventoTxt(e))}</span>
        <span class="al-card__meta">${fmtDate(e.criado_em)}</span></li>`).join('')
      : '<li class="al-hint">Sem registros.</li>';
  } catch (e) {
    if (tl) tl.innerHTML = `<li class="al-hint">Não deu para carregar: ${esc(e.message)}</li>`;
  }
}

async function portalLinkAnexo(path) {
  const r = await sbFetch(`/storage/v1/object/sign/portal-anexos/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 3600 })
  });
  const u = r?.signedURL || r?.signedUrl;
  if (!u) throw new Error('Link do anexo indisponível.');
  return `${CFG.supabaseUrl}/storage/v1${u.startsWith('/') ? '' : '/'}${u}`;
}
function portalCarregarMiniaturas(root) {
  root.querySelectorAll('[data-thumb]').forEach(async (th) => {
    if (!String(th.dataset.tipo).startsWith('image/')) return;
    try {
      const url = await portalLinkAnexo(th.dataset.thumb);
      th.style.backgroundImage = `url("${url}")`;
    } catch (_) { th.textContent = '?'; }
  });
}

async function portalBuscarItem(filtro) {
  const q = filtro.id ? `id=eq.${filtro.id}` : `codigo=eq.${encodeURIComponent(filtro.codigo)}`;
  const rows = await sbFetch(`/rest/v1/portal_itens?${q}&select=*`);
  const i = rows?.[0];
  if (i && !portalItem(i.id)) portal.itens.push(i);
  return i || null;
}

async function portalBuscar(texto) {
  const m = String(texto || '').toUpperCase().match(PORTAL_CODIGO_RE);
  if (!m) { uiAlert('Código não reconhecido', 'Digite um código como TR-0042 ou TR-0042-03, ou leia o QR do canhoto.'); return; }
  const cod = m[0];
  if (/-\d{4,}-\d{2,}$/.test(cod)) {
    const i = portal.itens.find((x) => x.codigo === cod) || (await portalBuscarItem({ codigo: cod }).catch(() => null));
    if (i) { portalAbrirItem(i.id); return; }
    uiAlert('Troca não encontrada', `Nenhuma troca com o código ${cod}. Ela ainda pode estar no pacote aberto da cliente.`);
    return;
  }
  const l = portal.lotes.find((x) => x.codigo === cod);
  if (l) { portalAbrirLote(l.id); return; }
  uiAlert('Pacote não encontrado', `Nenhum pacote enviado com o código ${cod}.`);
}

async function portalRecarregar(reabrir = true) {
  await Promise.all([loadPortal(), loadCasos()]);
  renderCasos();
  renderPortal();
  if (reabrir && portalModal && !el('al-modal-portal').hidden) {
    if (portalModal.tipo === 'lote') portalAbrirLote(portalModal.id);
    else portalAbrirItem(portalModal.id);
  }
}

async function handlePortalAction(act, btn) {
  const id = btn.dataset.id;
  try {
    if (act === 'abrir-lote') return portalAbrirLote(id);
    if (act === 'abrir-item') return portalAbrirItem(id);
    if (act === 'copiar') {
      const i = portalItem(portalModal?.id);
      const g = i?.aneis?.[Number(btn.dataset.a)]?.gravacoes?.[Number(btn.dataset.g)];
      if (!g) return;
      try { await navigator.clipboard.writeText(g.texto || ''); btn.textContent = 'Copiado!'; }
      catch (_) { uiAlert('Copie o texto', g.texto || ''); }
      setTimeout(() => { btn.textContent = 'Copiar texto'; }, 1500);
      return;
    }
    if (act === 'lote-recebido') {
      btn.disabled = true;
      await sbFetch(`/rest/v1/portal_lotes?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ recebido_em: new Date().toISOString() })
      });
      setStatus('Pacote marcado como recebido.', 'success');
      return portalRecarregar();
    }
    if (act === 'receber') {
      const sel = [...el('al-portal-sel').querySelectorAll('input:checked')].map((x) => x.value);
      if (!sel.length) { uiAlert('Marque ao menos um seletor', 'O card nos Casos da semana precisa de um tipo.'); return; }
      const qtd = Math.max(1, parseInt(el('al-portal-qtd').value, 10) || 1);
      btn.disabled = true;
      await sbFetch('/rest/v1/rpc/portal_receber_item', {
        method: 'POST', body: JSON.stringify({ p_item: id, p_seletores: sel, p_quantidade: qtd })
      });
      setStatus('Troca recebida. O card está nos Casos da semana.', 'success');
      return portalRecarregar();
    }
    if (act === 'concluir') {
      const nota = el('al-portal-nota').value.trim();
      const div = el('al-portal-div').checked;
      const divNota = el('al-portal-div-nota').value.trim();
      if (!nota) { uiAlert('Escreva o que foi feito', 'A cliente vê essa nota no portal.'); return; }
      if (div && !divNota) { uiAlert('Explique a diferença', 'Escreva o que estava diferente do que a cliente descreveu.'); return; }
      btn.disabled = true;
      await sbFetch(`/rest/v1/portal_itens?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'concluida', nota_equipe: nota, divergencia: div, divergencia_nota: div ? divNota : '' })
      });
      setStatus('Troca concluída.', 'success');
      return portalRecarregar();
    }
    if (act === 'devolver-um' || act === 'devolver') {
      const ids = act === 'devolver-um' ? [id]
        : [...el('al-portal-modal-body').querySelectorAll('.al-pcheck:checked')].map((x) => x.dataset.id);
      if (!ids.length) return;
      if (!(await uiDialog({ title: `Devolver ${ids.length} troca${ids.length === 1 ? '' : 's'}?`, body: 'A cliente passa a ver como devolvida no portal.', confirmLabel: 'Devolver' }))) return;
      await sbFetch(`/rest/v1/portal_itens?id=in.(${ids.join(',')})`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'devolvida' })
      });
      setStatus(`${ids.length} troca${ids.length === 1 ? '' : 's'} devolvida${ids.length === 1 ? '' : 's'}.`, 'success');
      return portalRecarregar();
    }
  } catch (e) {
    btn.disabled = false;
    uiAlert('Não deu certo', e.message);
  }
}

function wirePortalEvents() {
  el('al-portal-busca').addEventListener('submit', (e) => {
    e.preventDefault();
    portalBuscar(el('al-portal-q').value);
    el('al-portal-q').select();
  });
  el('al-portal-camera').addEventListener('click', async () => {
    if (typeof window.lerQRCamera !== 'function') { uiAlert('Leitor indisponível', 'Digite o código do canhoto no campo de busca.'); return; }
    const lido = await window.lerQRCamera({ titulo: 'Ler o QR do canhoto' });
    if (!lido) return;
    el('al-portal-q').value = lido;
    portalBuscar(lido);
  });
  el('al-portal-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-portal-act]');
    if (b) handlePortalAction(b.dataset.portalAct, b);
  });
  const body = el('al-portal-modal-body');
  body.addEventListener('click', async (e) => {
    const anexo = e.target.closest('.al-panexo');
    if (anexo) {
      e.preventDefault();
      try { window.open(await portalLinkAnexo(anexo.dataset.path), '_blank', 'noopener'); }
      catch (err) { uiAlert('Não deu para abrir o anexo', err.message); }
      return;
    }
    const b = e.target.closest('[data-portal-act]');
    if (b) handlePortalAction(b.dataset.portalAct, b);
  });
  body.addEventListener('change', (e) => {
    if (e.target.classList.contains('al-pcheck')) {
      const algum = body.querySelector('.al-pcheck:checked');
      const dev = el('al-portal-devolver');
      if (dev) dev.disabled = !algum;
    }
    if (e.target.id === 'al-portal-div') {
      el('al-portal-div-box').hidden = !e.target.checked;
      e.target.closest('.al-check')?.classList.toggle('is-checked', e.target.checked);
    }
    const chk = e.target.closest('#al-portal-sel .al-check');
    if (chk) chk.classList.toggle('is-checked', e.target.checked);
  });
}

/* ── View switching ────────────────────────────────────────────────────── */
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.al-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  el('al-view-ativos').hidden = view !== 'ativos';
  el('al-view-historico').hidden = view !== 'historico';
  el('al-view-portal').hidden = view !== 'portal';
  document.querySelector('.al-toolbar').hidden = view === 'portal';
  el('al-counters').style.display = view === 'ativos' ? '' : 'none';
  if (view === 'historico') renderHistorico();
  if (view === 'portal') { renderPortal(); el('al-portal-q').focus(); }
}

/* ── Eventos ───────────────────────────────────────────────────────────── */
function wireEvents() {
  el('al-btn-novo').addEventListener('click', () => openCasoModal(null));
  el('al-btn-resumo').addEventListener('click', openResumo);
  el('al-btn-fechar').addEventListener('click', fecharSemana);
  el('al-btn-seletores').addEventListener('click', openSeletoresModal);
  el('al-btn-regras').addEventListener('click', openRegrasModal);
  el('al-form').addEventListener('submit', submitCaso);
  el('al-seletor-form').addEventListener('submit', submitSeletor);
  el('al-regra-form').addEventListener('submit', submitRegra);
  el('al-regra-cancel').addEventListener('click', resetRegraForm);

  el('al-resumo-copy').addEventListener('click', async () => {
    const txt = resumoTexto(casos, `Resumo de alianças — ${new Date().toLocaleDateString('pt-BR')}`);
    try {
      await navigator.clipboard.writeText(txt);
      el('al-resumo-copy').textContent = 'Copiado!';
      setTimeout(() => { el('al-resumo-copy').textContent = 'Copiar resumo'; }, 1800);
    } catch (_) { uiAlert('Copie o resumo', txt); }
  });

  // fechar modais
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  // checkbox visual toggle no form
  el('al-form-seletores').addEventListener('change', (e) => {
    const label = e.target.closest('.al-check');
    if (label) label.classList.toggle('is-checked', e.target.checked);
  });

  // delegação de ações nos cards
  el('al-cards').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-portal-item]');
    if (chip) { portalAbrirItem(chip.dataset.portalItem); return; }
    const btn = e.target.closest('[data-act]');
    if (btn) handleCardAction(btn.dataset.act, btn.dataset.id);
  });

  // ações de seletores
  const selList = el('al-seletores-list');
  selList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sel-act]');
    if (btn) handleSeletorAction(btn.dataset.selAct, btn.dataset.id);
  });
  // arraste para reordenar seletores
  const clearDropMarks = () => selList.querySelectorAll('.drop-before,.drop-after')
    .forEach((r) => r.classList.remove('drop-before', 'drop-after'));
  selList.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.al-seletor-row');
    if (!row) return;
    dragSeletorId = row.dataset.id;
    row.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  selList.addEventListener('dragend', () => {
    selList.querySelectorAll('.is-dragging').forEach((r) => r.classList.remove('is-dragging'));
    clearDropMarks();
    dragSeletorId = null;
  });
  selList.addEventListener('dragover', (e) => {
    const row = e.target.closest('.al-seletor-row');
    if (!row || row.dataset.id === dragSeletorId) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    clearDropMarks();
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  selList.addEventListener('drop', async (e) => {
    e.preventDefault();
    const row = e.target.closest('.al-seletor-row');
    clearDropMarks();
    if (!row || !dragSeletorId) return;
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const from = dragSeletorId;
    dragSeletorId = null;
    await reorderSeletores(from, row.dataset.id, after);
  });

  // ações de regras
  el('al-regras-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-regra-act]');
    if (btn) handleRegraAction(btn.dataset.regraAct, btn.dataset.id);
  });
  el('al-regra-seletores').addEventListener('change', (e) => {
    const label = e.target.closest('.al-check');
    if (label) label.classList.toggle('is-checked', e.target.checked);
  });

  // tabs
  document.querySelectorAll('.al-tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  wirePortalEvents();

  // atualiza ao voltar o foco (outro usuário pode ter mexido)
  window.addEventListener('focus', () => {
    if (currentView === 'ativos' || currentView === 'portal') refreshData();
  });
}

async function refreshData() {
  try {
    await Promise.all([loadCasos(), loadSeletores(), loadRegras(), loadPortal()]);
    renderCasos();
    renderPortal();
    if (currentView === 'historico') renderHistorico();
  } catch (e) {
    setStatus('Falha ao atualizar: ' + e.message, 'error');
  }
}

/* ── Tempo real (Supabase Realtime via WebSocket) ──────────────────────── */
let rtSocket = null;
let rtHeartbeat = null;
let rtReconnect = null;
let rtRefreshTimer = null;
let rtRef = 0;

function setConn(on) {
  const dot = el('al-conn');
  if (!dot) return;
  dot.className = 'al-conn ' + (on ? 'al-conn--on' : 'al-conn--off');
  dot.title = on ? 'Atualização em tempo real ativa' : 'Sem tempo real — reconectando…';
  const text = el('al-conn-text');
  if (text) text.textContent = on ? 'Ao vivo' : 'Reconectando…';
}
function rtSend(msg) {
  if (rtSocket && rtSocket.readyState === WebSocket.OPEN) rtSocket.send(JSON.stringify(msg));
}
function scheduleRealtimeRefresh() {
  clearTimeout(rtRefreshTimer);
  rtRefreshTimer = setTimeout(refreshData, 400); // agrupa rajadas (ex.: arquivar semana)
}
async function ensureFreshToken() {
  try {
    const payload = JSON.parse(atob((auth.token || '').split('.')[1] || ''));
    const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    if (exp && exp - Date.now() < 120000 && auth.refreshToken) await refreshSession();
  } catch (_) { /* segue com o token atual */ }
}
async function connectRealtime() {
  if (!auth.token) return;
  clearTimeout(rtReconnect);
  await ensureFreshToken();
  try { if (rtSocket) rtSocket.close(); } catch (_) {}

  const url = `${CFG.supabaseUrl.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${CFG.supabaseKey}&vsn=1.0.0`;
  const ws = new WebSocket(url);
  rtSocket = ws;

  ws.onopen = () => {
    rtRef += 1;
    const joinRef = String(rtRef);
    rtSend({
      topic: 'realtime:aliancas',
      event: 'phx_join',
      ref: joinRef,
      join_ref: joinRef,
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: '' },
          postgres_changes: [
            { event: '*', schema: 'public', table: 'aliancas_casos' },
            { event: '*', schema: 'public', table: 'aliancas_seletores' },
            { event: '*', schema: 'public', table: 'aliancas_resumo_regras' },
            // só com a migration do portal aplicada (senão o canal inteiro falha)
            ...(portal.disponivel ? [
              { event: '*', schema: 'public', table: 'portal_lotes' },
              { event: '*', schema: 'public', table: 'portal_itens' }
            ] : [])
          ]
        },
        access_token: auth.token
      }
    });
    clearInterval(rtHeartbeat);
    rtHeartbeat = setInterval(() => {
      rtRef += 1;
      rtSend({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(rtRef) });
    }, 25000);
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (msg.event === 'postgres_changes') {
      scheduleRealtimeRefresh();
    } else if (msg.event === 'phx_reply' && msg.topic === 'realtime:aliancas' && msg.payload?.status === 'ok') {
      setConn(true);
    }
  };

  ws.onclose = () => {
    clearInterval(rtHeartbeat);
    setConn(false);
    clearTimeout(rtReconnect);
    rtReconnect = setTimeout(connectRealtime, 3000); // reconexão automática
  };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

/* ── Init ──────────────────────────────────────────────────────────────── */
async function init() {
  const session = await getSession();
  if (!session?.access_token || !session?.user) {
    document.getElementById('al-app').innerHTML = `
      <div class="al-signin">
        <div class="al-signin__title">Entre na conta para ver as Trocas</div>
        <p>Numa aba do Mercado Livre, abra a Conta no dock da Sentinela (ou Alt+U) e entre. Esta página atualiza sozinha.</p>
        <button id="al-reload" class="al-btn">Recarregar</button>
      </div>`;
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes[HUB_SESSION_KEY]?.newValue) location.reload();
    });
    document.getElementById('al-reload')?.addEventListener('click', () => location.reload());
    return;
  }
  auth = { user: session.user, token: session.access_token, refreshToken: session.refresh_token || null };

  el('al-user-name').textContent = displayName();
  if (isAdmin()) {
    el('al-btn-seletores').hidden = false;
    el('al-btn-regras').hidden = false;
  }

  wireEvents();
  setStatus('Carregando…');
  try {
    await loadSeletores();
    await loadRegras();
    await loadCasos();
    await loadPortal();
    setStatus('');
    renderCasos();
    renderPortal();
    connectRealtime(); // atualização ao vivo entre os usuários
  } catch (e) {
    setStatus('Erro ao carregar dados: ' + e.message + ' — verifique se a migration foi aplicada no Supabase.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
