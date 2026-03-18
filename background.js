// background.js - Sentinela Pro Service Worker
// Combina: Sentinela Ranger + Clip + Ranger Counter

let isMonitoring = true;
let notifiedOrders = new Set();
let processedElements = new Set();
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const CUSTOMER_HISTORY_CACHE_TTL = 5 * 60 * 1000;
const CUSTOMER_HISTORY_LOOKUP_CONCURRENCY = 2;
const customerHistoryCache = new Map();
const customerHistoryPending = new Map();
const customerHistoryQueue = [];
let activeCustomerHistoryLookups = 0;

// Clique no ícone da extensão não executa ações do hub.

// Inicialização
chrome.runtime.onStartup.addListener(initializeExtension);
chrome.runtime.onInstalled.addListener(() => {
  initializeExtension();
  chrome.alarms.create('badgeRefresh', { periodInMinutes: 0.1 });
});

async function initializeExtension() {
  const { notifiedOrders: storedOrders, isMonitoring: storedMonitoring } =
    await chrome.storage.local.get(['notifiedOrders', 'isMonitoring']);

  if (storedOrders) notifiedOrders = new Set(storedOrders);
  if (storedMonitoring !== undefined) isMonitoring = storedMonitoring;

  await chrome.storage.local.set({
    isMonitoring,
    notifiedOrders: Array.from(notifiedOrders)
  });

  processedElements.clear();
}

async function openOrderTabs(urls) {
  for (const url of urls) {
    await chrome.tabs.create({
      url,
      active: false
    });
  }
}

// Mensagens do content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_ORDER_TABS') {
    const urls = Array.isArray(message.urls) ? message.urls : [];

    openOrderTabs(urls)
      .then(() => sendResponse({ ok: true, opened: urls.length }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === 'GET_GMAIL_TOKEN') {
    chrome.identity.getAuthToken({ interactive: false, scopes: GMAIL_SCOPES }, (cachedToken) => {
      if (!chrome.runtime.lastError && cachedToken) {
        sendResponse({ token: cachedToken });
        return;
      }

      chrome.identity.getAuthToken({ interactive: true, scopes: GMAIL_SCOPES }, (token) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else if (!token) {
          sendResponse({ error: 'Token nao obtido. Verifique as permissoes OAuth2.' });
        } else {
          sendResponse({ token });
        }
      });
    });

    return true;
  }

  if (message?.type === 'REVOKE_GMAIL_TOKEN') {
    chrome.identity.getAuthToken({ interactive: false, scopes: GMAIL_SCOPES }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
        });
      }
    });

    return false;
  }

  if (message?.action === 'enqueueCustomerHistoryLookup') {
    const login = normalizeCustomerHistoryLogin(message.login);
    const saleNumber = normalizeCustomerHistorySaleNumber(message.saleNumber);
    const requestId = String(message.requestId || '').trim();
    const tabId = sender?.tab?.id;

    if (!tabId || !login || !saleNumber || !requestId) {
      sendResponse({ ok: false, error: 'Dados insuficientes para consultar recompra.' });
      return false;
    }

    enqueueCustomerHistoryLookup(tabId, login, saleNumber, requestId);
    sendResponse({ ok: true, queued: true });
    return false;
  }

  switch (message.action) {
    case 'orderFound':
      handleOrderFound(message.orderNumber, message.elementHash, sender.tab);
      break;
    case 'getStatus':
      sendResponse({ isMonitoring, notifiedOrdersCount: notifiedOrders.size });
      break;
    case 'toggleMonitoring':
      toggleMonitoring();
      sendResponse({ isMonitoring });
      break;
    case 'getLog':
      sendResponse({ orders: Array.from(notifiedOrders) });
      break;
    case 'clearLog':
      clearLog();
      sendResponse({ success: true });
      break;
  }
});

function normalizeCustomerHistoryLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCustomerHistorySaleNumber(value) {
  return String(value || '').replace(/\D+/g, '');
}

function decodeCustomerHistoryResults(results) {
  return Array.isArray(results) ? results : [];
}

