// ============================================================
//  SENTINELA PRO — content.js v1.0
//  Unificado: Sentinela Ranger + Passo Largo + Clip
// ============================================================

// ══════════════════════════════════════════════════════════════
// BARRA SUPERIOR CENTRALIZADA
// ══════════════════════════════════════════════════════════════

const PEGADOR_STORAGE_KEY = 'pegadorLastQuantity';
const ORDER_PICKER_TABLE = 'order_picker_history';
const HUB_PROFILE_TABLE = 'hub_user_profiles';
const HUB_SESSION_KEY = 'sp_hub_session';
const HUB_BUTTON_ORDER_KEY = 'sp_hub_button_order';
const HUB_DEFAULT_BUTTON_ORDER = ['passo', 'clip', 'counter', 'orders', 'gestor'];
const CFG = {
  supabaseUrl: 'https://dqiosohjicnruwrhxeou.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxaW9zb2hqaWNucnV3cmh4ZW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTI0NzcsImV4cCI6MjA4ODA2ODQ3N30.y5LVH3Lb9xDuHLDVvDaNCrzuS2RsJenI0EqgVtHBWfM'
};

let auth = { user: null, token: null, refreshToken: null };
let gestorPendencias = [];
let gestorLoading = false;
let gestorCapturedData = null;
let gestorLastCaptureUrl = '';
let gestorCurrentTab = 'pendencias';
let gestorHistoryFilter = '';
let gestorEmailSettings = { emailTo: '', emailCC: '' };
let gestorEmailSentIds = new Set();
let gestorCopiedIds = new Set();
let gestorArchivedIds = new Set();
let gestorFefrelloSentIds = new Set();
let gestorExpandedCardId = null;
let gestorPanelSavedPos = null;
let gestorPanelPositionLoaded = false;
let orderPickerCurrentView = 'picker';
let orderPickerHistoryCache = [];
let orderPickerHistoryLoaded = false;
let orderPickerHistoryLoading = false;
let hubProfilesCache = {};
let hubProfilesLoaded = false;

const GESTOR_IGNORE_MODEL_TERMS = [
  /pend[êe]ncia/i,
  /gestor/i,
  /observa[cç][õo]es/i,
  /nova pend[êe]ncia/i
];
const GESTOR_EMAIL_SETTINGS_KEY = 'sp_gestor_email_settings';
const GESTOR_CARD_STATUS_KEY = 'sp_gestor_card_status';
const GESTOR_FEFRELLO_CONFIG_KEY = 'sp_gestor_fefrello_config';
const GESTOR_FEFRELLO_CACHE_KEY = 'sp_gestor_fefrello_cache';
const GESTOR_PANEL_POSITION_KEY = 'sp_gestor_panel_pos';
const DEFAULT_GESTOR_EMAIL_TO = 'brunosims@gmail.com';
const GESTOR_FEFRELLO_API_BASE = 'https://southamerica-east1-fefrello.cloudfunctions.net';
const GESTOR_FEFRELLO_API_KEY = '708a34771f2659594502ed4b74cd634819a297d37e3fb2fa3cafdf826c286f16';
const GESTOR_FEFRELLO_CACHE_TTL = 24 * 60 * 60 * 1000;
const GESTOR_FEFRELLO_RESPONSAVEIS = ['Solha', 'Ti', 'Vitao', 'Brunao', 'Fe'];

function hasAuthSession() {
  return Boolean(auth.user && auth.token);
}

function saveSession(session) {
  return new Promise((resolve) => chrome.storage.local.set({ [HUB_SESSION_KEY]: session }, resolve));
}

function getSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(HUB_SESSION_KEY, (data) => resolve(data?.[HUB_SESSION_KEY] || null));
  });
}

function clearSession() {
  return new Promise((resolve) => chrome.storage.local.remove(HUB_SESSION_KEY, resolve));
}

async function signIn(email, password) {
  const res = await fetch(`${CFG.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: CFG.supabaseKey
    },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || 'Falha no login.');
  }

  return data;
}

async function signOut() {
  if (!auth.token) return;

  await fetch(`${CFG.supabaseUrl}/auth/v1/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: CFG.supabaseKey,
      Authorization: `Bearer ${auth.token}`
    }
  }).catch(() => {});
}

async function refreshSession() {
  if (!auth.refreshToken) {
    throw new Error('Sem refresh token.');
  }

  const res = await fetch(`${CFG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: CFG.supabaseKey
    },
    body: JSON.stringify({ refresh_token: auth.refreshToken })
  });

  if (!res.ok) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const data = await res.json();
  auth.token = data.access_token;
  auth.refreshToken = data.refresh_token;
  await saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: auth.user
  });

  return data;
}

async function sbFetch(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: CFG.supabaseKey,
    Authorization: `Bearer ${auth.token || CFG.supabaseKey}`,
    ...opts.headers
  };

  const res = await fetch(`${CFG.supabaseUrl}${path}`, { ...opts, headers });

  if (res.status === 401 && auth.refreshToken) {
    await refreshSession();
    headers.Authorization = `Bearer ${auth.token}`;
    const retry = await fetch(`${CFG.supabaseUrl}${path}`, { ...opts, headers });
    if (!retry.ok) {
      throw new Error(`HTTP ${retry.status}`);
    }
    return retry.status === 204 ? null : retry.json().catch(() => null);
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      message = payload.error_description || payload.message || payload.msg || message;
    } catch (_) {}
    if (typeof message === 'string' && (
      message.includes('passo_largo_user_data') ||
      message.includes(ORDER_PICKER_TABLE) ||
      message.includes('Could not find the table') ||
      message.includes('relation') ||
      message.includes('does not exist')
    )) {
      message = 'A tabela necessária ainda não existe no Supabase. Rode o SQL de criação primeiro.';
    }
    throw new Error(message);
  }

  return res.status === 204 ? null : res.json().catch(() => null);
}

function notifyAuthChanged() {
  syncAuthButton();
  document.dispatchEvent(new CustomEvent('sp:auth-changed', { detail: { user: auth.user } }));
}

async function restoreAuthSession() {
  const session = await getSession();
  if (!session?.access_token || !session?.user) {
    auth = { user: null, token: null, refreshToken: null };
    notifyAuthChanged();
    return false;
  }

  auth = {
    user: session.user,
    token: session.access_token,
    refreshToken: session.refresh_token || null
  };
  notifyAuthChanged();
  return true;
}

function normalizeHubDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeHubUserProfile(profile) {
  const userId = String(profile?.user_id || '').trim();
  if (!userId) return null;

  return {
    userId,
    displayName: normalizeHubDisplayName(profile?.display_name)
  };
}

async function loadHubUserProfiles(force = false) {
  if (!hasAuthSession()) {
    hubProfilesCache = {};
    hubProfilesLoaded = true;
    return hubProfilesCache;
  }

  if (hubProfilesLoaded && !force) return hubProfilesCache;

  const rows = await sbFetch(`/rest/v1/${HUB_PROFILE_TABLE}?select=user_id,display_name,updated_at`);
  const nextCache = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const normalized = normalizeHubUserProfile(row);
    if (normalized) nextCache[normalized.userId] = normalized;
  });

  hubProfilesCache = nextCache;
  hubProfilesLoaded = true;
  if (orderPickerHistoryCache.length) {
    orderPickerHistoryCache = normalizeOrderPickerHistory(orderPickerHistoryCache);
  }
  return hubProfilesCache;
}

function getHubUserDisplayName(userId = auth.user?.id, fallbackEmail = '') {
  const normalizedUserId = String(userId || '').trim();
  const profile = normalizedUserId ? hubProfilesCache[normalizedUserId] : null;
  if (profile?.displayName) return profile.displayName;

  if (normalizedUserId && normalizedUserId === String(auth.user?.id || '')) {
    const authDisplayName = normalizeHubDisplayName(
      auth.user?.user_metadata?.display_name
        || auth.user?.user_metadata?.full_name
        || auth.user?.user_metadata?.name
        || ''
    );
    if (authDisplayName) return authDisplayName;
    return normalizeHubDisplayName(auth.user?.email || fallbackEmail || 'Conta conectada');
  }

  return normalizeHubDisplayName(fallbackEmail || 'Usuário do Hub');
}

function getAuthUserDisplayName() {
  return getHubUserDisplayName(auth.user?.id, auth.user?.email || 'Conta conectada');
}

async function saveCurrentHubUserProfile(displayName) {
  if (!hasAuthSession()) {
    throw new Error('Faça login no Hub antes de salvar o nome de exibição.');
  }

  const normalized = normalizeHubDisplayName(displayName);
  if (!normalized) {
    throw new Error('Informe um nome de exibição.');
  }

  const payload = await sbFetch('/rest/v1/rpc/set_hub_display_name', {
    method: 'POST',
    body: JSON.stringify({
      p_display_name: normalized
    })
  });

  const normalizedProfile = normalizeHubUserProfile((Array.isArray(payload) ? payload[0] : payload) || {
    user_id: auth.user.id,
    display_name: normalized
  });

  if (normalizedProfile) {
    auth.user = {
      ...auth.user,
      user_metadata: {
        ...(auth.user?.user_metadata || {}),
        display_name: normalizedProfile.displayName,
        full_name: normalizedProfile.displayName,
        name: normalizedProfile.displayName
      }
    };
    hubProfilesCache[normalizedProfile.userId] = normalizedProfile;
    hubProfilesLoaded = true;
    if (orderPickerHistoryCache.length) {
      orderPickerHistoryCache = normalizeOrderPickerHistory(orderPickerHistoryCache);
    }
  }

  return normalizedProfile;
}

function formatGestorDate(dateString) {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return '';
  }
}

function escapeGestorValue(value) {
  return escapeHtml(String(value || ''));
}

function getGestorPageText() {
  return document.body?.innerText || '';
}

function getGestorLoginFromPage(pageText = '') {
  const loginCapturado = capturarLoginDoHTML();
  if (loginCapturado) return loginCapturado;

  const match = String(pageText || '').match(/([^\s|]+(?:\s+[^\s|]+)*)\s*\|\s*CPF\s*\d+/);
  return match ? match[1].trim() : '';
}

function isGestorParAlianca(pageText = '', modelo = '') {
  return /\bPar\s+Alian[cç]a\b/i.test(`${String(pageText || '')}\n${String(modelo || '')}`);
}

function buildGestorPairAros(aros = []) {
  const entries = Array.isArray(aros) ? aros : [];
  const masculino = entries.find((aro) => String(aro?.tipo || '').trim() === 'Masculino') || entries[0] || {};
  const feminino = entries.find((aro) => String(aro?.tipo || '').trim() === 'Feminino') || entries[1] || {};
  const masculinoNumero = clipRemoveComPedra(String(masculino?.numero || '').trim());
  const femininoNumero = String(feminino?.numero || '').trim();

  return [
    {
      label: 'Masculino',
      value: masculinoNumero,
      model: '',
      type: 'Masculino'
    },
    {
      label: 'Feminino',
      value: femininoNumero,
      model: '',
      type: 'Feminino'
    }
  ];
}

function captureGestorPageData() {
  const url = window.location.href;
  const pageText = getGestorPageText();
  const clipData = clipSanitizeCapturedData(capturarDados());
  const loginCliente = clipData?.login || getGestorLoginFromPage(pageText);

  let numeroVenda = '';
  const vendaMatch = pageText.match(/Venda\s*#\s*(\d+)/i);
  if (vendaMatch) {
    numeroVenda = vendaMatch[1];
  } else {
    const orderNode = document.querySelector('[data-testid="order-number"], .order-number, [class*="order-id"]');
    if (orderNode?.textContent) {
      numeroVenda = orderNode.textContent.replace(/[^0-9]/g, '');
    } else {
      const urlMatch = url.match(/[#?/](\d{8,})/);
      if (urlMatch) numeroVenda = urlMatch[1];
    }
  }

  const modelo = String(clipData?.modelo || '').trim();
  const clipAros = Array.isArray(clipData?.aros) ? clipData.aros : [];
  const aroCaptures = isGestorParAlianca(pageText, modelo)
    ? buildGestorPairAros(clipAros)
    : clipAros.map((aro, index) => {
        const tipo = String(aro?.tipo || '').trim();
        return {
          label: tipo || `Avulso ${index + 1}`,
          value: String(aro?.numero || '').trim(),
          model: String(aro?.modelo || modelo || '').trim(),
          type: tipo
        };
      });

  return {
    login_cliente: loginCliente,
    numero_venda: numeroVenda,
    modelo,
    url: clipData?.url || url,
    aro: buildGestorAroValue(aroCaptures)
  };
}

function hasGestorCapturedMeaningfulData(data) {
  return Boolean(data && (data.login_cliente || data.numero_venda || data.modelo || parseGestorAros(data.aro).length));
}

function getGestorCapturedPageData(force = false) {
  if (!force && gestorCapturedData && gestorLastCaptureUrl === window.location.href && gestorCapturedData.login_cliente) {
    const pageText = document.body?.innerText || '';
    const cachedAros = parseGestorAros(gestorCapturedData.aro || '');
    const cachedMissingStone = cachedAros.some((aro) => !clipTextHasComPedra(String(aro?.value || '')));
    if (!clipTextHasComPedra(pageText) || !cachedMissingStone) {
      return gestorCapturedData;
    }
  }

  const captured = captureGestorPageData();
  if (hasGestorCapturedMeaningfulData(captured) || force || !gestorCapturedData || gestorLastCaptureUrl !== window.location.href) {
    gestorCapturedData = captured;
    gestorLastCaptureUrl = window.location.href;
  }

  return gestorCapturedData || captured;
}

function fillGestorForm(panel, force = false) {
  if (!panel) return false;
  const data = getGestorCapturedPageData(force);
  if (!data) return false;

  const loginInput = panel.querySelector('#sp-gestor-login');
  const vendaInput = panel.querySelector('#sp-gestor-venda');
  const modeloInput = panel.querySelector('#sp-gestor-modelo');
  const urlInput = panel.querySelector('#sp-gestor-url');
  const obsInput = panel.querySelector('#sp-gestor-obs');
  const aroContainer = panel.querySelector('#sp-gestor-aro-fields');

  if (loginInput && (force || !loginInput.value.trim())) loginInput.value = data.login_cliente || '';
  if (vendaInput && (force || !vendaInput.value.trim())) vendaInput.value = data.numero_venda || '';
  if (modeloInput && (force || !modeloInput.value.trim())) modeloInput.value = data.modelo || '';
  if (urlInput && (force || !urlInput.value.trim())) urlInput.value = data.url || window.location.href;
  if (aroContainer) {
    const currentFields = Array.from(aroContainer.querySelectorAll('[data-gestor-aro-label]'));
    const hasFilledAro = currentFields.some((field) => String(field.value || '').trim());
    if (force || currentFields.length === 0 || !hasFilledAro) {
      aroContainer.innerHTML = renderGestorAroFields(parseGestorAros(data.aro), 'form');
    }
  }
  if (obsInput && force && !obsInput.value.trim()) {
    obsInput.value = '';
  }

  return Boolean(data.login_cliente || data.numero_venda || data.modelo || parseGestorAros(data.aro).length);
}

function hasGestorDuplicateVenda(numeroVenda, excludeId = null) {
  const target = String(numeroVenda || '').trim();
  if (!target) return false;
  return gestorPendencias.some((item) =>
    String(item.numero_venda || '').trim() === target &&
    (excludeId == null || String(item.id) !== String(excludeId))
  );
}

function getGestorScopedUserId() {
  return auth.user?.id || '';
}

function getGestorPendenciaById(id) {
  return gestorPendencias.find((item) => String(item.id) === String(id)) || null;
}

function getGestorVisiblePendencias(tab = gestorCurrentTab) {
  const items = tab === 'historico'
    ? gestorPendencias.filter((item) => gestorArchivedIds.has(String(item.id)))
    : gestorPendencias.filter((item) => !gestorArchivedIds.has(String(item.id)));

  const filter = String(gestorHistoryFilter || '').trim().toLowerCase();
  if (tab !== 'historico' || !filter) return items;

  return items.filter((item) => {
    const haystack = [
      item.login_cliente,
      item.numero_venda,
      item.modelo,
      item.aro,
      item.observacoes,
      item.url
    ].join(' ').toLowerCase();
    return haystack.includes(filter);
  });
}

function getGestorActiveCount() {
  return getGestorVisiblePendencias('pendencias').length;
}

function getGestorArchivedCount() {
  return gestorPendencias.filter((item) => gestorArchivedIds.has(String(item.id))).length;
}

function normalizeGestorEmailSettings(settings) {
  return {
    emailTo: (settings?.emailTo || DEFAULT_GESTOR_EMAIL_TO).trim(),
    emailCC: (settings?.emailCC || '').trim()
  };
}

function buildGestorSingleEmailHtml(pendencia, date = new Date().toLocaleDateString('pt-BR')) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#222;border-bottom:3px solid #FFE600;padding-bottom:8px;">
        Pendência - ${escapeGestorValue(pendencia.login_cliente) || 'Cliente'}
      </h2>
      <p style="color:#666;margin-bottom:16px;">Data: <strong>${date}</strong></p>
      ${gestorCardToRichHtml(pendencia)}
    </div>`;
}

function buildGestorConsolidatedEmailHtml(items, date = new Date().toLocaleDateString('pt-BR')) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#222;border-bottom:3px solid #FFE600;padding-bottom:8px;">
        Pendências em Aberto - ${date}
      </h2>
      <p style="color:#666;margin-bottom:16px;">Total: <strong>${items.length}</strong> pendência(s)</p>
      ${items.map((item, index) =>
        `${index > 0 ? '<hr style="border:none;border-top:1px solid #eee;margin:12px 0;" />' : ''}${gestorCardToRichHtml(item)}`
      ).join('')}
    </div>`;
}

function gestorHtmlToPlainText(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.innerText || container.textContent || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function copyGestorHtml(html) {
  const plain = gestorHtmlToPlainText(html);
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        })
      ]);
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(plain);
      return;
    }
  } catch (_) {}

  const textarea = document.createElement('textarea');
  textarea.value = plain;
  textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function parseGestorAros(aroStr) {
  if (!aroStr) return [];
  try {
    const parsed = JSON.parse(aroStr);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item, index) => ({
          label: String(item?.label || item?.tipo || `Aro ${index + 1}`),
          value: String(item?.value ?? item?.numero ?? '').trim(),
          model: String(item?.model ?? item?.modelo ?? '').trim(),
          type: String(item?.type ?? item?.tipo ?? '').trim()
        }))
        .filter((item) => item.label || item.value || item.model);
    }
  } catch (_) {}
  return [{ label: 'Aro 1', value: String(aroStr).trim() }];
}

function buildGestorAroValue(entries) {
  const sanitized = entries
    .map((entry, index) => ({
      label: String(entry?.label || `Aro ${index + 1}`),
      value: String(entry?.value || '').trim(),
      model: String(entry?.model || '').trim(),
      type: String(entry?.type || '').trim()
    }))
    .filter((entry) => entry.label || entry.value || entry.model);
  return sanitized.length ? JSON.stringify(sanitized) : '';
}

function renderGestorAroFields(entries, scope = 'form') {
  const items = entries.length ? entries : [{ label: 'Aro 1', value: '' }];
  return items.map((entry, index) => `
    <label class="sp-gestor-edit-field sp-gestor-aro-field">
      <span>${escapeGestorValue(entry.label || `Aro ${index + 1}`)}</span>
      ${entry.model || /^Avulso\s+\d+/i.test(entry.label || '') ? `
        <input
          type="text"
          data-gestor-aro-model="${escapeGestorValue(entry.label || `Aro ${index + 1}`)}"
          data-gestor-aro-scope="${scope}"
          value="${escapeGestorValue(entry.model || '')}"
          placeholder="Modelo do avulso"
        />
      ` : ''}
      <input
        type="text"
        data-gestor-aro-label="${escapeGestorValue(entry.label || `Aro ${index + 1}`)}"
        data-gestor-aro-type="${escapeGestorValue(entry.type || '')}"
        data-gestor-aro-scope="${scope}"
        value="${escapeGestorValue(entry.value || '')}"
        placeholder="Informe o aro"
      />
    </label>
  `).join('');
}

function collectGestorArosFromScope(scope) {
  return Array.from(scope.querySelectorAll('[data-gestor-aro-label]')).map((field, index) => ({
    label: field.dataset.gestorAroLabel || `Aro ${index + 1}`,
    value: field.value || '',
    model: field.closest('.sp-gestor-aro-field')?.querySelector('[data-gestor-aro-model]')?.value || '',
    type: field.dataset.gestorAroType || ''
  }));
}

async function fefrelloFetch(endpoint, options = {}) {
  const response = await fetch(`${GESTOR_FEFRELLO_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'x-api-key': GESTOR_FEFRELLO_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Erro na API Fefrello');
  return json;
}

function saveGestorFefrelloCache(data) {
  return new Promise((resolve) => chrome.storage.local.set({
    [GESTOR_FEFRELLO_CACHE_KEY]: { ...data, timestamp: Date.now() }
  }, resolve));
}

function loadGestorFefrelloCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get([GESTOR_FEFRELLO_CACHE_KEY], (result) => {
      const cache = result?.[GESTOR_FEFRELLO_CACHE_KEY];
      resolve(cache && (Date.now() - cache.timestamp) < GESTOR_FEFRELLO_CACHE_TTL ? cache : null);
    });
  });
}

async function loadGestorFefrelloBoards(forceRefresh = false) {
  if (!forceRefresh) {
    const cache = await loadGestorFefrelloCache();
    if (cache?.boards) return cache.boards;
  }
  const response = await fefrelloFetch('/listBoards');
  const boards = response.data || [];
  const current = (await loadGestorFefrelloCache()) || {};
  await saveGestorFefrelloCache({ ...current, boards });
  return boards;
}

async function loadGestorFefrelloColumns(boardId, forceRefresh = false) {
  if (!forceRefresh) {
    const cache = await loadGestorFefrelloCache();
    if (cache?.columns?.[boardId]) return cache.columns[boardId];
  }
  const response = await fefrelloFetch(`/listColumns?boardId=${boardId}`);
  const columns = response.data || [];
  const current = (await loadGestorFefrelloCache()) || {};
  const byBoard = current.columns || {};
  byBoard[boardId] = columns;
  await saveGestorFefrelloCache({ ...current, columns: byBoard });
  return columns;
}

function saveGestorFefrelloConfig(config) {
  return new Promise((resolve) => {
    chrome.storage.local.get([GESTOR_FEFRELLO_CONFIG_KEY], (result) => {
      const scoped = result?.[GESTOR_FEFRELLO_CONFIG_KEY] || {};
      const userId = getGestorScopedUserId();
      if (!userId) {
        resolve();
        return;
      }
      scoped[userId] = config;
      chrome.storage.local.set({ [GESTOR_FEFRELLO_CONFIG_KEY]: scoped }, resolve);
    });
  });
}

function loadGestorFefrelloConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([GESTOR_FEFRELLO_CONFIG_KEY], (result) => {
      const scoped = result?.[GESTOR_FEFRELLO_CONFIG_KEY] || {};
      resolve(scoped[getGestorScopedUserId()] || null);
    });
  });
}

async function createGestorFefrelloCard(boardId, columnId, title, description, responsible) {
  const body = { boardId, columnId, title };
  if (description) body.description = description;
  if (responsible) body.responsible = responsible;
  return fefrelloFetch('/createCardEndpoint', { method: 'POST', body: JSON.stringify(body) });
}

function formatGestorCardForFefrello(pendencia) {
  const lines = [];
  if (pendencia.url) lines.push(pendencia.url);
  if (pendencia.modelo) lines.push(`Modelo: ${pendencia.modelo}`);
  parseGestorAros(pendencia.aro).forEach((aro) => {
    if (aro.model && /^Avulso\s+\d+/i.test(aro.label || '')) lines.push(`Modelo ${aro.label}: ${aro.model}`);
    if (aro.value) lines.push(`${aro.label}: ${aro.value}`);
  });
  if (pendencia.numero_venda) lines.push(`Venda #${pendencia.numero_venda}`);
  if (pendencia.observacoes) lines.push(`\n${pendencia.observacoes}`);
  return lines.join('\n');
}

function getGestorStorageArea(areaName) {
  const namedArea = chrome?.storage?.[areaName];
  if (namedArea?.get && namedArea?.set) return namedArea;

  const localArea = chrome?.storage?.local;
  if (localArea?.get && localArea?.set) return localArea;

  return null;
}

function getGestorScopedStorage(key, areaName = 'local') {
  return new Promise((resolve) => {
    const storageArea = getGestorStorageArea(areaName);
    if (!storageArea?.get) {
      console.warn(`[Sentinela Pro] chrome.storage.${areaName} indisponível; usando objeto vazio.`);
      resolve({});
      return;
    }

    storageArea.get([key], (result) => {
      if (chrome.runtime?.lastError) {
        console.warn(`[Sentinela Pro] Falha ao ler ${key} em chrome.storage.${areaName}:`, chrome.runtime.lastError.message);
        resolve({});
        return;
      }
      resolve(result?.[key] || {});
    });
  });
}

function setGestorScopedStorage(key, value, areaName = 'local') {
  return new Promise((resolve) => {
    const storageArea = getGestorStorageArea(areaName);
    if (!storageArea?.set) {
      console.warn(`[Sentinela Pro] chrome.storage.${areaName} indisponível; gravação ignorada para ${key}.`);
      resolve();
      return;
    }

    storageArea.set({ [key]: value }, () => {
      if (chrome.runtime?.lastError) {
        console.warn(`[Sentinela Pro] Falha ao salvar ${key} em chrome.storage.${areaName}:`, chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

function normalizeGestorCardStatusData(data) {
  return {
    emailSentIds: Array.isArray(data?.emailSentIds) ? data.emailSentIds.map(String) : [],
    copiedIds: Array.isArray(data?.copiedIds) ? data.copiedIds.map(String) : [],
    archivedIds: Array.isArray(data?.archivedIds) ? data.archivedIds.map(String) : [],
    fefrelloSentIds: Array.isArray(data?.fefrelloSentIds) ? data.fefrelloSentIds.map(String) : []
  };
}

async function loadGestorEmailSettings() {
  const userId = getGestorScopedUserId();
  if (!userId) return normalizeGestorEmailSettings(null);

  const [syncScoped, localScoped] = await Promise.all([
    getGestorScopedStorage(GESTOR_EMAIL_SETTINGS_KEY, 'sync'),
    getGestorScopedStorage(GESTOR_EMAIL_SETTINGS_KEY, 'local')
  ]);

  const syncValue = syncScoped?.[userId] || null;
  const localValue = localScoped?.[userId] || null;
  const selected = syncValue || localValue || null;

  if (selected) {
    if (!syncValue) {
      syncScoped[userId] = selected;
      await setGestorScopedStorage(GESTOR_EMAIL_SETTINGS_KEY, syncScoped, 'sync');
    }
    if (!localValue) {
      localScoped[userId] = selected;
      await setGestorScopedStorage(GESTOR_EMAIL_SETTINGS_KEY, localScoped, 'local');
    }
  }

  return normalizeGestorEmailSettings(selected);
}

async function saveGestorEmailSettings(settings) {
  const userId = getGestorScopedUserId();
  if (!userId) return;

  const normalized = normalizeGestorEmailSettings(settings);
  const [syncScoped, localScoped] = await Promise.all([
    getGestorScopedStorage(GESTOR_EMAIL_SETTINGS_KEY, 'sync'),
    getGestorScopedStorage(GESTOR_EMAIL_SETTINGS_KEY, 'local')
  ]);

  syncScoped[userId] = normalized;
  localScoped[userId] = normalized;

  await Promise.all([
    setGestorScopedStorage(GESTOR_EMAIL_SETTINGS_KEY, syncScoped, 'sync'),
    setGestorScopedStorage(GESTOR_EMAIL_SETTINGS_KEY, localScoped, 'local')
  ]);
}

async function loadGestorCardStatus() {
  const userId = getGestorScopedUserId();
  if (!userId) {
    gestorEmailSentIds = new Set();
    gestorCopiedIds = new Set();
    gestorArchivedIds = new Set();
    gestorFefrelloSentIds = new Set();
    return;
  }

  const [syncScoped, localScoped] = await Promise.all([
    getGestorScopedStorage(GESTOR_CARD_STATUS_KEY, 'sync'),
    getGestorScopedStorage(GESTOR_CARD_STATUS_KEY, 'local')
  ]);

  const syncValue = syncScoped?.[userId] || null;
  const localValue = localScoped?.[userId] || null;
  const selected = normalizeGestorCardStatusData(syncValue || localValue || {});

  if (syncValue || localValue) {
    if (!syncValue) {
      syncScoped[userId] = selected;
      await setGestorScopedStorage(GESTOR_CARD_STATUS_KEY, syncScoped, 'sync');
    }
    if (!localValue) {
      localScoped[userId] = selected;
      await setGestorScopedStorage(GESTOR_CARD_STATUS_KEY, localScoped, 'local');
    }
  }

  gestorEmailSentIds = new Set(selected.emailSentIds);
  gestorCopiedIds = new Set(selected.copiedIds);
  gestorArchivedIds = new Set(selected.archivedIds);
  gestorFefrelloSentIds = new Set(selected.fefrelloSentIds);
}

async function saveGestorCardStatus() {
  const userId = getGestorScopedUserId();
  if (!userId) return;

  const nextStatus = {
    emailSentIds: [...gestorEmailSentIds],
    copiedIds: [...gestorCopiedIds],
    archivedIds: [...gestorArchivedIds],
    fefrelloSentIds: [...gestorFefrelloSentIds]
  };

  const [syncScoped, localScoped] = await Promise.all([
    getGestorScopedStorage(GESTOR_CARD_STATUS_KEY, 'sync'),
    getGestorScopedStorage(GESTOR_CARD_STATUS_KEY, 'local')
  ]);

  syncScoped[userId] = nextStatus;
  localScoped[userId] = nextStatus;

  await Promise.all([
    setGestorScopedStorage(GESTOR_CARD_STATUS_KEY, syncScoped, 'sync'),
    setGestorScopedStorage(GESTOR_CARD_STATUS_KEY, localScoped, 'local')
  ]);
}

async function loadGestorLocalState() {
  if (!hasAuthSession()) {
    gestorEmailSettings = normalizeGestorEmailSettings(null);
    gestorEmailSentIds = new Set();
    gestorCopiedIds = new Set();
    gestorArchivedIds = new Set();
    gestorFefrelloSentIds = new Set();
    return;
  }
  gestorEmailSettings = await loadGestorEmailSettings();
  await loadGestorCardStatus();
}

function gestorCardToEmailHtml(p) {
  const cellLabel = 'style="padding:4px 8px;color:#64748b;width:38%;vertical-align:top"';
  const cellValue = 'style="padding:4px 8px;vertical-align:top;color:#111827"';
  return `
    <div style="font-family:Arial,sans-serif;border:1px solid #e5e7eb;border-radius:10px;padding:16px;max-width:560px;background:#ffffff;">
      <h3 style="margin:0 0 10px;color:#111827;border-bottom:3px solid #facc15;padding-bottom:8px;font-size:15px;">
        ${escapeGestorValue(p.login_cliente) || '(sem login)'}
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td ${cellLabel}><b>Nº da Venda:</b></td><td ${cellValue}>${escapeGestorValue(p.numero_venda) || '—'}</td></tr>
        <tr><td ${cellLabel}><b>Modelo:</b></td><td ${cellValue}>${escapeGestorValue(p.modelo) || '—'}</td></tr>
        ${p.observacoes ? `<tr><td ${cellLabel}><b>Observações:</b></td><td ${cellValue}>${escapeGestorValue(p.observacoes)}</td></tr>` : ''}
        ${p.url ? `<tr><td ${cellLabel}><b>Link da venda:</b></td><td ${cellValue}><a href="${escapeGestorValue(p.url)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">Abrir venda</a></td></tr>` : ''}
      </table>
    </div>
  `;
}

function gestorCardToRichHtml(p) {
  const cellLabel = 'style="padding:4px 8px;color:#64748b;width:38%;vertical-align:top"';
  const cellValue = 'style="padding:4px 8px;vertical-align:top;color:#111827"';
  const aroRows = parseGestorAros(p.aro)
    .flatMap((aro) => {
      const rows = [];
      if (aro.model && /^Avulso\s+\d+/i.test(aro.label || '')) {
        rows.push(`<tr><td ${cellLabel}><b>Modelo ${escapeGestorValue(aro.label)}:</b></td><td ${cellValue}>${escapeGestorValue(aro.model)}</td></tr>`);
      }
      if (aro.value) {
        rows.push(`<tr><td ${cellLabel}><b>${escapeGestorValue(aro.label)}:</b></td><td ${cellValue}>${escapeGestorValue(aro.value)}</td></tr>`);
      }
      return rows;
    })
    .join('');
  return `
    <div style="font-family:Arial,sans-serif;border:1px solid #e5e7eb;border-radius:10px;padding:16px;max-width:560px;background:#ffffff;">
      <h3 style="margin:0 0 10px;color:#111827;border-bottom:3px solid #facc15;padding-bottom:8px;font-size:15px;">
        ${escapeGestorValue(p.login_cliente) || '(sem login)'}
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td ${cellLabel}><b>Venda:</b></td><td ${cellValue}>${escapeGestorValue(p.numero_venda) || '-'}</td></tr>
        <tr><td ${cellLabel}><b>Modelo:</b></td><td ${cellValue}>${escapeGestorValue(p.modelo) || '-'}</td></tr>
        ${aroRows}
        ${p.observacoes ? `<tr><td ${cellLabel}><b>Observações:</b></td><td ${cellValue}>${escapeGestorValue(p.observacoes)}</td></tr>` : ''}
        ${p.url ? `<tr><td ${cellLabel}><b>Link da venda:</b></td><td ${cellValue}><a href="${escapeGestorValue(p.url)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">Abrir venda</a></td></tr>` : ''}
      </table>
    </div>
  `;
}

function getGestorGmailToken() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_GMAIL_TOKEN' }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response.token);
    });
  });
}

async function sendGestorEmail(subject, html) {
  const token = await getGestorGmailToken();
  const settings = normalizeGestorEmailSettings(gestorEmailSettings);
  const subjectEncoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const rawLines = [
    `To: ${settings.emailTo}`,
    settings.emailCC ? `Cc: ${settings.emailCC}` : null,
    `Subject: ${subjectEncoded}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(html)))
  ].filter((value) => value !== null);
  const raw = rawLines.join('\r\n');
  const encodedRaw = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: encodedRaw })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gmail API: HTTP ${res.status}`);
  }
  return res.json();
}

function buildGestorEmailSubject(loginCliente, date) {
  return `${String(loginCliente || 'Cliente').trim() || 'Cliente'} - B.O. - ${date}`;
}

async function loadGestorPendencias() {
  if (!hasAuthSession()) {
    gestorPendencias = [];
    gestorLoading = false;
    syncGestorButton();
    renderGestorPanelContent(document.getElementById('sp-gestor-panel'));
    return;
  }

  gestorLoading = true;
  renderGestorPanelContent(document.getElementById('sp-gestor-panel'));
  try {
    const rows = await sbFetch(`/rest/v1/pendencias?user_id=eq.${auth.user.id}&order=created_at.desc&select=*`);
    gestorPendencias = Array.isArray(rows) ? rows : [];
  } finally {
    gestorLoading = false;
    syncGestorButton();
    renderGestorPanelContent(document.getElementById('sp-gestor-panel'));
  }
}

async function createGestorPendencia(fields) {
  const rows = await sbFetch('/rest/v1/pendencias', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      user_id: auth.user.id,
      ...fields
    })
  });

  return rows?.[0] || null;
}

