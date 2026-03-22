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

export function switchTheme(name) {
  if (!THEMES.includes(name)) return;
  document.body.setAttribute('data-theme', name);
  localStorage.setItem(LS_KEY, name);

  destroyWebGL();
  if (name === 'nexus') activateWebGL();

  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === name);
  });
}

export function initTheme() {
  const saved = localStorage.getItem(LS_KEY);
  const theme = THEMES.includes(saved) ? saved : 'nexus';
  document.body.setAttribute('data-theme', theme);

  if (theme === 'nexus') activateWebGL();

  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
    btn.addEventListener('click', () => switchTheme(btn.dataset.theme));
  });
}

window.switchTheme = switchTheme;
