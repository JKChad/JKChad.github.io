import { CONFIG } from '../config.js';

export class HUD {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      <div class="ns-hud">
        <div class="ns-top">
          <div class="ns-brand">NIGHT SHIFT</div>
          <div class="ns-mode" data-mode>STEALTH</div>
          <div class="ns-invoice" data-invoice>$0</div>
        </div>
        <div class="ns-attention">
          <div class="ns-att-card">
            <div class="ns-att-header">
              <span class="ns-att-label">ATTENTION LEDGER</span>
              <span class="ns-att-code">SPLIT / LIVE</span>
            </div>
            <div class="ns-att-track" aria-label="Shared attention">
              <div class="ns-att-grid"></div>
              <div class="ns-att-slice ns-att-you" data-att-you><span></span></div>
              <div class="ns-att-slice ns-att-partner" data-att-partner><span></span></div>
              <div class="ns-att-marker" data-att-marker></div>
            </div>
            <div class="ns-att-meta">
              <span data-att-you-pct>50%</span>
              <span>LOCAL HEAT</span>
              <span>GHOST WINDOW</span>
              <span data-att-partner-pct>50%</span>
            </div>
            <div class="ns-att-status" data-suspicion>
              <span class="ns-suspicion-key">SUSPICION</span>
              <span class="ns-suspicion-copy" data-suspicion-copy>no eyes / route cold</span>
              <span class="ns-suspicion-meter"><span data-suspicion-bar></span></span>
            </div>
          </div>
        </div>
        <div class="ns-crosshair" data-crosshair>
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="ns-bottom">
          <div class="ns-ammo"><span data-ammo>18</span> / <span data-reserve>72</span></div>
          <div class="ns-hint" data-hint>F distract · 1/2 trade attention</div>
          <div class="ns-fps" data-fps>60</div>
        </div>
        <div class="ns-extract" data-extract>
          <span>EXIT VECTOR</span>
          <strong data-extract-text>Extract at the far door</strong>
        </div>
        <div class="ns-banner" data-banner></div>
        <div class="ns-ghost" data-ghost></div>
      </div>
    `;
    this._injectStyles();
    this.el = {
      mode: root.querySelector('[data-mode]'),
      invoice: root.querySelector('[data-invoice]'),
      attYou: root.querySelector('[data-att-you]'),
      attPartner: root.querySelector('[data-att-partner]'),
      attMarker: root.querySelector('[data-att-marker]'),
      attYouPct: root.querySelector('[data-att-you-pct]'),
      attPartnerPct: root.querySelector('[data-att-partner-pct]'),
      suspicion: root.querySelector('[data-suspicion]'),
      suspicionCopy: root.querySelector('[data-suspicion-copy]'),
      suspicionBar: root.querySelector('[data-suspicion-bar]'),
      ammo: root.querySelector('[data-ammo]'),
      reserve: root.querySelector('[data-reserve]'),
      hint: root.querySelector('[data-hint]'),
      fps: root.querySelector('[data-fps]'),
      extract: root.querySelector('[data-extract]'),
      extractText: root.querySelector('[data-extract-text]'),
      banner: root.querySelector('[data-banner]'),
      ghost: root.querySelector('[data-ghost]'),
      crosshair: root.querySelector('[data-crosshair]'),
    };
    this._bannerTimer = 0;
  }

  _injectStyles() {
    if (document.getElementById('ns-hud-css')) return;
    const s = document.createElement('style');
    s.id = 'ns-hud-css';
    s.textContent = `
      .ns-hud { position:absolute; inset:0; font-family:'IBM Plex Mono',monospace; color:var(--paper,#d8dde6); }
      .ns-top { position:absolute; top:18px; left:20px; right:20px; display:flex; align-items:baseline; gap:18px; }
      .ns-brand { font-family:'Bebas Neue',sans-serif; letter-spacing:0.12em; font-size:1.4rem; opacity:0.85; }
      .ns-mode { font-size:0.7rem; letter-spacing:0.25em; color:var(--amber,#e8a84a); }
      .ns-mode.loud { color:var(--alert,#e0453a); animation: nsPulse 0.55s ease-in-out infinite alternate; }
      .ns-invoice { margin-left:auto; font-size:0.75rem; color:#9aa3ad; }
      .ns-attention { position:absolute; top:50px; left:50%; transform:translateX(-50%); width:min(500px,74vw); }
      .ns-att-card {
        position:relative;
        padding:10px 14px 9px;
        background:linear-gradient(180deg,rgba(10,12,16,0.76),rgba(16,22,30,0.44));
        border:1px solid rgba(232,168,74,0.18);
        box-shadow:0 0 0 1px rgba(94,200,192,0.07), 0 16px 40px rgba(0,0,0,0.24);
        clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px));
      }
      .ns-att-card::before {
        content:"";
        position:absolute;
        top:0;
        bottom:0;
        left:42px;
        width:1px;
        background:repeating-linear-gradient(180deg,rgba(232,168,74,0.0) 0 5px,rgba(232,168,74,0.28) 5px 8px);
        opacity:0.55;
      }
      .ns-att-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:7px; gap:12px; }
      .ns-att-label { font-size:0.62rem; letter-spacing:0.28em; color:var(--amber,#e8a84a); }
      .ns-att-code { font-size:0.55rem; letter-spacing:0.18em; color:var(--dim,#6a7380); }
      .ns-att-track {
        position:relative;
        height:18px;
        overflow:hidden;
        background:
          linear-gradient(90deg,rgba(224,69,58,0.09),rgba(94,200,192,0.08)),
          #101620;
        border:1px solid rgba(216,221,230,0.12);
        box-shadow:inset 0 0 18px rgba(0,0,0,0.5);
        clip-path:polygon(0 0,calc(100% - 18px) 0,100% 50%,calc(100% - 18px) 100%,0 100%,10px 50%);
      }
      .ns-att-grid {
        position:absolute;
        inset:0;
        background:repeating-linear-gradient(90deg,rgba(216,221,230,0.11) 0 1px,transparent 1px 34px);
        opacity:0.35;
      }
      .ns-att-slice {
        position:absolute;
        top:2px;
        bottom:2px;
        min-width:12px;
        transition:width 80ms linear;
      }
      .ns-att-slice span { position:absolute; inset:0; box-shadow:inset 0 0 12px rgba(255,255,255,0.1); }
      .ns-att-you {
        left:0;
        width:50%;
        background:linear-gradient(90deg,var(--alert,#e0453a),var(--amber,#e8a84a));
        clip-path:polygon(0 0,calc(100% - 16px) 0,100% 50%,calc(100% - 16px) 100%,0 100%,8px 50%);
      }
      .ns-att-partner {
        right:0;
        width:50%;
        background:linear-gradient(90deg,#3a8f88,var(--ghost,#5ec8c0));
        clip-path:polygon(0 50%,16px 0,100% 0,calc(100% - 8px) 50%,100% 100%,16px 100%);
      }
      .ns-att-marker {
        position:absolute;
        left:50%;
        top:-4px;
        bottom:-4px;
        width:2px;
        background:var(--paper,#d8dde6);
        transform:translateX(-50%) skewX(-12deg);
        opacity:0.78;
        box-shadow:0 0 12px rgba(216,221,230,0.35);
        pointer-events:none;
      }
      .ns-att-meta { display:grid; grid-template-columns:auto 1fr 1fr auto; gap:8px; margin-top:6px; font-size:0.6rem; color:var(--dim,#6a7380); letter-spacing:0.08em; }
      .ns-att-meta span:nth-child(1){color:var(--amber,#e8a84a)} .ns-att-meta span:nth-child(4){color:var(--ghost,#5ec8c0);text-align:right}
      .ns-att-status {
        display:grid;
        grid-template-columns:auto 1fr 64px;
        align-items:center;
        gap:8px;
        margin-top:7px;
        padding-top:7px;
        border-top:1px solid rgba(216,221,230,0.08);
        font-size:0.58rem;
        letter-spacing:0.08em;
        color:var(--dim,#6a7380);
        text-transform:uppercase;
      }
      .ns-suspicion-key { color:var(--amber,#e8a84a); }
      .ns-suspicion-copy { color:#9aa3ad; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ns-att-status.hot .ns-suspicion-key,
      .ns-att-status.hot .ns-suspicion-copy { color:var(--alert,#e0453a); }
      .ns-suspicion-meter { position:relative; height:3px; background:#1a2030; overflow:hidden; }
      .ns-suspicion-meter span { position:absolute; inset:0 auto 0 0; width:0%; background:linear-gradient(90deg,var(--amber,#e8a84a),var(--alert,#e0453a)); transition:width 120ms ease; }
      .ns-crosshair { position:absolute; left:50%; top:50%; width:22px; height:22px; transform:translate(-50%,-50%); }
      .ns-crosshair span { position:absolute; background:var(--paper,#d8dde6); opacity:0.75; }
      .ns-crosshair span:nth-child(1){left:50%;top:0;width:1px;height:6px;transform:translateX(-50%)}
      .ns-crosshair span:nth-child(2){left:50%;bottom:0;width:1px;height:6px;transform:translateX(-50%)}
      .ns-crosshair span:nth-child(3){top:50%;left:0;height:1px;width:6px;transform:translateY(-50%)}
      .ns-crosshair span:nth-child(4){top:50%;right:0;height:1px;width:6px;transform:translateY(-50%)}
      .ns-crosshair.ads { width:14px; height:14px; opacity:0.55; }
      .ns-bottom { position:absolute; left:20px; right:20px; bottom:18px; display:flex; align-items:flex-end; gap:16px; }
      .ns-ammo { font-size:1.1rem; letter-spacing:0.05em; }
      .ns-hint { font-size:0.65rem; color:#4a5560; }
      .ns-fps { margin-left:auto; font-size:0.65rem; color:#4a5560; }
      .ns-extract {
        position:absolute;
        left:50%;
        bottom:70px;
        transform:translate(-50%,10px);
        display:grid;
        gap:3px;
        min-width:min(360px,78vw);
        padding:10px 16px;
        background:linear-gradient(90deg,rgba(232,168,74,0.16),rgba(94,200,192,0.12));
        border:1px solid rgba(232,168,74,0.45);
        color:var(--paper,#d8dde6);
        text-align:center;
        opacity:0;
        transition:opacity 140ms ease, transform 140ms ease;
        clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);
      }
      .ns-extract.show { opacity:1; transform:translate(-50%,0); }
      .ns-extract span { font-size:0.55rem; letter-spacing:0.28em; color:var(--amber,#e8a84a); }
      .ns-extract strong { font-size:0.78rem; letter-spacing:0.12em; text-transform:uppercase; font-weight:600; }
      .ns-banner { position:absolute; left:50%; top:28%; transform:translate(-50%,-50%); font-family:'Bebas Neue',sans-serif; font-size:clamp(2rem,6vw,3.5rem); letter-spacing:0.14em; color:var(--alert,#e0453a); opacity:0; text-shadow:0 0 30px rgba(224,69,58,0.45); transition:opacity 200ms ease; pointer-events:none; }
      .ns-banner.show { opacity:1; }
      .ns-ghost { position:absolute; inset:0; box-shadow:inset 0 0 120px rgba(94,200,192,0.0); pointer-events:none; transition:box-shadow 200ms ease; }
      .ns-ghost.hot { box-shadow:inset 0 0 100px rgba(224,69,58,0.12); }
      .ns-ghost.cold { box-shadow:inset 0 0 120px rgba(94,200,192,0.16); }
      @keyframes nsPulse { from { opacity:0.65 } to { opacity:1 } }
    `;
    document.head.appendChild(s);
  }

  setAttention(p1, p2) {
    const t = CONFIG.attention.total;
    const youPct = Math.max(0, Math.min(100, (p1 / t) * 100));
    const partnerPct = Math.max(0, Math.min(100, (p2 / t) * 100));
    this.el.attYou.style.width = `${youPct}%`;
    this.el.attPartner.style.width = `${partnerPct}%`;
    this.el.attMarker.style.left = `${youPct}%`;
    this.el.attYouPct.textContent = `${Math.round(p1)}%`;
    this.el.attPartnerPct.textContent = `${Math.round(p2)}%`;
    this.el.ghost.classList.toggle('hot', p1 >= 55);
    this.el.ghost.classList.toggle('cold', p1 <= 35);
  }

  setSuspicion(level = 0) {
    const value = Math.max(0, Math.min(1, Number(level) || 0));
    const copy =
      value >= 0.82
        ? 'identity nearly burned'
        : value >= 0.55
          ? 'guard has a shape'
          : value >= 0.25
            ? 'sightline warming'
            : 'no eyes / route cold';

    this.el.suspicionCopy.textContent = copy;
    this.el.suspicionBar.style.width = `${Math.round(value * 100)}%`;
    this.el.suspicion.classList.toggle('hot', value >= 0.55);
  }

  setExtractHint(visible, text = 'Extract at the far door') {
    this.el.extractText.textContent = text;
    this.el.extract.classList.toggle('show', Boolean(visible));
  }

  setMode(mode) {
    this.el.mode.textContent = mode.toUpperCase();
    this.el.mode.classList.toggle('loud', mode === 'loud');
  }

  setAmmo(mag, reserve) {
    this.el.ammo.textContent = String(mag);
    this.el.reserve.textContent = String(reserve);
  }

  setInvoice(net) {
    const sign = net < 0 ? '-' : '';
    this.el.invoice.textContent = `${sign}$${Math.abs(net).toLocaleString()}`;
    this.el.invoice.style.color = net < 1000 ? 'var(--alert,#e0453a)' : '#9aa3ad';
  }

  setFps(fps) {
    this.el.fps.textContent = `${fps}|60`;
  }

  setAds(active) {
    this.el.crosshair.classList.toggle('ads', active);
  }

  banner(text, duration = 2.2) {
    this.el.banner.textContent = text;
    this.el.banner.classList.add('show');
    this._bannerTimer = duration;
  }

  update(dt) {
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.el.banner.classList.remove('show');
    }
  }
}
