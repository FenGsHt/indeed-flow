/**
 * 2026-03-20: 主题切换引擎
 * 管理 data-theme 属性 + Three.js 背景生命周期
 */

import { initWebGL, destroyWebGL } from './webgl-bg.js';

const LS_KEY = 'indeed-theme';
const THEMES = ['nexus', 'classic', 'joypad', 'fallout'];
let threeLoaded = false;

function loadThreeJS() {
  return new Promise((resolve, reject) => {
    if (window.THREE) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
    // 10 秒超时，防止 CDN 卡住
    setTimeout(() => reject(new Error('Three.js load timeout')), 10000);
  });
}

async function activateWebGL() {
  const canvas = document.getElementById('gl-canvas');
  if (!canvas) return;
  try {
    if (!threeLoaded) {
      await loadThreeJS();
      threeLoaded = true;
    }
    initWebGL(canvas);
  } catch (e) {
    console.warn('Three.js load failed:', e);
  }
}

// ===== Fallout FX =====
let _foBgCanvas  = null;
let _foBgRaf     = null;
let _foPipboy    = null;
let _foGlitchTid = null;

const FO_CMDS = [
  '> ROBCO INDUSTRIES (TM) TERMLINK PROTOCOL',
  '> ENTER PASSWORD NOW',
  '> ACCESSING MAINFRAME...',
  'WARNING: UNAUTHORIZED ACCESS DETECTED',
  '> SCAN COMPLETE — 0 THREATS FOUND',
  'MEMORY REMAINING: 44928 KB',
  '> DIR /USER/DATA',
  'VAULT-TEC CORP. UNIFIED OS v85.2',
  '> STATUS',
  'ALL SYSTEMS NOMINAL',
  'RADIATION LEVELS: NOMINAL',
  '> PING 192.168.1.1',
  'REPLY: TIME<1MS TTL=64',
  '> EXEC DAILY_BACKUP.EXE',
  'BACKUP COMPLETE — 1,204 FILES',
  '> UNLOCK VAULT DOOR',
  'ERROR: INSUFFICIENT CLEARANCE',
  '> LOAD GAME_LIST.DAT',
  'PARSING... OK',
  'CHECKSUM VERIFIED',
  '> SET TERMCOLOR GREEN',
  'OK',
  'LAST LOGIN: 10/23/2077 03:18:44',
  '> HELP',
  'AVAILABLE CMDS: WHO DIR SCAN STATUS PING',
  '> SCAN --DEEP',
  'SCANNING SECTOR 7G...',
  'SECTOR 7G: CLEAR',
  '> WHO',
  'TERMINAL ID: PRD-99',
  'ENCRYPTION: ACTIVE',
  '> SYS INFO',
  'CPU: 64K RAM — ROBCO Z-8000',
  'UPTIME: 49.2 YEARS',
  'CORE TEMP: 38°C — NORMAL',
];

function activateFallout() {
  _startFoBg();
  _injectPipboy();
}

function deactivateFallout() {
  if (_foBgRaf)     { cancelAnimationFrame(_foBgRaf); _foBgRaf = null; }
  if (_foBgCanvas)  { _foBgCanvas.remove(); _foBgCanvas = null; }
  if (_foPipboy)    { _foPipboy.remove();   _foPipboy = null; }
  if (_foGlitchTid) { clearTimeout(_foGlitchTid); _foGlitchTid = null; }
}

