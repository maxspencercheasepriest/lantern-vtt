// GoDice in the Android app. Android's web view has no Web Bluetooth, so this talks to the dice through
// Android's own Bluetooth (the Capacitor BLE plugin) and otherwise behaves exactly like the built-in
// driver from the GoDice extension (js/lib/godice-ble.js), reusing its message decoding.
import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';

const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const WRITE_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NOTIFY_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

let ready = null;
const init = () => (ready ||= BleClient.initialize({ androidNeverForLocation: true }).catch((e) => { ready = null; throw e; }));

function install() {
  const GoDie = window.GoDie;
  if (!GoDie) return;
  class NativeGoDie extends GoDie {
    /** Shows Android's device picker filtered to GoDice. Must follow a tap, like the web version. */
    static async request() {
      await init();
      const dev = await BleClient.requestDevice({ namePrefix: 'GoDice_', optionalServices: [SERVICE] });
      const stub = new EventTarget();
      stub.id = dev.deviceId;
      stub.name = dev.name || 'GoDice';
      stub.gatt = { connected: false };
      const die = new NativeGoDie(stub);
      await die.connect();
      return die;
    }

    async connect() {
      this._emit('status', { state: 'connecting' });
      await init();
      await BleClient.connect(this.id, () => {
        this.device.gatt.connected = false;
        this.device.dispatchEvent(new Event('gattserverdisconnected'));
      });
      this.device.gatt.connected = true;
      await BleClient.startNotifications(this.id, SERVICE, NOTIFY_CHAR, (value) => this._onNotify({ target: { value } }));
      this._writer = true;
      this._manualDisconnect = false;
      this.connected = true;
      this._emit('status', { state: 'connected' });
      this.requestBattery().catch(() => {});
      this.requestColour().catch(() => {});
      this._startKeepAlive();
    }

    disconnect() {
      this._manualDisconnect = true;
      BleClient.disconnect(this.id).catch(() => {});
      this.device.gatt.connected = false;
      this._onDisconnected();
    }

    _write(bytes) {
      // one Bluetooth operation at a time
      this._queue = this._queue.then(() => BleClient.write(this.id, SERVICE, WRITE_CHAR, numbersToDataView(bytes))).catch(() => {});
      return this._queue;
    }
  }
  window.NativeGoDie = NativeGoDie;
  if (window.lanternApp) window.lanternApp.nativeBluetooth = true;
}

install();
