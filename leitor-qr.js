/* ============================================================================
 * Leitor de QR pela câmera (Sentinela — Trocas e portal medievaljoias/pedidos)
 * Abre a câmera do notebook, lê o QR do canhoto e devolve o texto lido.
 * Usa o BarcodeDetector do navegador quando existe; senão, o jsQR (vendor).
 * Uso: const texto = await window.lerQRCamera();  // null se cancelar
 * O mesmo arquivo existe nos dois repositórios: mantenha os dois iguais.
 * ========================================================================== */
(function () {
  const CSS = `
.lqr { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; background: rgba(10, 10, 14, 0.55); }
.lqr__box { width: min(560px, 100%); display: flex; flex-direction: column; gap: 12px; padding: 18px; border-radius: 14px;
  background: var(--surface, var(--bg, #fff)); color: var(--fg, #18181b); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); font-family: inherit; }
.lqr__t { margin: 0; font-size: 16px; font-weight: 600; }
.lqr__v { position: relative; overflow: hidden; border-radius: 10px; background: #000; aspect-ratio: 4 / 3; }
.lqr__v video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.lqr__mira { position: absolute; inset: 18% 24%; border: 3px solid rgba(255, 255, 255, 0.85); border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.28); }
.lqr__msg { margin: 0; font-size: 13px; color: var(--muted, var(--fg-muted, #5d5d68)); }
.lqr__msg.erro { color: var(--danger, var(--alert, #b4322a)); }
.lqr__acoes { display: flex; justify-content: flex-end; gap: 8px; }
.lqr__btn { appearance: none; border: 1px solid var(--line-strong, var(--border-strong, #cbcbd3)); background: transparent; color: inherit;
  padding: 8px 14px; border-radius: 9px; font: inherit; font-weight: 500; cursor: pointer; }
.lqr__btn:hover { background: rgba(127, 127, 127, 0.12); }`;

  function injetarCss() {
    if (document.getElementById('lqr-css')) return;
    const st = document.createElement('style');
    st.id = 'lqr-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  async function criarDetector() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const formatos = await window.BarcodeDetector.getSupportedFormats();
      return formatos.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    } catch (_) { return null; }
  }

  function lerQRCamera({ titulo = 'Ler o QR do canhoto' } = {}) {
    injetarCss();
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'lqr';
      wrap.innerHTML = `
        <div class="lqr__box" role="dialog" aria-modal="true" aria-label="${titulo}">
          <h2 class="lqr__t"></h2>
          <div class="lqr__v"><video playsinline muted></video><div class="lqr__mira" aria-hidden="true"></div></div>
          <p class="lqr__msg">Abrindo a câmera…</p>
          <div class="lqr__acoes"><button type="button" class="lqr__btn" data-lqr="fechar">Cancelar</button></div>
        </div>`;
      wrap.querySelector('.lqr__t').textContent = titulo;
      document.body.appendChild(wrap);
      const video = wrap.querySelector('video');
      const msg = wrap.querySelector('.lqr__msg');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let stream = null;
      let timer = null;
      let fim = false;

      const terminar = (texto) => {
        if (fim) return;
        fim = true;
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        document.removeEventListener('keydown', onKey, true);
        wrap.remove();
        resolve(texto || null);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); terminar(null); } };
      document.addEventListener('keydown', onKey, true);
      wrap.addEventListener('click', (e) => {
        if (e.target === wrap || e.target.closest('[data-lqr="fechar"]')) terminar(null);
      });

      const erro = (texto) => {
        msg.textContent = texto;
        msg.classList.add('erro');
        wrap.querySelector('[data-lqr="fechar"]').textContent = 'Fechar';
      };

      (async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          erro('Este navegador não deixa usar a câmera aqui. Digite o código do canhoto no campo de busca.');
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        } catch (e) {
          const nome = e?.name || '';
          if (nome === 'NotAllowedError' || nome === 'SecurityError') erro('A câmera foi bloqueada. Clique no ícone de câmera na barra de endereço, permita o acesso e tente de novo.');
          else if (nome === 'NotFoundError' || nome === 'OverconstrainedError') erro('Nenhuma câmera encontrada neste computador.');
          else if (nome === 'NotReadableError') erro('A câmera está sendo usada por outro programa (Meet, Zoom…). Feche-o e tente de novo.');
          else erro(`Não deu para abrir a câmera (${nome || e?.message || 'erro'}).`);
          return;
        }
        if (fim) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        try { await video.play(); } catch (_) { /* segue tentando ler os quadros */ }
        msg.textContent = 'Aponte o QR do canhoto para a câmera, dentro do quadrado.';
        const detector = await criarDetector();
        const jsQR = window.jsQR;
        if (!detector && typeof jsQR !== 'function') { erro('Leitor de QR indisponível. Digite o código do canhoto.'); return; }

        const ler = async () => {
          if (fim) return;
          try {
            if (video.readyState >= 2 && video.videoWidth) {
              if (detector) {
                const achados = await detector.detect(video);
                if (achados.length && achados[0].rawValue) { terminar(achados[0].rawValue); return; }
              } else {
                const escala = Math.min(1, 800 / video.videoWidth);
                canvas.width = Math.round(video.videoWidth * escala);
                canvas.height = Math.round(video.videoHeight * escala);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
                if (qr && qr.data) { terminar(qr.data); return; }
              }
            }
          } catch (_) { /* quadro ruim: tenta o próximo */ }
          timer = setTimeout(ler, 150);
        };
        ler();
      })();
    });
  }

  window.lerQRCamera = lerQRCamera;
})();