function _startFoBg() {
  if (_foBgCanvas) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'fo-bg-canvas';
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0',
    width: '100%', height: '100%',
    zIndex: '0', pointerEvents: 'none',
  });
  document.body.insertBefore(canvas, document.body.firstChild);
  _foBgCanvas = canvas;

  const ctx = canvas.getContext('2d');
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  // Each particle = one command line fading in/hold/out
  class Cmd {
    constructor(stagger) {
      this.reset();
      if (stagger) {
        this.alpha = Math.random() * this.maxAlpha;
        this.phase = 'hold';
        this.holdCount = Math.random() * this.holdTime;
      }
    }
    reset() {
      this.text     = FO_CMDS[Math.floor(Math.random() * FO_CMDS.length)];
      this.x        = 60 + Math.random() * (canvas.width  - 180);
      this.y        = 40 + Math.random() * (canvas.height -  80);
      this.alpha    = 0;
      this.maxAlpha = 0.055 + Math.random() * 0.08;
      this.phase    = 'in';
      this.holdTime = 90 + Math.random() * 180;
      this.holdCount= 0;
      this.spd      = 0.006 + Math.random() * 0.01;
      this.size     = Math.random() < 0.15 ? 11 : 13;
    }
    tick() {
      if (this.phase === 'in') {
        this.alpha += this.spd;
        if (this.alpha >= this.maxAlpha) { this.alpha = this.maxAlpha; this.phase = 'hold'; }
      } else if (this.phase === 'hold') {
        if (++this.holdCount >= this.holdTime) this.phase = 'out';
      } else {
        this.alpha -= this.spd * 0.6;
        if (this.alpha <= 0) this.reset();
      }
    }
    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle   = '#2aff4d';
      ctx.font        = `${this.size}px 'VT323', monospace`;
      ctx.fillText(this.text, this.x, this.y);
      ctx.restore();
    }
  }

  const cmds = Array.from({ length: 28 }, (_, i) => new Cmd(i < 20));

  function frame() {
    if (!_foBgCanvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    cmds.forEach(c => { c.tick(); c.draw(ctx); });
    _foBgRaf = requestAnimationFrame(frame);
  }
  _foBgRaf = requestAnimationFrame(frame);
}

function _injectPipboy() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || document.getElementById('fo-pipboy')) return;

  function bar(pct) {
    const n = Math.round(pct / 10);
    return '█'.repeat(n) + '░'.repeat(10 - n);
  }

  const el = document.createElement('div');
  el.id = 'fo-pipboy';
  el.innerHTML = `
    <div class="fo-pb-title">◈ VAULT-BOY STATUS ◈</div>
    <div class="fo-pb-bar-row">
      <span class="fo-pb-lbl">HP</span>
      <span class="fo-pb-track">${bar(82)}</span>
      <span class="fo-pb-num">082</span>
    </div>
    <div class="fo-pb-bar-row">
      <span class="fo-pb-lbl">AP</span>
      <span class="fo-pb-track">${bar(65)}</span>
      <span class="fo-pb-num">065</span>
    </div>
    <div class="fo-pb-bar-row fo-pb-rad">
      <span class="fo-pb-lbl">RAD</span>
      <span class="fo-pb-track">${bar(12)}</span>
      <span class="fo-pb-num">012</span>
    </div>
    <div class="fo-pb-sep">────────────────────</div>
    <div class="fo-pb-special">
      <span>S<b>7</b></span><span>P<b>6</b></span><span>E<b>8</b></span>
      <span>C<b>5</b></span><span>I<b>9</b></span><span>A<b>7</b></span><span>L<b>6</b></span>
    </div>
    <div class="fo-pb-lvl">LVL&nbsp;<span id="fo-pb-n">42</span>&nbsp;<span class="fo-pb-cur">▮</span></div>
  `;
  sidebar.appendChild(el);
  _foPipboy = el;

  // Occasional glitch on the level number
  function glitchLoop() {
    if (!_foPipboy) return;
    _foGlitchTid = setTimeout(() => {
      if (!_foPipboy) return;
      const n = document.getElementById('fo-pb-n');
      if (n) {
        const orig = n.textContent;
        n.textContent = String(Math.floor(Math.random() * 99)).padStart(2, '0');
        setTimeout(() => { if (n) n.textContent = orig; }, 100);
      }
      glitchLoop();
    }, 6000 + Math.random() * 8000);
  }
  glitchLoop();
}
// ======================

export function switchTheme(name) {
  if (!THEMES.includes(name)) return;
  document.body.setAttribute('data-theme', name);
  localStorage.setItem(LS_KEY, name);

  destroyWebGL();
  deactivateFallout();

  if (name === 'nexus')   activateWebGL();
  if (name === 'fallout') activateFallout();

  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === name);
  });
}

export function initTheme() {
  const saved = localStorage.getItem(LS_KEY);
  const theme = THEMES.includes(saved) ? saved : 'nexus';
  document.body.setAttribute('data-theme', theme);

  if (theme === 'nexus')   activateWebGL();
  if (theme === 'fallout') activateFallout();

  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
    btn.addEventListener('click', () => switchTheme(btn.dataset.theme));
  });
}

window.switchTheme = switchTheme;
