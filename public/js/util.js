import { serverUrl } from './net.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// Tiny shared store: state + change listeners
export const store = {
  me: null, isGM: false, color: '#fff', room: null, uploadToken: null,
  scene: null, sheets: [], users: [], chat: [],
  listeners: {},
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); },
  emit(evt, data) { (this.listeners[evt] || []).forEach((fn) => fn(data)); },
};

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export async function uploadImage(file) {
  if (!file) return null;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(serverUrl('/api/upload'), { method: 'POST', body: fd, headers: { 'x-upload-token': store.uploadToken } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}

export const imageSize = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
  img.onerror = reject;
  img.src = serverUrl(url);
});

// --- socket helper with promise acks ---
export function call(socket, evt, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(evt, payload, (err, res) => {
      if (err) return reject(new Error('Server did not answer'));
      if (res?.error) return reject(new Error(res.error));
      resolve(res);
    });
  });
}

// --- floating windows ---
let zTop = 30;
const openWindows = new Map();
export function openWindow(key, { title, width = 460, height = 560, onClose } = {}) {
  if (openWindows.has(key)) {
    const w = openWindows.get(key);
    focusWin(w.el);
    return { ...w, existed: true };
  }
  const el = document.createElement('div');
  el.className = 'window';
  const n = openWindows.size;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, 80 + n * 28));
  const top = Math.max(8, Math.min(window.innerHeight - 200, 60 + n * 28));
  Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${Math.min(height, window.innerHeight - 80)}px` });
  el.innerHTML = `<div class="win-head"><span class="title"></span><button class="close" title="Close">✕</button></div><div class="win-body"></div>`;
  $('.title', el).textContent = title;
  $('#windows').append(el);
  const body = $('.win-body', el);
  const close = () => { el.remove(); openWindows.delete(key); onClose?.(); };
  $('.close', el).onclick = close;
  el.addEventListener('pointerdown', () => focusWin(el));
  // drag by header
  const head = $('.win-head', el);
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    const move = (ev) => {
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - sx))}px`;
      el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - sy))}px`;
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  focusWin(el);
  const w = { el, body, close, setTitle: (t) => { $('.title', el).textContent = t; } };
  openWindows.set(key, w);
  return w;
}
export const getWindow = (key) => openWindows.get(key);
export const allWindows = () => openWindows;
function focusWin(el) {
  $$('.window.focused').forEach((w) => w.classList.remove('focused'));
  el.classList.add('focused');
  el.style.zIndex = ++zTop;
}