function getCustomerHistoryCache(login) {
  const cached = customerHistoryCache.get(login);
  if (!cached) return null;
  if ((Date.now() - cached.timestamp) > CUSTOMER_HISTORY_CACHE_TTL) {
    customerHistoryCache.delete(login);
    return null;
  }
  return cached.results;
}

function setCustomerHistoryCache(login, results) {
  customerHistoryCache.set(login, {
    timestamp: Date.now(),
    results: decodeCustomerHistoryResults(results)
  });
}

function sendCustomerHistoryLookupResult(tabId, payload) {
  chrome.tabs.sendMessage(tabId, {
    action: 'customerHistoryLookupResult',
    ...payload
  }).catch(() => {});
}

function enqueueCustomerHistoryLookup(tabId, login, saleNumber, requestId) {
  const cachedResults = getCustomerHistoryCache(login);
  if (cachedResults) {
    sendCustomerHistoryLookupResult(tabId, {
      login,
      saleNumber,
      requestId,
      results: cachedResults,
      fromCache: true
    });
    return;
  }

  let entry = customerHistoryPending.get(login);
  if (!entry) {
    entry = {
      login,
      requests: new Map(),
      status: 'queued'
    };
    customerHistoryPending.set(login, entry);
    customerHistoryQueue.push(login);
  }

  entry.requests.set(`${tabId}:${saleNumber}`, {
    tabId,
    saleNumber,
    requestId
  });

  drainCustomerHistoryQueue();
}

function drainCustomerHistoryQueue() {
  while (activeCustomerHistoryLookups < CUSTOMER_HISTORY_LOOKUP_CONCURRENCY && customerHistoryQueue.length > 0) {
    const login = customerHistoryQueue.shift();
    const entry = customerHistoryPending.get(login);
    if (!entry || entry.status === 'running') continue;
    entry.status = 'running';
    void processCustomerHistoryLookup(login);
  }
}

async function processCustomerHistoryLookup(login) {
  const entry = customerHistoryPending.get(login);
  if (!entry) return;

  activeCustomerHistoryLookups += 1;

  try {
    const results = await runCustomerHistoryLookup(entry);
    setCustomerHistoryCache(login, results);
    deliverCustomerHistoryLookup(entry, {
      login,
      results,
      fromCache: false
    });
  } catch (error) {
    deliverCustomerHistoryLookup(entry, {
      login,
      error: error instanceof Error ? error.message : String(error || 'Falha ao consultar recompra.'),
      results: []
    });
  } finally {
    customerHistoryPending.delete(login);
    activeCustomerHistoryLookups = Math.max(0, activeCustomerHistoryLookups - 1);
    drainCustomerHistoryQueue();
  }
}

async function runCustomerHistoryLookup(entry) {
  let lastError = new Error('Nenhuma aba disponivel para consultar recompra.');

  for (const request of entry.requests.values()) {
    try {
      const response = await chrome.tabs.sendMessage(request.tabId, {
        action: 'run_customer_history_lookup',
        login: entry.login
      });

      if (response?.ok) {
        return decodeCustomerHistoryResults(response.results);
      }

      lastError = new Error(response?.error || 'A aba nao conseguiu consultar os pedidos anteriores.');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || 'Falha na aba de consulta.'));
    }
  }

  throw lastError;
}

function deliverCustomerHistoryLookup(entry, payload) {
  entry.requests.forEach((request) => {
    sendCustomerHistoryLookupResult(request.tabId, {
      ...payload,
      saleNumber: request.saleNumber,
      requestId: request.requestId
    });
  });
}

