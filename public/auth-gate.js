/**
 * 2026-03-19: 全站访问令牌验证
 * 一次验证后 localStorage 永久有效
 * 所有页面在 <head> 中引入此脚本即可
 */
(function() {
  'use strict';
  var KEY = 'indeed_auth_token';
  var CORRECT = 'fengshtindeed';

  try { if (localStorage.getItem(KEY) === CORRECT) return; } catch(e) {}

  // 隐藏页面内容
  var hideStyle = document.createElement('style');
  hideStyle.id = 'auth-hide';
  hideStyle.textContent = 'body{display:none!important}';
  document.documentElement.appendChild(hideStyle);

  // 验证遮罩样式
  var gateStyle = document.createElement('style');
  gateStyle.textContent = [
    '#auth-gate{position:fixed;inset:0;z-index:999999;background:linear-gradient(135deg,#0f0f23,#1a1a3e,#16213e);',
    'display:flex;align-items:center;justify-content:center;font-family:Inter,Noto Sans SC,system-ui,sans-serif}',
    '.ag-box{text-align:center;padding:3rem 2.5rem;background:rgba(255,255,255,.04);',
    'border:1px solid rgba(255,255,255,.08);border-radius:24px;width:90%;max-width:380px;',
    'backdrop-filter:blur(20px);box-shadow:0 20px 60px rgba(0,0,0,.4)}',
    '.ag-box h2{font-size:1.6rem;font-weight:800;margin-bottom:.5rem;color:#fff}',
    '.ag-box .ag-sub{font-size:.85rem;color:rgba(255,255,255,.45);margin-bottom:1.8rem}',
    '.ag-input{width:100%;padding:.9rem 1rem;border-radius:12px;border:1.5px solid rgba(255,255,255,.1);',
    'background:rgba(255,255,255,.06);color:#fff;font-size:1rem;outline:none;',
    'text-align:center;letter-spacing:.15em;transition:border-color .2s}',
    '.ag-input:focus{border-color:rgba(0,212,255,.5)}',
    '.ag-input::placeholder{color:rgba(255,255,255,.25);letter-spacing:.05em}',
    '.ag-btn{width:100%;margin-top:1rem;padding:.85rem;border:none;border-radius:12px;',
    'background:linear-gradient(135deg,#00d4ff,#7b2ff7);color:#fff;font-size:1rem;',
    'font-weight:700;cursor:pointer;transition:opacity .2s,transform .15s}',
    '.ag-btn:hover{opacity:.9;transform:translateY(-1px)}',
    '.ag-btn:active{transform:scale(.97)}',
    '.ag-err{margin-top:1rem;font-size:.8rem;color:#ff4757;min-height:1.2em;',
    'transition:opacity .2s}',
    '.ag-icon{font-size:3rem;margin-bottom:.8rem}',
  ].join('');
  document.documentElement.appendChild(gateStyle);

  // 验证遮罩 DOM
  var gate = document.createElement('div');
  gate.id = 'auth-gate';
  gate.innerHTML = [
    '<div class="ag-box">',
    '  <div class="ag-icon">🔐</div>',
    '  <h2>访问验证</h2>',
    '  <p class="ag-sub">请输入访问令牌以继续</p>',
    '  <input class="ag-input" id="ag-input" type="password" placeholder="输入令牌…" autocomplete="off" autofocus>',
    '  <button class="ag-btn" id="ag-btn">验 证</button>',
    '  <div class="ag-err" id="ag-err">&nbsp;</div>',
    '</div>',
  ].join('');
  document.documentElement.appendChild(gate);

  function verify() {
    var input = document.getElementById('ag-input');
    var err = document.getElementById('ag-err');
    if (input.value === CORRECT) {
      try { localStorage.setItem(KEY, CORRECT); } catch(e) {}
      gate.remove();
      gateStyle.remove();
      hideStyle.remove();
    } else {
      err.textContent = '令牌错误，请重试';
      input.value = '';
      input.focus();
      input.style.borderColor = '#ff4757';
      setTimeout(function() { input.style.borderColor = ''; }, 1500);
    }
  }

  gate.querySelector('#ag-btn').addEventListener('click', verify);
  gate.querySelector('#ag-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') verify();
  });
})();
