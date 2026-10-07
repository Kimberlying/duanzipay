import { $app, me, api, loadMe, bindForm, toast } from './core.js';

function authView(register) {
  $app.innerHTML = `
    <section class="auth-layout">
      <div class="auth-story">
        <span class="eyebrow"><span class="tiny-dot"></span> 一间贩卖快乐的小铺</span>
        <h1><span class="hl-mask"><span class="hl-line">生活的包袱，</span></span><span class="hl-mask"><span class="hl-line">在这里抖一抖。</span></span></h1>
        <p class="story-description">把平凡日子里的灵光一闪，<br>变成值得被珍藏的好段子。</p>
      </div>
      <div class="auth-form-wrap">
        <form class="auth-form" id="f">
          <span class="eyebrow">${register ? '开门，欢迎新朋友' : '小铺开着，等你回来'}</span>
          <h2>${register ? '创建你的账户' : '好久不见。'}</h2>
          <p class="muted">${register ? '让你的好段子，也有被发现的机会。' : '登录段子铺，发现下一个让你笑的瞬间。'}</p>
          <div class="auth-tabs" aria-label="账户入口"><a href="#/login" ${register ? '' : 'aria-current="page"'}>登录</a><a href="#/register" ${register ? 'aria-current="page"' : ''}>注册</a></div>
          <label for="account">手机号或邮箱</label>
          <input id="account" name="account" autocomplete="username" placeholder="输入手机号或邮箱" required>
          ${register ? '<label for="name">昵称</label><input id="name" name="name" maxlength="20" autocomplete="nickname" placeholder="段子上会展示的名字" required>' : ''}
          <label for="password">密码 ${register ? '<span class="field-hint">至少 6 位</span>' : ''}</label>
          <input id="password" name="password" type="password" ${register ? 'minlength="6"' : ''} autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="${register ? '设置一个至少 6 位的密码' : '输入你的密码'}" required>
          <button class="auth-submit" type="submit">${register ? '注册，进铺逛逛' : '登录，进铺逛逛'} <span class="action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></button>
          <p class="auth-switch">${register ? '已经有账户？<a href="#/login">直接登录</a>' : '第一次来？<a href="#/register">注册一个账户</a>'}</p>
        </form>
        <div class="auth-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg><p>每条只卖一次 · 买下后独享全文</p></div>
      </div>
    </section>`;
  bindForm(document.getElementById('f'), async (data) => {
    await api(register ? '/register' : '/login', { method: 'POST', data });
    await loadMe();
    if (register) toast('注册成功');
    location.hash = me.role === 'admin' ? '#/admin' : '#/';
  });
}

function viewLogin() { authView(false); }
function viewRegister() { authView(true); }

export { viewLogin, viewRegister };
