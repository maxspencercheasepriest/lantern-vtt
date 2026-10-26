/* Minimal GoDice d6 client over Web Bluetooth.
 * Speaks the protocol documented in Particula's GoDice JavaScript API
 * (Nordic UART service: notify on ...0003, write on ...0002). */
(function (root) {
  'use strict';

  const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const WRITE_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const NOTIFY_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

  const MSG = { BATTERY: 3, COLOUR: 23, SET_LED: 8, LED_PULSE: 16 };
  const COLOURS = ['black', 'red', 'green', 'blue', 'yellow', 'orange'];

  // Which face is up for a given accelerometer vector (standard d6 shell).
  const D6 = { 1: [-64, 0, 0], 2: [0, 0, 64], 3: [0, 64, 0], 4: [0, -64, 0], 5: [0, 0, -64], 6: [64, 0, 0] };

  function faceFromXYZ(x, y, z) {
    let best = 0, bestD = Infinity;
    for (const face in D6) {
      const [vx, vy, vz] = D6[face];
      const d = (x - vx) ** 2 + (y - vy) ** 2 + (z - vz) ** 2;
      if (d < bestD) { bestD = d; best = Number(face); }
    }
    return best;
  }

  class GoDie extends EventTarget {
    constructor(device) {
      super();
      this.device = device;
      this.id = device.id;
      this.name = device.name || 'GoDice';
      this.value = null;
      this.battery = null;
      this.colour = null;
      this.connected = false;
      this._writer = null;
      this._queue = Promise.resolve();
      this._manualDisconnect = false;
      this._onNotify = this._onNotify.bind(this);
      device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
    }

    /** Must be called from a click handler (browser requires a user gesture). */
    static async request() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth isn’t available in this browser. Use Chrome or Edge on desktop.');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'GoDice_' }],
        optionalServices: [SERVICE],
      });
      const die = new GoDie(device);
      await die.connect();
      return die;
    }

    /** Dice this site has been given permission for before (Chrome only, may be unavailable). */
    static async known() {
      if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return [];
      try {
        const devices = await navigator.bluetooth.getDevices();
        return devices.filter(d => (d.name || '').startsWith('GoDice_'));
      } catch { return []; }
    }

    async connect() {
      this._emit('status', { state: 'connecting' });
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);
      const notify = await service.getCharacteristic(NOTIFY_CHAR);
      this._writer = await service.getCharacteristic(WRITE_CHAR);
      notify.removeEventListener('characteristicvaluechanged', this._onNotify);
      notify.addEventListener('characteristicvaluechanged', this._onNotify);
      await notify.startNotifications();
      this.connected = true;
      this._emit('status', { state: 'connected' });
      this.requestBattery().catch(() => {});
      this.requestColour().catch(() => {});
    }

    disconnect() {
      this._manualDisconnect = true;
      if (this.device.gatt.connected) this.device.gatt.disconnect();
      else this._onDisconnected();
    }

    async _onDisconnected() {
      this.connected = false;
      this._emit('status', { state: 'disconnected' });
      if (this._manualDisconnect) { this._emit('removed', {}); return; }
      // Dice go to sleep or drift out of range; keep trying quietly.
      for (let attempt = 0; attempt < 30 && !this.connected && !this._manualDisconnect; attempt++) {
        await new Promise(r => setTimeout(r, Math.min(1000 * (attempt + 1), 5000)));
        try { await this.connect(); } catch { /* retry */ }
      }
    }

    _onNotify(ev) {
      const dv = ev.target.value;
      const b0 = dv.getUint8(0);
      const b1 = dv.byteLength > 1 ? dv.getUint8(1) : 0;
      const b2 = dv.byteLength > 2 ? dv.getUint8(2) : 0;

      if (b0 === 82) { // 'R' — roll started
        this.value = null;
        this._emit('rollstart', {});
        return;
      }
      if (b0 === 66 && b1 === 97 && b2 === 116) { // 'Bat'
        this.battery = dv.getUint8(3);
        this._emit('battery', { battery: this.battery });
        return;
      }
      if (b0 === 67 && b1 === 111 && b2 === 108) { // 'Col'
        this.colour = COLOURS[dv.getUint8(3)] || 'unknown';
        this._emit('colour', { colour: this.colour });
        return;
      }
      if (b0 === 83 && dv.byteLength >= 4) { // 'S' — settled after a real roll
        this._stable(dv, 1, 'stable');
        return;
      }
      if (b0 === 70 && b1 === 83) { // 'FS' — quick roll the die judged as stable
        this._stable(dv, 2, 'stable');
        return;
      }
      if ((b0 === 84 || b0 === 77) && b1 === 83) { // 'TS' tilt / 'MS' move — die nudged, not rolled
        const v = faceFromXYZ(dv.getInt8(2), dv.getInt8(3), dv.getInt8(4));
        this._emit('nudge', { value: v });
      }
    }

    _stable(dv, start, kind) {
      const v = faceFromXYZ(dv.getInt8(start), dv.getInt8(start + 1), dv.getInt8(start + 2));
      this.value = v;
      this._emit(kind, { value: v });
    }

    _emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail: { die: this, ...detail } }));
    }

    _write(bytes) {
      // GATT allows one operation at a time; serialise writes.
      this._queue = this._queue.then(() => this._writer ? this._writer.writeValue(new Uint8Array(bytes)) : null).catch(() => {});
      return this._queue;
    }

    requestBattery() { return this._write([MSG.BATTERY]); }
    requestColour() { return this._write([MSG.COLOUR]); }

    setLed(rgb1, rgb2 = rgb1) {
      const c = a => (a || [0, 0, 0]).map(v => Math.max(0, Math.min(255, v | 0)));
      return this._write([MSG.SET_LED, ...c(rgb1), ...c(rgb2)]);
    }

    /** pulses: count; on/off in 10ms units */
    pulse(rgb, count = 3, on = 20, off = 15) {
      const c = rgb.map(v => Math.max(0, Math.min(255, v | 0)));
      return this._write([MSG.LED_PULSE, count, on, off, ...c, 1, 0]);
    }
  }

  GoDie.faceFromXYZ = faceFromXYZ;
  root.GoDie = GoDie;
})(globalThis);
