const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
let me = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yuan = (c) => '¥' + (c / 100).toFixed(c % 100 ? 2 : 0);
const time = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '');

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

async function api(path, { method = 'GET', data } = {}) {
  const opts = { method, headers: {} };
  if (data !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  const res = await fetch('/api' + path, opts);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && me) {
      // 登录过期：回到登录页
      me = null;
      location.hash = '#/login';
    }
    throw new Error(out.error || '出错了');
  }
  return out;
}

// 把图片压缩到 D1 单行能放下的大小：最长边 800px，JPEG，必要时逐步降质量/尺寸
async function compressImage(file, maxChars = 300_000) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('图片读不出来，换一张试试'));
      i.src = url;
    });
    let side = 800;
    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // 透明 PNG 转 JPEG 时垫白底，二维码才扫得出
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      for (const q of [0.85, 0.7, 0.55]) {
        const data = canvas.toDataURL('image/jpeg', q);
        if (data.length <= maxChars) return data;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('图片太大，压缩不下来，换一张试试');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadMe() {
  try {
    me = (await api('/me')).user;
  } catch {
    me = null;
  }
}

function bindForm(form, handler) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };
}

function setMe(user) { me = user; }

function heading(title, description, eyebrow = '段子铺') {
  return `<header class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p class="muted">${description}</p></div></header>`;
}

function emptyState(title, description, href, label) {
  return `<div class="empty-state"><span class="empty-mark" aria-hidden="true">☺</span><h3>${title}</h3><p class="muted">${description}</p>${href ? `<a class="btn" href="${href}">${label} <span aria-hidden="true">↗</span></a>` : ''}</div>`;
}

export { $app, $nav, me, setMe, esc, yuan, time, toast, api, compressImage, loadMe, bindForm, heading, emptyState };
