export class NetLobby {
  constructor({ root = document.body, bus = null, bridge = null } = {}) {
    this.root = root;
    this.bus = bus;
    this.bridge = bridge;
    this.roomId = '';
    this.status = 'offline';
    this.rttMs = 0;
    this._unsubs = [];

    this.el = document.createElement('section');
    this.el.className = 'ns-net-lobby';
    this.el.innerHTML = `
      <div class="ns-net-row">
        <strong>NET</strong>
        <span data-net-status>offline</span>
        <span data-net-rtt>-- ms</span>
      </div>
      <div class="ns-net-row">
        <button type="button" data-net-host>Host</button>
        <button type="button" data-net-copy title="Copy room code">Code: <span data-net-code>----</span></button>
      </div>
      <form class="ns-net-row" data-net-join-form>
        <input data-net-join placeholder="join code" autocomplete="off" spellcheck="false" />
        <button type="submit">Join</button>
      </form>
      <div class="ns-net-row">
        <button type="button" data-net-disconnect>Disconnect</button>
      </div>
    `;
    this.root.appendChild(this.el);
    this._injectStyles();
    this.parts = {
      status: this.el.querySelector('[data-net-status]'),
      rtt: this.el.querySelector('[data-net-rtt]'),
      code: this.el.querySelector('[data-net-code]'),
      host: this.el.querySelector('[data-net-host]'),
      copy: this.el.querySelector('[data-net-copy]'),
      joinForm: this.el.querySelector('[data-net-join-form]'),
      join: this.el.querySelector('[data-net-join]'),
      disconnect: this.el.querySelector('[data-net-disconnect]'),
    };

    this.parts.host.addEventListener('click', () => this._host());
    this.parts.copy.addEventListener('click', () => this._copyCode());
    this.parts.joinForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this._join(this.parts.join.value);
    });
    this.parts.disconnect.addEventListener('click', () => this.bridge?.disconnect?.());

    if (this.bus) {
      this._unsubs.push(
        this.bus.on('net:room', ({ roomId }) => {
          this.roomId = roomId || this.roomId;
          this._render();
        }),
        this.bus.on('net:status', (payload) => {
          this.status = payload?.state || this.status;
          if (payload?.roomId) this.roomId = payload.roomId;
          this._render();
        }),
        this.bus.on('net:connected', () => {
          this.status = 'connected';
          this._render();
        }),
        this.bus.on('net:disconnected', ({ reason } = {}) => {
          this.status = reason ? `solo (${reason})` : 'solo';
          this._render();
        }),
        this.bus.on('net:rtt', ({ rttMs }) => {
          this.rttMs = rttMs || 0;
          this._render();
        }),
        this.bus.on('net:error', ({ message }) => {
          this.status = message ? `error: ${message}` : 'error';
          this._render();
        }),
      );
    }

    this._render();
  }

  dispose() {
    for (const off of this._unsubs) off?.();
    this._unsubs = [];
    this.el.remove();
  }

  async _host() {
    this.status = 'hosting...';
    this._render();
    try {
      this.roomId = await this.bridge?.host?.();
    } catch (error) {
      this.status = `error: ${error?.message || error}`;
    }
    this._render();
  }

  async _join(roomId) {
    const code = String(roomId || '').trim();
    if (!code) return;
    this.status = 'joining...';
    this._render();
    try {
      this.roomId = await this.bridge?.join?.(code);
    } catch (error) {
      this.status = `error: ${error?.message || error}`;
    }
    this._render();
  }

  async _copyCode() {
    if (!this.roomId) return;
    try {
      await navigator.clipboard?.writeText?.(this.roomId);
      this.status = 'code copied';
    } catch {
      this.status = 'copy unavailable';
    }
    this._render();
  }

  _render() {
    this.parts.status.textContent = this.status;
    this.parts.rtt.textContent = this.rttMs > 0 ? `${Math.round(this.rttMs)} ms` : '-- ms';
    this.parts.code.textContent = this.roomId || '----';
    this.parts.copy.disabled = !this.roomId;
  }

  _injectStyles() {
    if (document.getElementById('ns-net-lobby-css')) return;
    const style = document.createElement('style');
    style.id = 'ns-net-lobby-css';
    style.textContent = `
      .ns-net-lobby {
        position:absolute;
        right:18px;
        top:76px;
        z-index:30;
        width:230px;
        display:grid;
        gap:7px;
        padding:10px;
        color:var(--paper,#d8dde6);
        background:linear-gradient(180deg,rgba(8,10,14,0.88),rgba(13,18,25,0.72));
        border:1px solid rgba(94,200,192,0.22);
        box-shadow:0 12px 38px rgba(0,0,0,0.34);
        font-family:'IBM Plex Mono',monospace;
        font-size:0.62rem;
        letter-spacing:0.08em;
        pointer-events:auto;
        cursor:default;
      }
      .ns-net-row { display:flex; align-items:center; gap:6px; min-width:0; }
      .ns-net-row:first-child { justify-content:space-between; color:var(--ghost,#5ec8c0); text-transform:uppercase; }
      .ns-net-lobby button,
      .ns-net-lobby input {
        min-width:0;
        border:1px solid rgba(216,221,230,0.18);
        background:#0f1620;
        color:var(--paper,#d8dde6);
        font:inherit;
        letter-spacing:inherit;
        padding:6px 7px;
      }
      .ns-net-lobby button { cursor:pointer; text-transform:uppercase; }
      .ns-net-lobby button:hover:not(:disabled),
      .ns-net-lobby input:focus { border-color:var(--amber,#e8a84a); outline:none; }
      .ns-net-lobby button:disabled { opacity:0.42; cursor:not-allowed; }
      .ns-net-lobby input { flex:1; width:100%; text-transform:lowercase; }
      [data-net-copy] { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      [data-net-disconnect] { width:100%; color:var(--alert,#e0453a); }
    `;
    document.head.appendChild(style);
  }
}