async function updateGestorPendencia(id, fields) {
  await sbFetch(`/rest/v1/pendencias?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      ...fields,
      updated_at: new Date().toISOString()
    })
  });
}

async function deleteGestorPendencia(id) {
  await sbFetch(`/rest/v1/pendencias?id=eq.${id}`, {
    method: 'DELETE'
  });
}

function createTopBar() {
  if (document.getElementById('sp-topbar')) return;
  const bar = document.createElement('div');
  bar.id = 'sp-topbar';
  applyHubTheme(bar);

  const iconPasso = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    <line x1="9" y1="10" x2="15" y2="10" stroke-width="1.8"/>
    <line x1="9" y1="13" x2="13" y2="13" stroke-width="1.8"/>
  </svg>`;

  const iconClip = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
    <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
    <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
    <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
    <rect x="7" y="7" width="10" height="10" rx="1"/>
  </svg>`;

  // ícone de abas do navegador (browser tabs)
  const iconCounter = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2"/>
    <path d="M2 11h20"/>
    <path d="M6 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>`;

  const iconOrders = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 6h15"/>
    <path d="M6 12h15"/>
    <path d="M6 18h15"/>
    <path d="M3 6h.01"/>
    <path d="M3 12h.01"/>
    <path d="M3 18h.01"/>
  </svg>`;

  const iconAccount = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>`;

  const iconGestor = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
    <path d="m3.3 7 8.7 5 8.7-5"/>
    <path d="M12 22V12"/>
  </svg>`;

  bar.innerHTML = `
    <button id="sp-btn-passo"   class="sp-btn" title="Mensagem Rápida (Alt+M)">${iconPasso}</button>
    <div class="sp-sep"></div>
    <button id="sp-btn-clip"    class="sp-btn" title="Capturar Dados (Alt+C)">${iconClip}</button>
    <div class="sp-sep"></div>
    <button id="sp-btn-counter" class="sp-btn" title="Abas ML abertas — clique para recarregar (Alt+R)">
      ${iconCounter}
      <span class="sp-counter-badge" id="sp-counter-badge"></span>
    </button>
    <div class="sp-sep"></div>
    <button id="sp-btn-orders" class="sp-btn" title="Pegador de Pedidos (Alt+P)">${iconOrders}</button>
    <div class="sp-sep"></div>
    <button id="sp-btn-gestor" class="sp-btn" title="Gestor de Pendências (Alt+G)">
      ${iconGestor}
      <span class="sp-gestor-badge" id="sp-gestor-badge"></span>
    </button>
    <div class="sp-sep"></div>
    <button id="sp-btn-auth" class="sp-btn" title="Conta do Hub (Alt+U)">
      ${iconAccount}
      <span class="sp-auth-badge" id="sp-auth-badge"></span>
    </button>
  `;
  document.body.appendChild(bar);

  const btnPasso   = bar.querySelector('#sp-btn-passo');
  const btnClip    = bar.querySelector('#sp-btn-clip');
  const btnCounter = bar.querySelector('#sp-btn-counter');
  const btnOrders  = bar.querySelector('#sp-btn-orders');
  const btnGestor  = bar.querySelector('#sp-btn-gestor');
  const btnAuth    = bar.querySelector('#sp-btn-auth');

  function animateCounterRefreshButton() {
    if (!btnCounter) return;
    btnCounter.classList.remove('sp-spinning');
    void btnCounter.offsetWidth;
    btnCounter.classList.add('sp-spinning');
  }

  btnCounter?.addEventListener('animationend', (event) => {
    if (event.animationName === 'sp-counter-spin') {
      btnCounter.classList.remove('sp-spinning');
    }
  });

  // ── Button handlers ──────────────────────────────────────────

  // Passo Largo — toggle
  btnPasso.addEventListener('click', () => {
    const isVisible = document.getElementById('mr-panel')?.classList.contains('visible');
    togglePanel();
    btnPasso.classList.toggle('sp-active', !isVisible);
  });

  // Clip — toggle
  btnClip.addEventListener('click', () => {
    const overlay = document.getElementById('extensao-popup-overlay');
    if (overlay) {
      overlay.remove();
      btnClip.classList.remove('sp-active');
    } else {
      mostrarPopup().catch((error) => {
        console.error('[Sentinela Pro] Erro ao abrir o clip:', error);
        mostrarNotificacao('Erro ao abrir a interface', 'error');
      });
      btnClip.classList.add('sp-active');
    }
  });

  // Counter — recarrega todas as abas ML relevantes
  btnCounter.addEventListener('click', () => {
    if (btnCounter.dataset.refreshing === 'true') return;
    btnCounter.dataset.refreshing = 'true';
    animateCounterRefreshButton();
    chrome.runtime.sendMessage({ action: 'refreshAllTabs' }, (r) => {
      btnCounter.dataset.refreshing = 'false';
      if (r?.success) {
        mostrarNotificacao(`${r.count} aba${r.count !== 1 ? 's' : ''} recarregada${r.count !== 1 ? 's' : ''}!`);
      }
    });
  });

  btnOrders?.addEventListener('click', () => {
    toggleOrderPickerPanel();
  });

  btnGestor?.addEventListener('click', () => {
    toggleGestorPanel();
  });

  btnAuth?.addEventListener('click', () => {
    toggleAuthPanel();
  });

  // ── Keyboard shortcuts ───────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      btnPasso.click();
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      btnClip.click();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      btnCounter.click();
    } else if ((e.key === 'p' || e.key === 'P') && btnOrders) {
      e.preventDefault();
      btnOrders.click();
    } else if ((e.key === 'g' || e.key === 'G') && btnGestor) {
      e.preventDefault();
      btnGestor.click();
    } else if ((e.key === 'u' || e.key === 'U') && btnAuth) {
      e.preventDefault();
      btnAuth.click();
    }
  });

  // Busca contagem inicial ao criar a barra
  chrome.runtime.sendMessage({ action: 'getTabCount' }, (r) => {
    if (r) updateCounterBadge(r.count);
  });
  syncGestorButton();
  syncAuthButton();
  upgradeTopBarLayout(bar);
}

function normalizeTopBarOrder(order) {
  const sanitized = Array.isArray(order) ? order.filter((key) => HUB_DEFAULT_BUTTON_ORDER.includes(key)) : [];
  const unique = [];
  sanitized.forEach((key) => {
    if (!unique.includes(key)) unique.push(key);
  });
  HUB_DEFAULT_BUTTON_ORDER.forEach((key) => {
    if (!unique.includes(key)) unique.push(key);
  });
  return unique;
}

function saveTopBarOrder(order) {
  chrome.storage.local.set({ [HUB_BUTTON_ORDER_KEY]: normalizeTopBarOrder(order) });
}

function getTopBarCurrentOrder(bar) {
  return Array.from(bar.querySelectorAll('.sp-topbar-main .sp-topbar-item')).map((item) => item.dataset.key);
}

function bindTopBarItemDrag(bar, item) {
  if (!item || item.dataset.dragBound === 'true') return;
  item.dataset.dragBound = 'true';

  item.addEventListener('dragstart', () => {
    item.classList.add('is-dragging');
    bar.dataset.draggingKey = item.dataset.key || '';
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('is-dragging');
    bar.querySelectorAll('.sp-topbar-item').forEach((node) => node.classList.remove('is-drop-target'));
    delete bar.dataset.draggingKey;
  });

  item.addEventListener('dragover', (event) => {
    event.preventDefault();
    if ((bar.dataset.draggingKey || '') === (item.dataset.key || '')) return;
    bar.querySelectorAll('.sp-topbar-main .sp-topbar-item').forEach((node) => node.classList.remove('is-drop-target'));
    item.classList.add('is-drop-target');
  });

  item.addEventListener('dragleave', () => {
    item.classList.remove('is-drop-target');
  });

  item.addEventListener('drop', (event) => {
    event.preventDefault();
    const draggedKey = bar.dataset.draggingKey || '';
    const targetKey = item.dataset.key || '';
    item.classList.remove('is-drop-target');
    if (!draggedKey || !targetKey || draggedKey === targetKey) return;

    const order = getTopBarCurrentOrder(bar).filter((key) => key !== draggedKey);
    const targetIndex = order.indexOf(targetKey);
    const rect = item.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    order.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedKey);
    saveTopBarOrder(order);
    renderTopBarLayout(bar, order);
  });
}

function renderTopBarLayout(bar, order = HUB_DEFAULT_BUTTON_ORDER) {
  if (!bar) return;

  const defs = {
    passo: { id: 'sp-btn-passo', label: 'Mensagem' },
    clip: { id: 'sp-btn-clip', label: 'Gravação' },
    counter: { id: 'sp-btn-counter', label: 'N. de Página' },
    orders: { id: 'sp-btn-orders', label: 'Pedidos' },
    gestor: { id: 'sp-btn-gestor', label: 'Pendências' },
    auth: { id: 'sp-btn-auth', label: 'Conta' },
  };

  defs.counter.label = 'N.º Páginas';
  const normalizedOrder = normalizeTopBarOrder(order);
  const buttons = {};
  Object.values(defs).forEach((def) => {
    const button = document.getElementById(def.id);
    if (button) buttons[def.id] = button;
  });

  bar.innerHTML = '';

  const main = document.createElement('div');
  main.className = 'sp-topbar-main';
  normalizedOrder.forEach((key) => {
    const def = defs[key];
    const button = buttons[def.id];
    if (!button) return;
    const item = document.createElement('div');
    item.className = 'sp-topbar-item';
    item.dataset.key = key;
    item.draggable = true;
    item.appendChild(button);
    const label = document.createElement('span');
    label.className = 'sp-btn-label';
    label.textContent = def.label;
    item.appendChild(label);
    bindTopBarItemDrag(bar, item);
    main.appendChild(item);
  });

  bar.appendChild(main);
  const authButton = buttons[defs.auth.id];
  if (authButton) {
    const side = document.createElement('div');
    side.className = 'sp-topbar-side';
    const item = document.createElement('div');
    item.className = 'sp-topbar-item';
    item.appendChild(authButton);
    const label = document.createElement('span');
    label.className = 'sp-btn-label';
    label.textContent = defs.auth.label;
    item.appendChild(label);
    side.appendChild(item);
    bar.appendChild(side);
  }
}

function upgradeTopBarLayout(bar) {
  if (!bar || bar.dataset.layoutEnhanced === 'true') return;
  bar.dataset.layoutEnhanced = 'true';
  renderTopBarLayout(bar, HUB_DEFAULT_BUTTON_ORDER);
  chrome.storage.local.get([HUB_BUTTON_ORDER_KEY], (result) => {
    renderTopBarLayout(bar, normalizeTopBarOrder(result?.[HUB_BUTTON_ORDER_KEY]));
  });
}

function updateCounterBadge(count) {
  const badge = document.getElementById('sp-counter-badge');
  const btn   = document.getElementById('sp-btn-counter');
  if (!badge) return;
  badge.textContent = count > 0 ? count : '';
  badge.dataset.count = count;
  if (btn) btn.title = count > 0
    ? `${count} aba${count !== 1 ? 's' : ''} ML abertas — clique para recarregar todas`
    : 'Nenhuma aba ML com "Detalhe" ou "Mensagens"';
}

// ══════════════════════════════════════════════════════════════
// MÓDULO: SENTINELA RANGER (Monitoramento automático de página)
// ══════════════════════════════════════════════════════════════

function syncAuthButton() {
  const btn = document.getElementById('sp-btn-auth');
  const badge = document.getElementById('sp-auth-badge');
  if (!btn || !badge) return;

  const email = auth.user?.email || '';
  const displayName = getAuthUserDisplayName();
  const initial = (displayName || email || '').charAt(0).toUpperCase();

  btn.classList.toggle('sp-active', hasAuthSession());
  btn.title = hasAuthSession() ? `Conta conectada: ${displayName}` : 'Conta do Hub (Alt+U)';
  badge.textContent = initial;
  badge.dataset.connected = hasAuthSession() ? 'true' : 'false';

  const panel = document.getElementById('sp-auth-panel');
  if (panel) renderAuthPanelContent(panel);
}

function setAuthPanelStatus(message = '', tone = 'info') {
  const status = document.getElementById('sp-auth-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function renderAuthPanelContent(panel) {
  const themeLabel = isDarkTheme ? 'Escuro' : 'Claro';
  const themeAction = isDarkTheme ? 'Usar tema claro' : 'Usar tema escuro';
  const displayName = getAuthUserDisplayName();
  const themeMarkup = `
      <div class="sp-auth-theme">
        <div class="sp-auth-theme__copy">
          <span class="sp-auth-theme__eyebrow">Tema da interface</span>
          <strong>${themeLabel}</strong>
          <p>Aplica em Passo Largo, Gestor, Pegador de Pedidos e Clip.</p>
        </div>
        <button type="button" id="sp-auth-theme-toggle" class="sp-auth-theme-toggle">${themeAction}</button>
      </div>
  `;
  panel.innerHTML = hasAuthSession()
    ? `
      <div class="sp-auth-panel__header">
        <strong>Conta do Hub</strong>
        <button type="button" id="sp-auth-close" class="sp-auth-close" aria-label="Fechar">x</button>
      </div>
      <p class="sp-auth-copy">Conectado com a conta que será usada pelo Gestor e pelo Passo Largo.</p>
      <div class="sp-auth-summary">
        <span class="sp-auth-avatar">${(displayName || auth.user?.email || '?').charAt(0).toUpperCase()}</span>
        <div>
          <strong>${escapeHtml(displayName || auth.user?.email || 'Conta conectada')}</strong>
          <p>${escapeHtml(auth.user?.email || 'Sessão ativa neste navegador.')}</p>
        </div>
      </div>
      <label class="sp-auth-field">
        <span>Nome de exibição</span>
        <input id="sp-auth-display-name" type="text" maxlength="80" placeholder="Ex.: Bruno / Expedição" value="${escapeHtml(displayName)}" />
      </label>
      <button type="button" id="sp-auth-save-display-name" class="sp-auth-run sp-auth-run--secondary">Salvar nome</button>
      ${themeMarkup}
      <button type="button" id="sp-auth-logout" class="sp-auth-run sp-auth-run--danger">Sair</button>
      <p id="sp-auth-status" class="sp-auth-status" data-tone="info"></p>
    `
    : `
      <div class="sp-auth-panel__header">
        <strong>Conta do Hub</strong>
        <button type="button" id="sp-auth-close" class="sp-auth-close" aria-label="Fechar">x</button>
      </div>
      <p class="sp-auth-copy">Entre com a mesma conta do Gestor de Pendências. O Passo Largo vai usar essa conta depois.</p>
      <label class="sp-auth-field">
        <span>E-mail</span>
        <input id="sp-auth-email" type="email" autocomplete="username" placeholder="voce@empresa.com" />
      </label>
      <label class="sp-auth-field">
        <span>Senha</span>
        <input id="sp-auth-password" type="password" autocomplete="current-password" placeholder="Sua senha" />
      </label>
      ${themeMarkup}
      <button type="button" id="sp-auth-login" class="sp-auth-run">Entrar</button>
      <p id="sp-auth-status" class="sp-auth-status" data-tone="info"></p>
    `;

  bindAuthPanelEvents(panel);
}

function bindAuthPanelEvents(panel) {
  panel.querySelector('#sp-auth-close')?.addEventListener('click', closeAuthPanel);
  panel.querySelector('#sp-auth-theme-toggle')?.addEventListener('click', () => setGlobalTheme(!isDarkTheme));

  if (hasAuthSession()) {
    panel.querySelector('#sp-auth-logout')?.addEventListener('click', onAuthLogout);
    panel.querySelector('#sp-auth-save-display-name')?.addEventListener('click', onAuthSaveDisplayName);
    panel.querySelector('#sp-auth-display-name')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onAuthSaveDisplayName();
      }
    });
    return;
  }

  const loginButton = panel.querySelector('#sp-auth-login');
  const emailInput = panel.querySelector('#sp-auth-email');
  const passwordInput = panel.querySelector('#sp-auth-password');

  loginButton?.addEventListener('click', onAuthLogin);
  [emailInput, passwordInput].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onAuthLogin();
      }
    });
  });
}

function createAuthPanel() {
  const existingPanel = document.getElementById('sp-auth-panel');
  if (existingPanel) return existingPanel;

  const panel = document.createElement('section');
  panel.id = 'sp-auth-panel';
  applyHubTheme(panel);
  renderAuthPanelContent(panel);
  document.body.appendChild(panel);
  return panel;
}

function openAuthPanel() {
  const panel = createAuthPanel();
  applyHubTheme(panel);
  panel.classList.add('visible');
  document.getElementById('sp-btn-auth')?.classList.add('sp-active');
  renderAuthPanelContent(panel);

  if (!hasAuthSession()) {
    panel.querySelector('#sp-auth-email')?.focus();
  }
}

function closeAuthPanel() {
  document.getElementById('sp-auth-panel')?.classList.remove('visible');
  document.getElementById('sp-btn-auth')?.classList.toggle('sp-active', hasAuthSession());
}

function toggleAuthPanel() {
  const panel = createAuthPanel();
  if (panel.classList.contains('visible')) {
    closeAuthPanel();
  } else {
    openAuthPanel();
  }
}

async function onAuthLogin() {
  const panel = createAuthPanel();
  const emailInput = panel.querySelector('#sp-auth-email');
  const passwordInput = panel.querySelector('#sp-auth-password');
  const loginButton = panel.querySelector('#sp-auth-login');
  const email = emailInput?.value?.trim();
  const password = passwordInput?.value || '';

  if (!email || !password) {
    setAuthPanelStatus('Preencha e-mail e senha.', 'error');
    return;
  }

  if (loginButton) loginButton.disabled = true;
  setAuthPanelStatus('Entrando...', 'info');

  try {
    const session = await signIn(email, password);
    auth.token = session.access_token;
    auth.refreshToken = session.refresh_token;
    auth.user = session.user;
    await saveSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: session.user
    });
    notifyAuthChanged();
    openAuthPanel();
    setAuthPanelStatus('Login realizado com sucesso.', 'success');
    mostrarNotificacao('Conta conectada no Sentinela Pro.');
  } catch (error) {
    setAuthPanelStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (loginButton) loginButton.disabled = false;
  }
}

async function onAuthSaveDisplayName() {
  const panel = createAuthPanel();
  const input = panel.querySelector('#sp-auth-display-name');
  const button = panel.querySelector('#sp-auth-save-display-name');
  const displayName = input?.value?.trim() || '';

  if (button) button.disabled = true;
  setAuthPanelStatus('Salvando nome...', 'info');

  try {
    await saveCurrentHubUserProfile(displayName);
    syncAuthButton();
    renderAuthPanelContent(panel);
    if (panel.classList.contains('visible')) {
      panel.querySelector('#sp-auth-display-name')?.focus();
    }
    if (document.getElementById('sp-order-panel')) {
      renderOrderPickerSessionState(document.getElementById('sp-order-panel'));
      renderOrderPickerDashboard(document.getElementById('sp-order-panel'));
    }
    setAuthPanelStatus('Nome de exibição salvo com sucesso.', 'success');
  } catch (error) {
    setAuthPanelStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    const refreshedButton = createAuthPanel().querySelector('#sp-auth-save-display-name');
    if (refreshedButton) refreshedButton.disabled = false;
  }
}

async function onAuthLogout() {
  const panel = createAuthPanel();
  const logoutButton = panel.querySelector('#sp-auth-logout');
  if (logoutButton) logoutButton.disabled = true;
  setAuthPanelStatus('Saindo...', 'info');

  try {
    await signOut();
    chrome.runtime.sendMessage({ type: 'REVOKE_GMAIL_TOKEN' });
    await clearSession();
    auth = { user: null, token: null, refreshToken: null };
    notifyAuthChanged();
    openAuthPanel();
    setAuthPanelStatus('Sessão encerrada.', 'success');
    mostrarNotificacao('Conta desconectada.');
  } catch (error) {
    setAuthPanelStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (logoutButton) logoutButton.disabled = false;
  }
}

function syncGestorButton() {
  const btn = document.getElementById('sp-btn-gestor');
  const badge = document.getElementById('sp-gestor-badge');
  if (!btn || !badge) return;

  const count = getGestorActiveCount();
  badge.textContent = count > 0 ? String(count) : '';
  badge.dataset.count = count;
  btn.title = hasAuthSession()
    ? `Gestor de Pendências (${count})`
    : 'Gestor de Pendências (Alt+G)';
}

function setGestorStatus(message = '', tone = 'info') {
  const status = document.getElementById('sp-gestor-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function gestorFieldInput(name, label, value, placeholder, wide = false) {
  return `
    <label class="sp-gestor-edit-field${wide ? ' is-wide' : ''}">
      <span>${label}</span>
      <input type="text" data-gestor-field="${name}" value="${escapeGestorValue(value)}" placeholder="${escapeGestorValue(placeholder)}" />
    </label>
  `;
}

function gestorFieldTextarea(name, label, value, placeholder) {
  return `
    <label class="sp-gestor-edit-field is-wide">
      <span>${label}</span>
      <textarea data-gestor-field="${name}" rows="4" placeholder="${escapeGestorValue(placeholder)}">${escapeGestorValue(value)}</textarea>
    </label>
  `;
}

function gestorHiddenField(name, value) {
  return `<input type="hidden" data-gestor-field="${name}" value="${escapeGestorValue(value)}" />`;
}

function getGestorActionIcon(type) {
  switch (type) {
    case 'archive':
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7.5 5 4h14l2 3.5"></path>
          <path d="M4 7h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"></path>
          <path d="M9 12h6"></path>
        </svg>
      `;
    case 'return':
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 14l-4-4 4-4"></path>
          <path d="M5 10h9a5 5 0 1 1 0 10h-1"></path>
        </svg>
      `;
    case 'delete':
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18"></path>
          <path d="M8 6V4h8v2"></path>
          <path d="M7 6l1 14h8l1-14"></path>
          <path d="M10 10v6"></path>
          <path d="M14 10v6"></path>
        </svg>
      `;
    case 'edit':
    default:
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
        </svg>
      `;
  }
}

function renderGestorIconButton({ action, id, title, iconType, danger = false, active = false, tone = '' }) {
  return `
    <button
      type="button"
      class="sp-gestor-icon-btn${danger ? ' sp-gestor-icon-btn--danger' : ''}${tone ? ` sp-gestor-icon-btn--${escapeGestorValue(tone)}` : ''}${active ? ' is-active' : ''}"
      data-action="${escapeGestorValue(action)}"
      data-id="${escapeGestorValue(id)}"
      title="${escapeGestorValue(title)}"
      aria-label="${escapeGestorValue(title)}"
    >
      ${getGestorActionIcon(iconType)}
    </button>
  `;
}

function collectGestorFields(card) {
  const fields = {};
  card.querySelectorAll('[data-gestor-field]').forEach((field) => {
    fields[field.dataset.gestorField] = field.value || '';
  });
  const aroFields = collectGestorArosFromScope(card);
  fields.aro = buildGestorAroValue(aroFields);
  return fields;
}

function createGestorBatchModal() {
  const existing = document.getElementById('sp-gestor-batch-overlay');
  if (existing) return existing;

  const overlay = document.createElement('div');
  overlay.id = 'sp-gestor-batch-overlay';
  applyHubTheme(overlay);
  overlay.innerHTML = `
    <div class="sp-gestor-batch-modal">
      <div class="sp-gestor-batch-modal__header">
        <div>
          <strong>Consolidado de Pendências</strong>
          <p id="sp-gestor-batch-count" class="sp-gestor-batch-modal__copy"></p>
        </div>
        <button type="button" id="sp-gestor-batch-close" class="sp-gestor-close" aria-label="Fechar">x</button>
      </div>
      <div id="sp-gestor-batch-list" class="sp-gestor-batch-list"></div>
      <div class="sp-gestor-batch-modal__footer">
        <button type="button" id="sp-gestor-batch-copy" class="sp-gestor-action">Copiar selecionados</button>
        <button type="button" id="sp-gestor-batch-individual" class="sp-gestor-action">Enviar individual</button>
        <button type="button" id="sp-gestor-batch-consolidated" class="sp-gestor-action sp-gestor-action--primary">Enviar consolidado</button>
      </div>
    </div>
  `;
  overlay._selectedIds = new Set();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeGestorBatchModal();
    }
  });
  overlay.querySelector('.sp-gestor-batch-modal')?.addEventListener('click', (event) => event.stopPropagation());
  document.body.appendChild(overlay);
  return overlay;
}

function closeGestorBatchModal() {
  document.getElementById('sp-gestor-batch-overlay')?.classList.remove('visible');
}

function renderGestorBatchModal() {
  const overlay = createGestorBatchModal();
  const list = overlay.querySelector('#sp-gestor-batch-list');
  const count = overlay.querySelector('#sp-gestor-batch-count');
  const selectedIds = overlay._selectedIds || new Set();
  const activeItems = getGestorVisiblePendencias('pendencias');

  if (!list || !count) return;

  count.textContent = `${selectedIds.size} de ${activeItems.length} selecionada(s)`;

  list.innerHTML = activeItems.length
    ? activeItems.map((item) => {
        const selected = selectedIds.has(String(item.id));
        return `
          <button type="button" class="sp-gestor-batch-item${selected ? ' is-selected' : ''}" data-id="${escapeGestorValue(item.id)}">
            <span class="sp-gestor-batch-item__check">${selected ? 'OK' : ''}</span>
            <span class="sp-gestor-batch-item__content">
              <strong>${escapeGestorValue(item.login_cliente || '(sem login)')}</strong>
              <span>${item.numero_venda ? `#${escapeGestorValue(item.numero_venda)}` : 'Sem venda'}${item.modelo ? ` • ${escapeGestorValue(item.modelo)}` : ''}</span>
            </span>
          </button>
        `;
      }).join('')
    : '<div class="sp-gestor-empty">Nenhuma pendência ativa para envio.</div>';

  list.querySelectorAll('.sp-gestor-batch-item').forEach((button) => {
    button.addEventListener('click', () => {
      const id = String(button.dataset.id || '');
      if (!id) return;
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
      overlay._selectedIds = selectedIds;
      renderGestorBatchModal();
    });
  });

  overlay.querySelector('#sp-gestor-batch-close')?.addEventListener('click', closeGestorBatchModal);
  overlay.querySelector('#sp-gestor-batch-copy')?.addEventListener('click', onGestorCopySelectedAction);
  overlay.querySelector('#sp-gestor-batch-consolidated')?.addEventListener('click', onGestorSendConsolidatedAction);
  overlay.querySelector('#sp-gestor-batch-individual')?.addEventListener('click', onGestorSendIndividualAllAction);
}

function openGestorBatchModal() {
  const activeItems = getGestorVisiblePendencias('pendencias');
  if (!activeItems.length) {
    setGestorStatus('Nenhuma pendência ativa para envio em lote.', 'error');
    return;
  }

  const overlay = createGestorBatchModal();
  overlay._selectedIds = new Set(activeItems.map((item) => String(item.id)));
  renderGestorBatchModal();
  overlay.classList.add('visible');
}

function getSelectedGestorBatchItems() {
  const overlay = createGestorBatchModal();
  const selectedIds = overlay._selectedIds || new Set();
  return getGestorVisiblePendencias('pendencias').filter((item) => selectedIds.has(String(item.id)));
}

function renderGestorCards(tab = gestorCurrentTab) {
  const items = getGestorVisiblePendencias(tab);
  if (gestorLoading) {
    return '<div class="sp-gestor-empty">Carregando pendências...</div>';
  }

  if (!items.length) {
    if (tab === 'historico' && gestorHistoryFilter.trim()) {
      return '<div class="sp-gestor-empty">Nenhuma pendência encontrada para esse filtro.</div>';
    }
    return `<div class="sp-gestor-empty">${tab === 'historico' ? 'Nenhuma pendência arquivada.' : 'Nenhuma pendência cadastrada.'}</div>`;
  }

  return items.map((p) => `
    <article class="sp-gestor-card${gestorArchivedIds.has(String(p.id)) ? ' is-archived' : ''}${gestorExpandedCardId === String(p.id) ? ' is-expanded' : ''}" data-id="${escapeGestorValue(p.id)}">
      <div class="sp-gestor-card__summary" data-action="toggle-card" data-id="${escapeGestorValue(p.id)}">
        <div class="sp-gestor-card__top">
          <div class="sp-gestor-card__identity">
            <strong>${escapeGestorValue(p.login_cliente || 'Pendencia')}</strong>
            <span>${escapeGestorValue(formatGestorDate(p.created_at) || 'Sem data')}</span>
          </div>
          <div class="sp-gestor-card__top-side">
            ${gestorEmailSentIds.has(String(p.id)) ? '<span class="sp-gestor-card__flag">Email enviado</span>' : ''}
            <div class="sp-gestor-card__quick-actions">
              ${renderGestorIconButton({
                action: 'archive',
                id: p.id,
                title: gestorArchivedIds.has(String(p.id)) ? 'Retornar' : 'Arquivar',
                iconType: gestorArchivedIds.has(String(p.id)) ? 'return' : 'archive',
                active: gestorArchivedIds.has(String(p.id)),
                tone: 'archive'
              })}
              ${renderGestorIconButton({
                action: 'delete',
                id: p.id,
                title: 'Excluir',
                iconType: 'delete',
                danger: true
              })}
              ${renderGestorIconButton({
                action: 'toggle-card',
                id: p.id,
                title: gestorExpandedCardId === String(p.id) ? 'Fechar edicao' : 'Editar',
                iconType: 'edit',
                active: gestorExpandedCardId === String(p.id)
              })}
            </div>
          </div>
        </div>
        <div class="sp-gestor-card__meta">
          ${p.numero_venda ? `<span>#${escapeGestorValue(p.numero_venda)}</span>` : '<span>Sem venda</span>'}
          ${p.modelo ? `<span>${escapeGestorValue(p.modelo)}</span>` : ''}
          ${p.updated_at ? `<span>Atualizado</span>` : ''}
        </div>
        ${p.observacoes ? `<p class="sp-gestor-card__obs">${escapeGestorValue(p.observacoes)}</p>` : ''}
        ${p.url ? `<a class="sp-gestor-card__link" href="${escapeGestorValue(p.url)}" target="_blank" rel="noreferrer">Abrir URL</a>` : ''}
        <div class="sp-gestor-card__actions">
          <button type="button" class="sp-gestor-chip sp-gestor-chip--fefrello${gestorFefrelloSentIds.has(String(p.id)) ? ' is-done' : ''}" data-action="fefrello" data-id="${escapeGestorValue(p.id)}" ${gestorFefrelloSentIds.has(String(p.id)) ? 'disabled' : ''}>${gestorFefrelloSentIds.has(String(p.id)) ? 'Enviado ao Fefrello' : 'Fefrello'}</button>
          <button type="button" class="sp-gestor-chip sp-gestor-chip--mail${gestorEmailSentIds.has(String(p.id)) ? ' is-done' : ''}" data-action="email" data-id="${escapeGestorValue(p.id)}">${gestorEmailSentIds.has(String(p.id)) ? 'Email enviado' : 'Enviar email'}</button>
          <button type="button" class="sp-gestor-chip sp-gestor-chip--copy${gestorCopiedIds.has(String(p.id)) ? ' is-done' : ''}" data-action="copy" data-id="${escapeGestorValue(p.id)}">${gestorCopiedIds.has(String(p.id)) ? 'Copiado' : 'Copiar'}</button>
        </div>
      </div>
      <div class="sp-gestor-card__body">
        <div class="sp-gestor-edit-grid">
          ${gestorFieldInput('login_cliente', 'Login', p.login_cliente, 'Apelido do comprador')}
          ${gestorFieldInput('modelo', 'Modelo', p.modelo, 'Descreva o modelo')}
          ${gestorHiddenField('numero_venda', p.numero_venda)}
          ${gestorHiddenField('url', p.url)}
          ${renderGestorAroFields(parseGestorAros(p.aro), 'card')}
          ${gestorFieldTextarea('observacoes', 'Observações', p.observacoes, 'Detalhes adicionais...')}
        </div>
        <div class="sp-gestor-card__footer">
          <button type="button" class="sp-gestor-action" data-action="cancel-edit" data-id="${escapeGestorValue(p.id)}">Fechar</button>
          <button type="button" class="sp-gestor-action sp-gestor-action--primary" data-action="save-card" data-id="${escapeGestorValue(p.id)}">Salvar</button>
        </div>
      </div>
    </article>
  `).join('');
}

function renderGestorPanelContent(panel) {
  if (!panel) return;
  const activeCount = getGestorActiveCount();
  const archivedCount = getGestorArchivedCount();
  const visibleArchivedCount = getGestorVisiblePendencias('historico').length;
  const emailSettings = normalizeGestorEmailSettings(gestorEmailSettings);

  panel.innerHTML = hasAuthSession()
    ? `
      <div class="sp-gestor-panel__header">
        <div>
          <strong>Gestor de Pendências</strong>
        </div>
        <button type="button" id="sp-gestor-close" class="sp-gestor-close" aria-label="Fechar">x</button>
      </div>
      <div class="sp-gestor-tabs">
        <button type="button" class="sp-gestor-tab${gestorCurrentTab === 'pendencias' ? ' is-active' : ''}" data-tab="pendencias">Pendências <span>${activeCount}</span></button>
        <button type="button" class="sp-gestor-tab${gestorCurrentTab === 'historico' ? ' is-active' : ''}" data-tab="historico">Histórico <span>${archivedCount}</span></button>
        <button type="button" class="sp-gestor-tab${gestorCurrentTab === 'ajustes' ? ' is-active' : ''}" data-tab="ajustes">Ajustes</button>
      </div>
      <section class="sp-gestor-view${gestorCurrentTab === 'pendencias' ? ' is-active' : ''}" data-view="pendencias">
        <div class="sp-gestor-toolbar">
          <button type="button" id="sp-gestor-refresh" class="sp-gestor-action">Atualizar</button>
          <button type="button" id="sp-gestor-batch" class="sp-gestor-action">Consolidado</button>
          <button type="button" id="sp-gestor-capture" class="sp-gestor-action">Capturar página</button>
          <button type="button" id="sp-gestor-toggle-form" class="sp-gestor-action sp-gestor-action--primary">Nova pendência</button>
        </div>
        <form id="sp-gestor-form" class="sp-gestor-form sp-hidden">
          <div class="sp-gestor-form__grid">
            <label class="sp-gestor-field">
              <span>Login</span>
              <input id="sp-gestor-login" type="text" placeholder="Cliente" />
            </label>
            <label class="sp-gestor-field">
              <span>Modelo</span>
              <input id="sp-gestor-modelo" type="text" placeholder="Modelo" />
            </label>
          </div>
          <input id="sp-gestor-venda" type="hidden" />
          <input id="sp-gestor-url" type="hidden" value="${escapeGestorValue(window.location.href.includes('mercadol') ? window.location.href : '')}" />
          <p class="sp-gestor-form__hint">Venda e link são capturados automaticamente da página atual.</p>
          <div id="sp-gestor-aro-fields" class="sp-gestor-edit-grid sp-gestor-aro-grid">${renderGestorAroFields([], 'form')}</div>
          <label class="sp-gestor-field">
            <span>Observações</span>
            <textarea id="sp-gestor-obs" rows="4" placeholder="Detalhes da pendência"></textarea>
          </label>
          <div class="sp-gestor-form__actions">
            <button type="button" id="sp-gestor-cancel" class="sp-gestor-action">Cancelar</button>
            <button type="button" id="sp-gestor-save-fefrello" class="sp-gestor-action sp-gestor-action--success">Fefrello</button>
            <button type="submit" id="sp-gestor-save" class="sp-gestor-action sp-gestor-action--primary">Salvar</button>
          </div>
        </form>
        <div id="sp-gestor-list" class="sp-gestor-list">${renderGestorCards('pendencias')}</div>
      </section>
      <section class="sp-gestor-view${gestorCurrentTab === 'historico' ? ' is-active' : ''}" data-view="historico">
        <div class="sp-gestor-section-head">
          <strong>Histórico</strong>
          <span>${gestorHistoryFilter.trim() ? `${visibleArchivedCount} de ${archivedCount}` : archivedCount} arquivada(s)</span>
        </div>
        <div class="sp-gestor-history-toolbar">
          <label class="sp-gestor-history-search">
            <span>Buscar</span>
            <input id="sp-gestor-history-search" type="search" placeholder="Login, venda, modelo, observações..." value="${escapeHtml(gestorHistoryFilter)}" />
          </label>
          <button type="button" id="sp-gestor-clear-history" class="sp-gestor-action">Limpar arquivados</button>
        </div>
        <div id="sp-gestor-history" class="sp-gestor-list">${renderGestorCards('historico')}</div>
      </section>
      <section class="sp-gestor-view${gestorCurrentTab === 'ajustes' ? ' is-active' : ''}" data-view="ajustes">
        <div class="sp-gestor-settings">
          <div class="sp-gestor-settings__block">
            <strong>Conta conectada</strong>
            <p>${escapeHtml(auth.user?.email || 'Sem conta conectada')}</p>
          </div>
          <div class="sp-gestor-settings__block">
            <strong>Envio por Gmail</strong>
            <p>Defina destinatário e cópia. O token do Gmail será pedido no primeiro envio.</p>
          </div>
          <label class="sp-gestor-field">
            <span>Destinatario</span>
            <input id="sp-gestor-email-to" type="email" placeholder="destinatario@email.com" value="${escapeHtml(emailSettings.emailTo)}" />
          </label>
          <label class="sp-gestor-field">
            <span>Copia</span>
            <input id="sp-gestor-email-cc" type="email" placeholder="copia@email.com" value="${escapeHtml(emailSettings.emailCC)}" />
          </label>
          <button type="button" id="sp-gestor-save-email" class="sp-gestor-action sp-gestor-action--primary">Salvar email</button>
          <div class="sp-gestor-settings__block">
            <strong>Fefrello</strong>
            <p>Configure board, coluna e responsavel para criar cards direto do Gestor.</p>
          </div>
          <label class="sp-gestor-field">
            <span>Board</span>
            <select id="sp-gestor-fefrello-board" class="sp-gestor-select">
              <option value="">Carregando...</option>
            </select>
          </label>
          <label class="sp-gestor-field">
            <span>Coluna</span>
            <select id="sp-gestor-fefrello-column" class="sp-gestor-select" disabled>
              <option value="">Selecione um board</option>
            </select>
          </label>
          <label class="sp-gestor-field">
            <span>Responsavel</span>
            <select id="sp-gestor-fefrello-responsible" class="sp-gestor-select">
              <option value="">Sem responsavel</option>
              ${GESTOR_FEFRELLO_RESPONSAVEIS.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
            </select>
          </label>
          <div class="sp-gestor-form__actions">
            <button type="button" id="sp-gestor-fefrello-refresh" class="sp-gestor-action">Atualizar Fefrello</button>
            <button type="button" id="sp-gestor-fefrello-save" class="sp-gestor-action sp-gestor-action--primary">Salvar Fefrello</button>
          </div>
        </div>
      </section>
      <p id="sp-gestor-status" class="sp-gestor-status" data-tone="info"></p>
    `
    : `
      <div class="sp-gestor-panel__header">
        <div>
          <strong>Gestor de Pendências</strong>
          <p class="sp-gestor-subtitle">Entre no hub para sincronizar e enviar emails.</p>
        </div>
        <button type="button" id="sp-gestor-close" class="sp-gestor-close" aria-label="Fechar">x</button>
      </div>
      <p class="sp-gestor-copy">Entre na Conta do Hub para ver e salvar pendências do Gestor aqui.</p>
      <button type="button" id="sp-gestor-open-auth" class="sp-gestor-action sp-gestor-action--primary">Abrir login</button>
      <p id="sp-gestor-status" class="sp-gestor-status" data-tone="info"></p>
    `;

  bindGestorPanelEvents(panel);
  makeGestorPanelDraggable(panel);
}

function bindGestorPanelEvents(panel) {
  panel.querySelector('#sp-gestor-close')?.addEventListener('click', closeGestorPanel);

  if (!hasAuthSession()) {
    panel.querySelector('#sp-gestor-open-auth')?.addEventListener('click', () => {
      closeGestorPanel();
      openAuthPanel();
    });
    return;
  }

  panel.querySelectorAll('.sp-gestor-tab').forEach((button) => {
    button.addEventListener('click', () => {
      gestorCurrentTab = button.dataset.tab || 'pendencias';
      renderGestorPanelContent(panel);
    });
  });

  panel.querySelector('#sp-gestor-refresh')?.addEventListener('click', async () => {
    setGestorStatus('Atualizando...', 'info');
    try {
      await loadGestorPendencias();
      setGestorStatus('Pendências atualizadas.', 'success');
    } catch (error) {
      setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  });

  panel.querySelector('#sp-gestor-batch')?.addEventListener('click', openGestorBatchModal);

  panel.querySelector('#sp-gestor-capture')?.addEventListener('click', () => {
    panel.querySelector('#sp-gestor-form')?.classList.remove('sp-hidden');
    const captured = fillGestorForm(panel, true);
    setGestorStatus(
      captured ? 'Dados da página capturados.' : 'Não encontrei dados suficientes nesta página.',
      captured ? 'success' : 'error'
    );
  });

  panel.querySelector('#sp-gestor-toggle-form')?.addEventListener('click', () => {
    const form = panel.querySelector('#sp-gestor-form');
    form?.classList.remove('sp-hidden');
    fillGestorForm(panel, true);
  });

  panel.querySelector('#sp-gestor-cancel')?.addEventListener('click', () => {
    panel.querySelector('#sp-gestor-form')?.classList.add('sp-hidden');
  });

  panel.querySelector('#sp-gestor-save-fefrello')?.addEventListener('click', onGestorCreateAndSendToFefrello);
  panel.querySelector('#sp-gestor-save-email')?.addEventListener('click', onGestorSaveEmailSettings);
  panel.querySelector('#sp-gestor-fefrello-save')?.addEventListener('click', onGestorSaveFefrelloSettings);
  panel.querySelector('#sp-gestor-fefrello-refresh')?.addEventListener('click', onGestorRefreshFefrelloSettings);
  panel.querySelector('#sp-gestor-history-search')?.addEventListener('input', (event) => {
    gestorHistoryFilter = event.target?.value || '';
    renderGestorPanelContent(panel);
  });
  panel.querySelector('#sp-gestor-clear-history')?.addEventListener('click', onGestorClearArchivedAction);
  panel.querySelector('#sp-gestor-form')?.addEventListener('submit', onGestorCreateSubmit);
  panel.querySelectorAll('.sp-gestor-card__link').forEach((link) => {
    link.addEventListener('click', (event) => event.stopPropagation());
  });
  panel.querySelectorAll('[data-action="copy"]').forEach((button) => {
    button.addEventListener('click', onGestorCopyCardAction);
  });
  panel.querySelectorAll('[data-action="fefrello"]').forEach((button) => {
    button.addEventListener('click', onGestorCreateFefrelloAction);
  });
  panel.querySelectorAll('[data-action="toggle-card"]').forEach((button) => {
    button.addEventListener('click', onGestorToggleCard);
  });
  panel.querySelectorAll('[data-action="save-card"]').forEach((button) => {
    button.addEventListener('click', onGestorSaveCard);
  });
  panel.querySelectorAll('[data-action="cancel-edit"]').forEach((button) => {
    button.addEventListener('click', onGestorCancelEdit);
  });
  panel.querySelectorAll('[data-action="email"]').forEach((button) => {
    button.addEventListener('click', onGestorSendEmailAction);
  });
  panel.querySelectorAll('[data-action="archive"]').forEach((button) => {
    button.addEventListener('click', onGestorToggleArchiveAction);
  });
  panel.querySelectorAll('[data-action="delete"]').forEach((button) => {
    button.addEventListener('click', onGestorDelete);
  });

  if (gestorCurrentTab === 'ajustes') {
    loadGestorFefrelloSettings(panel);
  }
}

function createGestorPanel() {
  const existingPanel = document.getElementById('sp-gestor-panel');
  if (existingPanel) return existingPanel;

  const panel = document.createElement('section');
  panel.id = 'sp-gestor-panel';
  applyHubTheme(panel);
  panel.addEventListener('click', (event) => event.stopPropagation());
  document.body.appendChild(panel);
  renderGestorPanelContent(panel);
  positionGestorPanel(panel);
  return panel;
}

function loadGestorPanelPosition() {
  return new Promise((resolve) => {
    if (gestorPanelPositionLoaded) {
      resolve();
      return;
    }
    chrome.storage.local.get([GESTOR_PANEL_POSITION_KEY], (result) => {
      gestorPanelSavedPos = result?.[GESTOR_PANEL_POSITION_KEY] || null;
      gestorPanelPositionLoaded = true;
      resolve();
    });
  });
}

function positionGestorPanel(panel) {
  if (!panel) return;
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  panel.style.maxHeight = `${Math.max(320, wh - 88)}px`;

  if (gestorPanelSavedPos && ww > 760) {
    const safeLeft = Math.max(8, Math.min(gestorPanelSavedPos.left, ww - panel.offsetWidth - 8));
    const safeTop = Math.max(8, Math.min(gestorPanelSavedPos.top, wh - panel.offsetHeight - 8));
    panel.classList.add('is-positioned');
    panel.style.left = `${safeLeft}px`;
    panel.style.top = `${safeTop}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    return;
  }

  panel.classList.remove('is-positioned');
  panel.style.top = '62px';
  panel.style.left = '50%';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
}

function makeGestorPanelDraggable(panel) {
  const handle = panel?.querySelector('.sp-gestor-panel__header');
  if (!panel || !handle || handle.dataset.dragBound === 'true') return;
  handle.dataset.dragBound = 'true';

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  handle.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || event.target.closest('button, input, textarea, a')) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    isDragging = true;
    panel.classList.add('is-positioned');
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    handle.classList.add('is-dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(event) {
    if (!isDragging) return;
    const nextLeft = Math.max(8, Math.min(startLeft + (event.clientX - startX), window.innerWidth - panel.offsetWidth - 8));
    const nextTop = Math.max(8, Math.min(startTop + (event.clientY - startY), window.innerHeight - panel.offsetHeight - 8));
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
  }

  function onUp() {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove('is-dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const rect = panel.getBoundingClientRect();
    gestorPanelSavedPos = { top: rect.top, left: rect.left };
    chrome.storage.local.set({ [GESTOR_PANEL_POSITION_KEY]: gestorPanelSavedPos });
  }
}

async function openGestorPanel() {
  await loadGestorPanelPosition();
  const panel = createGestorPanel();
  applyHubTheme(panel);
  positionGestorPanel(panel);
  panel.classList.add('visible');
  document.getElementById('sp-btn-gestor')?.classList.add('sp-active');

  if (hasAuthSession()) {
    try {
      await loadGestorLocalState();
      renderGestorPanelContent(panel);
      await loadGestorPendencias();
      fillGestorForm(panel);
    } catch (error) {
      setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  } else {
    renderGestorPanelContent(panel);
  }
}

function closeGestorPanel() {
  document.getElementById('sp-gestor-panel')?.classList.remove('visible');
  document.getElementById('sp-btn-gestor')?.classList.remove('sp-active');
}

function toggleGestorPanel() {
  const panel = createGestorPanel();
  if (panel.classList.contains('visible')) {
    closeGestorPanel();
  } else {
    openGestorPanel();
  }
}

function collectGestorCreateDraft(panel) {
  const form = panel.querySelector('#sp-gestor-form') || panel;
  return {
    fields: {
      login_cliente: panel.querySelector('#sp-gestor-login')?.value?.trim() || '',
      numero_venda: panel.querySelector('#sp-gestor-venda')?.value?.trim() || '',
      modelo: panel.querySelector('#sp-gestor-modelo')?.value?.trim() || '',
      url: panel.querySelector('#sp-gestor-url')?.value?.trim() || '',
      observacoes: panel.querySelector('#sp-gestor-obs')?.value?.trim() || '',
      aro: buildGestorAroValue(collectGestorArosFromScope(form))
    }
  };
}

function resetGestorCreateForm(panel) {
  panel.querySelector('#sp-gestor-form')?.reset();
  const aroFields = panel.querySelector('#sp-gestor-aro-fields');
  if (aroFields) aroFields.innerHTML = renderGestorAroFields([], 'form');
  panel.querySelector('#sp-gestor-form')?.classList.add('sp-hidden');
}

async function submitGestorCreate({ sendToFefrello = false } = {}) {
  const panel = createGestorPanel();
  const { fields } = collectGestorCreateDraft(panel);
  const login = fields.login_cliente;
  const numeroVenda = fields.numero_venda;
  const modelo = fields.modelo;
  const observacoes = fields.observacoes;
  const hasAroData = parseGestorAros(fields.aro).some((aro) => aro.value || aro.model);

  if (!login && !numeroVenda && !modelo && !observacoes && !hasAroData) {
    setGestorStatus('Preencha pelo menos um campo para salvar a pendência.', 'error');
    return;
  }

  if (hasGestorDuplicateVenda(numeroVenda)) {
    setGestorStatus(`Já existe uma pendência com a venda #${numeroVenda}.`, 'error');
    return;
  }

  let fefrelloConfig = null;
  if (sendToFefrello) {
    fefrelloConfig = await loadGestorFefrelloConfig();
    if (!fefrelloConfig?.boardId || !fefrelloConfig?.columnId) {
      gestorCurrentTab = 'ajustes';
      renderGestorPanelContent(createGestorPanel());
      setGestorStatus('Configure o Fefrello em Ajustes.', 'error');
      return;
    }
  }

  const saveButton = panel.querySelector('#sp-gestor-save');
  const fefrelloButton = panel.querySelector('#sp-gestor-save-fefrello');
  if (saveButton) saveButton.disabled = true;
  if (fefrelloButton) fefrelloButton.disabled = true;
  setGestorStatus(sendToFefrello ? 'Criando card no Fefrello e salvando pendência...' : 'Salvando pendência...', 'info');

  try {
    if (sendToFefrello) {
      const title = fields.login_cliente || fields.numero_venda || 'Sem titulo';
      const description = formatGestorCardForFefrello(fields);
      await createGestorFefrelloCard(
        fefrelloConfig.boardId,
        fefrelloConfig.columnId,
        title,
        description,
        fefrelloConfig.responsible || ''
      );
    }

    const created = await createGestorPendencia(fields);
    if (sendToFefrello && created?.id) {
      gestorFefrelloSentIds.add(String(created.id));
      await saveGestorCardStatus();
    }

    gestorCurrentTab = 'pendencias';
    resetGestorCreateForm(panel);
    await loadGestorPendencias();
    resetGestorCreateForm(createGestorPanel());
    setGestorStatus(sendToFefrello ? 'Pendência salva e enviada ao Fefrello.' : 'Pendência criada com sucesso.', 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (saveButton) saveButton.disabled = false;
    if (fefrelloButton) fefrelloButton.disabled = false;
  }
}

async function onGestorCreateSubmit(event) {
  event.preventDefault();
  await submitGestorCreate({ sendToFefrello: false });
}

async function onGestorCreateAndSendToFefrello(event) {
  event.preventDefault();
  event.stopPropagation();
  await submitGestorCreate({ sendToFefrello: true });
}

async function onGestorSaveEmailSettings() {
  const panel = createGestorPanel();
  const emailTo = panel.querySelector('#sp-gestor-email-to')?.value?.trim() || '';
  const emailCC = panel.querySelector('#sp-gestor-email-cc')?.value?.trim() || '';
  if (!emailTo) {
    setGestorStatus('Informe o e-mail destinatário.', 'error');
    return;
  }
  gestorEmailSettings = normalizeGestorEmailSettings({ emailTo, emailCC });
  await saveGestorEmailSettings(gestorEmailSettings);
  setGestorStatus('Ajustes de email salvos.', 'success');
}

async function loadGestorFefrelloColumnsIntoPanel(panel, boardId, selectedColumnId = '') {
  const columnSelect = panel.querySelector('#sp-gestor-fefrello-column');
  if (!columnSelect) return;
  if (!boardId) {
    columnSelect.innerHTML = '<option value="">Selecione um board</option>';
    columnSelect.disabled = true;
    return;
  }
  columnSelect.innerHTML = '<option value="">Carregando...</option>';
  columnSelect.disabled = true;
  try {
    const columns = await loadGestorFefrelloColumns(boardId);
    columnSelect.innerHTML = '<option value="">Selecione a coluna...</option>';
    columns.forEach((column) => {
      const option = document.createElement('option');
      option.value = column.id;
      option.textContent = column.title;
      if (selectedColumnId && selectedColumnId === column.id) option.selected = true;
      columnSelect.appendChild(option);
    });
    columnSelect.disabled = false;
  } catch (error) {
    columnSelect.innerHTML = '<option value="">Erro ao carregar</option>';
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function loadGestorFefrelloSettings(panel = createGestorPanel()) {
  const boardSelect = panel.querySelector('#sp-gestor-fefrello-board');
  const responsibleSelect = panel.querySelector('#sp-gestor-fefrello-responsible');
  if (!boardSelect) return;

  const saved = await loadGestorFefrelloConfig();
  boardSelect.innerHTML = '<option value="">Carregando...</option>';
  try {
    const boards = await loadGestorFefrelloBoards();
    boardSelect.innerHTML = '<option value="">Selecione o board...</option>';
    boards.forEach((board) => {
      const option = document.createElement('option');
      option.value = board.id;
      option.textContent = board.name;
      if (saved?.boardId === board.id) option.selected = true;
      boardSelect.appendChild(option);
    });
    if (saved?.responsible && responsibleSelect) {
      responsibleSelect.value = saved.responsible;
    }
    await loadGestorFefrelloColumnsIntoPanel(panel, saved?.boardId || boardSelect.value, saved?.columnId || '');
  } catch (error) {
    boardSelect.innerHTML = '<option value="">Erro ao carregar</option>';
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  }

  boardSelect.onchange = async () => {
    await loadGestorFefrelloColumnsIntoPanel(panel, boardSelect.value);
  };
}

async function onGestorSaveFefrelloSettings() {
  const panel = createGestorPanel();
  const boardId = panel.querySelector('#sp-gestor-fefrello-board')?.value || '';
  const columnId = panel.querySelector('#sp-gestor-fefrello-column')?.value || '';
  const responsible = panel.querySelector('#sp-gestor-fefrello-responsible')?.value || '';
  await saveGestorFefrelloConfig({ boardId, columnId, responsible });
  setGestorStatus('Configuração do Fefrello salva.', 'success');
}

async function onGestorRefreshFefrelloSettings(event) {
  const button = event.currentTarget;
  if (button) {
    button.disabled = true;
    button.textContent = 'Atualizando...';
  }
  try {
    const boards = await loadGestorFefrelloBoards(true);
    const columns = {};
    for (const board of boards) {
      columns[board.id] = await loadGestorFefrelloColumns(board.id, true);
    }
    await saveGestorFefrelloCache({ boards, columns });
    await loadGestorFefrelloSettings();
    setGestorStatus('Cache do Fefrello atualizado.', 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Atualizar Fefrello';
    }
  }
}

function onGestorToggleCard(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  gestorExpandedCardId = gestorExpandedCardId === String(id) ? null : String(id);
  renderGestorPanelContent(createGestorPanel());
}

function onGestorCancelEdit(event) {
  event.preventDefault();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  gestorExpandedCardId = null;
  renderGestorPanelContent(createGestorPanel());
}

async function onGestorSaveCard(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  const card = event.currentTarget.closest('.sp-gestor-card');
  if (!card) return;
  const fields = collectGestorFields(card);
  if (hasGestorDuplicateVenda(fields.numero_venda, id)) {
    setGestorStatus(`Já existe uma pendência com a venda #${fields.numero_venda}.`, 'error');
    return;
  }

  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Salvando...';
  setGestorStatus('Atualizando pendência...', 'info');

  try {
    await updateGestorPendencia(id, fields);
    const index = gestorPendencias.findIndex((item) => String(item.id) === String(id));
    if (index !== -1) {
      gestorPendencias[index] = {
        ...gestorPendencias[index],
        ...fields,
        updated_at: new Date().toISOString()
      };
    }
    gestorExpandedCardId = null;
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Pendencia atualizada.', 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
    button.disabled = false;
    button.textContent = 'Salvar';
  }
}

async function onGestorSendEmail(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  const pendencia = getGestorPendenciaById(id);
  if (!pendencia) {
    setGestorStatus('Pendência não encontrada.', 'error');
    return;
  }
  if (!normalizeGestorEmailSettings(gestorEmailSettings).emailTo) {
    gestorCurrentTab = 'ajustes';
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Defina o destinatário nos Ajustes antes de enviar.', 'error');
    return;
  }
  setGestorStatus('Enviando email...', 'info');
  try {
    const date = new Date().toLocaleDateString('pt-BR');
    const subject = buildGestorEmailSubject(pendencia.login_cliente, date);
    const body = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="color:#222;border-bottom:3px solid #FFE600;padding-bottom:8px;">
          Pendência — ${escapeGestorValue(pendencia.login_cliente) || 'Cliente'}
        </h2>
        <p style="color:#666;margin-bottom:16px;">Data: <strong>${date}</strong></p>
        ${gestorCardToEmailHtml(pendencia)}
      </div>`;
    await sendGestorEmail(subject, body);
    gestorEmailSentIds.add(String(id));
    await saveGestorCardStatus();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Email enviado com sucesso.', 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function onGestorSendConsolidated() {
  const selected = getSelectedGestorBatchItems();
  if (!selected.length) {
    setGestorStatus('Nenhuma pendência selecionada.', 'error');
    return;
  }

  const button = document.getElementById('sp-gestor-batch-consolidated');
  if (button) {
    button.disabled = true;
    button.textContent = 'Enviando...';
  }

  try {
    const date = new Date().toLocaleDateString('pt-BR');
    const subject = `Pendentes - ${date}`;
    const body = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="color:#222;border-bottom:3px solid #FFE600;padding-bottom:8px;">
          Pendências em Aberto — ${date}
        </h2>
        <p style="color:#666;margin-bottom:16px;">Total: <strong>${selected.length}</strong> pendência(s)</p>
        ${selected.map((item, index) =>
          `${index > 0 ? '<hr style="border:none;border-top:1px solid #eee;margin:12px 0;" />' : ''}${gestorCardToEmailHtml(item)}`
        ).join('')}
      </div>`;
    await sendGestorEmail(subject, body);
    selected.forEach((item) => gestorEmailSentIds.add(String(item.id)));
    await saveGestorCardStatus();
    closeGestorBatchModal();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus(`Consolidado enviado — ${selected.length} pendência(s)!`, 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Enviar consolidado';
    }
  }
}

async function onGestorSendIndividualAll() {
  const selected = getSelectedGestorBatchItems();
  if (!selected.length) {
    setGestorStatus('Nenhuma pendência selecionada.', 'error');
    return;
  }

  const button = document.getElementById('sp-gestor-batch-individual');
  if (button) {
    button.disabled = true;
    button.textContent = 'Enviando...';
  }

  let success = 0;
  const errors = [];

  for (const item of selected) {
    try {
      const date = new Date().toLocaleDateString('pt-BR');
      const subject = buildGestorEmailSubject(item.login_cliente, date);
      const body = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="color:#222;border-bottom:3px solid #FFE600;padding-bottom:8px;">
            Pendência — ${escapeGestorValue(item.login_cliente) || 'Cliente'}
          </h2>
          <p style="color:#666;margin-bottom:16px;">Data: <strong>${date}</strong></p>
          ${gestorCardToEmailHtml(item)}
        </div>`;
      await sendGestorEmail(subject, body);
      gestorEmailSentIds.add(String(item.id));
      success += 1;
    } catch (error) {
      errors.push(`${item.login_cliente || 'Cliente'}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await saveGestorCardStatus();
  closeGestorBatchModal();
  renderGestorPanelContent(createGestorPanel());
  setGestorStatus(
    errors.length ? `${success} enviados, ${errors.length} erro(s).` : `${success} email(s) enviado(s)!`,
    errors.length ? 'error' : 'success'
  );

  if (button) {
    button.disabled = false;
    button.textContent = 'Enviar individual';
  }
}

async function onGestorToggleArchive(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  if (gestorArchivedIds.has(String(id))) {
    gestorArchivedIds.delete(String(id));
    gestorCurrentTab = 'pendencias';
    if (gestorExpandedCardId === String(id)) gestorExpandedCardId = null;
    await saveGestorCardStatus();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Pendência retornou para a tela principal.', 'success');
    return;
  }
  gestorArchivedIds.add(String(id));
  if (gestorExpandedCardId === String(id)) gestorExpandedCardId = null;
  await saveGestorCardStatus();
  syncGestorButton();
  renderGestorPanelContent(createGestorPanel());
  setGestorStatus('Pendência arquivada no histórico.', 'success');
}

async function onGestorDelete(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  if (!confirm('Excluir esta pendência?')) return;

  setGestorStatus('Excluindo pendência...', 'info');
  try {
    await deleteGestorPendencia(id);
    gestorArchivedIds.delete(String(id));
    gestorEmailSentIds.delete(String(id));
    gestorCopiedIds.delete(String(id));
    gestorFefrelloSentIds.delete(String(id));
    if (gestorExpandedCardId === String(id)) gestorExpandedCardId = null;
    await saveGestorCardStatus();
    await loadGestorPendencias();
    setGestorStatus('Pendencia excluida.', 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function onGestorSendEmailAction(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  const pendencia = getGestorPendenciaById(id);
  if (!pendencia) {
    setGestorStatus('Pendência não encontrada.', 'error');
    return;
  }
  if (!normalizeGestorEmailSettings(gestorEmailSettings).emailTo) {
    gestorCurrentTab = 'ajustes';
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Defina o destinatário nos Ajustes antes de enviar.', 'error');
    return;
  }
  setGestorStatus('Enviando email...', 'info');
  try {
    const date = new Date().toLocaleDateString('pt-BR');
    const subject = buildGestorEmailSubject(pendencia.login_cliente, date);
    await sendGestorEmail(subject, buildGestorSingleEmailHtml(pendencia, date));
    gestorEmailSentIds.add(String(id));
    await saveGestorCardStatus();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Email enviado com sucesso.', 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function onGestorCopyCardAction(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  const pendencia = getGestorPendenciaById(id);
  if (!pendencia) {
    setGestorStatus('Pendência não encontrada.', 'error');
    return;
  }
  try {
    await copyGestorHtml(buildGestorSingleEmailHtml(pendencia));
    gestorCopiedIds.add(String(id));
    await saveGestorCardStatus();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Dados do cartão copiados.', 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function onGestorCopySelectedAction() {
  const selected = getSelectedGestorBatchItems();
  if (!selected.length) {
    setGestorStatus('Nenhuma pendência selecionada.', 'error');
    return;
  }

  const button = document.getElementById('sp-gestor-batch-copy');
  if (button) {
    button.disabled = true;
    button.textContent = 'Copiando...';
  }

  try {
    const html = selected.length === 1
      ? buildGestorSingleEmailHtml(selected[0])
      : buildGestorConsolidatedEmailHtml(selected);
    await copyGestorHtml(html);
    selected.forEach((item) => gestorCopiedIds.add(String(item.id)));
    await saveGestorCardStatus();
    closeGestorBatchModal();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus(`${selected.length} pendência(s) copiada(s).`, 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Copiar selecionados';
    }
  }
}

async function onGestorCreateFefrelloAction(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event?.currentTarget || event?.target?.closest?.('[data-action="fefrello"]');
  const id = button?.dataset?.id;
  if (!id) return;
  const pendencia = getGestorPendenciaById(id);
  if (!pendencia) return;

  const config = await loadGestorFefrelloConfig();
  if (!config?.boardId || !config?.columnId) {
    gestorCurrentTab = 'ajustes';
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Configure o Fefrello em Ajustes.', 'error');
    return;
  }

  const previousLabel = button?.textContent || 'Fefrello';
  if (button) {
    button.disabled = true;
    button.textContent = 'Criando...';
  }

  try {
    const title = pendencia.login_cliente || pendencia.numero_venda || 'Sem titulo';
    const description = formatGestorCardForFefrello(pendencia);
    await createGestorFefrelloCard(config.boardId, config.columnId, title, description, config.responsible || '');
    gestorFefrelloSentIds.add(String(id));
    await saveGestorCardStatus();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Card Fefrello criado.', 'success');
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = previousLabel;
    }
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function onGestorSendConsolidatedAction() {
  const selected = getSelectedGestorBatchItems();
  if (!selected.length) {
    setGestorStatus('Nenhuma pendencia selecionada.', 'error');
    return;
  }

  const button = document.getElementById('sp-gestor-batch-consolidated');
  if (button) {
    button.disabled = true;
    button.textContent = 'Enviando...';
  }

  try {
    const date = new Date().toLocaleDateString('pt-BR');
    const subject = `Pendentes - ${date}`;
    await sendGestorEmail(subject, buildGestorConsolidatedEmailHtml(selected, date));
    selected.forEach((item) => gestorEmailSentIds.add(String(item.id)));
    await saveGestorCardStatus();
    closeGestorBatchModal();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus(`Consolidado enviado - ${selected.length} pendência(s)!`, 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Enviar consolidado';
    }
  }
}

async function onGestorSendIndividualAllAction() {
  const selected = getSelectedGestorBatchItems();
  if (!selected.length) {
    setGestorStatus('Nenhuma pendência selecionada.', 'error');
    return;
  }

  const button = document.getElementById('sp-gestor-batch-individual');
  if (button) {
    button.disabled = true;
    button.textContent = 'Enviando...';
  }

  let success = 0;
  const errors = [];

  for (const item of selected) {
    try {
      const date = new Date().toLocaleDateString('pt-BR');
      const subject = buildGestorEmailSubject(item.login_cliente, date);
      await sendGestorEmail(subject, buildGestorSingleEmailHtml(item, date));
      gestorEmailSentIds.add(String(item.id));
      success += 1;
    } catch (error) {
      errors.push(`${item.login_cliente || 'Cliente'}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await saveGestorCardStatus();
  closeGestorBatchModal();
  renderGestorPanelContent(createGestorPanel());
  setGestorStatus(
    errors.length ? `${success} enviados, ${errors.length} erro(s).` : `${success} email(s) enviado(s)!`,
    errors.length ? 'error' : 'success'
  );

  if (button) {
    button.disabled = false;
    button.textContent = 'Enviar individual';
  }
}

async function onGestorToggleArchiveAction(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget?.dataset?.id;
  if (!id) return;
  if (gestorArchivedIds.has(String(id))) {
    gestorArchivedIds.delete(String(id));
    if (gestorExpandedCardId === String(id)) gestorExpandedCardId = null;
    await saveGestorCardStatus();
    syncGestorButton();
    renderGestorPanelContent(createGestorPanel());
    setGestorStatus('Pendência retornou para a lista principal.', 'success');
    return;
  }
  gestorArchivedIds.add(String(id));
  if (gestorExpandedCardId === String(id)) gestorExpandedCardId = null;
  await saveGestorCardStatus();
  syncGestorButton();
  renderGestorPanelContent(createGestorPanel());
  setGestorStatus('Pendência arquivada.', 'success');
}

async function onGestorClearArchivedAction() {
  const historico = gestorPendencias.filter((item) => gestorArchivedIds.has(String(item.id)));
  if (!historico.length) {
    setGestorStatus('Não há pendências arquivadas para limpar.', 'error');
    return;
  }
  if (!confirm(`Excluir ${historico.length} pendência(s) arquivada(s)? Esta ação não pode ser desfeita.`)) return;

  const button = document.getElementById('sp-gestor-clear-history');
  if (button) {
    button.disabled = true;
    button.textContent = 'Limpando...';
  }

  setGestorStatus('Limpando historico...', 'info');
  try {
    for (const pendencia of historico) {
      await deleteGestorPendencia(pendencia.id);
      gestorArchivedIds.delete(String(pendencia.id));
      gestorEmailSentIds.delete(String(pendencia.id));
      gestorCopiedIds.delete(String(pendencia.id));
      gestorFefrelloSentIds.delete(String(pendencia.id));
    }
    gestorPendencias = gestorPendencias.filter((item) => !historico.some((archived) => String(archived.id) === String(item.id)));
    if (gestorExpandedCardId && !getGestorPendenciaById(gestorExpandedCardId)) gestorExpandedCardId = null;
    await saveGestorCardStatus();
    renderGestorPanelContent(createGestorPanel());
    syncGestorButton();
    setGestorStatus('Histórico arquivado limpo com sucesso.', 'success');
  } catch (error) {
    setGestorStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Limpar arquivados';
    }
  }
}

function isOrderPickerSupportedPage() {
  const isMercadoLivre =
    window.location.hostname.includes('mercadolivre.com.br') ||
    window.location.hostname.includes('mercadolibre.com');

  return isMercadoLivre && /^\/vendas(\/|$)/.test(window.location.pathname);
}

function getOrderRowsForPicker() {
  return Array.from(document.querySelectorAll('.sc-row, .sc-row-marketplace'))
    .filter((row) => row.querySelector('.left-column__pack-id[aria-label^="#"]'));
}

function getOrderIdFromPickerRow(row) {
  const packNode = row.querySelector('.left-column__pack-id[aria-label^="#"]');
  const rawValue = packNode?.getAttribute('aria-label') || packNode?.textContent || '';
  return rawValue.replace('#', '').trim();
}

function getOrderCheckbox(row) {
  return row.querySelector('input[data-testid="row-checkbox"][type="checkbox"]');
}

function getOrderDetailUrl(orderId) {
  const callbackUrl = encodeURIComponent(window.location.href);
  return `${window.location.origin}/vendas/${orderId}/detalhe?callbackUrl=${callbackUrl}`;
}

function selectOrderCheckbox(checkbox) {
  if (!checkbox || checkbox.disabled || checkbox.checked) {
    return checkbox?.checked === true;
  }

  const clickableTarget =
    checkbox.closest('.andes-checkbox__checkbox') ||
    checkbox.parentElement ||
    checkbox;

  clickableTarget.click();
  if (!checkbox.checked) checkbox.click();

  return checkbox.checked;
}

function collectOrdersFromBottom(quantity) {
  const rows = getOrderRowsForPicker();
  const selectedOrders = [];
  const skippedOrders = [];

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (selectedOrders.length >= quantity) break;

    const row = rows[index];
    const orderId = getOrderIdFromPickerRow(row);
    const checkbox = getOrderCheckbox(row);

    if (!orderId || !checkbox || checkbox.disabled) {
      skippedOrders.push(orderId || `linha-${index + 1}`);
      continue;
    }

    const wasSelected = selectOrderCheckbox(checkbox);
    if (!wasSelected) {
      skippedOrders.push(orderId);
      continue;
    }

    selectedOrders.push({
      orderId,
      numeroVenda: orderId,
      loginCliente: getOrderBuyerLoginFromPickerRow(row),
      url: getOrderDetailUrl(orderId)
    });
  }

  return {
    totalRows: rows.length,
    selectedOrders,
    skippedOrders
  };
}

function setOrderPickerStatus(message, tone = 'info') {
  const status = document.getElementById('sp-order-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function normalizeOrderPickerLogin(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeOrderPickerSaleNumber(value) {
  return String(value || '').replace(/\D+/g, '');
}

function getOrderPickerSearchKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function extractOrderPickerLoginFromText(text) {
  const raw = String(text || '').replace(/\u00a0/g, ' ').trim();
  if (!raw) return '';

  const labeledPatterns = [
    /comprador\s*:?\s*([a-z0-9._-]{3,})/i,
    /cliente\s*:?\s*([a-z0-9._-]{3,})/i,
    /nickname\s*:?\s*([a-z0-9._-]{3,})/i,
    /usuario\s*:?\s*([a-z0-9._-]{3,})/i,
    /@([a-z0-9._-]{3,})/i,
    /([a-z0-9._-]{3,})\s*\|\s*CPF/i
  ];

  for (const pattern of labeledPatterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return normalizeOrderPickerLogin(match[1]);
  }

  const blockedTerms = ['mercado livre', 'entrega', 'full', 'flex', 'venda', 'pedido', 'enviado', 'cancelado', 'pago'];
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lowered = line.toLowerCase();
    if (blockedTerms.some((term) => lowered.includes(term))) continue;
    if (/^#?\d{6,}$/.test(line)) continue;
    const token = line.match(/\b([a-z0-9._-]{3,})\b/i)?.[1] || '';
    if (token && !/^\d+$/.test(token)) return normalizeOrderPickerLogin(token);
  }

  return normalizeOrderPickerLogin(getGestorLoginFromPage(raw));
}

function getOrderBuyerLoginFromPickerRow(row) {
  if (!row) return '';

  const exactNicknameNode = row.querySelector('.buyer.ml-buyer .buyer-nickName, .buyer-nickName, [class*="buyer-nick"]');
  if (exactNicknameNode?.textContent) {
    const login = normalizeOrderPickerLogin(exactNicknameNode.textContent);
    if (login) return login;
  }

  const selectors = [
    '.buyer.ml-buyer',
    '[data-testid*="buyer"]',
    '[data-testid*="customer"]',
    '[data-testid*="nickname"]',
    '[class*="buyer-nick"]',
    '[class*="buyer"]',
    '[class*="customer"]',
    '[class*="nickname"]',
    '[class*="client"]',
    '[class*="user"]'
  ];

  for (const selector of selectors) {
    const nodes = row.querySelectorAll(selector);
    for (const node of nodes) {
      const login = extractOrderPickerLoginFromText(node.textContent || '');
      if (login) return login;
    }
  }

  const htmlMatch = row.innerHTML.match(/buyer-nickName[^>]*>\s*([^<\s]+)/i)
    || row.innerHTML.match(/"nickName":"([^"]+)"/i);
  if (htmlMatch?.[1]) {
    const login = normalizeOrderPickerLogin(htmlMatch[1]);
    if (login) return login;
  }

  return extractOrderPickerLoginFromText(row.innerText || row.textContent || '');
}

function normalizeOrderPickerHistoryEntry(entry) {
  const numeroVenda = normalizeOrderPickerSaleNumber(entry?.numero_venda || entry?.orderId);
  if (!numeroVenda) return null;

  const parsedDate = Date.parse(entry?.selected_at || entry?.selectedAt || entry?.created_at || '');
  const loginCliente = normalizeOrderPickerLogin(entry?.login_cliente || entry?.loginCliente);
  const userId = String(entry?.user_id || entry?.userId || '').trim();
  const ownerEmail = String(entry?.owner_email || entry?.ownerEmail || '').trim();

  return {
    id: String(entry?.id || `${numeroVenda}-${parsedDate || Date.now()}`),
    userId,
    ownerEmail,
    responsavel: getHubUserDisplayName(userId, ownerEmail),
    loginCliente: loginCliente || 'Sem login identificado',
    loginKey: getOrderPickerSearchKey(loginCliente),
    numeroVenda,
    url: typeof entry?.url === 'string' && entry.url ? entry.url : getOrderDetailUrl(numeroVenda),
    selectedAt: Number.isNaN(parsedDate) ? new Date().toISOString() : new Date(parsedDate).toISOString()
  };
}

function normalizeOrderPickerHistory(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(normalizeOrderPickerHistoryEntry)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.selectedAt) - Date.parse(a.selectedAt));
}

async function loadOrderPickerHistory(force = false) {
  if (!hasAuthSession()) {
    orderPickerHistoryCache = [];
    orderPickerHistoryLoaded = true;
    orderPickerHistoryLoading = false;
    return [];
  }

  if (orderPickerHistoryLoaded && !force) return orderPickerHistoryCache;

  orderPickerHistoryLoading = true;
  try {
    await loadHubUserProfiles(force);
    const rows = await sbFetch(`/rest/v1/${ORDER_PICKER_TABLE}?order=selected_at.desc&select=id,user_id,owner_email,login_cliente,numero_venda,url,selected_at,created_at`);
    orderPickerHistoryCache = normalizeOrderPickerHistory(rows);
    orderPickerHistoryLoaded = true;
    return orderPickerHistoryCache;
  } finally {
    orderPickerHistoryLoading = false;
  }
}

async function saveOrderPickerHistoryEntries(entries) {
  if (!hasAuthSession()) {
    throw new Error('Faça login no Hub para registrar os pedidos.');
  }

  const selectedAt = new Date().toISOString();
  const payload = entries
    .map((entry) => {
      const numeroVenda = normalizeOrderPickerSaleNumber(entry?.numeroVenda || entry?.orderId);
      if (!numeroVenda) return null;
      return {
        user_id: auth.user.id,
        owner_email: auth.user?.email || '',
        login_cliente: normalizeOrderPickerLogin(entry?.loginCliente) || 'Sem login identificado',
        numero_venda: numeroVenda,
        url: typeof entry?.url === 'string' ? entry.url : getOrderDetailUrl(numeroVenda),
        selected_at: selectedAt
      };
    })
    .filter(Boolean);

  if (!payload.length) return;

  await sbFetch(`/rest/v1/${ORDER_PICKER_TABLE}`, {
    method: 'POST',
    headers: {
      Prefer: 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  await loadOrderPickerHistory(true);
}

async function deleteOrderPickerHistoryEntry(id) {
  if (!hasAuthSession() || !id) return;

  await sbFetch(`/rest/v1/${ORDER_PICKER_TABLE}?id=eq.${encodeURIComponent(id)}&user_id=eq.${auth.user.id}`, {
    method: 'DELETE',
    headers: {
      Prefer: 'return=minimal'
    }
  });

  orderPickerHistoryCache = orderPickerHistoryCache.filter((entry) => entry.id !== String(id));
}

async function clearOrderPickerHistory() {
  if (!hasAuthSession()) return;

  await sbFetch(`/rest/v1/${ORDER_PICKER_TABLE}?user_id=eq.${auth.user.id}`, {
    method: 'DELETE',
    headers: {
      Prefer: 'return=minimal'
    }
  });

  orderPickerHistoryCache = [];
  orderPickerHistoryLoaded = true;
}

function formatOrderPickerDate(value) {
  const parsed = Date.parse(value || '');
  if (Number.isNaN(parsed)) return '-';
  return new Date(parsed).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getOrderPickerPeriodStart(period, referenceDate = new Date()) {
  const start = new Date(referenceDate);
  start.setSeconds(0, 0);

  if (period === 'day') {
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (period === 'week') {
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function countUniqueOrderPickerSales(entries) {
  return new Set(entries.map((entry) => entry.numeroVenda)).size;
}

function getOrderPickerSummary(entries) {
  const now = new Date();
  return [
    { key: 'day', label: 'Hoje' },
    { key: 'week', label: 'Semana' },
    { key: 'month', label: 'Mês' }
  ].map((period) => {
    const start = getOrderPickerPeriodStart(period.key, now).getTime();
    const periodEntries = entries.filter((entry) => Date.parse(entry.selectedAt) >= start);
    return {
      label: period.label,
      total: countUniqueOrderPickerSales(periodEntries)
    };
  });
}

function getOrderPickerSearchMatches(entries, loginTerm, saleTerm) {
  const loginKey = getOrderPickerSearchKey(loginTerm);
  const numeroVenda = normalizeOrderPickerSaleNumber(saleTerm);

  return entries.filter((entry) => {
    const matchesLogin = !loginKey || entry.loginKey.includes(loginKey);
    const matchesSale = !numeroVenda || entry.numeroVenda.includes(numeroVenda);
    return matchesLogin && matchesSale;
  });
}

function isSameOrderPickerDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function getOrderPickerHistoryGroups(entries) {
  const now = new Date();
  const todayStart = getOrderPickerPeriodStart('day', now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = getOrderPickerPeriodStart('week', now);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const monthStart = getOrderPickerPeriodStart('month', now);

  const buckets = [
    { key: 'today', label: 'Hoje', entries: [] },
    { key: 'yesterday', label: 'Ontem', entries: [] },
    { key: 'this_week', label: 'Esta semana', entries: [] },
    { key: 'last_week', label: 'Semana passada', entries: [] },
    { key: 'this_month', label: 'Este mês', entries: [] },
    { key: 'older', label: 'Mais antigos', entries: [] }
  ];

  entries.forEach((entry) => {
    const selectedAt = new Date(entry.selectedAt);
    const time = selectedAt.getTime();
    if (Number.isNaN(time)) {
      buckets[5].entries.push(entry);
      return;
    }

    if (isSameOrderPickerDay(selectedAt, now)) {
      buckets[0].entries.push(entry);
      return;
    }
    if (isSameOrderPickerDay(selectedAt, yesterdayStart)) {
      buckets[1].entries.push(entry);
      return;
    }
    if (time >= weekStart.getTime()) {
      buckets[2].entries.push(entry);
      return;
    }
    if (time >= lastWeekStart.getTime()) {
      buckets[3].entries.push(entry);
      return;
    }
    if (time >= monthStart.getTime()) {
      buckets[4].entries.push(entry);
      return;
    }
    buckets[5].entries.push(entry);
  });

  return buckets.filter((bucket) => bucket.entries.length > 0);
}

function setOrderPickerView(view, panel = document.getElementById('sp-order-panel') || createOrderPickerPanel()) {
  const nextView = view === 'history' ? 'history' : 'picker';
  orderPickerCurrentView = nextView;

  panel.querySelectorAll('.sp-order-tab').forEach((button) => {
    const isActive = button.dataset.view === nextView;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  panel.querySelectorAll('.sp-order-view').forEach((section) => {
    section.classList.toggle('is-active', section.dataset.view === nextView);
  });

  if (nextView === 'history') {
    void refreshOrderPickerDashboard(panel);
  }
}

function renderOrderPickerSessionState(panel) {
  const sessionBox = panel?.querySelector('#sp-order-session');
  const quantityInput = panel?.querySelector('#sp-order-quantity');
  const runButton = panel?.querySelector('#sp-order-run');
  const searchInputs = panel ? Array.from(panel.querySelectorAll('.sp-order-search-grid input')) : [];
  const refreshButton = panel?.querySelector('#sp-order-refresh');
  const clearButton = panel?.querySelector('#sp-order-clear');
  const ownEntryCount = orderPickerHistoryCache.filter((entry) => String(entry.userId || '') === String(auth.user?.id || '')).length;
  if (!sessionBox) return;

  if (hasAuthSession()) {
    sessionBox.innerHTML = `
      <div class="sp-order-session__copy">
        <span>Conta do Hub</span>
        <strong>${escapeHtml(getAuthUserDisplayName())}</strong>
        <small>${escapeHtml(auth.user?.email || '')}</small>
      </div>
    `;
  } else {
    sessionBox.innerHTML = `
      <div class="sp-order-session__copy">
        <span>Conta do Hub</span>
        <strong>Login necessário</strong>
      </div>
      <button type="button" id="sp-order-open-auth" class="sp-order-link">Abrir login</button>
    `;
    sessionBox.querySelector('#sp-order-open-auth')?.addEventListener('click', () => openAuthPanel());
  }

  const disabled = !hasAuthSession();
  if (quantityInput) quantityInput.disabled = disabled;
  if (runButton) runButton.disabled = disabled;
  if (refreshButton) refreshButton.disabled = disabled;
  if (clearButton) clearButton.disabled = disabled || ownEntryCount === 0;
  searchInputs.forEach((input) => { input.disabled = disabled; });
}

function buildOrderPickerHistoryItem(entry) {
  const safeLogin = escapeHtml(entry.loginCliente);
  const safeVenda = escapeHtml(entry.numeroVenda);
  const safeDate = escapeHtml(formatOrderPickerDate(entry.selectedAt));
  const safeUrl = escapeHtml(entry.url || getOrderDetailUrl(entry.numeroVenda));
  const safeResponsavel = escapeHtml(entry.responsavel || 'Usuário do Hub');

  const canDelete = String(entry.userId || '') === String(auth.user?.id || '');
  return `
    <article class="sp-order-history-item">
      <div class="sp-order-history-item__head">
        <div class="sp-order-history-item__identity">
          <strong>${safeLogin}</strong>
          <span class="sp-order-history-item__sale">Venda #${safeVenda}</span>
        </div>
        <div class="sp-order-history-item__actions">
          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="sp-order-action sp-order-action--open">Abrir</a>
          ${canDelete ? `<button type="button" class="sp-order-action sp-order-action--delete" data-order-history-delete="${escapeHtml(entry.id)}">Excluir</button>` : ''}
        </div>
      </div>
      <p class="sp-order-history-item__meta">Responsável: ${safeResponsavel} • ${safeDate}</p>
    </article>
  `;
}

function buildOrderPickerHistoryGroup(group) {
  return `
    <section class="sp-order-history-group">
      <div class="sp-order-history-group__header">
        <strong>${escapeHtml(group.label)}</strong>
        <span>${group.entries.length}</span>
      </div>
      <div class="sp-order-history-group__list">
        ${group.entries.map(buildOrderPickerHistoryItem).join('')}
      </div>
    </section>
  `;
}

function renderOrderPickerDashboard(panel = document.getElementById('sp-order-panel')) {
  if (!panel) return;

  const metrics = panel.querySelector('#sp-order-metrics');
  const historyTitle = panel.querySelector('#sp-order-history-title');
  const searchLoginInput = panel.querySelector('#sp-order-search-login');
  const searchSaleInput = panel.querySelector('#sp-order-search-sale');
  const searchResult = panel.querySelector('#sp-order-search-result');
  const historyList = panel.querySelector('#sp-order-history-list');
  const clearButton = panel.querySelector('#sp-order-clear');

  if (!metrics || !searchResult || !historyList) return;

  renderOrderPickerSessionState(panel);

  const summary = getOrderPickerSummary(orderPickerHistoryCache);
  metrics.innerHTML = summary.map((item) => `
    <article class="sp-order-metric">
      <span>${item.label}</span>
      <strong>${item.total}</strong>
      <small>vendas únicas</small>
    </article>
  `).join('');

  if (historyTitle) {
    historyTitle.textContent = 'Histórico de pedidos';
  }
  if (clearButton) {
    clearButton.disabled = !hasAuthSession() || !orderPickerHistoryCache.some((entry) => String(entry.userId || '') === String(auth.user?.id || ''));
  }

  if (!hasAuthSession()) {
    searchResult.dataset.tone = 'warning';
    searchResult.innerHTML = '<p>Faça login no Hub para listar, buscar e excluir o histórico remoto.</p>';
    historyList.innerHTML = '<p class="sp-order-empty">Sem sessão ativa.</p>';
    return;
  }

  if (orderPickerHistoryLoading && !orderPickerHistoryCache.length) {
    searchResult.dataset.tone = 'info';
    searchResult.innerHTML = '<p>Carregando histórico...</p>';
    historyList.innerHTML = '<p class="sp-order-empty">Buscando registros no Supabase.</p>';
    return;
  }

  const loginTerm = String(searchLoginInput?.value || '').trim();
  const saleTerm = String(searchSaleInput?.value || '').trim();
  const hasFilter = Boolean(loginTerm || saleTerm);
  const matches = getOrderPickerSearchMatches(orderPickerHistoryCache, loginTerm, saleTerm);

  if (!hasFilter) {
    searchResult.dataset.tone = 'info';
    searchResult.innerHTML = '<p>Busque pelo login do comprador e/ou pelo número da venda.</p>';
  } else if (matches.length > 0) {
    const responsaveis = [...new Set(matches.map((entry) => entry.responsavel).filter(Boolean))].slice(0, 4);
    searchResult.dataset.tone = 'success';
    searchResult.innerHTML = `<p>${matches.length} registro(s) encontrado(s) para o filtro informado.</p>${responsaveis.length ? `<p>Responsável(eis): ${escapeHtml(responsaveis.join(', '))}</p>` : ''}`;
  } else {
    searchResult.dataset.tone = 'error';
    searchResult.innerHTML = '<p>Nenhum registro encontrado para esse filtro.</p>';
  }

  const visibleEntries = (hasFilter ? matches : orderPickerHistoryCache).slice(0, 40);
  const groups = getOrderPickerHistoryGroups(visibleEntries);
  historyList.innerHTML = groups.length
    ? groups.map(buildOrderPickerHistoryGroup).join('')
    : '<p class="sp-order-empty">Nenhum pedido registrado ainda.</p>';
}

async function refreshOrderPickerDashboard(panel = document.getElementById('sp-order-panel'), force = false) {
  if (!panel) return;

  if (hasAuthSession()) {
    try {
      await loadOrderPickerHistory(force);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOrderPickerStatus(message, 'error');
      const searchResult = panel.querySelector('#sp-order-search-result');
      if (searchResult) {
        searchResult.dataset.tone = 'error';
        searchResult.innerHTML = `<p>${escapeHtml(message)}</p>`;
      }
    }
  } else {
    orderPickerHistoryCache = [];
    orderPickerHistoryLoaded = true;
    orderPickerHistoryLoading = false;
  }

  renderOrderPickerDashboard(panel);
}

async function loadOrderPickerQuantity(input) {
  try {
    const stored = await chrome.storage.local.get(PEGADOR_STORAGE_KEY);
    const quantity = Number(stored?.[PEGADOR_STORAGE_KEY]);
    if (Number.isInteger(quantity) && quantity > 0) {
      input.value = String(quantity);
    }
  } catch (_) {}

  input.dataset.autoClear = input.value ? 'true' : 'false';
}

function createOrderPickerPanel() {
  const existingPanel = document.getElementById('sp-order-panel');
  if (existingPanel) return existingPanel;

  const panel = document.createElement('section');
  panel.id = 'sp-order-panel';
  applyHubTheme(panel);
  panel.innerHTML = `
    <div class="sp-order-panel__header">
      <strong>Pegador de Pedidos</strong>
      <button type="button" id="sp-order-close" class="sp-order-close" aria-label="Fechar">x</button>
    </div>
    <div id="sp-order-session" class="sp-order-session"></div>
    <div class="sp-order-tabs" role="tablist" aria-label="Modos do pegador de pedidos">
      <button type="button" class="sp-order-tab is-active" data-view="picker" aria-selected="true">Coleta</button>
      <button type="button" class="sp-order-tab" data-view="history" aria-selected="false">Painel</button>
    </div>
    <div class="sp-order-view is-active" data-view="picker">
      <label class="sp-order-field">
        <span>Quantidade de pedidos</span>
        <input id="sp-order-quantity" type="number" min="1" step="1" value="1" />
      </label>
      <button type="button" id="sp-order-run" class="sp-order-run">Selecionar e abrir</button>
      <p id="sp-order-status" class="sp-order-status" data-tone="info"></p>
    </div>
    <div class="sp-order-view" data-view="history">
      <div id="sp-order-metrics" class="sp-order-metrics"></div>
      <div class="sp-order-search-grid">
        <label class="sp-order-field">
          <span>Buscar por login</span>
          <input id="sp-order-search-login" type="search" placeholder="Ex.: cliente123" />
        </label>
        <label class="sp-order-field">
          <span>Buscar por venda</span>
          <input id="sp-order-search-sale" type="search" placeholder="Ex.: 2000001234567890" />
        </label>
      </div>
      <div id="sp-order-search-result" class="sp-order-search-result" data-tone="info"></div>
      <div class="sp-order-history-head">
        <strong id="sp-order-history-title">Histórico de pedidos</strong>
        <div class="sp-order-history-actions">
          <button type="button" id="sp-order-refresh" class="sp-order-link">Atualizar</button>
          <button type="button" id="sp-order-clear" class="sp-order-link sp-order-link--danger">Limpar tudo</button>
        </div>
      </div>
      <div id="sp-order-history-list" class="sp-order-history-list"></div>
    </div>
  `;

  document.body.appendChild(panel);

  const quantityInput = panel.querySelector('#sp-order-quantity');
  const runButton = panel.querySelector('#sp-order-run');
  const closeButton = panel.querySelector('#sp-order-close');
  const refreshButton = panel.querySelector('#sp-order-refresh');
  const clearButton = panel.querySelector('#sp-order-clear');
  const historyList = panel.querySelector('#sp-order-history-list');

  loadOrderPickerQuantity(quantityInput);
  renderOrderPickerSessionState(panel);
  void refreshOrderPickerDashboard(panel, true);
  runButton.addEventListener('click', runOrderPicker);
  panel.querySelectorAll('.sp-order-tab').forEach((button) => {
    button.addEventListener('click', () => setOrderPickerView(button.dataset.view, panel));
  });
  quantityInput.addEventListener('keydown', (event) => {
    if (/^\d$/.test(event.key) && quantityInput.dataset.autoClear !== 'false') {
      quantityInput.value = '';
      quantityInput.dataset.autoClear = 'false';
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      runOrderPicker();
    }
  });
  quantityInput.addEventListener('input', () => {
    if (quantityInput.dataset.autoClear !== 'false' && quantityInput.value === '') {
      quantityInput.dataset.autoClear = 'false';
    }
  });
  panel.querySelectorAll('.sp-order-search-grid input').forEach((input) => {
    input.addEventListener('input', () => renderOrderPickerDashboard(panel));
  });
  refreshButton.addEventListener('click', () => {
    void refreshOrderPickerDashboard(panel, true);
  });
  clearButton.addEventListener('click', async () => {
    if (!hasAuthSession()) {
      setOrderPickerStatus('Faça login no Hub para limpar o histórico.', 'error');
      return;
    }
    if (!orderPickerHistoryCache.some((entry) => String(entry.userId || '') === String(auth.user?.id || ''))) return;
    if (!window.confirm('Deseja excluir todo o seu histórico do painel?')) return;

    try {
      await clearOrderPickerHistory();
      renderOrderPickerDashboard(panel);
      setOrderPickerStatus('Histórico removido com sucesso.', 'success');
      mostrarNotificacao('Histórico do painel removido.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOrderPickerStatus(message, 'error');
      mostrarNotificacao(message, 'error');
    }
  });
  historyList.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-order-history-delete]');
    if (!deleteButton) return;

    const recordId = deleteButton.getAttribute('data-order-history-delete') || '';
    if (!recordId || !window.confirm('Excluir este registro do histórico?')) return;

    try {
      await deleteOrderPickerHistoryEntry(recordId);
      renderOrderPickerDashboard(panel);
      setOrderPickerStatus('Registro removido do histórico.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOrderPickerStatus(message, 'error');
      mostrarNotificacao(message, 'error');
    }
  });
  closeButton.addEventListener('click', closeOrderPickerPanel);

  return panel;
}

function openOrderPickerPanel() {
  const panel = createOrderPickerPanel();
  applyHubTheme(panel);
  panel.classList.add('visible');
  document.getElementById('sp-btn-orders')?.classList.add('sp-active');
  renderOrderPickerSessionState(panel);
  setOrderPickerView(orderPickerCurrentView, panel);
  void refreshOrderPickerDashboard(panel);

  if (!isOrderPickerSupportedPage()) {
    setOrderPickerStatus('Abra a tela de Vendas do Mercado Livre para usar este modulo.', 'error');
  } else if (!hasAuthSession()) {
    setOrderPickerStatus('Faça login no Hub para registrar os pedidos no painel.', 'error');
  } else {
    setOrderPickerStatus('Defina a quantidade e execute a coleta.', 'info');
  }
  const quantityInput = panel.querySelector('#sp-order-quantity');
  if (quantityInput) {
    quantityInput.dataset.autoClear = quantityInput.value ? 'true' : 'false';
    if (orderPickerCurrentView === 'picker' && hasAuthSession()) {
      quantityInput.focus();
      quantityInput.select();
    }
  }
}

function closeOrderPickerPanel() {
  document.getElementById('sp-order-panel')?.classList.remove('visible');
  document.getElementById('sp-btn-orders')?.classList.remove('sp-active');
}

function toggleOrderPickerPanel() {
  const panel = createOrderPickerPanel();
  if (panel.classList.contains('visible')) {
    closeOrderPickerPanel();
  } else {
    openOrderPickerPanel();
  }
}

async function runOrderPicker() {
  const panel = createOrderPickerPanel();
  const quantityInput = panel.querySelector('#sp-order-quantity');
  const runButton = panel.querySelector('#sp-order-run');
  const requestedQuantity = Number(quantityInput?.value);

  if (!hasAuthSession()) {
    setOrderPickerStatus('Faça login no Hub para registrar os pedidos no painel.', 'error');
    openAuthPanel();
    return;
  }

  if (!isOrderPickerSupportedPage()) {
    setOrderPickerStatus('Abra a tela de Vendas do Mercado Livre para usar este modulo.', 'error');
    return;
  }

  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    setOrderPickerStatus('Informe uma quantidade inteira maior que zero.', 'error');
    quantityInput?.focus();
    return;
  }

  runButton.disabled = true;
  setOrderPickerStatus('Processando pedidos...', 'info');

  try {
    await chrome.storage.local.set({ [PEGADOR_STORAGE_KEY]: requestedQuantity });

    const result = collectOrdersFromBottom(requestedQuantity);
    if (result.totalRows === 0) {
      throw new Error('Nenhuma linha de pedido foi encontrada nesta pagina.');
    }
    if (result.selectedOrders.length === 0) {
      throw new Error('Nenhum pedido visivel pode ser selecionado no momento.');
    }

    const openResult = await chrome.runtime.sendMessage({
      type: 'OPEN_ORDER_TABS',
      urls: result.selectedOrders.map((order) => order.url)
    });

    if (!openResult?.ok) {
      throw new Error(openResult?.error || 'Falha ao abrir os pedidos.');
    }

    await saveOrderPickerHistoryEntries(result.selectedOrders);
    renderOrderPickerDashboard(panel);

    const processedOrders = result.selectedOrders.map((order) => order.numeroVenda).join(', ');
    const processedLogins = [...new Set(result.selectedOrders.map((order) => order.loginCliente).filter(Boolean))].slice(0, 5).join(', ');
    setOrderPickerStatus(
      `Selecionados: ${result.selectedOrders.length}\n` +
      `Abas abertas: ${openResult.opened || 0}\n` +
      `Logins: ${processedLogins || 'Sem login identificado'}\n` +
      `Vendas: ${processedOrders || '-'}`,
      'success'
    );

    mostrarNotificacao(`${openResult.opened || 0} pedido${openResult.opened === 1 ? '' : 's'} aberto${openResult.opened === 1 ? '' : 's'}!`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setOrderPickerStatus(message, 'error');
    mostrarNotificacao(message, 'error');
  } finally {
    runButton.disabled = false;
  }
}

let isMonitoring = true;
let observer = null;
let checkInterval = null;
let lastProcessedContent = '';

initialize();

async function initialize() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
    if (response) isMonitoring = response.isMonitoring;
  } catch (e) { /* SW ainda não pronto */ }
  startMonitoring();
}

function startMonitoring() {
  if (observer || checkInterval) stopMonitoring();
  console.log('Sentinela Pro: Monitoramento iniciado');
  checkForOrders();
  observer = new MutationObserver(() => {
    setTimeout(() => { checkForOrders(); }, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  checkInterval = setInterval(() => { checkForOrders(); }, 5000);
}

function stopMonitoring() {
  console.log('Sentinela Pro: Monitoramento parado');
  if (observer) { observer.disconnect(); observer = null; }
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  lastProcessedContent = '';
  document.querySelectorAll('.sentinela-target').forEach(el => {
    el.classList.remove('sentinela-target');
    el.style.removeProperty('background-color');
    el.style.removeProperty('box-shadow');
    el.style.removeProperty('border-radius');
    el.style.removeProperty('padding');
    el.style.removeProperty('margin');
  });
  document.querySelectorAll('.sentinela-target-text').forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
  });
  const existingNotif = document.getElementById('sentinela-persistent-notification');
  if (existingNotif) existingNotif.remove();
}

function checkForOrders() {
  if (!isMonitoring) return;
  let foundCases = [];

  try {
    const currentContent = document.body.innerText;
    if (currentContent !== lastProcessedContent) {
      const pageText = currentContent.toLowerCase();
      if (pageText.includes('2 unidades')) {
        const orderPatterns = [
          /venda\s*#\s*(\d+)/gi, /pedido\s*#\s*(\d+)/gi, /ordem\s*#\s*(\d+)/gi,
          /venda\s*(\d{4,})/gi, /pedido\s*(\d{4,})/gi
        ];
        let foundOrders = [];
        const fullText = document.body.innerText;
        orderPatterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(fullText)) !== null) {
            if (!foundOrders.includes(match[0])) foundOrders.push(match[0]);
          }
        });
        const selectors = [
          '[class*="order"]', '[class*="venda"]', '[class*="pedido"]', '[id*="order"]',
          '[id*="venda"]', '[id*="pedido"]', 'h1, h2, h3, h4, h5, h6', '.title, .header, .info'
        ];
        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(element => {
            orderPatterns.forEach(pattern => {
              let match;
              while ((match = pattern.exec(element.textContent)) !== null) {
                if (!foundOrders.includes(match[0])) foundOrders.push(match[0]);
              }
            });
          });
        });
        foundOrders.forEach(orderNumber => {
          const elementHash = hashCode(currentContent + orderNumber + window.location.href);
          chrome.runtime.sendMessage({ action: 'orderFound', orderNumber, elementHash }).catch(() => {});
        });
      }
      lastProcessedContent = currentContent;
    }
  } catch (error) { console.error('Erro na verificação de pedidos:', error); }

  try {
    let wasObserverActive = false;
    if (observer) { observer.disconnect(); wasObserverActive = true; }
    foundCases = detectAndHighlightCases();
    if (foundCases.length > 0) {
      showPersistentNotification([...new Set(foundCases)]);
    } else {
      const existingNotif = document.getElementById('sentinela-persistent-notification');
      if (existingNotif) existingNotif.remove();
    }
    if (wasObserverActive && observer) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  } catch (error) { console.error('Erro ao destacar/mostrar notificação:', error); }
}

function detectAndHighlightCases() {
  let foundCases = [];
  document.querySelectorAll('.sentinela-target').forEach(el => {
    el.classList.remove('sentinela-target');
    el.style.removeProperty('background-color');
    el.style.removeProperty('box-shadow');
    el.style.removeProperty('border-radius');
    el.style.removeProperty('padding');
    el.style.removeProperty('margin');
  });
  document.querySelectorAll('.sentinela-target-text').forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
  });

  const quantityElements = document.querySelectorAll('.sc-quantity.sc-quantity__unique span');
  quantityElements.forEach(el => {
    if (el && el.textContent.toLowerCase().includes('2 unidades')) {
      foundCases.push('2 unidades'); createHighlight(el);
    }
  });

  const sublabelElements = document.querySelectorAll('.sc-title-subtitle-action__sublabel, .section-item-information');
  sublabelElements.forEach(el => {
    if (!el) return;
    const text = el.textContent;
    if (text.toLowerCase().includes('com pedra')) {
      foundCases.push('Modelo com Pedra');
      highlightTextInElement(el, 'com pedra');
    }
    const femaleMatch = text.match(/Tamanho::?\s*Feminino\s*-\s*(\d+)/i);
    const maleMatch   = text.match(/Tamanho::?\s*Masculino\s*-\s*(\d+)/i);
    if (femaleMatch && maleMatch) {
      const femaleSize = parseInt(femaleMatch[1]);
      const maleSize   = parseInt(maleMatch[1]);
      if (femaleSize > maleSize) {
        const caseMessage = `Tamanho Feminino (${femaleSize}) > Masculino (${maleSize})`;
        foundCases.push(caseMessage);
        createHighlight(el);
        chrome.runtime.sendMessage({ action: 'sizeAlert', message: caseMessage, femaleSize, maleSize });
      }
    }
  });

  const titleElements = document.querySelectorAll('.sc-detail-title__text');
  titleElements.forEach(el => {
    if (el && el.textContent.includes('1 pacote')) {
      foundCases.push('1 pacote'); createHighlight(el.parentNode);
    }
  });

  const allTextElements = document.querySelectorAll(
    '.sc-detail-title__text, .andes-list__item-primary, .sc-title-subtitle-action__sublabel, [class*="title"], [class*="description"]'
  );
  allTextElements.forEach(el => {
    if (!el) return;
    const text = el.textContent;
    if (text.toLowerCase().includes('6mm banhada ouro com friso prateado')) {
      foundCases.push('6mm Banhada Ouro Com Friso Prateado');
      highlightTextInElement(el, '6mm Banhada Ouro Com Friso Prateado');
    }
  });

  document.querySelectorAll('.andes-button__content').forEach(el => {
    if (el && el.textContent.trim() === 'Ver mensagens') foundCases.push('Ver mensagens');
  });

  document.querySelectorAll('.sc-title-subtitle-action__label').forEach(el => {
    if (!el) return;
    if (el.textContent.toLowerCase().includes('pedra')) {
      foundCases.push('Modelo com Pedra');
      highlightTextInElement(el, 'pedra');
    }
  });

  return foundCases;
}

function highlightTextInElement(element, textToHighlight) {
  if (!element || typeof element.innerHTML === 'undefined') return;
  if (element.querySelector('.sentinela-target-text')) return;
  const innerHTML = element.innerHTML;
  const regex = new RegExp(`(${textToHighlight})`, 'gi');
  if (innerHTML.toLowerCase().includes(textToHighlight.toLowerCase())) {
    element.innerHTML = innerHTML.replace(regex, (match) =>
      `<span class="sentinela-target-text" style="background-color: rgba(255, 0, 0, 0.2); border-radius: 4px;">${match}</span>`
    );
  }
}

function createHighlight(element) {
  element.classList.add('sentinela-target');
  element.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
  element.style.boxShadow = 'inset 0 0 0 2px red';
  element.style.borderRadius = '4px';
  element.style.padding = '0';
  element.style.margin = '0';
}

function makeElementDraggable(elementToDrag, handleElement) {
  let isDragging = false, offsetX, offsetY;
  handleElement.style.cursor = 'grab';
  handleElement.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    const rect = elementToDrag.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    elementToDrag.style.right = 'auto';
    elementToDrag.style.bottom = 'auto';
    elementToDrag.style.left = `${rect.left}px`;
    elementToDrag.style.top = `${rect.top}px`;
    handleElement.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
  function onMouseMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    let newX = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - elementToDrag.offsetWidth));
    let newY = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - elementToDrag.offsetHeight));
    elementToDrag.style.left = `${newX}px`;
    elementToDrag.style.top = `${newY}px`;
  }
  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    handleElement.style.cursor = 'grab';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    chrome.storage.local.set({ 'sentinelaNotificationPosition': { left: elementToDrag.style.left, top: elementToDrag.style.top } });
  }
}

function showPersistentNotification(cases) {
  if (window.location.href.startsWith('https://www.mercadolivre.com.br/vendas/omni/lista')) return;
  const casesKey = cases.join('||');
  const existingPanel = document.getElementById('sentinela-persistent-notification');
  if (existingPanel && existingPanel.dataset.casesKey === casesKey) return;
  if (existingPanel) existingPanel.remove();

  if (!document.getElementById('sentinela-overlay-styles')) {
    const style = document.createElement('style');
    style.id = 'sentinela-overlay-styles';
    style.textContent = `
      @keyframes sn-slidein { from { transform: translateX(calc(100% + 28px)); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes sn-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      #sentinela-persistent-notification { animation: sn-slidein 0.38s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      .sn-dot-pulse { animation: sn-pulse 1.8s ease-in-out infinite; }
    `;
    document.head.appendChild(style);
  }

  const panel = document.createElement('div');
  panel.id = 'sentinela-persistent-notification';
  panel.dataset.casesKey = casesKey;
  panel.style.cssText = `position:fixed;right:20px;bottom:50px;width:288px;background:#111827;border-radius:12px;box-shadow:0 0 0 1px rgba(255,255,255,0.07),0 4px 6px rgba(0,0,0,0.4),0 12px 28px rgba(0,0,0,0.55);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;overflow:hidden;user-select:none;z-index:999999;`;

  const topStripe = document.createElement('div');
  topStripe.style.cssText = 'height:3px;background:linear-gradient(90deg,#ef4444 0%,#f97316 100%);';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:9px 11px 9px 13px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:grab;';

  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = 'display:flex;align-items:center;gap:7px;pointer-events:none;';

  const liveDot = document.createElement('span');
  liveDot.className = 'sn-dot-pulse';
  liveDot.style.cssText = 'display:inline-block;width:7px;height:7px;background:#ef4444;border-radius:50%;flex-shrink:0;';

  const badge = document.createElement('span');
  badge.textContent = 'SENTINELA PRO';
  badge.style.cssText = 'font-size:10px;font-weight:800;letter-spacing:1.2px;color:#ef4444;text-transform:uppercase;';

  const countBadge = document.createElement('span');
  countBadge.textContent = `${cases.length} alerta${cases.length > 1 ? 's' : ''}`;
  countBadge.style.cssText = 'font-size:10px;font-weight:500;color:#6b7280;';

  headerLeft.appendChild(liveDot);
  headerLeft.appendChild(badge);
  headerLeft.appendChild(countBadge);

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&#10005;';
  closeBtn.style.cssText = 'background:transparent;border:none;color:#4b5563;width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;flex-shrink:0;transition:background 0.15s,color 0.15s;';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(239,68,68,0.15)'; closeBtn.style.color = '#ef4444'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#4b5563'; });
  closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.remove(); });

  header.appendChild(headerLeft);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.style.cssText = 'padding:10px 12px 12px;';

  const bodyTitle = document.createElement('div');
  bodyTitle.textContent = 'Atenção necessária';
  bodyTitle.style.cssText = 'font-size:13px;font-weight:700;color:#f9fafb;margin-bottom:7px;';

  const itemList = document.createElement('div');
  itemList.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

  cases.forEach(c => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 9px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.18);border-radius:6px;';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:5px;height:5px;background:#ef4444;border-radius:50%;flex-shrink:0;';
    const txt = document.createElement('span');
    txt.textContent = c;
    txt.style.cssText = 'font-size:12.5px;color:#e5e7eb;line-height:1.35;';
    item.appendChild(dot); item.appendChild(txt); itemList.appendChild(item);
  });

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);';
  const timeLabel = document.createElement('span');
  timeLabel.textContent = `Detectado às ${new Date().toLocaleTimeString('pt-BR')}`;
  timeLabel.style.cssText = 'font-size:10.5px;color:#4b5563;';
  const logoImg = document.createElement('img');
  logoImg.src = chrome.runtime.getURL('icon128.png');
  logoImg.style.cssText = 'width:14px;height:14px;opacity:0.35;';
  footer.appendChild(timeLabel); footer.appendChild(logoImg);

  body.appendChild(bodyTitle); body.appendChild(itemList); body.appendChild(footer);
  panel.appendChild(topStripe); panel.appendChild(header); panel.appendChild(body);
  document.body.appendChild(panel);

  chrome.storage.local.get(['sentinelaNotificationPosition'], (result) => {
    if (result.sentinelaNotificationPosition) {
      panel.style.left   = result.sentinelaNotificationPosition.left;
      panel.style.top    = result.sentinelaNotificationPosition.top;
      panel.style.right  = 'auto';
      panel.style.bottom = 'auto';
    }
    makeElementDraggable(panel, header);
  });
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString();
}

function playAlertSound() {
  try {
    const audio = new Audio(chrome.runtime.getURL('alerta.wav'));
    audio.volume = 0.8;
    audio.play().catch(e => console.error('Erro ao reproduzir áudio:', e));
  } catch (e) { console.error('Erro ao criar áudio:', e); }
}

function showInPageNotification(orderNumber) {
  const notification = document.createElement('div');
  notification.style.cssText = `position:fixed;top:20px;right:20px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:15px 20px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:999999;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;max-width:300px;animation:slideIn 0.5s ease-out;`;
  const style = document.createElement('style');
  style.textContent = `@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}`;
  document.head.appendChild(style);
  notification.innerHTML = `<div style="display:flex;align-items:center;margin-bottom:8px;"><strong> ALERTA !</strong></div><div>Detectado pedido com 2 unidades</div><div style="margin-top:5px;font-size:12px;opacity:0.9;">${orderNumber}</div>`;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.5s ease-out';
    setTimeout(() => { if (notification.parentNode) notification.parentNode.removeChild(notification); }, 500);
  }, 20000);
  notification.addEventListener('click', () => {
    notification.style.animation = 'slideOut 0.5s ease-out';
    setTimeout(() => { if (notification.parentNode) notification.parentNode.removeChild(notification); }, 500);
  });
}

// ══════════════════════════════════════════════════════════════
// MÓDULO: PASSO LARGO (Mensagens Rápidas para Mercado Livre)
// ══════════════════════════════════════════════════════════════

let messageData = { categories: {} };
let buttonPosition = { bottom: '20px', right: '20px', top: 'auto', left: 'auto' };
let activeCategory = null;
let searchQuery    = '';
let isDarkTheme    = false;
let passoLargoRemoteLoaded = false;
let passoLargoSyncTimer = null;
let passoLargoSyncInFlight = false;
let passoLargoLastSyncedSignature = '';
let panelSavedPos  = null;  // posição gravada do overlay arrastar

const PASSO_THEME_VARS = ['--bg','--bg2','--bg3','--bghov','--txt','--txt2','--txt3','--border','--accent','--accenthov','--accentlt','--success','--danger','--dangerlt','--sh-sm','--sh-md','--sh-lg','--r-sm','--r-md','--r-lg','--r-full','--tr'];

function getHubThemeClass() {
  return isDarkTheme ? 'sp-theme-dark' : 'sp-theme-light';
}

function applyHubTheme(element, options = {}) {
  if (!element) return element;

  const { isClip = false } = options;
  element.classList.remove('sp-theme-dark', 'sp-theme-light');
  element.classList.add(getHubThemeClass());

  if (isClip) {
    element.classList.toggle('sp-clip-light', !isDarkTheme);
  }

  return element;
}

function syncHubTheme() {
  applyHubTheme(document.getElementById('sp-topbar'));
  applyHubTheme(document.getElementById('sp-auth-panel'));
  applyHubTheme(document.getElementById('sp-gestor-panel'));
  applyHubTheme(document.getElementById('sp-order-panel'));
  applyHubTheme(document.getElementById('sp-gestor-batch-overlay'));
  applyHubTheme(document.getElementById('extensao-popup-overlay'), { isClip: true });
}

function copyPassoThemeVars(target) {
  const panel = document.getElementById('mr-panel');
  if (!target || !panel) return;

  const computed = getComputedStyle(panel);
  PASSO_THEME_VARS.forEach((variable) => target.style.setProperty(variable, computed.getPropertyValue(variable)));
}

function setGlobalTheme(nextDark) {
  isDarkTheme = Boolean(nextDark);
  localStorage.setItem('mr-theme', isDarkTheme ? 'dark' : 'light');

  document.getElementById('mr-panel')?.classList.toggle('dark', isDarkTheme);
  document.getElementById('mr-settings')?.classList.toggle('dark', isDarkTheme);
  copyPassoThemeVars(document.getElementById('mr-settings'));

  syncHubTheme();
  paintClipIconButton(document.getElementById('btn-coracao'), 'coracao');
  paintClipIconButton(document.getElementById('btn-infinito'), 'infinito');
  paintClipIconButton(document.getElementById('btn-formatar-tudo'), 'formatar');
  paintClipIconButton(document.getElementById('btn-config-fefrello'), 'config', document.getElementById('view-config-fefrello')?.style.display === 'block');

  const authPanel = document.getElementById('sp-auth-panel');
  if (authPanel?.classList.contains('visible')) {
    renderAuthPanelContent(authPanel);
  }
}

const AVAILABLE_VARS = [
  '[NOME_CLIENTE]', '[NUMERO_PEDIDO]', '[PRAZO_ENTREGA]',
  '[DATA]', '[HORA]', '[VALOR]',
];
const categoryIcons = {
  'Gravação': '✍️', 'Desconto 50%': '💰', 'Mercado Pago': '💳',
  'Troca de Endereço': '🏠', 'Troca de Aliança': '💍', 'Menos Usadas': '❓', default: '📂',
};

const PASSO_LARGO_TABLE = 'passo_largo_user_data';

function normalizePassoLargoData(data) {
  if (!data || typeof data !== 'object' || typeof data.categories !== 'object' || !data.categories) {
    return { categories: {} };
  }
  return data;
}

function getMessageDataSignature() {
  try {
    return JSON.stringify(messageData);
  } catch (_) {
    return '';
  }
}

function loadData() {
  try {
    const s = localStorage.getItem('mr-messages');
    if (s) messageData = normalizePassoLargoData(JSON.parse(s));
  } catch(e) {}
  try { const p = localStorage.getItem('mr-button-position'); if (p) buttonPosition = JSON.parse(p); } catch(e) {}
  try { const t = localStorage.getItem('mr-theme');           if (t) isDarkTheme    = t === 'dark';  } catch(e) {}
  chrome.storage.local.get(['sp_panel_pos'], (r) => { if (r.sp_panel_pos) panelSavedPos = r.sp_panel_pos; });
}

async function loadPassoLargoRemoteData() {
  if (!hasAuthSession()) {
    passoLargoRemoteLoaded = false;
    return false;
  }

  const rows = await sbFetch(`/rest/v1/${PASSO_LARGO_TABLE}?user_id=eq.${auth.user.id}&select=payload`);
  const payload = rows?.[0]?.payload;

  if (!payload || typeof payload !== 'object') {
    passoLargoRemoteLoaded = true;
    passoLargoLastSyncedSignature = '';
    return false;
  }

  messageData = normalizePassoLargoData(payload);
  localStorage.setItem('mr-messages', JSON.stringify(messageData));
  passoLargoRemoteLoaded = true;
  passoLargoLastSyncedSignature = getMessageDataSignature();
  return true;
}

async function upsertPassoLargoRemoteData() {
  if (!hasAuthSession()) return;

  const signature = getMessageDataSignature();
  if (!signature || signature === passoLargoLastSyncedSignature) return;

  await sbFetch(`/rest/v1/${PASSO_LARGO_TABLE}`, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({
      user_id: auth.user.id,
      payload: messageData,
      updated_at: new Date().toISOString()
    })
  });

  passoLargoRemoteLoaded = true;
  passoLargoLastSyncedSignature = signature;
}

function schedulePassoLargoSync() {
  if (!hasAuthSession()) return;
  if (passoLargoSyncTimer) clearTimeout(passoLargoSyncTimer);

  passoLargoSyncTimer = setTimeout(async () => {
    if (passoLargoSyncInFlight) return;
    passoLargoSyncInFlight = true;
    try {
      await upsertPassoLargoRemoteData();
    } catch (error) {
      console.warn('[Sentinela Pro] Falha ao sincronizar Passo Largo:', error instanceof Error ? error.message : error);
    } finally {
      passoLargoSyncInFlight = false;
      passoLargoSyncTimer = null;
    }
  }, 400);
}

async function initializePassoLargoForSession() {
  if (!hasAuthSession()) {
    passoLargoRemoteLoaded = false;
    return;
  }

  const loadedRemote = await loadPassoLargoRemoteData();
  if (loadedRemote) return;

  if (Object.keys(messageData.categories).length > 0) {
    await upsertPassoLargoRemoteData();
  }
}

function saveData() {
  localStorage.setItem('mr-messages', JSON.stringify(messageData));
  schedulePassoLargoSync();
}
function saveButtonPosition(top, left) {
  const ww = window.innerWidth, wh = window.innerHeight, dr = ww - left, db = wh - top;
  buttonPosition = { right: dr < ww/2 ? dr+'px' : 'auto', left: dr < ww/2 ? 'auto' : left+'px', bottom: db < wh/2 ? db+'px' : 'auto', top: db < wh/2 ? 'auto' : top+'px' };
  localStorage.setItem('mr-button-position', JSON.stringify(buttonPosition));
}

function formatCustomerName(name) {
  if (!name) return name;
  const normalized = String(name).trim().toLowerCase();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
function getFirstNameFromPage() {
  let n = '';
  for (const s of ['#user_header p', '.andes-message-card__header__title span.andes-text_size_large', '[data-testid="buyer-name"]', '.buyer-info__name', '.user-info__name']) {
    const el = document.querySelector(s);
    if (el) { const t = el.textContent.trim(), m = t.match(/Conversa com (.+)/); n = (m ? m[1] : t).split(' ')[0]; if (n) break; }
  }
  if (!n) {
    const lbl = Array.from(document.querySelectorAll('span,div,p')).find(el => el.textContent.includes('Comprador') || el.textContent.includes('Cliente'));
    if (lbl?.nextElementSibling) n = lbl.nextElementSibling.textContent.trim().split(' ')[0];
  }
  return n.replace(/^(Sr\.|Sra\.)\s*/i, '').trim();
}
function highlightVars(text) { return text.replace(/\[([A-Z_]+)\]/g, '<span class="mr-var">[$1]</span>'); }
function extractVarTags(text) { return [...new Set(text.match(/\[([A-Z_]+)\]/g) || [])]; }
function showToast(msg = 'Mensagem inserida! ✓') {
  const t = document.getElementById('mr-toast'); if (!t) return;
  t.querySelector('.mr-tmsg').textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function insertMessage(message) {
  let final = message;
  if (final.includes('[NOME_CLIENTE]')) {
    const name = getFirstNameFromPage();
    final = name ? final.replace(/\[NOME_CLIENTE\]/g, formatCustomerName(name)) : final.replace(/\[NOME_CLIENTE\]/g, '').trim();
  }
  const campo = document.querySelector('textarea.sc-textarea') || document.querySelector('textarea') || document.querySelector('[contenteditable="true"]') || document.querySelector('input[type="text"]');
  if (campo) {
    campo.focus();
    if (campo.tagName === 'TEXTAREA' || campo.tagName === 'INPUT') {
      campo.value = final; campo.dispatchEvent(new Event('input', { bubbles: true })); campo.dispatchEvent(new Event('change', { bubbles: true }));
    } else { campo.textContent = final; campo.dispatchEvent(new Event('input', { bubbles: true })); }
    
  } else { navigator.clipboard.writeText(final).then(() => showToast('Copiado!')).catch(() => showToast('Não foi possível inserir.')); }
  hidePanel();
}
function getCategoryColor(catName, category) { return category.color || '#3B82F6'; }
function getAllMessages() {
  const results = [];
  Object.entries(messageData.categories).forEach(([catName, cat]) => {
    if (activeCategory && activeCategory !== catName) return;
    Object.entries(cat.subcategories || {}).forEach(([subName, subItem]) => {
      const msg = typeof subItem === 'string' ? subItem : subItem.message;
      const color = typeof subItem === 'object' && subItem.color ? subItem.color : getCategoryColor(catName, cat);
      if (searchQuery) { const q = searchQuery.toLowerCase(); if (!subName.toLowerCase().includes(q) && !msg.toLowerCase().includes(q)) return; }
      results.push({ catName, subName, message: msg, color });
    });
  });
  return results;
}

// ── NLP / Suggestion Engine ───────────────────────────────────
const nlpStopWords = new Set(['a','o','e','é','em','de','do','da','dos','das','um','uma','uns','umas','que','não','com','por','para','como','mais','mas','ou','se','me','te','lhe','nos','vos','ele','ela','eles','elas','eu','tu','você','vocês','meu','minha','meus','minhas','seu','sua','seus','suas','isso','isto','aqui','ali','tudo','todo','toda','todos','todas','já','ainda','então','esse','essa','esses','essas','este','esta','estes','estas','num','numa','pelo','pela','pelos','pelas','foi','ser','ter','haver','estar','bem','sim','oi','olá','ola','bom','boa','dia','tarde','noite','obrigado','obrigada','por','favor','preciso','quero','gostaria']);
function nlpTokenize(text) { return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(t => t.length > 2 && !nlpStopWords.has(t)); }
function nlpTfIdf(query, docs) {
  const qTokens = nlpTokenize(query); if (!qTokens.length) return docs.map(() => 0);
  const docTokens = docs.map(d => nlpTokenize(d.message + ' ' + d.subName)), N = docs.length, idf = {};
  const allTerms = new Set([...qTokens, ...docTokens.flat()]);
  allTerms.forEach(term => { const df = docTokens.filter(dt => dt.includes(term)).length; idf[term] = df > 0 ? Math.log((N+1)/(df+0.5)) : 0; });
  const qTf = {}; qTokens.forEach(t => { qTf[t] = (qTf[t]||0)+1; });
  const qVec = {}; Object.keys(qTf).forEach(t => { qVec[t] = (qTf[t]/qTokens.length)*(idf[t]||0); });
  return docTokens.map(dtArr => {
    const dtf = {}; dtArr.forEach(t => { dtf[t] = (dtf[t]||0)+1; });
    const dVec = {}; Object.keys(dtf).forEach(t => { dVec[t] = (dtf[t]/(dtArr.length||1))*(idf[t]||0); });
    const dot = Object.keys(qVec).reduce((s,t) => s+(qVec[t]||0)*(dVec[t]||0),0);
    const magQ = Math.sqrt(Object.values(qVec).reduce((s,v)=>s+v*v,0)), magD = Math.sqrt(Object.values(dVec).reduce((s,v)=>s+v*v,0));
    return (magQ && magD) ? dot/(magQ*magD) : 0;
  });
}
let suggestionObserver = null;
function recordFeedback() {}
function getLastClientMessages(n=3) {
  const container = document.querySelector('.messages-container') || document.querySelector('[data-testid="messages-container"]') || document.querySelector('.andes-message-card__body') || document.querySelector('.conversation-thread') || document.querySelector('.chat-container');
  if (!container) return '';
  let msgs = [];
  for (const sel of ['.message--received .message__text','.andes-message--incoming .andes-message__bubble','[data-testid="message-received"] .message-text','.message-bubble--buyer','.incoming-message']) {
    const els = container.querySelectorAll(sel); if (els.length) { msgs = Array.from(els).map(el=>el.textContent.trim()).filter(Boolean); break; }
  }
  if (!msgs.length) { const all = container.querySelectorAll('[class*="message"] [class*="text"],[class*="bubble"],[class*="message-content"]'); msgs = Array.from(all).map(el=>el.textContent.trim()).filter(t=>t.length>3&&t.length<500); }
  return msgs.slice(-n).join(' ');
}
function runSuggestion() {}
function startSuggestionObserver() {
  if (suggestionObserver) suggestionObserver.disconnect();
  suggestionObserver = null;
}

// ── Panel UI ──────────────────────────────────────────────────
function buildPanel() {
  const existing = document.getElementById('mr-panel'); if (existing) existing.remove();
  const panel = document.createElement('div'); panel.id = 'mr-panel'; if (isDarkTheme) panel.classList.add('dark');
  panel.innerHTML = `
    <div class="mr-cn-wrap"><nav class="mr-cn" id="mr-cn"></nav></div>
    <div class="mr-col">
      <div class="mr-hd"><div class="mr-hd-l"><span class="mr-title">Passo Largo</span></div><div class="mr-hd-r"><div class="mr-tt" id="mr-tt" title="Alternar tema"><span class="mr-tti sun">☀</span><span class="mr-tti moon">☽</span></div><button class="mr-ibtn" id="mr-close-btn" title="Fechar">✕</button></div></div>
      <div class="mr-sw"><div class="mr-s"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" id="mr-si" placeholder="Buscar mensagens..." autocomplete="off"></div></div>
      <div class="mr-c" id="mr-c"></div>
      <div class="mr-ft">
        <button class="mr-bnew" id="mr-bnew"><span style="font-size:13px;line-height:1">+</span> Nova Mensagem</button>
        <div class="mr-ftr">
          <button class="mr-ibtn" id="mr-ie-btn" title="Importar / Exportar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg></button>
          <button class="mr-ibtn" id="mr-cat-btn" title="Nova Categoria"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 17h6M17 14v6"/></svg></button>
          <button class="mr-ibtn" id="mr-settings-btn" title="Configurações"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg></button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(panel);
  positionPanel(panel);
  makePanelDraggable(panel);
  panel.addEventListener('click', e => e.stopPropagation());
  panel.querySelector('#mr-tt')?.remove();
  panel.querySelector('#mr-close-btn').onclick = hidePanel;
  panel.querySelector('#mr-si').oninput = (e) => { searchQuery = e.target.value.trim(); renderCards(); };
  panel.querySelector('#mr-bnew').onclick      = () => openMessageModal(null, null);
  panel.querySelector('#mr-cat-btn').onclick   = openCatModal;
  panel.querySelector('#mr-settings-btn').onclick = openSettingsPanel;
  panel.querySelector('#mr-ie-btn').onclick    = openImportExportModal;
  renderCatTabs(); renderCards();
  syncHubTheme();
}

function positionPanel(panel) {
  const ww = window.innerWidth, wh = window.innerHeight;
  panel.style.maxHeight = (wh - 70) + 'px';
  panel.style.bottom = 'auto';
  panel.style.right  = 'auto';
  if (panelSavedPos) {
    // garante que o painel ainda cabe na viewport depois de redimensionamento
    const safeLeft = Math.max(0, Math.min(panelSavedPos.left, ww - 360));
    const safeTop  = Math.max(0, Math.min(panelSavedPos.top,  wh - 100));
    panel.style.left = safeLeft + 'px';
    panel.style.top  = safeTop  + 'px';
  } else {
    panel.style.top  = '56px';
    panel.style.left = 'calc(50% - 100px)';
  }
}

function makePanelDraggable(panel) {
  const handle = panel.querySelector('.mr-hd');
  if (!handle) return;

  let isDragging = false, startX, startY, startLeft, startTop;

  handle.style.cursor = 'grab';

  handle.addEventListener('mousedown', (e) => {
    // ignora cliques em botões e no toggle de tema dentro do header
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    isDragging = true;

    const rect = panel.getBoundingClientRect();
    // converte posição para pixels absolutos (resolve calc() se ainda não foi arrastado)
    panel.style.left   = rect.left + 'px';
    panel.style.top    = rect.top  + 'px';
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';

    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = rect.left;
    startTop  = rect.top;

    handle.style.cursor = 'grabbing';
    panel.style.transition = 'none';   // desativa transições durante o arraste
    panel.style.userSelect = 'none';

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  function onMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newLeft = Math.max(0, Math.min(startLeft + dx, window.innerWidth  - panel.offsetWidth));
    const newTop  = Math.max(0, Math.min(startTop  + dy, window.innerHeight - panel.offsetHeight));
    panel.style.left = newLeft + 'px';
    panel.style.top  = newTop  + 'px';
  }

  function onUp() {
    if (!isDragging) return;
    isDragging = false;
    handle.style.cursor   = 'grab';
    panel.style.transition = '';
    panel.style.userSelect = '';

    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);

    // grava posição no chrome.storage.local
    const rect = panel.getBoundingClientRect();
    panelSavedPos = { top: rect.top, left: rect.left };
    chrome.storage.local.set({ sp_panel_pos: panelSavedPos });
  }
}

function renderCatTabs() {
  const nav = document.getElementById('mr-cn'); if (!nav) return; nav.innerHTML = '';
  const allTab = document.createElement('div'); allTab.className = 'mr-ct'+(activeCategory===null?' active':'');
  allTab.innerHTML = `<span class="mr-ct-icon">🗂</span><span class="mr-ct-name">Todas</span>`;
  allTab.onclick = (e) => { e.stopPropagation(); activeCategory=null; renderCatTabs(); renderCards(); }; nav.appendChild(allTab);
  Object.entries(messageData.categories).forEach(([catName, cat]) => {
    const tab = document.createElement('div'); tab.className = 'mr-ct'+(activeCategory===catName?' active':'');
    tab.innerHTML = `<span class="mr-ct-icon">${cat.icon||categoryIcons[catName]||categoryIcons.default}</span><span class="mr-ct-name">${catName}</span>`;
    tab.onclick = (e) => { e.stopPropagation(); activeCategory=catName; renderCatTabs(); renderCards(); }; nav.appendChild(tab);
  });
}

function renderCards() {
  const content = document.getElementById('mr-c'); if (!content) return; content.innerHTML = '';
  const msgs = getAllMessages();
  if (!msgs.length) { content.innerHTML = `<div class="mr-empty"><div class="mr-ei">💬</div><div class="mr-et">${searchQuery?'Nenhum resultado':'Nenhuma mensagem'}</div><div class="mr-ed">${searchQuery?'Tente outro termo.':'Clique em "+ Nova Mensagem" para começar.'}</div></div>`; return; }
  msgs.forEach(({ catName, subName, message, color }) => {
    const card = document.createElement('div');
    card.className = 'mr-card';
    card.innerHTML = `<div class="mr-ci"><div class="mr-cbar" style="background:${color}"></div><div class="mr-cbody"><span class="mr-cname">${subName}</span><div class="mr-cprev">${highlightVars(message)}</div><div class="mr-cft"><div class="mr-cact"><button class="mr-btn mr-bg mr-edit">Editar</button><button class="mr-btn mr-bp mr-use">Usar</button></div></div></div></div>`;
    card.querySelector('.mr-use').onclick  = e => { e.stopPropagation(); insertMessage(message); };
    card.querySelector('.mr-edit').onclick = e => { e.stopPropagation(); openMessageModal(catName,subName); };
    card.onclick = () => { insertMessage(message); };
    content.appendChild(card);
  });
}

function showPanel() {
  let panel = document.getElementById('mr-panel'); if (!panel) buildPanel(); panel = document.getElementById('mr-panel');
  searchQuery = ''; const si = panel.querySelector('#mr-si'); if (si) si.value = '';
  renderCatTabs(); renderCards(); setTimeout(() => panel.classList.add('visible'), 10); startSuggestionObserver();
}
function hidePanel() {
  const p = document.getElementById('mr-panel');
  if (p) p.classList.remove('visible');
  document.getElementById('sp-btn-passo')?.classList.remove('sp-active');
}
function togglePanel() { const p = document.getElementById('mr-panel'); if (!p||!p.classList.contains('visible')) showPanel(); else hidePanel(); }

function createOverlay() {
  const ov = document.createElement('div'); ov.className = 'mr-ov'; ov.innerHTML = `<div class="mr-modal" id="mr-modal-inner"></div>`;
  const panel = document.getElementById('mr-panel');
  if (panel) copyPassoThemeVars(ov.querySelector('.mr-modal'));
  ov.onclick = e => { if (e.target===ov) closeOverlay(ov); }; ov.querySelector('.mr-modal').addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(ov); setTimeout(() => ov.classList.add('active'), 10); return ov;
}
function closeOverlay(ov) { ov.classList.remove('active'); setTimeout(() => ov.remove(), 220); }

function openMessageModal(editCatName, editSubName, defaultCat, fromSettings, onSave) {
  const isEdit = editCatName!==null&&editSubName!==null, ov = createOverlay();
  if (fromSettings) { ov.style.zIndex='1000010'; const inner=ov.querySelector('#mr-modal-inner'); if(inner) inner.style.zIndex='1000011'; }
  const modal = ov.querySelector('#mr-modal-inner');
  const catOpts = Object.keys(messageData.categories).map(c=>`<option value="${c}" ${(c===editCatName||c===defaultCat)?'selected':''}>${c}</option>`).join('');
  let currentMsg='', currentColor='#3B82F6';
  if (isEdit) { const sub=messageData.categories[editCatName]?.subcategories[editSubName]; if(sub){currentMsg=typeof sub==='string'?sub:sub.message;currentColor=typeof sub==='object'&&sub.color?sub.color:currentColor;} }
  modal.innerHTML = `<div class="mr-mhd"><span class="mr-mt">${isEdit?'Editar Mensagem':'Nova Mensagem'}</span><button class="mr-mc">✕</button></div><div class="mr-mb"><div class="mr-fg"><label class="mr-fl">Título</label><input class="mr-fi" id="mr-f-name" type="text" value="${isEdit?escapeHtml(editSubName):''}"></div><div class="mr-fg"><label class="mr-fl">Categoria</label><select class="mr-fs" id="mr-f-cat"><option value="">Selecione...</option>${catOpts}</select></div><div class="mr-fg"><label class="mr-fl">Cor</label><input type="color" id="mr-f-color" value="${currentColor}" style="width:100%;height:30px;padding:2px;border:1.5px solid var(--border);border-radius:var(--r-sm);background:var(--bg2);cursor:pointer"></div><div class="mr-fg"><label class="mr-fl">Mensagem</label><textarea class="mr-fta" id="mr-f-msg">${isEdit?escapeHtml(currentMsg):''}</textarea></div><div class="mr-fg"><label class="mr-fl">Inserir variável</label><div class="mr-vp">${AVAILABLE_VARS.map(v=>`<span class="mr-vc">${v}</span>`).join('')}</div></div>${isEdit?'<div id="mr-del-area"></div>':''}</div><div class="mr-mft">${isEdit?'<button class="mr-btn mr-bd" id="mr-f-del">Excluir</button>':''}<button class="mr-btn mr-bg" id="mr-f-cancel">Cancelar</button><button class="mr-btn mr-bp" id="mr-f-save">Salvar</button></div>`;
  modal.querySelector('.mr-mc').onclick = () => closeOverlay(ov);
  modal.querySelector('#mr-f-cancel').onclick = () => closeOverlay(ov);
  modal.querySelectorAll('.mr-vc').forEach(chip => { chip.onclick = () => { const ta=modal.querySelector('#mr-f-msg'),s=ta.selectionStart,e=ta.selectionEnd,v=chip.textContent; ta.value=ta.value.slice(0,s)+v+ta.value.slice(e); ta.focus();ta.selectionStart=ta.selectionEnd=s+v.length; }; });
  modal.querySelector('#mr-f-save').onclick = () => {
    const name=modal.querySelector('#mr-f-name').value.trim(),cat=modal.querySelector('#mr-f-cat').value,msg=modal.querySelector('#mr-f-msg').value.trim(),color=modal.querySelector('#mr-f-color').value;
    if (!name){alert('Digite um título.');return;} if (!cat){alert('Selecione uma categoria.');return;} if (!msg){alert('Mensagem não pode ser vazia.');return;}
    if (isEdit&&(editCatName!==cat||editSubName!==name)) delete messageData.categories[editCatName].subcategories[editSubName];
    if (!messageData.categories[cat]) return;
    messageData.categories[cat].subcategories[name]={message:msg,color}; saveData(); refreshPanel(); closeOverlay(ov); if(onSave)onSave(); showToast(isEdit?'Mensagem atualizada!':'Mensagem criada!');
  };
  if (isEdit) {
    modal.querySelector('#mr-f-del').onclick = () => {
      const area=modal.querySelector('#mr-del-area');
      area.innerHTML=`<div class="mr-delbar"><span>Tem certeza?</span><div class="mr-delbar-act"><button class="mr-btn mr-bg" id="del-no">Não</button><button class="mr-btn mr-bd" id="del-yes">Excluir</button></div></div>`;
      area.querySelector('#del-no').onclick=()=>{area.innerHTML='';};
      area.querySelector('#del-yes').onclick=()=>{delete messageData.categories[editCatName].subcategories[editSubName];saveData();refreshPanel();closeOverlay(ov);if(onSave)onSave();showToast('Mensagem excluída.');};
    };
  }
}

function openCatModal() {
  const ov=createOverlay(), modal=ov.querySelector('#mr-modal-inner');
  modal.innerHTML=`<div class="mr-mhd"><span class="mr-mt">Nova Categoria</span><button class="mr-mc">✕</button></div><div class="mr-mb"><div class="mr-fg"><label class="mr-fl">Nome</label><input class="mr-fi" id="mc-name" type="text" placeholder="Ex: Pós-venda"></div><div class="mr-fg"><label class="mr-fl">Ícone (emoji)</label><input class="mr-fi" id="mc-icon" type="text" placeholder="Ex: ✅"></div><div class="mr-fg"><label class="mr-fl">Cor</label><input type="color" id="mc-color" value="#3B82F6" style="width:100%;height:30px;padding:2px;border:1.5px solid var(--border);border-radius:var(--r-sm);background:var(--bg2);cursor:pointer"></div></div><div class="mr-mft"><button class="mr-btn mr-bg" id="mc-cancel">Cancelar</button><button class="mr-btn mr-bp" id="mc-save">Criar Categoria</button></div>`;
  modal.querySelector('.mr-mc').onclick=()=>closeOverlay(ov); modal.querySelector('#mc-cancel').onclick=()=>closeOverlay(ov);
  modal.querySelector('#mc-save').onclick=()=>{const name=modal.querySelector('#mc-name').value.trim(),icon=modal.querySelector('#mc-icon').value.trim(),color=modal.querySelector('#mc-color').value;if(!name){alert('Digite um nome.');return;}if(messageData.categories[name]){alert('Categoria já existe.');return;}messageData.categories[name]={subcategories:{},color,icon:icon||categoryIcons[name]||categoryIcons.default};saveData();refreshPanel();closeOverlay(ov);showToast('Categoria criada!');};
}

function openImportExportModal() {
  const ov=createOverlay(), modal=ov.querySelector('#mr-modal-inner');
  modal.innerHTML=`<div class="mr-mhd"><span class="mr-mt">Importar / Exportar</span><button class="mr-mc">✕</button></div><div class="mr-mb"><p style="font-size:12px;color:var(--txt2);line-height:1.5">Exporte suas mensagens como JSON para backup.</p><div style="display:flex;gap:8px"><button class="mr-btn mr-bp" id="exp-btn" style="flex:1;padding:9px">↑ Exportar JSON</button><button class="mr-btn mr-bg" id="imp-btn" style="flex:1;padding:9px">↓ Importar JSON</button></div><input type="file" id="mr-file" accept=".json" style="display:none"></div><div class="mr-mft"><button class="mr-btn mr-bg" id="ie-close">Fechar</button></div>`;
  modal.querySelector('.mr-mc').onclick=()=>closeOverlay(ov); modal.querySelector('#ie-close').onclick=()=>closeOverlay(ov);
  modal.querySelector('#exp-btn').onclick=()=>{const a=document.createElement('a');a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(messageData,null,2));a.download='backup-mensagens.json';a.click();};
  modal.querySelector('#imp-btn').onclick=()=>modal.querySelector('#mr-file').click();
  modal.querySelector('#mr-file').onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{try{const data=JSON.parse(ev.target.result);if(!data.categories)throw new Error('Formato inválido');if(confirm('Substituir mensagens atuais?')){messageData=normalizePassoLargoData(data);saveData();refreshPanel();closeOverlay(ov);showToast('Importado com sucesso!');}}catch(err){alert('Erro: '+err.message);}};reader.readAsText(file);e.target.value='';};
}

function openSettingsPanel() {
  if (document.getElementById('mr-settings')) return;
  if (!document.getElementById('mr-settings-css')) {
    const st=document.createElement('style');st.id='mr-settings-css';
    st.textContent='#mr-settings{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.95);width:700px;max-width:calc(100vw - 24px);height:82vh;max-height:720px;background:var(--bg,#fff);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px var(--border,#E2E8F0);display:flex;flex-direction:column;z-index:1000002;opacity:0;pointer-events:none;transition:opacity .25s ease,transform .25s ease;}#mr-settings.visible{opacity:1;transform:translate(-50%,-50%) scale(1);pointer-events:all;}#mr-settings-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(3px);z-index:1000001;opacity:0;pointer-events:none;transition:opacity .25s ease;}#mr-settings-backdrop.visible{opacity:1;pointer-events:all;}#mr-settings *{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif;}.mst-hd{padding:14px 18px;border-bottom:1px solid var(--border,#E2E8F0);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}.mst-title{font-size:15px;font-weight:700;color:var(--txt,#0F172A);}.mst-body{display:flex;flex:1;overflow:hidden;}.mst-sidebar{width:210px;flex-shrink:0;border-right:1px solid var(--border,#E2E8F0);display:flex;flex-direction:column;overflow:hidden;}.mst-sidebar-hd{padding:10px 12px;font-size:11px;font-weight:700;color:var(--txt3,#94A3B8);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border,#E2E8F0);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}.mst-sidebar-list{flex:1;overflow-y:auto;padding:6px;}.mst-cat-row{display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:6px;cursor:pointer;transition:all 150ms ease;border:1.5px solid transparent;margin-bottom:3px;}.mst-cat-row:hover{background:var(--bg2,#F8FAFC);}.mst-cat-row.active{background:var(--accentlt,#DBEAFE);border-color:var(--accent,#3B82F6);}.mst-cat-drag{cursor:grab;color:var(--txt3,#94A3B8);font-size:16px;opacity:.4;}.mst-cat-icon{font-size:14px;flex-shrink:0;}.mst-cat-name{font-size:12px;font-weight:500;color:var(--txt,#0F172A);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.mst-cat-count{font-size:10px;color:var(--txt3,#94A3B8);}.mst-main{flex:1;display:flex;flex-direction:column;overflow:hidden;}.mst-cat-edit-bar{border-bottom:1px solid var(--border,#E2E8F0);flex-shrink:0;background:var(--bg2,#F8FAFC);}.mst-cat-edit-top{display:flex;align-items:center;gap:6px;padding:10px 14px 6px;}.mst-cat-edit-icon{font-size:18px;}.mst-cat-edit-name{flex:1;min-width:0;padding:5px 8px;border:1.5px solid var(--border,#E2E8F0);border-radius:6px;font-size:12px;color:var(--txt,#0F172A);background:var(--bg,#fff);outline:none;}.mst-cat-edit-emoji{width:54px;text-align:center;padding:5px 4px;border:1.5px solid var(--border,#E2E8F0);border-radius:6px;font-size:13px;color:var(--txt,#0F172A);background:var(--bg,#fff);outline:none;}.mst-cat-edit-color{width:32px;height:28px;padding:2px;border:1.5px solid var(--border,#E2E8F0);border-radius:6px;cursor:pointer;}.mst-cat-edit-actions{display:flex;gap:6px;padding:0 14px 10px;}.mst-action-btn{flex:1;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;border:none;cursor:pointer;transition:all 150ms ease;white-space:nowrap;}.mst-action-save{background:var(--accent,#3B82F6);color:#fff;}.mst-action-del{background:var(--bg3,#F1F5F9);color:var(--danger,#EF4444);border:1.5px solid var(--danger,#EF4444);}.mst-msgs-header{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--border,#E2E8F0);flex-shrink:0;}.mst-msgs-header-left{display:flex;align-items:center;gap:7px;}.mst-msgs-header-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}.mst-msgs-header-title{font-size:12px;font-weight:600;color:var(--txt,#0F172A);}.mst-action-new{padding:5px 12px;border-radius:6px;font-size:11px;font-weight:600;border:none;cursor:pointer;background:var(--accent,#3B82F6);color:#fff;}.mst-msg-list{flex:1;overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:5px;}.mst-msg-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:var(--bg2,#F8FAFC);border:1.5px solid var(--border,#E2E8F0);transition:all 150ms ease;}.mst-msg-row:hover{border-color:var(--accent,#3B82F6);}.mst-msg-drag{cursor:grab;color:var(--txt3,#94A3B8);font-size:16px;opacity:.4;}.mst-msg-bar{width:3px;min-height:34px;border-radius:2px;flex-shrink:0;align-self:stretch;}.mst-msg-info{flex:1;min-width:0;}.mst-msg-name{font-size:12px;font-weight:600;color:var(--txt,#0F172A);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.mst-msg-prev{font-size:11px;color:var(--txt3,#94A3B8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}.mst-msg-acts{display:flex;gap:4px;}.mst-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--txt3,#94A3B8);}.mst-empty-icon{font-size:36px;opacity:.3;}.mst-empty-txt{font-size:12px;}';
    document.head.appendChild(st);
  }
  let selectedCat=Object.keys(messageData.categories)[0]||null, dragSrcCat=null, dragSrcMsg=null;
  const backdrop=document.createElement('div'); backdrop.id='mr-settings-backdrop'; backdrop.onclick=closeSettings; document.body.appendChild(backdrop);
  const sp=document.createElement('div'); sp.id='mr-settings'; if(isDarkTheme)sp.classList.add('dark');
  sp.innerHTML=`<div class="mst-hd"><span class="mst-title">⚙️ Configurações — Categorias & Mensagens</span><button class="mr-mc" id="mst-close">✕</button></div><div class="mst-body"><div class="mst-sidebar"><div class="mst-sidebar-hd"><span>Categorias</span><button class="mr-btn mr-bp" id="mst-add-cat" style="padding:2px 8px;font-size:10px">+ Nova</button></div><div class="mst-sidebar-list" id="mst-cat-list"></div></div><div class="mst-main" id="mst-main"><div class="mst-empty"><div class="mst-empty-icon">📂</div><div class="mst-empty-txt">Selecione uma categoria</div></div></div></div>`;
  sp.addEventListener('click', e=>e.stopPropagation()); document.body.appendChild(sp);
  copyPassoThemeVars(sp);
  sp.querySelector('#mst-close').onclick=closeSettings; sp.querySelector('#mst-add-cat').onclick=()=>{closeSettings();openCatModal();};
  setTimeout(()=>{backdrop.classList.add('visible');sp.classList.add('visible');},10);
  function renderSidebar(){
    const list=sp.querySelector('#mst-cat-list'); list.innerHTML='';
    Object.entries(messageData.categories).forEach(([catName,cat])=>{
      const count=Object.keys(cat.subcategories||{}).length, color=cat.color||'#3B82F6';
      const row=document.createElement('div'); row.className='mst-cat-row'+(catName===selectedCat?' active':''); row.dataset.cat=catName; row.draggable=true;
      row.innerHTML=`<span class="mst-cat-drag">⠿</span><span class="mst-cat-icon" style="color:${color}">${cat.icon||'📂'}</span><span class="mst-cat-name">${catName}</span><span class="mst-cat-count">${count}</span>`;
      row.onclick=(e)=>{if(e.target.classList.contains('mst-cat-drag'))return;if(catName===selectedCat)return;selectedCat=catName;renderSidebar();renderMain();};
      row.addEventListener('dragstart',e=>{dragSrcCat=catName;setTimeout(()=>row.classList.add('dragging'),0);e.dataTransfer.effectAllowed='move';});
      row.addEventListener('dragend',()=>row.classList.remove('dragging'));
      row.addEventListener('dragover',e=>{e.preventDefault();if(dragSrcCat&&dragSrcCat!==catName)row.classList.add('drag-over');});
      row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
      row.addEventListener('drop',e=>{e.preventDefault();row.classList.remove('drag-over');if(!dragSrcCat||dragSrcCat===catName)return;const entries=Object.entries(messageData.categories);const fi=entries.findIndex(([k])=>k===dragSrcCat),ti=entries.findIndex(([k])=>k===catName);const[moved]=entries.splice(fi,1);entries.splice(ti,0,moved);messageData.categories=Object.fromEntries(entries);saveData();refreshPanel();renderSidebar();dragSrcCat=null;});
      list.appendChild(row);
    });
  }
  function renderMain(){
    const main=sp.querySelector('#mst-main');
    if(!selectedCat||!messageData.categories[selectedCat]){main.innerHTML=`<div class="mst-empty"><div class="mst-empty-icon">📂</div><div class="mst-empty-txt">Selecione uma categoria</div></div>`;return;}
    const cat=messageData.categories[selectedCat], color=cat.color||'#3B82F6';
    main.innerHTML=`<div class="mst-cat-edit-bar"><div class="mst-cat-edit-top"><span class="mst-cat-edit-icon">${cat.icon||'📂'}</span><input id="mst-cat-name-input" class="mst-cat-edit-name" value="${escapeHtml(selectedCat)}"><input id="mst-cat-icon-input" class="mst-cat-edit-emoji" value="${escapeHtml(cat.icon||'')}"><input type="color" id="mst-cat-color-input" class="mst-cat-edit-color" value="${color}"></div><div class="mst-cat-edit-actions"><button class="mst-action-btn mst-action-save" id="mst-cat-save">✓ Salvar</button><button class="mst-action-btn mst-action-del" id="mst-cat-del">🗑 Excluir</button></div></div><div class="mst-msgs-header"><div class="mst-msgs-header-left"><span class="mst-msgs-header-dot" style="background:${color}"></span><span class="mst-msgs-header-title">Mensagens em <strong>${selectedCat}</strong></span></div><button class="mst-action-new" id="mst-add-msg">+ Nova</button></div><div class="mst-msg-list" id="mst-msg-list"></div>`;
    main.querySelector('#mst-cat-save').onclick=()=>{const newName=main.querySelector('#mst-cat-name-input').value.trim(),newIcon=main.querySelector('#mst-cat-icon-input').value.trim(),newColor=main.querySelector('#mst-cat-color-input').value;if(!newName){alert('Nome não pode ser vazio.');return;}if(newName!==selectedCat&&messageData.categories[newName]){alert('Já existe.');return;}const data={...messageData.categories[selectedCat],icon:newIcon,color:newColor};if(newName!==selectedCat){const entries=Object.entries(messageData.categories);entries[entries.findIndex(([k])=>k===selectedCat)]=[newName,data];messageData.categories=Object.fromEntries(entries);selectedCat=newName;}else{messageData.categories[selectedCat].icon=newIcon;messageData.categories[selectedCat].color=newColor;}saveData();refreshPanel();renderSidebar();renderMain();showToast('Categoria atualizada!');};
    main.querySelector('#mst-cat-del').onclick=()=>{if(!confirm(`Excluir "${selectedCat}"?`))return;delete messageData.categories[selectedCat];selectedCat=Object.keys(messageData.categories)[0]||null;saveData();refreshPanel();renderSidebar();renderMain();};
    main.querySelector('#mst-add-msg').onclick=()=>openMessageModal(null,null,selectedCat,true,()=>renderMsgList());
    renderMsgList();
  }
  function renderMsgList(){
    const list=sp.querySelector('#mst-msg-list'); if(!list)return; list.innerHTML='';
    const subs=Object.entries(messageData.categories[selectedCat]?.subcategories||{});
    if(!subs.length){list.innerHTML=`<div class="mst-empty" style="padding:32px"><div class="mst-empty-icon">💬</div><div class="mst-empty-txt">Nenhuma mensagem</div></div>`;return;}
    subs.forEach(([subName,subItem])=>{
      const msg=typeof subItem==='string'?subItem:subItem.message, color=typeof subItem==='object'&&subItem.color?subItem.color:'#3B82F6';
      const row=document.createElement('div'); row.className='mst-msg-row'; row.dataset.sub=subName; row.draggable=true;
      row.innerHTML=`<span class="mst-msg-drag">⠿</span><div class="mst-msg-bar" style="background:${color}"></div><div class="mst-msg-info"><div class="mst-msg-name">${escapeHtml(subName)}</div><div class="mst-msg-prev">${escapeHtml(msg)}</div></div><div class="mst-msg-acts"><button class="mr-btn mr-bg mst-edit-msg" style="padding:3px 9px;font-size:10px">Editar</button><button class="mr-btn mr-bd mst-del-msg" style="padding:3px 8px;font-size:10px">🗑</button></div>`;
      row.querySelector('.mst-edit-msg').onclick=()=>openMessageModal(selectedCat,subName,null,true,()=>renderMsgList());
      row.querySelector('.mst-del-msg').onclick=()=>{if(!confirm(`Excluir "${subName}"?`))return;delete messageData.categories[selectedCat].subcategories[subName];saveData();refreshPanel();renderMsgList();showToast('Mensagem excluída.');};
      row.addEventListener('dragstart',e=>{dragSrcMsg=subName;setTimeout(()=>row.classList.add('dragging'),0);e.dataTransfer.effectAllowed='move';});
      row.addEventListener('dragend',()=>row.classList.remove('dragging'));
      row.addEventListener('dragover',e=>{e.preventDefault();if(dragSrcMsg&&dragSrcMsg!==subName)row.classList.add('drag-over');});
      row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
      row.addEventListener('drop',e=>{e.preventDefault();row.classList.remove('drag-over');if(!dragSrcMsg||dragSrcMsg===subName)return;const entries=Object.entries(messageData.categories[selectedCat].subcategories);const fi=entries.findIndex(([k])=>k===dragSrcMsg),ti=entries.findIndex(([k])=>k===subName);const[moved]=entries.splice(fi,1);entries.splice(ti,0,moved);messageData.categories[selectedCat].subcategories=Object.fromEntries(entries);saveData();refreshPanel();renderMsgList();dragSrcMsg=null;});
      list.appendChild(row);
    });
  }
  function closeSettings(){backdrop.classList.remove('visible');sp.classList.remove('visible');setTimeout(()=>{backdrop.remove();sp.remove();},250);}
  renderSidebar(); renderMain();
}

function refreshPanel() { renderCatTabs(); renderCards(); }
function escapeHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderToast() {
  if (document.getElementById('mr-toast')) return;
  const t=document.createElement('div'); t.id='mr-toast'; t.innerHTML=`<span class="mr-ticon">✓</span><span class="mr-tmsg">Mensagem inserida!</span>`;
  document.body.appendChild(t);
}

const BACKUP_URL  = 'https://raw.githubusercontent.com/ASolha/passo-largo/main/backup-mensagens.json';
const IMPORT_FLAG = 'mr-auto-imported';

async function bootstrap() {
  await restoreAuthSession();
  loadData();
  try {
    await initializePassoLargoForSession();
  } catch (error) {
    console.warn('[Sentinela Pro] Falha ao iniciar o Passo Largo remoto:', error instanceof Error ? error.message : error);
  }
  try {
    await loadGestorLocalState();
    if (hasAuthSession()) {
      await loadGestorPendencias();
    }
  } catch (error) {
    console.warn('[Sentinela Pro] Falha ao iniciar o Gestor:', error instanceof Error ? error.message : error);
  }
  const alreadyImported = localStorage.getItem(IMPORT_FLAG), hasData = Object.keys(messageData.categories).length > 0;
  if (!alreadyImported && !hasData) {
    try {
      const res = await fetch(BACKUP_URL); if (!res.ok) throw new Error('HTTP ' + res.status);
      const imported = await res.json();
      if (imported && imported.categories && Object.keys(imported.categories).length > 0) {
        messageData = normalizePassoLargoData(imported); saveData(); localStorage.setItem(IMPORT_FLAG, '1');
        console.log('[Sentinela Pro] Backup Passo Largo importado!');
      }
    } catch(e) { console.warn('[Sentinela Pro] Não foi possível importar backup:', e.message); }
  }
  renderToast();
  if (window.location.hostname.includes('mercadolivre.com.br') || window.location.hostname.includes('mercadolibre.com')) {
    createTopBar();
  }
}

function init() { bootstrap(); }
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }

document.addEventListener('sp:auth-changed', async () => {
  try {
    if (hasAuthSession()) {
      hubProfilesLoaded = false;
      await loadHubUserProfiles(true);
      await initializePassoLargoForSession();
      await loadGestorLocalState();
      await loadGestorPendencias();
      orderPickerHistoryLoaded = false;
      await loadOrderPickerHistory(true);
      if (document.getElementById('mr-panel')) {
        refreshPanel();
      }
    } else {
      passoLargoRemoteLoaded = false;
      passoLargoLastSyncedSignature = '';
      gestorPendencias = [];
      gestorLoading = false;
      gestorCurrentTab = 'pendencias';
      gestorEmailSettings = normalizeGestorEmailSettings(null);
      gestorEmailSentIds = new Set();
      gestorCopiedIds = new Set();
      gestorArchivedIds = new Set();
      gestorFefrelloSentIds = new Set();
      hubProfilesCache = {};
      hubProfilesLoaded = false;
      orderPickerHistoryCache = [];
      orderPickerHistoryLoaded = false;
      orderPickerHistoryLoading = false;
      syncGestorButton();
      renderGestorPanelContent(document.getElementById('sp-gestor-panel'));
    }

    if (document.getElementById('sp-order-panel')) {
      renderOrderPickerSessionState(document.getElementById('sp-order-panel'));
      renderOrderPickerDashboard(document.getElementById('sp-order-panel'));
    }
  } catch (error) {
    console.warn('[Sentinela Pro] Falha ao atualizar dados do Passo Largo apos login:', error instanceof Error ? error.message : error);
    if (error instanceof Error) {
      mostrarNotificacao(error.message, 'error');
    }
  }
});

document.addEventListener('click', e => {
  const panel = document.getElementById('mr-panel');
  const orderPanel = document.getElementById('sp-order-panel');
  const gestorPanel = document.getElementById('sp-gestor-panel');
  const gestorBatchOverlay = document.getElementById('sp-gestor-batch-overlay');
  const authPanel = document.getElementById('sp-auth-panel');
  const bar = document.getElementById('sp-topbar');

  if (gestorPanel?.classList.contains('visible') && !gestorPanel.contains(e.target) && !gestorBatchOverlay?.contains(e.target) && !bar?.contains(e.target)) {
    closeGestorPanel();
  }

  if (authPanel?.classList.contains('visible') && !authPanel.contains(e.target) && !bar?.contains(e.target)) {
    closeAuthPanel();
  }

  if (orderPanel?.classList.contains('visible') && !orderPanel.contains(e.target) && !bar?.contains(e.target)) {
    closeOrderPickerPanel();
  }

  if (!panel?.classList.contains('visible')) return;
  if (document.querySelector('.mr-ov.active')) return;
  if (!panel.contains(e.target) && !bar?.contains(e.target)) hidePanel();
});

// ══════════════════════════════════════════════════════════════
// MÓDULO: CLIP (Captura de Dados e Overlay)
// ══════════════════════════════════════════════════════════════

function capturarLoginDoHTML() {
  const elementoLogin = document.querySelector('div.sc-title-subtitle-action__container p.sc-text');
  if (elementoLogin) {
    const textoCompleto = elementoLogin.textContent || elementoLogin.innerText;
    const match = textoCompleto.match(/^([^|]+?)\s*\|\s*CPF/);
    if (match && match[1]) { return match[1].trim(); }
    return textoCompleto.trim();
  }
  const textoCompleto = document.body.innerText;
  const loginMatch = textoCompleto.match(/([^\s|]+(?:\s+[^\s|]+)*)\s*\|\s*CPF\s*\d+/);
  return loginMatch ? loginMatch[1].trim() : '';
}

function clipModelHasPedra(modelo) {
  return /pedra/i.test(modelo || '');
}

function clipTextHasComPedra(texto) {
  return /com\s+pedra/i.test(texto || '');
}

function clipShouldAppendComPedra({
  tipo = '',
  index = -1,
  aroText = '',
  numeroAtual = '',
  modelo = '',
  fallbackModelo = '',
  contextHasStone = false,
  totalCount = 0
}) {
  const hasStoneOnAro = clipTextHasComPedra(aroText) || clipTextHasComPedra(numeroAtual);
  const hasStoneOnModel = clipModelHasPedra(modelo) || clipModelHasPedra(fallbackModelo);
  const hasStoneContext = Boolean(contextHasStone);
  const normalizedTotalCount = Number(totalCount) || 0;

  if (tipo === 'Masculino') return false;
  if (tipo === 'Feminino') return hasStoneOnAro || hasStoneOnModel || hasStoneContext;
  if (!tipo && normalizedTotalCount <= 1) return hasStoneOnAro || hasStoneOnModel || hasStoneContext;
  if (!tipo && index === 1) return hasStoneOnAro || hasStoneOnModel || hasStoneContext;
  return hasStoneOnAro;
}

function clipRemoveComPedra(numero) {
  const base = String(numero || '').replace(/\s+com\s+pedra\b/gi, '').trim();
  if (!base) return base;
  return base;
}

function clipSanitizeCapturedData(dados) {
  if (!dados || typeof dados !== 'object') return dados;
  return {
    ...dados,
    aros: Array.isArray(dados.aros)
      ? dados.aros.map((aro) => (
          aro?.tipo === 'Masculino'
            ? { ...aro, numero: clipRemoveComPedra(aro.numero || '') }
            : aro
        ))
      : []
  };
}

function clipSanitizeMasculinoField() {
  document.querySelectorAll('#extensao-popup-overlay input[id^="campo-aro-"]').forEach((input) => {
    const box = input.closest('div[style*="margin-bottom:8px"]') || input.parentElement?.parentElement;
    const badge = box?.querySelector('span');
    const badgeText = (badge?.textContent || '').trim().toLowerCase();
    if (!badgeText.includes('masculino')) return;

    const cleanValue = clipRemoveComPedra(input.value);
    if (input.value !== cleanValue) {
      input.value = cleanValue;
    }

    if (input.dataset.masculinoSanitized === 'true') return;
    input.dataset.masculinoSanitized = 'true';
    input.addEventListener('input', () => {
      const nextValue = clipRemoveComPedra(input.value);
      if (input.value !== nextValue) {
        input.value = nextValue;
      }
    });
  });
}

function clipNeedsFreshCapture(dados) {
  if (!clipHasMeaningfulData(dados)) return true;
  if (!dados.login) return true;

  const aros = Array.isArray(dados.aros) ? dados.aros : [];

  if (aros.some((aro) => aro?.tipo === 'Masculino' && clipTextHasComPedra(aro?.numero || ''))) return true;

  const pageText = document.body?.innerText || '';
  if (clipTextHasComPedra(pageText) && aros.some((aro) => !aro?.tipo && !clipTextHasComPedra(String(aro?.numero || '')))) return true;

  return false;
}

function capturarDados() {
  const textoCompleto = document.body.innerText;
  const url = window.location.href;
  const login = capturarLoginDoHTML();
  const linhas = textoCompleto.split('\n');

  let modelo = '';
  const padroesModelo = [
    /\*\*(\d+mm[^*\n]+)/,
    /(\d+mm\s+[^\n]+)/,
    /\*\*([^*]*\d+mm[^*\n]+)/,
    /Modelo:\s*([^\n]+)/i
  ];

  for (const padrao of padroesModelo) {
    const match = textoCompleto.match(padrao);
    if (match) {
      let modeloCompleto = match[1].replace(/\*\*/g, '').trim();
      modeloCompleto = modeloCompleto.replace(/\s+(Banhad[ao]|Folhead[ao]).*$/i, '');
      modelo = modeloCompleto;
      break;
    }
  }
  const modeloTemPedra = clipModelHasPedra(modelo);

  function findLineIndexByOccurrence(fragmento, ocorrencia = 0) {
    let count = 0;
    for (let i = 0; i < linhas.length; i += 1) {
      if (!linhas[i].includes(fragmento)) continue;
      if (count === ocorrencia) return i;
      count += 1;
    }
    return -1;
  }

  function findLineByRegex(regex) {
    for (let i = 0; i < linhas.length; i += 1) {
      if (regex.test(linhas[i])) return { text: linhas[i], index: i };
    }
    return { text: '', index: -1 };
  }

  function hasComPedraNearby(index, fallbackText = '') {
    if (clipTextHasComPedra(fallbackText)) return true;
    if (index >= 0) {
      for (let j = index; j <= Math.min(linhas.length - 1, index + 3); j += 1) {
        const currentLine = linhas[j];
        if (j > index && /\b(Aro\s*-|Masculino\s*[-–]|Feminino\s*[-–])/.test(currentLine)) break;
        if (clipTextHasComPedra(currentLine)) return true;
      }
    }
    return false;
  }

  function extractModeloNearby(index) {
    if (index < 0) return '';
    for (let j = Math.max(0, index - 3); j <= Math.min(linhas.length - 1, index + 3); j += 1) {
      const linhaBusca = linhas[j];
      for (const padrao of padroesModelo) {
        const matchModelo = linhaBusca.match(padrao);
        if (!matchModelo) continue;
        let modeloCompleto = matchModelo[1].replace(/\*\*/g, '').trim();
        modeloCompleto = modeloCompleto.replace(/\s+(Banhad[ao]|Folhead[ao]).*$/i, '');
        return modeloCompleto;
      }
    }
    return '';
  }

  function extractCoupleAroText(label) {
    const match = textoCompleto.match(new RegExp(`${label}\\s*-\\s*([^\\n|]+)`, 'i'));
    return match ? match[1].trim() : '';
  }

  const arosAvulsos = [];
  const padroesAro = textoCompleto.match(/Aro\s*-\s*([^\n|]+)/g);

  if (padroesAro && padroesAro.length > 0) {
    const totalAroEntries = padroesAro.reduce((total, match) => {
      const textoAro = match.replace(/Aro\s*-\s*/, '').trim();
      const numberMatches = Array.from(textoAro.matchAll(/(\d+(?:\.\d+)?)/g)).length;
      return total + (numberMatches || 1);
    }, 0);
    padroesAro.forEach((match, index) => {
      const textoAro = match.replace(/Aro\s*-\s*/, '').trim();
      const numeroMatch = textoAro.match(/(\d+(?:\.\d+)?)/);
      const numeroBase = numeroMatch ? numeroMatch[1] : '';
      const matchIndex = findLineIndexByOccurrence(match, index);
      const modeloAro = extractModeloNearby(matchIndex) || modelo;
      const contextHasStoneNearby = hasComPedraNearby(matchIndex, textoAro);
      const shouldAppendStone = clipShouldAppendComPedra({
        index,
        aroText: textoAro,
        contextHasStone: contextHasStoneNearby,
        modelo: modeloAro,
        fallbackModelo: modelo,
        totalCount: totalAroEntries
      }) || (index === 1 && modeloTemPedra) || contextHasStoneNearby;
      const numero = clipRemoveComPedra(numeroBase);
      arosAvulsos.push({
        numero: shouldAppendStone ? `${numero} com pedra` : numero,
        modelo: modeloAro || modelo
      });
    });

    if (modeloTemPedra && arosAvulsos.length === 2) {
      const n0 = parseFloat(clipRemoveComPedra(arosAvulsos[0].numero)) || Infinity;
      const n1 = parseFloat(clipRemoveComPedra(arosAvulsos[1].numero)) || Infinity;
      const femIdx = n0 <= n1 ? 0 : 1;
      const aro = arosAvulsos[femIdx];
      if (!clipTextHasComPedra(aro.numero)) {
        const base = clipRemoveComPedra(aro.numero);
        if (base) arosAvulsos[femIdx] = { ...aro, numero: `${base} com pedra` };
      }
    }
  } else {
    const textoAroMasculino = extractCoupleAroText('Masculino');
    const linhaAroMasculino = findLineByRegex(/Masculino\s*[-–]\s*/i);
    let aroMasculino = '';
    if (textoAroMasculino) {
      const textoAro = textoAroMasculino;
      const numeroMatch = textoAro.match(/(\d+(?:\.\d+)?)/);
      const numeroBase = numeroMatch ? numeroMatch[1] : textoAro;
      aroMasculino = clipRemoveComPedra(numeroBase);
    }
    const textoAroFeminino = extractCoupleAroText('Feminino');
    const linhaAroFeminino = findLineByRegex(/Feminino\s*[-–]\s*/i);
    let aroFeminino = '';
    if (textoAroFeminino) {
      const textoAro = textoAroFeminino;
      const numeroMatch = textoAro.match(/(\d+(?:\.\d+)?)/);
      const numeroBase = numeroMatch ? numeroMatch[1] : textoAro;
      const numero = clipRemoveComPedra(numeroBase);
      aroFeminino = clipShouldAppendComPedra({
        tipo: 'Feminino',
        aroText: textoAro,
        contextHasStone: hasComPedraNearby(linhaAroFeminino.index, textoAro) || hasComPedraNearby(linhaAroMasculino.index, textoAroMasculino),
        modelo
      }) ? `${numero} com pedra` : numero;
    }
    if (aroMasculino || aroFeminino) {
      arosAvulsos.push({ numero: aroMasculino, modelo: modelo, tipo: 'Masculino' });
      arosAvulsos.push({ numero: aroFeminino, modelo: modelo, tipo: 'Feminino' });
    }
  }
  return clipSanitizeCapturedData({ login, modelo, aros: arosAvulsos, url });
}

function formatarTextoParaCopia(dados) {
  let texto = `${dados.url}\n\n${dados.modelo || ''}\n`;
  let ultimoTipo = '';
  dados.aros.filter(a => a.tipo).forEach(aro => {
    if (ultimoTipo === 'Masculino' && aro.tipo === 'Feminino') texto += '\n';
    const numero = aro.numero || '';
    const valor = aro.valor || '';
    if (valor) { texto += `${aro.tipo} ${numero} >>                    ${valor}\n`; }
    else { texto += `${aro.tipo} ${numero}\n`; }
    ultimoTipo = aro.tipo;
  });
  const avulsos = dados.aros.filter(a => !a.tipo);
  avulsos.forEach((aro, i) => {
    const numero = aro.numero || '';
    const valor = aro.valor || '';
    if (i > 0) texto += '\n';
    texto += `Aro avulso ${i+1}\n`;
    if (aro.modelo) texto += `Modelo ${aro.modelo}\n`;
    if (valor) { texto += `${numero} >>                    ${valor}\n`; }
    else { texto += `${numero}\n`; }
  });
  return texto.trimEnd();
}

const SESSION_STORAGE_KEY = 'extensao_dados_capturados_sessao';

const FEFRELLO_API_BASE = 'https://southamerica-east1-fefrello.cloudfunctions.net';
const FEFRELLO_API_KEY = '708a34771f2659594502ed4b74cd634819a297d37e3fb2fa3cafdf826c286f16';
const FEFRELLO_CONFIG_KEY = 'extensao_fefrello_config';
const FEFRELLO_CACHE_KEY = 'extensao_fefrello_cache';
const FEFRELLO_CACHE_TTL = 24 * 60 * 60 * 1000;
const RESPONSAVEIS_FEFRELLO = ['Solha', 'Ti', 'Vitão', 'Brunão', 'Fe'];

async function fefrelloFetch(endpoint, options = {}) {
  const res = await fetch(`${FEFRELLO_API_BASE}${endpoint}`, {
    ...options,
    headers: { 'x-api-key': FEFRELLO_API_KEY, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Erro na API Fefrello');
  return json;
}

function salvarCache(data) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [FEFRELLO_CACHE_KEY]: { ...data, timestamp: Date.now() } }, resolve);
  });
}

function carregarCache() {
  return new Promise(resolve => {
    chrome.storage.local.get([FEFRELLO_CACHE_KEY], result => {
      const cache = result[FEFRELLO_CACHE_KEY];
      if (cache && (Date.now() - cache.timestamp) < FEFRELLO_CACHE_TTL) { resolve(cache); }
      else { resolve(null); }
    });
  });
}

async function carregarBoards(forceRefresh = false) {
  if (!forceRefresh) {
    const cache = await carregarCache();
    if (cache && cache.boards) return cache.boards;
  }
  const res = await fefrelloFetch('/listBoards');
  const boards = res.data;
  const cacheAtual = await carregarCache() || {};
  await salvarCache({ ...cacheAtual, boards, columns: cacheAtual.columns || {} });
  return boards;
}

async function carregarColunas(boardId, forceRefresh = false) {
  if (!forceRefresh) {
    const cache = await carregarCache();
    if (cache && cache.columns && cache.columns[boardId]) return cache.columns[boardId];
  }
  const res = await fefrelloFetch(`/listColumns?boardId=${boardId}`);
  const colunas = res.data;
  const cacheAtual = await carregarCache() || {};
  const columns = cacheAtual.columns || {};
  columns[boardId] = colunas;
  await salvarCache({ ...cacheAtual, columns });
  return colunas;
}

async function forcarAtualizacaoCache() {
  const boards = await carregarBoards(true);
  const columns = {};
  for (const board of boards) { columns[board.id] = await carregarColunas(board.id, true); }
  await salvarCache({ boards, columns });
  return { boards, columns };
}

async function criarCardFefrello(boardId, columnId, title, description, responsible) {
  const body = { boardId, columnId, title };
  if (description) body.description = description;
  if (responsible) body.responsible = responsible;
  return await fefrelloFetch('/createCardEndpoint', { method: 'POST', body: JSON.stringify(body) });
}

function salvarConfigFefrello(config) {
  return new Promise(resolve => { chrome.storage.local.set({ [FEFRELLO_CONFIG_KEY]: config }, resolve); });
}

function carregarConfigFefrello() {
  return new Promise(resolve => {
    chrome.storage.local.get([FEFRELLO_CONFIG_KEY], result => { resolve(result[FEFRELLO_CONFIG_KEY] || null); });
  });
}

function salvarDados(dados) {
  try { sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(dados)); }
  catch (e) { console.error('Erro ao salvar dados na sessão:', e); }
}

function atualizarApenasURL(novoURL) {
  try {
    const dadosExistentes = carregarDados();
    if (dadosExistentes && (dadosExistentes.login || dadosExistentes.modelo)) {
      dadosExistentes.url = novoURL;
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(dadosExistentes));
      const campoURL = document.getElementById('campo-url');
      if (campoURL) campoURL.value = novoURL;
      return true;
    }
    return false;
  } catch (e) { console.error('Erro ao atualizar URL:', e); return false; }
}

function carregarDados() {
  try {
    const dadosSalvos = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (dadosSalvos) return JSON.parse(dadosSalvos);
  } catch (e) { console.error('Erro ao carregar dados da sessão:', e); }
  return { login: '', modelo: '', aros: [], url: '' };
}

function limparDadosSalvos() {
  try { sessionStorage.removeItem(SESSION_STORAGE_KEY); }
  catch (e) { console.error('Erro ao limpar dados da sessão:', e); }
}

function clipEmptyData() {
  return { login: '', modelo: '', aros: [], url: '', sourceUrl: '', capturedAt: 0 };
}

function normalizeClipStoredData(dados) {
  if (!dados || typeof dados !== 'object') return clipEmptyData();
  return {
    login: String(dados.login || '').trim(),
    modelo: String(dados.modelo || '').trim(),
    aros: Array.isArray(dados.aros) ? dados.aros : [],
    url: String(dados.url || '').trim(),
    sourceUrl: String(dados.sourceUrl || dados.url || '').trim(),
    capturedAt: Number(dados.capturedAt) || 0
  };
}

function clipHasMeaningfulData(dados) {
  const normalized = normalizeClipStoredData(dados);
  return Boolean(normalized.login || normalized.modelo || normalized.aros.length > 0);
}

function clipCaptureScore(dados) {
  const normalized = normalizeClipStoredData(dados);
  let score = 0;

  if (normalized.login) score += 2;
  if (normalized.modelo) score += 3;
  if (normalized.url) score += 1;

  normalized.aros.forEach((aro) => {
    if (aro?.numero || aro?.value) score += 2;
    if (aro?.modelo || aro?.model) score += 1;
    if (aro?.tipo || aro?.type) score += 1;
  });

  return score;
}

function clipShouldReplaceStoredData(existingData, nextData) {
  if (!clipHasMeaningfulData(existingData)) return true;
  if (!clipHasMeaningfulData(nextData)) return false;
  return clipCaptureScore(nextData) >= clipCaptureScore(existingData);
}

function getClipStorageValue() {
  return new Promise((resolve) => {
    try {
      const dadosSalvos = sessionStorage.getItem(SESSION_STORAGE_KEY);
      resolve(normalizeClipStoredData(dadosSalvos ? JSON.parse(dadosSalvos) : null));
    } catch (e) {
      console.error('Erro ao carregar dados do clip:', e);
      resolve(clipEmptyData());
    }
  });
}

function setClipStorageValue(dados) {
  return new Promise((resolve) => {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(dados));
    } catch (e) {
      console.error('Erro ao salvar dados do clip:', e);
    }
    resolve();
  });
}

async function salvarDadosClip(dados, options = {}) {
  const { force = false } = options;
  const normalizedIncoming = normalizeClipStoredData({
    ...dados,
    sourceUrl: dados?.sourceUrl || dados?.url || window.location.href,
    url: dados?.url || window.location.href,
    capturedAt: Date.now()
  });

  const dadosExistentes = await carregarDadosClip();
  const deveManterExistente = !force && clipHasMeaningfulData(dadosExistentes) && !clipHasMeaningfulData(normalizedIncoming);
  const dadosParaSalvar = deveManterExistente
    ? { ...dadosExistentes, url: normalizedIncoming.url || dadosExistentes.url }
    : normalizedIncoming;

  await setClipStorageValue(dadosParaSalvar);
  return dadosParaSalvar;
}

async function atualizarApenasURLClip(novoURL) {
  try {
    const dadosExistentes = await carregarDadosClip();
    if (clipHasMeaningfulData(dadosExistentes)) {
      const atualizados = { ...dadosExistentes, url: novoURL };
      await setClipStorageValue(atualizados);
      const campoURL = document.getElementById('campo-url');
      if (campoURL) campoURL.value = novoURL;
      return true;
    }
    return false;
  } catch (e) {
    console.error('Erro ao atualizar URL:', e);
    return false;
  }
}

async function carregarDadosClip() {
  try {
    return await getClipStorageValue();
  } catch (e) {
    console.error('Erro ao carregar dados do clip:', e);
    return clipEmptyData();
  }
}

async function limparDadosSalvosClip() {
  return new Promise((resolve) => {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) {
      console.error('Erro ao limpar dados do clip:', e);
    }
    resolve();
  });
}

function inserirSimboloNoCursor(campo, simbolo) {
  const posicaoInicial = campo.selectionStart;
  const posicaoFinal = campo.selectionEnd;
  const novoValor = campo.value.substring(0, posicaoInicial) + simbolo + campo.value.substring(posicaoFinal);
  campo.value = novoValor;
  const novaPosicao = posicaoInicial + simbolo.length;
  campo.setSelectionRange(novaPosicao, novaPosicao);
  campo.focus();
}

function formatarTextoPrimeiraMaiuscula(texto) {
  if (!texto || !texto.trim()) return texto;
  return texto.toLowerCase().split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function getClipIconButtonPalette(kind, active = false) {
  const palettes = {
    coracao: isDarkTheme
      ? { color: '#f472b6', border: 'rgba(244,114,182,0.3)', background: 'transparent' }
      : { color: '#be185d', border: 'rgba(244,114,182,0.42)', background: 'rgba(244,114,182,0.1)' },
    infinito: isDarkTheme
      ? { color: '#60a5fa', border: 'rgba(96,165,250,0.3)', background: 'transparent' }
      : { color: '#1d4ed8', border: 'rgba(96,165,250,0.42)', background: 'rgba(96,165,250,0.1)' },
    formatar: isDarkTheme
      ? { color: '#ffffff', border: 'rgba(255,255,255,0.15)', background: 'transparent' }
      : { color: '#334155', border: 'rgba(148,163,184,0.34)', background: 'rgba(255,255,255,0.92)' },
    config: isDarkTheme
      ? { color: active ? '#ffffff' : 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.15)', background: active ? 'rgba(255,255,255,0.15)' : 'transparent' }
      : { color: active ? '#312e81' : '#475569', border: 'rgba(148,163,184,0.34)', background: active ? 'rgba(99,102,241,0.16)' : 'rgba(255,255,255,0.92)' }
  };

  return palettes[kind];
}

function getClipIconButtonHoverPalette(kind, active = false) {
  const palettes = {
    coracao: isDarkTheme
      ? { color: '#f472b6', border: 'rgba(244,114,182,0.3)', background: 'rgba(244,114,182,0.15)' }
      : { color: '#9d174d', border: 'rgba(244,114,182,0.48)', background: 'rgba(244,114,182,0.18)' },
    infinito: isDarkTheme
      ? { color: '#60a5fa', border: 'rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.15)' }
      : { color: '#1e40af', border: 'rgba(96,165,250,0.48)', background: 'rgba(96,165,250,0.18)' },
    formatar: isDarkTheme
      ? { color: '#ffffff', border: 'rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.1)' }
      : { color: '#0f172a', border: 'rgba(148,163,184,0.4)', background: 'rgba(226,232,240,0.9)' },
    config: isDarkTheme
      ? { color: '#ffffff', border: 'rgba(255,255,255,0.18)', background: active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.1)' }
      : { color: '#1e1b4b', border: 'rgba(99,102,241,0.34)', background: active ? 'rgba(99,102,241,0.2)' : 'rgba(226,232,240,0.9)' }
  };

  return palettes[kind];
}

function paintClipIconButton(button, kind, active = false, hovered = false) {
  if (!button) return;
  const palette = hovered ? getClipIconButtonHoverPalette(kind, active) : getClipIconButtonPalette(kind, active);
  button.style.color = palette.color;
  button.style.borderColor = palette.border;
  button.style.background = palette.background;
}

function criarBotoesSimbolos() {
  return `
    <div style="display: flex; gap: 6px;">
      <button id="btn-coracao" type="button" style="width:32px;height:32px;background:transparent;color:#f472b6;border:1px solid rgba(244,114,182,0.3);border-radius:50%;cursor:pointer;font-size:14px;transition:all 0.2s;display:flex;align-items:center;justify-content:center;" title="Inserir coração">♥</button>
      <button id="btn-infinito" type="button" style="width:32px;height:32px;background:transparent;color:#60a5fa;border:1px solid rgba(96,165,250,0.3);border-radius:50%;cursor:pointer;font-size:14px;transition:all 0.2s;display:flex;align-items:center;justify-content:center;" title="Inserir infinito">∞</button>
      <button id="btn-formatar-tudo" type="button" style="width:32px;height:32px;background:transparent;color:#ffffff;border:1px solid rgba(255,255,255,0.15);border-radius:50%;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;display:flex;align-items:center;justify-content:center;" title="Formatar todos os textos">Aa</button>
      <button id="btn-config-fefrello" type="button" style="width:32px;height:32px;background:transparent;color:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.15);border-radius:50%;cursor:pointer;font-size:14px;transition:all 0.2s;display:flex;align-items:center;justify-content:center;" title="Configurações Fefrello">⚙</button>
    </div>
  `;
}

function adicionarEventosBotoesSimbolos() {
  let campoAtivo = null;
  document.addEventListener('focusin', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') campoAtivo = e.target;
  });
  document.addEventListener('paste', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      setTimeout(() => {
        const campo = e.target;
        const valorOriginal = campo.value;
        const coracoes = ['❤️','♥️','💗','💕','💖','💘','💝','💞','💟','♡','🖤','🤍','🤎','💜','💛','💚','💙','❣️','💓','💔','❤','🧡'];
        let valorNovo = valorOriginal;
        coracoes.forEach(c => { valorNovo = valorNovo.replace(new RegExp(c, 'g'), '♥'); });
        if (valorNovo !== valorOriginal) { campo.value = valorNovo; mostrarNotificacaoCoracao('Corações convertidos automaticamente!'); }
      }, 50);
    }
  });

  const btnCoracao = document.getElementById('btn-coracao');
  if (btnCoracao) {
    paintClipIconButton(btnCoracao, 'coracao');
    btnCoracao.addEventListener('click', () => { if (campoAtivo) inserirSimboloNoCursor(campoAtivo, '♥'); });
    btnCoracao.addEventListener('mouseenter', () => paintClipIconButton(btnCoracao, 'coracao', false, true));
    btnCoracao.addEventListener('mouseleave', () => paintClipIconButton(btnCoracao, 'coracao'));
  }
  const btnInfinito = document.getElementById('btn-infinito');
  if (btnInfinito) {
    paintClipIconButton(btnInfinito, 'infinito');
    btnInfinito.addEventListener('click', () => { if (campoAtivo) inserirSimboloNoCursor(campoAtivo, '∞'); });
    btnInfinito.addEventListener('mouseenter', () => paintClipIconButton(btnInfinito, 'infinito', false, true));
    btnInfinito.addEventListener('mouseleave', () => paintClipIconButton(btnInfinito, 'infinito'));
  }
  const btnFormatarTudo = document.getElementById('btn-formatar-tudo');
  if (btnFormatarTudo) {
    paintClipIconButton(btnFormatarTudo, 'formatar');
    btnFormatarTudo.addEventListener('click', () => {
      document.querySelectorAll('input[type="text"]').forEach(campo => {
        if (campo.id && campo.id.startsWith('campo-valor-')) campo.value = formatarTextoPrimeiraMaiuscula(campo.value);
      });
      mostrarNotificacao('Todos os textos foram formatados!');
    });
    btnFormatarTudo.addEventListener('mouseenter', () => paintClipIconButton(btnFormatarTudo, 'formatar', false, true));
    btnFormatarTudo.addEventListener('mouseleave', () => paintClipIconButton(btnFormatarTudo, 'formatar'));
  }
}

function criarInterfaceAro(aro, index, isAvulso = false) {
  const tipoLabel = isAvulso ? `AVL ${index + 1}` : (aro.tipo || `ARO ${index + 1}`);
  const badgeColor = aro.tipo === 'Masculino' ? '#6366f1' : aro.tipo === 'Feminino' ? '#ec4899' : '#8b5cf6';
  const numeroAro = aro.tipo === 'Masculino' ? clipRemoveComPedra(aro.numero || '') : (aro.numero || '');

  let html = `<div style="margin-bottom:8px;padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(255,255,255,0.04);">`;
  html += `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1px;color:white;background:${badgeColor};margin-bottom:8px;text-transform:uppercase;">${tipoLabel}</span>`;
  if (isAvulso && aro.modelo) {
    html += `<div style="margin-bottom:8px;">`;
    html += `<label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">MODELO</label>`;
    html += `<input type="text" id="campo-modelo-aro-${index}" value="${aro.modelo}" autocomplete="off" spellcheck="false" style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:12px;box-sizing:border-box;outline:none;">`;
    html += `</div>`;
  }
  html += `<div style="margin-bottom:5px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">ARO</label><input type="text" id="campo-aro-${index}" value="${numeroAro}" autocomplete="off" spellcheck="false" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;"></div>`;
  html += `<div style="position:relative;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">DADOS</label><input type="text" id="campo-valor-${index}" value="" autocomplete="off" spellcheck="false" style="width:100%;padding:7px 30px 7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;" placeholder="Dados..."><button class="btn-formatar" data-target="campo-valor-${index}" style="position:absolute;right:4px;bottom:4px;width:24px;height:24px;background:transparent;color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" title="Formatar texto">Aa</button></div>`;
  html += `</div>`;
  return html;
}

function makeClipDraggable(container) {
  const handle = container.querySelector('#clip-drag-handle');
  if (!handle) return;

  let isDragging = false, startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    isDragging = true;

    const rect = container.getBoundingClientRect();
    container.style.left   = rect.left + 'px';
    container.style.right  = 'auto';
    container.style.top    = rect.top  + 'px';
    container.style.bottom = 'auto';

    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = rect.left;
    startTop  = rect.top;

    handle.style.cursor = 'grabbing';
    container.style.transition = 'none';
    container.style.userSelect = 'none';

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  function onMove(e) {
    if (!isDragging) return;
    const newLeft = Math.max(0, Math.min(startLeft + e.clientX - startX, window.innerWidth  - container.offsetWidth));
    const newTop  = Math.max(0, Math.min(startTop  + e.clientY - startY, window.innerHeight - container.offsetHeight));
    container.style.left = newLeft + 'px';
    container.style.top  = newTop  + 'px';
  }

  function onUp() {
    if (!isDragging) return;
    isDragging = false;
    handle.style.cursor = 'grab';
    container.style.transition = '';
    container.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    chrome.storage.local.set({ sp_clip_pos: { top: container.style.top, left: container.style.left } });
  }
}

async function mostrarPopup() {
  const popupExistente = document.getElementById('extensao-popup-overlay');
  if (popupExistente) popupExistente.remove();

  let dados = await carregarDadosClip();
  if (clipNeedsFreshCapture(dados)) {
    const dadosPagina = capturarDados();
    if (clipHasMeaningfulData(dadosPagina)) {
      dados = await salvarDadosClip(dadosPagina);
    }
  }
  const isAvulso = dados.aros.length > 0 && !dados.aros[0].tipo;

  const container = document.createElement('div');
  container.id = 'extensao-popup-overlay';
  container.style.cssText = `position:fixed;top:8px;right:8px;width:340px;background:linear-gradient(180deg,#1a1a2e 0%,#16213e 100%);z-index:10000;box-shadow:-4px 0 24px rgba(0,0,0,0.4);overflow:hidden;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;border-radius:16px;`;
  applyHubTheme(container, { isClip: true });

  const popup = document.createElement('div');
  popup.style.cssText = `padding:16px;box-sizing:border-box;`;

  let arosHTML = '';
  dados.aros.forEach((aro, index) => { arosHTML += criarInterfaceAro(aro, index, isAvulso); });

  if (dados.aros.length === 0) {
    const femininoFallback = clipShouldAppendComPedra({
      tipo: 'Feminino',
      modelo: dados.modelo || '',
      contextHasStone: clipTextHasComPedra(document.body?.innerText || '')
    }) ? ' com pedra' : '';
    arosHTML = `
      <div style="margin-bottom:8px;padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(255,255,255,0.04);">
        <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1px;color:white;background:#6366f1;margin-bottom:8px;text-transform:uppercase;">Masculino</span>
        <div style="margin-bottom:5px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">ARO</label><input type="text" id="campo-aro-0" value="" autocomplete="off" spellcheck="false" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;"></div>
        <div style="position:relative;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">DADOS</label><input type="text" id="campo-valor-0" value="" autocomplete="off" spellcheck="false" style="width:100%;padding:7px 30px 7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;" placeholder="Dados..."><button class="btn-formatar" data-target="campo-valor-0" style="position:absolute;right:4px;bottom:4px;width:24px;height:24px;background:transparent;color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" title="Formatar texto">Aa</button></div>
      </div>
      <div style="margin-bottom:8px;padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(255,255,255,0.04);">
        <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1px;color:white;background:#ec4899;margin-bottom:8px;text-transform:uppercase;">Feminino</span>
        <div style="margin-bottom:5px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">ARO</label><input type="text" id="campo-aro-1" value="${femininoFallback}" autocomplete="off" spellcheck="false" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;"></div>
        <div style="position:relative;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">DADOS</label><input type="text" id="campo-valor-1" value="" autocomplete="off" spellcheck="false" style="width:100%;padding:7px 30px 7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;" placeholder="Dados..."><button class="btn-formatar" data-target="campo-valor-1" style="position:absolute;right:4px;bottom:4px;width:24px;height:24px;background:transparent;color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" title="Formatar texto">Aa</button></div>
      </div>`;
  }

  popup.innerHTML = `
    <style>
      #extensao-popup-overlay input:focus, #extensao-popup-overlay textarea:focus { border-color:rgba(99,102,241,0.5)!important; box-shadow:0 0 0 2px rgba(99,102,241,0.2)!important; }
      #extensao-popup-overlay input::placeholder { color:rgba(255,255,255,0.25); }
      #extensao-popup-overlay .btn-formatar:hover { color:rgba(255,255,255,0.7)!important; background:rgba(255,255,255,0.08)!important; }
      #extensao-popup-overlay select:focus { border-color:rgba(99,102,241,0.5)!important; box-shadow:0 0 0 2px rgba(99,102,241,0.2)!important; }
      #extensao-popup-overlay select option { background:#1a1a2e; color:#fff; }
    </style>
    <div id="clip-drag-handle" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;cursor:grab;user-select:none;">
      ${criarBotoesSimbolos()}
      <button id="fechar-popup" style="width:28px;height:28px;background:transparent;color:rgba(255,255,255,0.4);border:1px solid rgba(255,255,255,0.12);border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;flex-shrink:0;">✕</button>
    </div>
    <div id="conteudo-principal">
      <div style="margin-bottom:10px;">
        <label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">LOGIN</label>
        <input type="text" id="campo-login" value="${dados.login}" autocomplete="off" spellcheck="false" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;">
      </div>
      ${(!isAvulso || !dados.aros.some(aro => aro.modelo)) ?
      `<div style="margin-bottom:10px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">MODELO</label><textarea id="campo-modelo" autocomplete="off" spellcheck="false" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;max-height:50px;resize:none;line-height:1.4;">${dados.modelo}</textarea></div>` : ''}
      ${arosHTML}
      <input type="hidden" id="campo-url" value="${dados.url}">
    </div>
    <div id="footer-principal" style="display:flex;gap:6px;margin-top:12px;">
      <button id="recapturar-dados" style="flex:0 0 auto;background:transparent;color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:10px 12px;cursor:pointer;font-size:11px;font-weight:500;transition:all 0.2s;">Recapturar</button>
      <button id="criar-card-fefrello" style="flex:1;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:10px;padding:10px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;box-shadow:0 2px 8px rgba(16,185,129,0.3);">Criar Card</button>
      <button id="copiar-dados" style="flex:1;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;border-radius:10px;padding:10px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;box-shadow:0 2px 8px rgba(99,102,241,0.3);">Copiar e Fechar</button>
    </div>
    <div id="view-config-fefrello" style="display:none;">
      <div style="margin-bottom:14px;"><span style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.6);">Configurações Fefrello</span></div>
      <div style="margin-bottom:10px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">BOARD</label><select id="config-board" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;cursor:pointer;"><option value="">Carregando...</option></select></div>
      <div style="margin-bottom:10px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">LISTA (COLUNA)</label><select id="config-coluna" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;cursor:pointer;" disabled><option value="">Selecione um board primeiro</option></select></div>
      <div style="margin-bottom:14px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">RESPONSÁVEL</label><select id="config-responsavel" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;cursor:pointer;"><option value="">Selecione...</option>${RESPONSAVEIS_FEFRELLO.map(r => `<option value="${r}">${r}</option>`).join('')}</select></div>
      <div style="display:flex;gap:8px;">
        <button id="atualizar-cache-fefrello" style="flex:1;background:transparent;color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:10px;cursor:pointer;font-size:11px;font-weight:500;transition:all 0.2s;">Atualizar Listas</button>
        <button id="salvar-config-fefrello" style="flex:2;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;border-radius:10px;padding:10px;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.2s;box-shadow:0 2px 8px rgba(99,102,241,0.3);">Salvar Configurações</button>
      </div>
    </div>
    <div id="view-enviar-card" style="display:none;">
      <div style="margin-bottom:14px;"><span style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.6);">Enviar para o Fefrello</span></div>
      <div style="margin-bottom:10px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">LISTA (COLUNA)</label><select id="enviar-coluna" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;cursor:pointer;"><option value="">Carregando...</option></select></div>
      <div style="display:flex;gap:8px;">
        <button id="voltar-enviar-card" style="flex:0 0 auto;background:transparent;color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:10px 14px;cursor:pointer;font-size:11px;font-weight:500;transition:all 0.2s;">Voltar</button>
        <button id="confirmar-enviar-card" style="flex:1;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:10px;padding:10px;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.2s;box-shadow:0 2px 8px rgba(16,185,129,0.3);">Enviar para o Fefrello</button>
      </div>
    </div>
  `;

  container.appendChild(popup);
  document.body.appendChild(container);

  // Clip theme: seguir o tema do Passo Largo
  if (!isDarkTheme) {
    container.classList.add('sp-clip-light');
    // marca os cards ARO para CSS targeting
    container.querySelectorAll('#conteudo-principal > div').forEach(div => {
      if (div.style.borderRadius) div.classList.add('sp-aro-box');
    });
  }

  // Posição salva + arraste
  chrome.storage.local.get(['sp_clip_pos'], (r) => {
    if (r.sp_clip_pos) {
      container.style.top   = r.sp_clip_pos.top;
      container.style.right = 'auto';
      container.style.left  = r.sp_clip_pos.left;
    }
  });
  makeClipDraggable(container);
  clipSanitizeMasculinoField();

  adicionarEventosBotoesSimbolos();

  document.querySelectorAll('.btn-formatar').forEach(btn => {
    btn.addEventListener('click', () => {
      const campo = document.getElementById(btn.getAttribute('data-target'));
      if (campo) { campo.value = formatarTextoPrimeiraMaiuscula(campo.value); campo.focus(); }
    });
  });

  const fecharBtn = document.getElementById('fechar-popup');
  fecharBtn.addEventListener('click', () => {
    container.remove();
    document.getElementById('sp-btn-clip')?.classList.remove('sp-active');
  });
  fecharBtn.addEventListener('mouseenter', () => { fecharBtn.style.background = 'rgba(239,68,68,0.2)'; fecharBtn.style.color = '#f87171'; fecharBtn.style.borderColor = 'rgba(239,68,68,0.4)'; });
  fecharBtn.addEventListener('mouseleave', () => { fecharBtn.style.background = 'transparent'; fecharBtn.style.color = 'rgba(255,255,255,0.4)'; fecharBtn.style.borderColor = 'rgba(255,255,255,0.12)'; });

  const recapturarBtn = document.getElementById('recapturar-dados');
  recapturarBtn.addEventListener('mouseenter', () => { recapturarBtn.style.background = 'rgba(255,255,255,0.08)'; recapturarBtn.style.color = 'rgba(255,255,255,0.9)'; });
  recapturarBtn.addEventListener('mouseleave', () => { recapturarBtn.style.background = 'transparent'; recapturarBtn.style.color = 'rgba(255,255,255,0.6)'; });
  recapturarBtn.addEventListener('click', async () => {
    const popupOverlay = document.getElementById('extensao-popup-overlay');
    if (popupOverlay) popupOverlay.remove();
    const novosDados = capturarDados();
    await salvarDadosClip(novosDados, { force: true });
    await mostrarPopup();
    mostrarNotificacao('Dados da página foram recapturados!');
  });

  const copiarBtn = document.getElementById('copiar-dados');
  copiarBtn.addEventListener('mouseenter', () => { copiarBtn.style.boxShadow = '0 4px 16px rgba(99,102,241,0.45)'; copiarBtn.style.transform = 'translateY(-1px)'; });
  copiarBtn.addEventListener('mouseleave', () => { copiarBtn.style.boxShadow = '0 2px 8px rgba(99,102,241,0.3)'; copiarBtn.style.transform = 'translateY(0)'; });
  copiarBtn.addEventListener('click', () => {
    clipSanitizeMasculinoField();
    const dadosParaCopiar = coletarDadosDaInterface(dados);
    const textoFormatado = formatarTextoParaCopia(dadosParaCopiar);
    const closeClip = () => { container.remove(); document.getElementById('sp-btn-clip')?.classList.remove('sp-active'); };
    navigator.clipboard.writeText(textoFormatado).then(async () => {
      mostrarNotificacao('Dados copiados com sucesso!'); await limparDadosSalvosClip(); closeClip();
    }).catch(() => {
      const ta = document.createElement('textarea'); ta.value = textoFormatado;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      (async () => {
        mostrarNotificacao('Dados copiados com sucesso!'); await limparDadosSalvosClip(); closeClip();
      })();
    });
  });

  const viewConfig = document.getElementById('view-config-fefrello');
  const btnConfig = document.getElementById('btn-config-fefrello');
  let configAberta = false;

  if (btnConfig) {
    paintClipIconButton(btnConfig, 'config', false, false);
    btnConfig.addEventListener('click', async () => {
      configAberta = !configAberta;
      const conteudoPrincipal = document.getElementById('conteudo-principal');
      const footerPrincipal = document.getElementById('footer-principal');
      if (configAberta) {
        paintClipIconButton(btnConfig, 'config', true, false);
        if (conteudoPrincipal) conteudoPrincipal.style.display = 'none';
        if (footerPrincipal) footerPrincipal.style.display = 'none';
        viewConfig.style.display = 'block';
        await carregarDadosConfig();
      } else {
        paintClipIconButton(btnConfig, 'config', false, false);
        if (conteudoPrincipal) conteudoPrincipal.style.display = 'block';
        if (footerPrincipal) footerPrincipal.style.display = 'flex';
        viewConfig.style.display = 'none';
      }
    });
    btnConfig.addEventListener('mouseenter', () => paintClipIconButton(btnConfig, 'config', configAberta, true));
    btnConfig.addEventListener('mouseleave', () => paintClipIconButton(btnConfig, 'config', configAberta, false));
  }

  async function carregarDadosConfig() {
    const selectBoard = document.getElementById('config-board');
    const selectColuna = document.getElementById('config-coluna');
    const selectResponsavel = document.getElementById('config-responsavel');
    const configSalva = await carregarConfigFefrello();
    selectBoard.innerHTML = '<option value="">Carregando...</option>';
    try {
      const boards = await carregarBoards();
      selectBoard.innerHTML = '<option value="">Selecione o board...</option>';
      boards.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id; opt.textContent = b.name;
        if (configSalva && configSalva.boardId === b.id) opt.selected = true;
        selectBoard.appendChild(opt);
      });
      if (configSalva && configSalva.boardId) await carregarColunasNoSelect(configSalva.boardId, configSalva.columnId);
      if (configSalva && configSalva.responsible) selectResponsavel.value = configSalva.responsible;
    } catch (e) {
      selectBoard.innerHTML = '<option value="">Erro ao carregar boards</option>';
      mostrarNotificacao('Erro ao carregar boards: ' + e.message, 'error');
    }
    selectBoard.addEventListener('change', async () => {
      const boardId = selectBoard.value;
      if (boardId) { await carregarColunasNoSelect(boardId); }
      else { selectColuna.innerHTML = '<option value="">Selecione um board primeiro</option>'; selectColuna.disabled = true; }
    });
  }

  async function carregarColunasNoSelect(boardId, columnIdSalva) {
    const selectColuna = document.getElementById('config-coluna');
    selectColuna.innerHTML = '<option value="">Carregando...</option>'; selectColuna.disabled = true;
    try {
      const colunas = await carregarColunas(boardId);
      selectColuna.innerHTML = '<option value="">Selecione a coluna...</option>';
      colunas.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.title;
        if (columnIdSalva && columnIdSalva === c.id) opt.selected = true;
        selectColuna.appendChild(opt);
      });
      selectColuna.disabled = false;
    } catch (e) {
      selectColuna.innerHTML = '<option value="">Erro ao carregar colunas</option>';
      mostrarNotificacao('Erro ao carregar colunas: ' + e.message, 'error');
    }
  }

  const salvarConfigBtn = document.getElementById('salvar-config-fefrello');
  if (salvarConfigBtn) {
    salvarConfigBtn.addEventListener('click', async () => {
      const boardId = document.getElementById('config-board').value;
      const columnId = document.getElementById('config-coluna').value;
      const responsible = document.getElementById('config-responsavel').value;
      if (!boardId || !columnId) { mostrarNotificacao('Selecione board e coluna', 'error'); return; }
      await salvarConfigFefrello({ boardId, columnId, responsible });
      mostrarNotificacao('Configurações salvas!');
      configAberta = false;
      btnConfig.style.background = 'transparent'; btnConfig.style.color = 'rgba(255,255,255,0.5)';
      const conteudoPrincipal = document.getElementById('conteudo-principal');
      const footerPrincipal = document.getElementById('footer-principal');
      if (conteudoPrincipal) conteudoPrincipal.style.display = 'block';
      if (footerPrincipal) footerPrincipal.style.display = 'flex';
      viewConfig.style.display = 'none';
    });
  }

  const atualizarCacheBtn = document.getElementById('atualizar-cache-fefrello');
  if (atualizarCacheBtn) {
    atualizarCacheBtn.addEventListener('click', async () => {
      atualizarCacheBtn.textContent = 'Atualizando...'; atualizarCacheBtn.disabled = true;
      try { await forcarAtualizacaoCache(); mostrarNotificacao('Listas atualizadas!'); await carregarDadosConfig(); }
      catch (e) { mostrarNotificacao('Erro ao atualizar: ' + e.message, 'error'); }
      atualizarCacheBtn.textContent = 'Atualizar Listas'; atualizarCacheBtn.disabled = false;
    });
  }

  const viewEnviarCard = document.getElementById('view-enviar-card');
  const criarCardBtn = document.getElementById('criar-card-fefrello');
  if (criarCardBtn) {
    criarCardBtn.addEventListener('mouseenter', () => { criarCardBtn.style.boxShadow = '0 4px 16px rgba(16,185,129,0.45)'; criarCardBtn.style.transform = 'translateY(-1px)'; });
    criarCardBtn.addEventListener('mouseleave', () => { criarCardBtn.style.boxShadow = '0 2px 8px rgba(16,185,129,0.3)'; criarCardBtn.style.transform = 'translateY(0)'; });
    criarCardBtn.addEventListener('click', async () => {
      const config = await carregarConfigFefrello();
      if (!config || !config.boardId) { mostrarNotificacao('Configure o Fefrello primeiro (⚙)', 'error'); return; }
      const conteudoPrincipal = document.getElementById('conteudo-principal');
      const footerPrincipal = document.getElementById('footer-principal');
      if (conteudoPrincipal) conteudoPrincipal.style.display = 'none';
      if (footerPrincipal) footerPrincipal.style.display = 'none';
      viewEnviarCard.style.display = 'block';
      const selectColuna = document.getElementById('enviar-coluna');
      selectColuna.innerHTML = '<option value="">Carregando...</option>';
      try {
        const colunas = await carregarColunas(config.boardId);
        selectColuna.innerHTML = '<option value="">Selecione a lista...</option>';
        colunas.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id; opt.textContent = c.title;
          if (config.columnId === c.id) opt.selected = true;
          selectColuna.appendChild(opt);
        });
      } catch (e) {
        selectColuna.innerHTML = '<option value="">Erro ao carregar</option>';
        mostrarNotificacao('Erro ao carregar colunas: ' + e.message, 'error');
      }
    });
  }

  const voltarEnviarBtn = document.getElementById('voltar-enviar-card');
  if (voltarEnviarBtn) {
    voltarEnviarBtn.addEventListener('click', () => {
      viewEnviarCard.style.display = 'none';
      const conteudoPrincipal = document.getElementById('conteudo-principal');
      const footerPrincipal = document.getElementById('footer-principal');
      if (conteudoPrincipal) conteudoPrincipal.style.display = 'block';
      if (footerPrincipal) footerPrincipal.style.display = 'flex';
    });
  }

  const confirmarEnviarBtn = document.getElementById('confirmar-enviar-card');
  if (confirmarEnviarBtn) {
    confirmarEnviarBtn.addEventListener('mouseenter', () => { confirmarEnviarBtn.style.boxShadow = '0 4px 16px rgba(16,185,129,0.45)'; confirmarEnviarBtn.style.transform = 'translateY(-1px)'; });
    confirmarEnviarBtn.addEventListener('mouseleave', () => { confirmarEnviarBtn.style.boxShadow = '0 2px 8px rgba(16,185,129,0.3)'; confirmarEnviarBtn.style.transform = 'translateY(0)'; });
    confirmarEnviarBtn.addEventListener('click', async () => {
      const config = await carregarConfigFefrello();
      const columnId = document.getElementById('enviar-coluna').value;
      const responsible = config.responsible || '';
      if (!columnId) { mostrarNotificacao('Selecione a lista', 'error'); return; }
      clipSanitizeMasculinoField();
      const dadosParaCopiar = coletarDadosDaInterface(dados);
      const descricao = formatarTextoParaCopia(dadosParaCopiar);
      const titulo = document.getElementById('campo-login')?.value || 'Sem título';
      confirmarEnviarBtn.disabled = true;
      const textoOriginal = confirmarEnviarBtn.textContent;
      confirmarEnviarBtn.textContent = 'Enviando...'; confirmarEnviarBtn.style.opacity = '0.7';
      try {
        await criarCardFefrello(config.boardId, columnId, titulo, descricao, responsible);
        mostrarNotificacao('Card criado com sucesso!'); await limparDadosSalvosClip(); container.remove(); document.getElementById('sp-btn-clip')?.classList.remove('sp-active');
      } catch (e) {
        mostrarNotificacao('Erro ao criar card: ' + e.message, 'error');
        confirmarEnviarBtn.disabled = false; confirmarEnviarBtn.textContent = textoOriginal; confirmarEnviarBtn.style.opacity = '1';
      }
    });
  }
}

function coletarDadosDaInterface(dadosOriginais) {
  const login = document.getElementById('campo-login')?.value || '';
  const modelo = document.getElementById('campo-modelo')?.value || '';
  const url = document.getElementById('campo-url')?.value || '';
  const aros = [];
  const modeloTemPedra = clipModelHasPedra(modelo);
  if (dadosOriginais.aros.length > 0) {
    dadosOriginais.aros.forEach((aro, index) => {
      const campoAro = document.getElementById(`campo-aro-${index}`);
      const campoValor = document.getElementById(`campo-valor-${index}`);
      const campoModeloAro = document.getElementById(`campo-modelo-aro-${index}`);
      if (campoAro) {
        const modeloAro = campoModeloAro ? campoModeloAro.value : aro.modelo;
        const numeroBase = clipRemoveComPedra(campoAro.value);
        const reforcoPedra = clipShouldAppendComPedra({
          tipo: aro.tipo,
          index,
          aroText: campoAro.value || '',
          numeroAtual: aro.numero || '',
          modelo: modeloAro,
          fallbackModelo: modeloTemPedra ? modelo : '',
          contextHasStone: clipTextHasComPedra(document.body?.innerText || '') && !numeroBase,
          totalCount: dadosOriginais.aros.length
        });
        aros.push({
          numero: reforcoPedra ? `${numeroBase} com pedra` : numeroBase,
          valor: campoValor ? campoValor.value.trim() : '',
          tipo: aro.tipo,
          modelo: modeloAro
        });
      }
    });
  } else {
    const campoAroMasc = document.getElementById('campo-aro-0');
    const campoValorMasc = document.getElementById('campo-valor-0');
    const campoAroFem = document.getElementById('campo-aro-1');
    const campoValorFem = document.getElementById('campo-valor-1');
    const numeroMasc = clipRemoveComPedra(campoAroMasc ? campoAroMasc.value.trim() : '');
    const numeroFemBase = clipRemoveComPedra(campoAroFem ? campoAroFem.value.trim() : '');
    aros.push({
      numero: numeroMasc,
      valor: campoValorMasc ? campoValorMasc.value.trim() : '',
      tipo: 'Masculino',
      modelo
    });
      aros.push({
        numero: clipShouldAppendComPedra({
          tipo: 'Feminino',
          aroText: campoAroFem ? campoAroFem.value.trim() : '',
          contextHasStone: clipTextHasComPedra(document.body?.innerText || ''),
          modelo,
          totalCount: 2
        }) ? `${numeroFemBase} com pedra` : numeroFemBase,
      valor: campoValorFem ? campoValorFem.value.trim() : '',
      tipo: 'Feminino',
      modelo
    });
  }
  return { login, modelo, aros, url };
}

function mostrarNotificacao(mensagem, tipo = 'success') {
  const notificacaoExistente = document.getElementById('extensao-notificacao');
  if (notificacaoExistente) notificacaoExistente.remove();
  const notificacao = document.createElement('div');
  notificacao.id = 'extensao-notificacao';
  notificacao.style.cssText = `position:fixed;top:20px;right:360px;background:${tipo === 'success' ? 'rgba(99,102,241,0.95)' : 'rgba(239,68,68,0.95)'};color:white;padding:10px 16px;border-radius:10px;z-index:10001;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.3);backdrop-filter:blur(8px);opacity:0;transform:translateY(-20px);transition:all 0.3s ease;`;
  notificacao.textContent = mensagem;
  document.body.appendChild(notificacao);
  setTimeout(() => { notificacao.style.opacity = '1'; notificacao.style.transform = 'translateY(0)'; }, 10);
  setTimeout(() => {
    notificacao.style.opacity = '0'; notificacao.style.transform = 'translateY(-20px)';
    setTimeout(() => { if (notificacao.parentNode) notificacao.remove(); }, 300);
  }, 3000);
}

function mostrarNotificacaoCoracao(mensagem) {
  const notificacaoExistente = document.getElementById('extensao-notificacao-coracao');
  if (notificacaoExistente) notificacaoExistente.remove();
  const notificacao = document.createElement('div');
  notificacao.id = 'extensao-notificacao-coracao';
  notificacao.style.cssText = `position:fixed;top:60px;right:20px;background:#ff6b6b;color:white;padding:8px 12px;border-radius:4px;z-index:10001;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.2);opacity:0;transform:translateX(20px);transition:all 0.3s ease;`;
  notificacao.innerHTML = `♥ ${mensagem}`;
  document.body.appendChild(notificacao);
  setTimeout(() => { notificacao.style.opacity = '1'; notificacao.style.transform = 'translateX(0)'; }, 10);
  setTimeout(() => {
    notificacao.style.opacity = '0'; notificacao.style.transform = 'translateX(20px)';
    setTimeout(() => { if (notificacao.parentNode) notificacao.remove(); }, 300);
  }, 2000);
}

function mostrarNotificacaoURL(mensagem) {
  const notificacaoExistente = document.getElementById('extensao-notificacao-url');
  if (notificacaoExistente) notificacaoExistente.remove();
  const notificacao = document.createElement('div');
  notificacao.id = 'extensao-notificacao-url';
  notificacao.style.cssText = `position:fixed;top:20px;right:20px;background:#17a2b8;color:white;padding:8px 12px;border-radius:4px;z-index:10001;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.2);opacity:0;transform:translateX(20px);transition:all 0.3s ease;`;
  notificacao.textContent = mensagem;
  document.body.appendChild(notificacao);
  setTimeout(() => { notificacao.style.opacity = '1'; notificacao.style.transform = 'translateX(0)'; }, 10);
  setTimeout(() => {
    notificacao.style.opacity = '0'; notificacao.style.transform = 'translateX(20px)';
    setTimeout(() => { if (notificacao.parentNode) notificacao.remove(); }, 300);
  }, 1500);
}

let urlAtual = window.location.href;

function monitorarMudancasURL() {
  setInterval(async () => {
    const novaURL = window.location.href;
    if (novaURL !== urlAtual) {
      urlAtual = novaURL;
      const dadosExistentes = await carregarDadosClip();
      if (clipHasMeaningfulData(dadosExistentes)) {
        const foiAtualizado = await atualizarApenasURLClip(novaURL);
        if (foiAtualizado) {
          console.log('[Sentinela Pro] URL atualizado automaticamente:', novaURL);
          mostrarNotificacaoURL('URL atualizado');
        }
      }
    }
  }, 500);
}

// ══════════════════════════════════════════════════════════════
// CLIP: EXECUÇÃO PRINCIPAL (captura automática ao carregar)
// ══════════════════════════════════════════════════════════════
if (window.location.hostname.includes('mercadolivre.com.br') || window.location.hostname.includes('mercadolibre.com')) {
  window.addEventListener('load', async () => {
    monitorarMudancasURL();
    const dadosJaSalvos = await carregarDadosClip();
    if (!dadosJaSalvos.url) {
      const dadosPagina = capturarDados();
      if (clipHasMeaningfulData(dadosPagina)) {
        await salvarDadosClip(dadosPagina);
      }
    } else if (dadosJaSalvos.url !== window.location.href) {
      await atualizarApenasURLClip(window.location.href);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// HANDLER UNIFICADO DE MENSAGENS (todos os módulos)
// ══════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Sentinela Ranger
  if (message.action === 'playAlert') {
    playAlertSound();
    showInPageNotification(message.orderNumber);
    return;
  }
  if (message.action === 'monitoringStatusChanged') {
    isMonitoring = message.isMonitoring;
    if (isMonitoring) { startMonitoring(); } else { stopMonitoring(); }
    return;
  }
  // Passo Largo
  if (message.action === 'openEditor') {
    showPanel();
    return;
  }
  if (message.action === 'open_hub_account') {
    try {
      toggleAuthPanel();
      sendResponse?.({ success: true });
    } catch (error) {
      sendResponse?.({ success: false, error: error.message });
    }
    return true;
  }
  // Clip
  if (message.action === 'capturar_e_copiar') {
    mostrarPopup().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('[Sentinela Pro] Erro ao mostrar popup:', error);
      mostrarNotificacao('Erro ao abrir a interface', 'error');
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  // Ranger Counter — atualiza badge do botão na top bar
  if (message.action === 'tabCountUpdate') {
    updateCounterBadge(message.count);
    return;
  }
});

// ══════════════════════════════════════════════════════════════
// CLEANUP
// ══════════════════════════════════════════════════════════════
window.addEventListener('beforeunload', () => stopMonitoring());
