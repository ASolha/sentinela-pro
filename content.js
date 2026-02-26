// ============================================================
//  SENTINELA PRO — content.js v1.0
//  Unificado: Sentinela Ranger + Passo Largo + Clip
// ============================================================

// ══════════════════════════════════════════════════════════════
// BARRA SUPERIOR CENTRALIZADA
// ══════════════════════════════════════════════════════════════

function createTopBar() {
  if (document.getElementById('sp-topbar')) return;
  const bar = document.createElement('div');
  bar.id = 'sp-topbar';

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

  bar.innerHTML = `
    <button id="sp-btn-passo"   class="sp-btn" title="Mensagem Rápida (Alt+M)">${iconPasso}</button>
    <div class="sp-sep"></div>
    <button id="sp-btn-clip"    class="sp-btn" title="Capturar Dados (Alt+C)">${iconClip}</button>
    <div class="sp-sep"></div>
    <button id="sp-btn-counter" class="sp-btn" title="Abas ML abertas — clique para recarregar (Alt+R)">
      ${iconCounter}
      <span class="sp-counter-badge" id="sp-counter-badge"></span>
    </button>
  `;
  document.body.appendChild(bar);

  const btnPasso   = bar.querySelector('#sp-btn-passo');
  const btnClip    = bar.querySelector('#sp-btn-clip');
  const btnCounter = bar.querySelector('#sp-btn-counter');

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
      mostrarPopup();
      btnClip.classList.add('sp-active');
    }
  });

  // Counter — recarrega todas as abas ML relevantes
  btnCounter.addEventListener('click', () => {
    if (btnCounter.classList.contains('sp-spinning')) return;
    btnCounter.classList.add('sp-spinning');
    chrome.runtime.sendMessage({ action: 'refreshAllTabs' }, (r) => {
      btnCounter.classList.remove('sp-spinning');
      if (r?.success) {
        mostrarNotificacao(`${r.count} aba${r.count !== 1 ? 's' : ''} recarregada${r.count !== 1 ? 's' : ''}!`);
      }
    });
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
    }
  });

  // Busca contagem inicial ao criar a barra
  chrome.runtime.sendMessage({ action: 'getTabCount' }, (r) => {
    if (r) updateCounterBadge(r.count);
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
let panelSavedPos  = null;  // posição gravada do overlay arrastar

const AVAILABLE_VARS = [
  '[NOME_CLIENTE]', '[NUMERO_PEDIDO]', '[PRAZO_ENTREGA]',
  '[DATA]', '[HORA]', '[VALOR]',
];
const categoryIcons = {
  'Gravação': '✍️', 'Desconto 50%': '💰', 'Mercado Pago': '💳',
  'Troca de Endereço': '🏠', 'Troca de Aliança': '💍', 'Menos Usadas': '❓', default: '📂',
};

function loadData() {
  try { const s = localStorage.getItem('mr-messages');        if (s) messageData    = JSON.parse(s); } catch(e) {}
  try { const p = localStorage.getItem('mr-button-position'); if (p) buttonPosition = JSON.parse(p); } catch(e) {}
  try { const t = localStorage.getItem('mr-theme');           if (t) isDarkTheme    = t === 'dark';  } catch(e) {}
  chrome.storage.local.get(['sp_panel_pos'], (r) => { if (r.sp_panel_pos) panelSavedPos = r.sp_panel_pos; });
}
function saveData() { localStorage.setItem('mr-messages', JSON.stringify(messageData)); }
function saveButtonPosition(top, left) {
  const ww = window.innerWidth, wh = window.innerHeight, dr = ww - left, db = wh - top;
  buttonPosition = { right: dr < ww/2 ? dr+'px' : 'auto', left: dr < ww/2 ? 'auto' : left+'px', bottom: db < wh/2 ? db+'px' : 'auto', top: db < wh/2 ? 'auto' : top+'px' };
  localStorage.setItem('mr-button-position', JSON.stringify(buttonPosition));
}

function formatCustomerName(name) {
  if (!name) return name;
  if (name === name.toUpperCase()) return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return name;
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
    showToast('Mensagem inserida! ✓');
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
let suggestionState = { catName: null, subName: null, score: 0 };
let suggestionObserver = null;
const SUGGESTION_THRESHOLD = 0.05, FEEDBACK_KEY = 'mr-suggestion-feedback', FEEDBACK_BONUS = 0.35, FEEDBACK_DECAY = 0.92, MAX_FEEDBACK_ENTRIES = 200;
function loadFeedback() { try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY)||'{}'); } catch(e) { return {}; } }
function saveFeedback(fb) { try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(fb)); } catch(e) {} }
function contextKey(text) { return nlpTokenize(text).slice(-6).join('_').substring(0,80); }
function recordFeedback(catName, subName) {
  if (!suggestionState.score) return;
  const clientText = getLastClientMessages(3); if (!clientText) return;
  const key = contextKey(clientText); if (!key) return;
  const fb = loadFeedback(); if (!fb[key]) fb[key] = {};
  const chosenId = catName+'::'+subName; fb[key][chosenId] = (fb[key][chosenId]||0)+1;
  Object.keys(fb[key]).forEach(id => { if (id!==chosenId) fb[key][id]=(fb[key][id]||0)*FEEDBACK_DECAY; });
  if (Object.keys(fb).length > MAX_FEEDBACK_ENTRIES) delete fb[Object.keys(fb)[0]];
  saveFeedback(fb);
}
function feedbackBonus(clientText, catName, subName) {
  const key = contextKey(clientText); if (!key) return 0;
  const fb = loadFeedback(); if (!fb[key]) return 0;
  const uses = fb[key][catName+'::'+subName]||0;
  return uses > 0 ? FEEDBACK_BONUS*Math.log1p(uses) : 0;
}
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
function runSuggestion() {
  const clientText = getLastClientMessages(3); if (!clientText||clientText.length<5) return;
  const allMsgs = [];
  Object.entries(messageData.categories).forEach(([catName,cat]) => { Object.entries(cat.subcategories||{}).forEach(([subName,subItem]) => { allMsgs.push({catName,subName,message:typeof subItem==='string'?subItem:subItem.message}); }); });
  if (!allMsgs.length) return;
  const rawScores = nlpTfIdf(clientText, allMsgs);
  const scores = rawScores.map((s,i)=>s+feedbackBonus(clientText,allMsgs[i].catName,allMsgs[i].subName));
  const best = scores.reduce((bi,s,i)=>s>scores[bi]?i:bi,0), bestScore = scores[best];
  if (bestScore >= SUGGESTION_THRESHOLD) { const prev = suggestionState; suggestionState = {...allMsgs[best],score:bestScore}; if (prev.subName!==suggestionState.subName||prev.catName!==suggestionState.catName) renderCards(); }
  else if (suggestionState.subName) { suggestionState = {catName:null,subName:null,score:0}; renderCards(); }
}
function startSuggestionObserver() {
  if (suggestionObserver) suggestionObserver.disconnect();
  const target = document.querySelector('.messages-container')||document.querySelector('[data-testid="messages-container"]')||document.querySelector('.conversation-thread')||document.body;
  let debounceTimer = null;
  suggestionObserver = new MutationObserver(() => { clearTimeout(debounceTimer); debounceTimer = setTimeout(runSuggestion, 800); });
  suggestionObserver.observe(target, {childList:true,subtree:true});
  setTimeout(runSuggestion, 300);
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
  panel.querySelector('#mr-close-btn').onclick = hidePanel;
  panel.querySelector('#mr-tt').onclick = () => { isDarkTheme = !isDarkTheme; panel.classList.toggle('dark', isDarkTheme); localStorage.setItem('mr-theme', isDarkTheme?'dark':'light'); };
  panel.querySelector('#mr-si').oninput = (e) => { searchQuery = e.target.value.trim(); renderCards(); };
  panel.querySelector('#mr-bnew').onclick      = () => openMessageModal(null, null);
  panel.querySelector('#mr-cat-btn').onclick   = openCatModal;
  panel.querySelector('#mr-settings-btn').onclick = openSettingsPanel;
  panel.querySelector('#mr-ie-btn').onclick    = openImportExportModal;
  renderCatTabs(); renderCards();
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
    if (e.button !== 0 || e.target.closest('button, .mr-tt')) return;
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
    const card = document.createElement('div'), isSuggested = suggestionState.subName===subName&&suggestionState.catName===catName;
    card.className = 'mr-card'+(isSuggested?' mr-suggested':'');
    card.innerHTML = `<div class="mr-ci">${isSuggested?'<div class="mr-suggest-badge">✨ Sugerida</div>':''}<div class="mr-cbar" style="background:${color}"></div><div class="mr-cbody"><span class="mr-cname">${subName}</span><div class="mr-cprev">${highlightVars(message)}</div><div class="mr-cft"><div class="mr-cact"><button class="mr-btn mr-bg mr-edit">Editar</button><button class="mr-btn mr-bp mr-use">Usar</button></div></div></div></div>`;
    card.querySelector('.mr-use').onclick  = e => { e.stopPropagation(); recordFeedback(catName,subName); insertMessage(message); };
    card.querySelector('.mr-edit').onclick = e => { e.stopPropagation(); openMessageModal(catName,subName); };
    card.onclick = () => { recordFeedback(catName,subName); insertMessage(message); };
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
  if (panel) { const cs = getComputedStyle(panel); const vars = ['--bg','--bg2','--bg3','--bghov','--txt','--txt2','--txt3','--border','--accent','--accenthov','--accentlt','--success','--danger','--dangerlt','--sh-sm','--sh-md','--sh-lg','--r-sm','--r-md','--r-lg','--r-full','--tr']; const modal = ov.querySelector('.mr-modal'); vars.forEach(v => modal.style.setProperty(v, cs.getPropertyValue(v))); }
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
  modal.querySelector('#mr-file').onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{try{const data=JSON.parse(ev.target.result);if(!data.categories)throw new Error('Formato inválido');if(confirm('Substituir mensagens atuais?')){messageData=data;saveData();refreshPanel();closeOverlay(ov);showToast('Importado com sucesso!');}}catch(err){alert('Erro: '+err.message);}};reader.readAsText(file);e.target.value='';};
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
  const panel=document.getElementById('mr-panel');
  if(panel){const cs=getComputedStyle(panel);['--bg','--bg2','--bg3','--bghov','--txt','--txt2','--txt3','--border','--accent','--accenthov','--accentlt','--success','--danger','--dangerlt','--sh-sm','--sh-md','--sh-lg','--r-sm','--r-md','--r-lg','--r-full','--tr'].forEach(v=>sp.style.setProperty(v,cs.getPropertyValue(v)));}
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
  loadData();
  const alreadyImported = localStorage.getItem(IMPORT_FLAG), hasData = Object.keys(messageData.categories).length > 0;
  if (!alreadyImported && !hasData) {
    try {
      const res = await fetch(BACKUP_URL); if (!res.ok) throw new Error('HTTP ' + res.status);
      const imported = await res.json();
      if (imported && imported.categories && Object.keys(imported.categories).length > 0) {
        messageData = imported; saveData(); localStorage.setItem(IMPORT_FLAG, '1');
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

document.addEventListener('click', e => {
  const panel = document.getElementById('mr-panel');
  if (!panel?.classList.contains('visible')) return;
  if (document.querySelector('.mr-ov.active')) return;
  const bar = document.getElementById('sp-topbar');
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

function capturarDados() {
  const textoCompleto = document.body.innerText;
  const url = window.location.href;
  const login = capturarLoginDoHTML();

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

  const arosAvulsos = [];
  const padroesAro = textoCompleto.match(/Aro\s*-\s*([^\n|]+)/g);

  if (padroesAro && padroesAro.length > 0) {
    padroesAro.forEach((match, index) => {
      const textoAro = match.replace(/Aro\s*-\s*/, '').trim();
      const numeroMatch = textoAro.match(/(\d+(?:\.\d+)?)/);
      const numero = numeroMatch ? numeroMatch[1] : '';
      let comPedra = '';
      if (/com\s+pedra/i.test(textoAro)) {
        comPedra = ' com pedra';
      } else {
        const linhas = textoCompleto.split('\n');
        for (let i = 0; i < linhas.length; i++) {
          if (linhas[i].includes(match)) {
            for (let j = Math.max(0, i - 3); j <= Math.min(linhas.length - 1, i + 3); j++) {
              if (/com\s+pedra/i.test(linhas[j])) { comPedra = ' com pedra'; break; }
            }
            break;
          }
        }
      }
      let modeloAro = '';
      const linhas = textoCompleto.split('\n');
      for (let i = 0; i < linhas.length; i++) {
        if (linhas[i].includes(match)) {
          for (let j = Math.max(0, i - 3); j <= Math.min(linhas.length - 1, i + 3); j++) {
            const linhaBusca = linhas[j];
            for (const padrao of padroesModelo) {
              const matchModelo = linhaBusca.match(padrao);
              if (matchModelo) {
                let modeloCompleto = matchModelo[1].replace(/\*\*/g, '').trim();
                modeloCompleto = modeloCompleto.replace(/\s+(Banhad[ao]|Folhead[ao]).*$/i, '');
                modeloAro = modeloCompleto;
                break;
              }
            }
            if (modeloAro) break;
          }
          break;
        }
      }
      arosAvulsos.push({ numero: numero + comPedra, modelo: modeloAro || modelo });
    });
  } else {
    const aroMasculinoMatch = textoCompleto.match(/Masculino\s*-\s*([^\n|]+)/);
    let aroMasculino = '';
    if (aroMasculinoMatch) {
      const textoAro = aroMasculinoMatch[1].trim();
      const numeroMatch = textoAro.match(/(\d+(?:\.\d+)?)/);
      const numero = numeroMatch ? numeroMatch[1] : textoAro;
      aroMasculino = numero + (/com\s+pedra/i.test(textoAro) ? ' com pedra' : '');
    }
    const aroFemininoMatch = textoCompleto.match(/Feminino\s*-\s*([^\n|]+)/);
    let aroFeminino = '';
    if (aroFemininoMatch) {
      const textoAro = aroFemininoMatch[1].trim();
      const numeroMatch = textoAro.match(/(\d+(?:\.\d+)?)/);
      const numero = numeroMatch ? numeroMatch[1] : textoAro;
      aroFeminino = numero + (/com\s+pedra/i.test(textoAro) ? ' com pedra' : '');
    }
    if (aroMasculino || aroFeminino) {
      arosAvulsos.push({ numero: aroMasculino, modelo: modelo, tipo: 'Masculino' });
      arosAvulsos.push({ numero: aroFeminino, modelo: modelo, tipo: 'Feminino' });
    }
  }
  return { login, modelo, aros: arosAvulsos, url };
}

function formatarTextoParaCopia(dados) {
  let texto = `${dados.url}\n\n${dados.modelo || ''}\n`;
  dados.aros.filter(a => a.tipo).forEach(aro => {
    const numero = aro.numero || '';
    const valor = aro.valor || '';
    if (valor) { texto += `${aro.tipo} ${numero} >>                    ${valor}\n`; }
    else { texto += `${aro.tipo} ${numero}\n`; }
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
    btnCoracao.addEventListener('click', () => { if (campoAtivo) inserirSimboloNoCursor(campoAtivo, '♥'); });
    btnCoracao.addEventListener('mouseenter', () => { btnCoracao.style.background = 'rgba(244,114,182,0.15)'; });
    btnCoracao.addEventListener('mouseleave', () => { btnCoracao.style.background = 'transparent'; });
  }
  const btnInfinito = document.getElementById('btn-infinito');
  if (btnInfinito) {
    btnInfinito.addEventListener('click', () => { if (campoAtivo) inserirSimboloNoCursor(campoAtivo, '∞'); });
    btnInfinito.addEventListener('mouseenter', () => { btnInfinito.style.background = 'rgba(96,165,250,0.15)'; });
    btnInfinito.addEventListener('mouseleave', () => { btnInfinito.style.background = 'transparent'; });
  }
  const btnFormatarTudo = document.getElementById('btn-formatar-tudo');
  if (btnFormatarTudo) {
    btnFormatarTudo.addEventListener('click', () => {
      document.querySelectorAll('input[type="text"]').forEach(campo => {
        if (campo.id && campo.id.startsWith('campo-valor-')) campo.value = formatarTextoPrimeiraMaiuscula(campo.value);
      });
      mostrarNotificacao('Todos os textos foram formatados!');
    });
    btnFormatarTudo.addEventListener('mouseenter', () => { btnFormatarTudo.style.background = 'rgba(255,255,255,0.1)'; });
    btnFormatarTudo.addEventListener('mouseleave', () => { btnFormatarTudo.style.background = 'transparent'; });
  }
}

function criarInterfaceAro(aro, index, isAvulso = false) {
  const tipoLabel = isAvulso ? `AVL ${index + 1}` : (aro.tipo || `ARO ${index + 1}`);
  const badgeColor = aro.tipo === 'Masculino' ? '#6366f1' : aro.tipo === 'Feminino' ? '#ec4899' : '#8b5cf6';

  let html = `<div style="margin-bottom:8px;padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(255,255,255,0.04);">`;
  html += `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1px;color:white;background:${badgeColor};margin-bottom:8px;text-transform:uppercase;">${tipoLabel}</span>`;
  if (isAvulso && aro.modelo) {
    html += `<div style="margin-bottom:8px;">`;
    html += `<label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">MODELO</label>`;
    html += `<input type="text" id="campo-modelo-aro-${index}" value="${aro.modelo}" style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:12px;box-sizing:border-box;outline:none;">`;
    html += `</div>`;
  }
  html += `<div style="margin-bottom:5px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">ARO</label><input type="text" id="campo-aro-${index}" value="${aro.numero}" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;"></div>`;
  html += `<div style="position:relative;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">DADOS</label><input type="text" id="campo-valor-${index}" value="" style="width:100%;padding:7px 30px 7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;" placeholder="Dados..."><button class="btn-formatar" data-target="campo-valor-${index}" style="position:absolute;right:4px;bottom:4px;width:24px;height:24px;background:transparent;color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" title="Formatar texto">Aa</button></div>`;
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

function mostrarPopup() {
  const popupExistente = document.getElementById('extensao-popup-overlay');
  if (popupExistente) popupExistente.remove();

  const dados = carregarDados();
  const isAvulso = dados.aros.length > 0 && !dados.aros[0].tipo;

  const container = document.createElement('div');
  container.id = 'extensao-popup-overlay';
  container.style.cssText = `position:fixed;top:8px;right:8px;width:340px;background:linear-gradient(180deg,#1a1a2e 0%,#16213e 100%);z-index:10000;box-shadow:-4px 0 24px rgba(0,0,0,0.4);overflow:hidden;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;border-radius:16px;`;

  const popup = document.createElement('div');
  popup.style.cssText = `padding:16px;box-sizing:border-box;`;

  let arosHTML = '';
  dados.aros.forEach((aro, index) => { arosHTML += criarInterfaceAro(aro, index, isAvulso); });

  if (dados.aros.length === 0) {
    arosHTML = `
      <div style="margin-bottom:8px;padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(255,255,255,0.04);">
        <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1px;color:white;background:#6366f1;margin-bottom:8px;text-transform:uppercase;">Masculino</span>
        <div style="margin-bottom:5px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">ARO</label><input type="text" id="campo-aro-0" value="" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;"></div>
        <div style="position:relative;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">DADOS</label><input type="text" id="campo-valor-0" value="" style="width:100%;padding:7px 30px 7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;" placeholder="Dados..."><button class="btn-formatar" data-target="campo-valor-0" style="position:absolute;right:4px;bottom:4px;width:24px;height:24px;background:transparent;color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" title="Formatar texto">Aa</button></div>
      </div>
      <div style="margin-bottom:8px;padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(255,255,255,0.04);">
        <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1px;color:white;background:#ec4899;margin-bottom:8px;text-transform:uppercase;">Feminino</span>
        <div style="margin-bottom:5px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">ARO</label><input type="text" id="campo-aro-1" value="" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;"></div>
        <div style="position:relative;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">DADOS</label><input type="text" id="campo-valor-1" value="" style="width:100%;padding:7px 30px 7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;" placeholder="Dados..."><button class="btn-formatar" data-target="campo-valor-1" style="position:absolute;right:4px;bottom:4px;width:24px;height:24px;background:transparent;color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" title="Formatar texto">Aa</button></div>
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
        <input type="text" id="campo-login" value="${dados.login}" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;">
      </div>
      ${(!isAvulso || !dados.aros.some(aro => aro.modelo)) ?
        `<div style="margin-bottom:10px;"><label style="display:block;margin-bottom:3px;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">MODELO</label><textarea id="campo-modelo" style="width:100%;padding:7px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;outline:none;max-height:50px;resize:none;line-height:1.4;">${dados.modelo}</textarea></div>` : ''}
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
  recapturarBtn.addEventListener('click', () => {
    const popupOverlay = document.getElementById('extensao-popup-overlay');
    if (popupOverlay) popupOverlay.remove();
    const novosDados = capturarDados();
    salvarDados(novosDados);
    mostrarPopup();
    mostrarNotificacao('Dados da página foram recapturados!');
  });

  const copiarBtn = document.getElementById('copiar-dados');
  copiarBtn.addEventListener('mouseenter', () => { copiarBtn.style.boxShadow = '0 4px 16px rgba(99,102,241,0.45)'; copiarBtn.style.transform = 'translateY(-1px)'; });
  copiarBtn.addEventListener('mouseleave', () => { copiarBtn.style.boxShadow = '0 2px 8px rgba(99,102,241,0.3)'; copiarBtn.style.transform = 'translateY(0)'; });
  copiarBtn.addEventListener('click', () => {
    const dadosParaCopiar = coletarDadosDaInterface(dados);
    const textoFormatado = formatarTextoParaCopia(dadosParaCopiar);
    const closeClip = () => { container.remove(); document.getElementById('sp-btn-clip')?.classList.remove('sp-active'); };
    navigator.clipboard.writeText(textoFormatado).then(() => {
      mostrarNotificacao('Dados copiados com sucesso!'); limparDadosSalvos(); closeClip();
    }).catch(() => {
      const ta = document.createElement('textarea'); ta.value = textoFormatado;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      mostrarNotificacao('Dados copiados com sucesso!'); limparDadosSalvos(); closeClip();
    });
  });

  const viewConfig = document.getElementById('view-config-fefrello');
  const btnConfig = document.getElementById('btn-config-fefrello');
  let configAberta = false;

  if (btnConfig) {
    btnConfig.addEventListener('click', async () => {
      configAberta = !configAberta;
      const conteudoPrincipal = document.getElementById('conteudo-principal');
      const footerPrincipal = document.getElementById('footer-principal');
      if (configAberta) {
        btnConfig.style.background = 'rgba(255,255,255,0.15)'; btnConfig.style.color = '#fff';
        if (conteudoPrincipal) conteudoPrincipal.style.display = 'none';
        if (footerPrincipal) footerPrincipal.style.display = 'none';
        viewConfig.style.display = 'block';
        await carregarDadosConfig();
      } else {
        btnConfig.style.background = 'transparent'; btnConfig.style.color = 'rgba(255,255,255,0.5)';
        if (conteudoPrincipal) conteudoPrincipal.style.display = 'block';
        if (footerPrincipal) footerPrincipal.style.display = 'flex';
        viewConfig.style.display = 'none';
      }
    });
    btnConfig.addEventListener('mouseenter', () => { if (!configAberta) btnConfig.style.background = 'rgba(255,255,255,0.1)'; });
    btnConfig.addEventListener('mouseleave', () => { if (!configAberta) btnConfig.style.background = 'transparent'; });
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
      const dadosParaCopiar = coletarDadosDaInterface(dados);
      const descricao = formatarTextoParaCopia(dadosParaCopiar);
      const titulo = document.getElementById('campo-login')?.value || 'Sem título';
      confirmarEnviarBtn.disabled = true;
      const textoOriginal = confirmarEnviarBtn.textContent;
      confirmarEnviarBtn.textContent = 'Enviando...'; confirmarEnviarBtn.style.opacity = '0.7';
      try {
        await criarCardFefrello(config.boardId, columnId, titulo, descricao, responsible);
        mostrarNotificacao('Card criado com sucesso!'); limparDadosSalvos(); container.remove(); document.getElementById('sp-btn-clip')?.classList.remove('sp-active');
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
  if (dadosOriginais.aros.length > 0) {
    dadosOriginais.aros.forEach((aro, index) => {
      const campoAro = document.getElementById(`campo-aro-${index}`);
      const campoValor = document.getElementById(`campo-valor-${index}`);
      const campoModeloAro = document.getElementById(`campo-modelo-aro-${index}`);
      if (campoAro) {
        aros.push({ numero: campoAro.value.trim(), valor: campoValor ? campoValor.value.trim() : '', tipo: aro.tipo, modelo: campoModeloAro ? campoModeloAro.value : aro.modelo });
      }
    });
  } else {
    const campoAroMasc = document.getElementById('campo-aro-0');
    const campoValorMasc = document.getElementById('campo-valor-0');
    const campoAroFem = document.getElementById('campo-aro-1');
    const campoValorFem = document.getElementById('campo-valor-1');
    aros.push({ numero: campoAroMasc ? campoAroMasc.value.trim() : '', valor: campoValorMasc ? campoValorMasc.value.trim() : '', tipo: 'Masculino', modelo });
    aros.push({ numero: campoAroFem ? campoAroFem.value.trim() : '', valor: campoValorFem ? campoValorFem.value.trim() : '', tipo: 'Feminino', modelo });
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
  setInterval(() => {
    const novaURL = window.location.href;
    if (novaURL !== urlAtual) {
      urlAtual = novaURL;
      const dadosExistentes = carregarDados();
      if (dadosExistentes && (dadosExistentes.login || dadosExistentes.modelo)) {
        const foiAtualizado = atualizarApenasURL(novaURL);
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
  window.addEventListener('load', () => {
    monitorarMudancasURL();
    const dadosJaSalvos = carregarDados();
    if (!dadosJaSalvos || !dadosJaSalvos.url) {
      const dadosPagina = capturarDados();
      if (dadosPagina.login || dadosPagina.modelo) {
        salvarDados(dadosPagina);
        mostrarNotificacao('Dados da página capturados em segundo plano!');
      }
    } else {
      if (dadosJaSalvos.url !== window.location.href) atualizarApenasURL(window.location.href);
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
  // Clip
  if (message.action === 'capturar_e_copiar') {
    try {
      mostrarPopup();
      sendResponse({ success: true });
    } catch (error) {
      console.error('[Sentinela Pro] Erro ao mostrar popup:', error);
      mostrarNotificacao('Erro ao abrir a interface', 'error');
      sendResponse({ success: false, error: error.message });
    }
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
