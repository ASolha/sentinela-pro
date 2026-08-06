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
async function refreshSession() {
  if (!auth.refreshToken) throw new Error('Sem refresh token.');
  const res = await fetch(`${CFG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey },
    body: JSON.stringify({ refresh_token: auth.refreshToken })
  });
  if (!res.ok) throw new Error('Sessão expirada. Faça login novamente pela extensão.');
  const data = await res.json();
  auth.token = data.access_token;
  auth.refreshToken = data.refresh_token;
  await saveSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: auth.user });
  return data;
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
  el('al-counters').innerHTML = `
    <div class="al-counter"><b>${casos.length}</b><span>casos</span></div>
    <div class="al-counter"><b>${totalAliancas}</b><span>alianças</span></div>
  `;
}

function chipsHTML(labels) {
  const ordered = orderLabels(labels);
  return (ordered && ordered.length)
    ? ordered.map((s) => `<span class="al-chip">${esc(s)}</span>`).join('')
    : '<span class="al-chip al-chip--none">Sem classificação</span>';
}

function cardHTML(c) {
  return `
    <article class="al-card" data-id="${c.id}">
      <div class="al-card__top">
        <div class="al-card__title ${c.titulo ? '' : 'is-empty'}">${c.titulo ? esc(c.titulo) : 'Sem título'}</div>
      </div>
      <div class="al-chips">${chipsHTML(c.seletores)}</div>
      <div class="al-card__qtd">Quantidade: <b>${Number(c.quantidade) || 1}</b> aliança(s)</div>
      ${c.observacao ? `<div class="al-card__obs">${esc(c.observacao)}</div>` : ''}
      <div class="al-card__meta">
        <span>${esc(c.created_by_name || '—')}</span>
        <span>${fmtDate(c.created_at)}</span>
      </div>
      <div class="al-card__actions">
        <button class="al-btn al-btn--sm al-btn--ghost" data-act="edit" data-id="${c.id}">Editar</button>
        <button class="al-btn al-btn--sm al-btn--danger" data-act="delete" data-id="${c.id}">Excluir</button>
      </div>
    </article>
  `;
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
          <span class="al-col__name">${esc(info.name)}${key === auth.user.id ? ' (você)' : ''}</span>
          <span class="al-col__count">${info.list.length} caso(s) · ${totalAl} aliança(s)</span>
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
        <span class="al-hist-caso__qtd">${Number(c.quantidade) || 1} aliança(s)</span>
      </div>
      <div class="al-chips">${chipsHTML(c.seletores)}</div>
      ${c.observacao ? `<div class="al-card__obs">${esc(c.observacao)}</div>` : ''}
      <div class="al-card__meta">
        <span>${esc(c.created_by_name || '—')}</span>
        <span>${fmtDate(c.created_at)}</span>
      </div>
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
  if (!confirm(`Excluir DEFINITIVAMENTE o histórico "${label}"?\n\nApaga ${ids.length} caso(s) arquivado(s) dessa semana. Não pode ser desfeito.`)) return;
  try {
    await sbFetch(`/rest/v1/aliancas_casos?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    setStatus(`Histórico "${label}" excluído.`, 'success');
    renderHistorico();
  } catch (e) {
    alert('Erro ao excluir o histórico: ' + e.message);
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
    if (!confirm('Excluir este caso definitivamente?')) return;
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
  let label = prompt(
    `Arquivar ${casos.length} caso(s) da semana.\n\nRótulo do lote:`, padrao);
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
    alert('Erro ao salvar a ordem: ' + e.message);
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
      if (!confirm(`Excluir o seletor "${s.label}"? Casos antigos que já o usam continuam intactos.`)) return;
      await deleteSeletor(id);
    }
    await loadSeletores();
    renderSeletoresList();
  } catch (e) {
    // se falhar por casos usando o label, orienta desativar
    alert('Não foi possível excluir agora (' + e.message + '). Use "Desativar".');
  }
}

// Renomeia um seletor e propaga o novo nome para os casos ATIVOS e as regras
// que o usam (arquivados mantêm o nome antigo — são registro histórico).
async function editSeletorLabel(s) {
  const novo = prompt('Editar nome do seletor:', s.label);
  if (novo === null) return;
  const label = novo.trim();
  if (!label || label === s.label) return;
  if (seletores.some((x) => String(x.id) !== String(s.id) && x.label.toLowerCase() === label.toLowerCase())) {
    alert('Já existe um seletor com esse nome.');
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
    alert('Erro ao editar o seletor: ' + e.message);
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
    alert('Esse seletor já existe.'); return;
  }
  try {
    await createSeletor(label);
    input.value = '';
    await loadSeletores();
    renderSeletoresList();
  } catch (err) {
    alert('Erro ao adicionar: ' + err.message);
  }
}

/* ── Modais util ───────────────────────────────────────────────────────── */
function closeModals() {
  el('al-modal').hidden = true;
  el('al-modal-resumo').hidden = true;
  el('al-modal-seletores').hidden = true;
  el('al-modal-regras').hidden = true;
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
      if (!confirm(`Excluir a regra "${regras[idx].label}"?`)) return;
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
    alert('Erro: ' + e.message);
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
  if (!label) { alert('Escreva o rótulo da regra.'); return; }
  if (!sel.length) { alert('Marque ao menos um seletor.'); return; }
  // duplicata: mesma combinação, ignorando a própria regra em edição
  if (regras.some((r) => String(r.id) !== String(editingRegraId) && setKey(r.seletores) === setKey(sel))) {
    alert('Já existe uma regra para essa combinação de seletores.'); return;
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
    alert('Erro ao salvar a regra: ' + err.message + '\n(Verifique se a migration de regras foi aplicada no Supabase.)');
  }
}

/* ── View switching ────────────────────────────────────────────────────── */
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.al-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  el('al-view-ativos').hidden = view !== 'ativos';
  el('al-view-historico').hidden = view !== 'historico';
  el('al-counters').style.display = view === 'ativos' ? '' : 'none';
  if (view === 'historico') renderHistorico();
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
    } catch (_) { alert(txt); }
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

  // atualiza ao voltar o foco (outro usuário pode ter mexido)
  window.addEventListener('focus', () => {
    if (currentView === 'ativos') refreshData();
  });
}

async function refreshData() {
  try {
    await Promise.all([loadCasos(), loadSeletores(), loadRegras()]);
    renderCasos();
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
            { event: '*', schema: 'public', table: 'aliancas_resumo_regras' }
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
      <div class="al-empty" style="padding-top:120px">
        <h2 style="margin:0">Você não está conectado</h2>
        <p>Abra a extensão Sentinela Pro em uma aba do Mercado Livre e faça login na sua conta do Hub. Depois recarregue esta página.</p>
        <button id="al-reload" class="al-btn al-btn--primary">Recarregar</button>
      </div>`;
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
    setStatus('');
    renderCasos();
    connectRealtime(); // atualização ao vivo entre os usuários
  } catch (e) {
    setStatus('Erro ao carregar dados: ' + e.message + ' — verifique se a migration foi aplicada no Supabase.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
