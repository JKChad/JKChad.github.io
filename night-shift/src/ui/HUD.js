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
          <div class="ns-att-label">ATTENTION</div>
          <div class="ns-att-track">
            <div class="ns-att-you" data-att-you></div>
            <div class="ns-att-divider"></div>
            <div class="ns-att-partner" data-att-partner></div>
          </div>
          <div class="ns-att-meta">
            <span data-att-you-pct>50%</span>
            <span>YOU</span>
            <span>PARTNER</span>
            <span data-att-partner-pct>50%</span>
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
      attYouPct: root.querySelector('[data-att-you-pct]'),
      attPartnerPct: root.querySelector('[data-att-partner-pct]'),
      ammo: root.querySelector('[data-ammo]'),
      reserve: root.querySelector('[data-reserve]'),
      hint: root.querySelector('[data-hint]'),
      fps: root.querySelector('[data-fps]'),
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
      .ns-hud { position:absolute; inset:0; font-family:'IBM Plex Mono',monospace; color:#d8dde6; }
      .ns-top { position:absolute; top:18px; left:20px; right:20px; display:flex; align-items:baseline; gap:18px; }
      .ns-brand { font-family:'Bebas Neue',sans-serif; letter-spacing:0.12em; font-size:1.4rem; opacity:0.85; }
      .ns-mode { font-size:0.7rem; letter-spacing:0.25em; color:#e8a84a; }
      .ns-mode.loud { color:#e0453a; animation: nsPulse 0.55s ease-in-out infinite alternate; }
      .ns-invoice { margin-left:auto; font-size:0.75rem; color:#9aa3ad; }
      .ns-attention { position:absolute; top:52px; left:50%; transform:translateX(-50%); width:min(420px,70vw); }
      .ns-att-label { text-align:center; font-size:0.62rem; letter-spacing:0.3em; color:#6a7380; margin-bottom:6px; }
      .ns-att-track { display:flex; height:8px; background:#1a2030; overflow:hidden; position:relative; }
      .ns-att-you { background:linear-gradient(90deg,#e0453a,#e8a84a); width:50%; transition:width 80ms linear; }
      .ns-att-partner { background:linear-gradient(90deg,#5ec8c0,#3a8f88); width:50%; margin-left:auto; transition:width 80ms linear; }
      .ns-att-divider { position:absolute; left:50%; top:-2px; bottom:-2px; width:2px; background:#d8dde6; transform:translateX(-50%); opacity:0.5; pointer-events:none; }
      .ns-att-meta { display:grid; grid-template-columns:auto 1fr 1fr auto; gap:8px; margin-top:6px; font-size:0.62rem; color:#6a7380; }
      .ns-att-meta span:nth-child(1){color:#e8a84a} .ns-att-meta span:nth-child(4){color:#5ec8c0;text-align:right}
      .ns-crosshair { position:absolute; left:50%; top:50%; width:22px; height:22px; transform:translate(-50%,-50%); }
      .ns-crosshair span { position:absolute; background:#d8dde6; opacity:0.75; }
      .ns-crosshair span:nth-child(1){left:50%;top:0;width:1px;height:6px;transform:translateX(-50%)}
      .ns-crosshair span:nth-child(2){left:50%;bottom:0;width:1px;height:6px;transform:translateX(-50%)}
      .ns-crosshair span:nth-child(3){top:50%;left:0;height:1px;width:6px;transform:translateY(-50%)}
      .ns-crosshair span:nth-child(4){top:50%;right:0;height:1px;width:6px;transform:translateY(-50%)}
      .ns-crosshair.ads { width:14px; height:14px; opacity:0.55; }
      .ns-bottom { position:absolute; left:20px; right:20px; bottom:18px; display:flex; align-items:flex-end; gap:16px; }
      .ns-ammo { font-size:1.1rem; letter-spacing:0.05em; }
      .ns-hint { font-size:0.65rem; color:#4a5560; }
      .ns-fps { margin-left:auto; font-size:0.65rem; color:#4a5560; }
      .ns-banner { position:absolute; left:50%; top:28%; transform:translate(-50%,-50%); font-family:'Bebas Neue',sans-serif; font-size:clamp(2rem,6vw,3.5rem); letter-spacing:0.14em; color:#e0453a; opacity:0; text-shadow:0 0 30px rgba(224,69,58,0.45); transition:opacity 200ms ease; pointer-events:none; }
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
    this.el.attYou.style.width = `${(p1 / t) * 100}%`;
    this.el.attPartner.style.width = `${(p2 / t) * 100}%`;
    this.el.attYouPct.textContent = `${Math.round(p1)}%`;
    this.el.attPartnerPct.textContent = `${Math.round(p2)}%`;
    this.el.ghost.classList.toggle('hot', p1 >= 55);
    this.el.ghost.classList.toggle('cold', p1 <= 35);
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
    this.el.invoice.style.color = net < 1000 ? '#e0453a' : '#9aa3ad';
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