async function handleOrderFound(orderNumber, elementHash, tab) {
  if (!isMonitoring) return;

  const uniqueKey = `${tab.id}-${elementHash}-${orderNumber}`;
  if (notifiedOrders.has(orderNumber) || processedElements.has(uniqueKey)) return;

  processedElements.add(uniqueKey);
  notifiedOrders.add(orderNumber);
  await chrome.storage.local.set({ notifiedOrders: Array.from(notifiedOrders) });

  const notificationId = `sentinela_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon128.png'),
      title: 'Sentinela Pro - Nova Venda!',
      message: `Detectada venda com 2 unidades:\n${orderNumber}`,
      priority: 2,
      requireInteraction: true,
      silent: false
    });
    setTimeout(() => chrome.notifications.clear(notificationId), 30000);
  } catch (error) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon128.png'),
      title: 'Sentinela Pro',
      message: `Nova venda: ${orderNumber}`
    });
  }

  chrome.tabs.sendMessage(tab.id, { action: 'playAlert', orderNumber }).catch(console.error);
  console.log(`✅ Venda detectada: ${orderNumber} - ${new Date().toLocaleString()}`);
}

async function toggleMonitoring() {
  isMonitoring = !isMonitoring;
  await chrome.storage.local.set({ isMonitoring });
  processedElements.clear();

  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      action: 'monitoringStatusChanged',
      isMonitoring
    }).catch(() => {});
  });
}

async function clearLog() {
  notifiedOrders.clear();
  processedElements.clear();
  await chrome.storage.local.set({ notifiedOrders: [] });
}

chrome.notifications.onClicked.addListener(notificationId => {
  chrome.notifications.clear(notificationId);
});

// ══════════════════════════════════════════════════════════════
// MÓDULO: RANGER COUNTER (badge + contador de abas ML)
// ══════════════════════════════════════════════════════════════

const ML_URLS = ['*://*.mercadolivre.com.br/*', '*://*.mercadolibre.com/*'];

async function countRelevantTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => {
    const isML = tab.url && (
      tab.url.includes('mercadolivre.com.br') ||
      tab.url.includes('mercadolibre.com')
    );
    const hasTitle = tab.title && (
      tab.title.includes('Detalhe') ||
      tab.title.includes('Mensagens')
    );
    return isML && hasTitle;
  }).length;
}

async function refreshAllMLTabs() {
  const tabs = await chrome.tabs.query({});
  const relevant = tabs.filter(tab => {
    const isML = tab.url && (
      tab.url.includes('mercadolivre.com.br') ||
      tab.url.includes('mercadolibre.com')
    );
    const hasTitle = tab.title && (
      tab.title.includes('Detalhe') ||
      tab.title.includes('Mensagens')
    );
    return isML && hasTitle;
  });
  await Promise.all(relevant.map(tab => chrome.tabs.reload(tab.id).catch(() => {})));
  return relevant.length;
}

async function updateBadgeAndNotify() {
  const count = await countRelevantTabs();

  chrome.action.setBadgeText({ text: '' });
  chrome.action.setTitle({ title: 'Sentinela Pro' });

  // Broadcast para todos os content scripts ML para atualizar o botão na top bar
  const mlTabs = await chrome.tabs.query({});
  mlTabs.forEach(tab => {
    if (tab.url && (tab.url.includes('mercadolivre.com.br') || tab.url.includes('mercadolibre.com'))) {
      chrome.tabs.sendMessage(tab.id, { action: 'tabCountUpdate', count }).catch(() => {});
    }
  });
}

// Handlers de getTabCount e refreshAllTabs
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getTabCount') {
    countRelevantTabs().then(count => sendResponse({ count }));
    return true;
  }
  if (message.action === 'refreshAllTabs') {
    refreshAllMLTabs().then(count => {
      updateBadgeAndNotify();
      sendResponse({ success: true, count });
    }).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

// Monitora mudanças de abas
chrome.tabs.onCreated.addListener(updateBadgeAndNotify);
chrome.tabs.onRemoved.addListener(updateBadgeAndNotify);
chrome.tabs.onRemoved.addListener((tabId) => {
  customerHistoryPending.forEach((entry, login) => {
    entry.requests.forEach((request, key) => {
      if (request.tabId === tabId) {
        entry.requests.delete(key);
      }
    });

    if (!entry.requests.size) {
      customerHistoryPending.delete(login);
    }
  });
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.title || changeInfo.status === 'complete') updateBadgeAndNotify();
});
chrome.tabs.onActivated.addListener(updateBadgeAndNotify);

// Atualiza via chrome.alarms (MV3-safe — não suspende como setInterval)
chrome.alarms.create('badgeRefresh', { periodInMinutes: 0.1 }); // ~6 s
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badgeRefresh') updateBadgeAndNotify();
});

// Inicializa badge imediatamente ao ativar o service worker
updateBadgeAndNotify();
