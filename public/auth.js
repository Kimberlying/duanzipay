import { $app, me, api, loadMe, bindForm, toast } from './core.js';

function authView(register) {
  $app.innerHTML = `
    <section class="auth-layout">
      <div class="auth-story">
        <span class="eyebrow"><span class="tiny-dot"></span> 一间贩卖快乐的小铺</span>
        <h1>生活的包袱，<br>在这里<span>抖一抖。</span></h1>
        <p class="story-description">把平凡日子里的灵光一闪，<br>变成值得被珍藏的好段子。</p>
        <div class="story-art"><img src="/shop.svg" width="420" height="300" alt=""><span class="art-caption">好笑的灵魂，终于有了小店。</span></div>
        <div class="story-foot"><span>写下灵感</span><i aria-hidden="true">↗</i><span>遇见知音</span><i aria-hidden="true">↗</i><span>快乐成交</span></div>
      </div>
      <div class="auth-form-wrap">
        <form class="auth-form" id="f">
          <span class="eyebrow">${register ? '开门，欢迎新朋友' : '小铺开着，等你回来'}</span>
          <h2>${register ? '来，开个小账户。' : '好久不见。'}</h2>
          <p class="muted">${register ? '让你的好段子，也有被发现的机会。' : '登录段子铺，发现下一个让你笑的瞬间。'}</p>
          <div class="auth-tabs" aria-label="账户入口"><a href="#/login" ${register ? '' : 'aria-current="page"'}>登录</a><a href="#/register" ${register ? 'aria-current="page"' : ''}>注册</a></div>
          <label for="account">手机号或邮箱</label>
          <input id="account" name="account" autocomplete="username" placeholder="输入手机号或邮箱" required>
          ${register ? '<label for="name">昵称</label><input id="name" name="name" maxlength="20" autocomplete="nickname" placeholder="段子上会展示的名字" required>' : ''}
          <label for="password">密码 ${register ? '<span class="field-hint">至少 6 位</span>' : ''}</label>
          <input id="password" name="password" type="password" ${register ? 'minlength="6"' : ''} autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="${register ? '设置一个至少 6 位的密码' : '输入你的密码'}" required>
          <button class="auth-submit" type="submit">${register ? '注册，进铺逛逛' : '登录，进铺逛逛'} <span aria-hidden="true">→</span></button>
          <p class="auth-switch">${register ? '已经有账户？<a href="#/login">直接登录</a>' : '第一次来？<a href="#/register">注册一个账户</a>'}</p>
        </form>
        <div class="auth-note"><span aria-hidden="true">✳</span><p>每条段子只卖一次。<br><span class="muted">买下之后，完整的快乐只属于你。</span></p></div>
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
