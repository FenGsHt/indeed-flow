/**
 * 2026-03-20: Three.js WebGL 赛博朋克背景着色器
 * Cellular noise + Simplex noise 动态渐变
 */

let renderer, scene, camera, material, mesh, rafId;

const vertexShader = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec2 u_resolution;
  uniform float u_time;

  vec2 random2(vec2 p) {
    return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
  }

  float cellularNoise(vec2 st) {
    vec2 i_st = floor(st);
    vec2 f_st = fract(st);
    float m_dist = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 point = random2(i_st + neighbor);
        point = 0.5 + 0.5 * sin(u_time * 0.5 + 6.2831 * point);
        vec2 diff = neighbor + point - f_st;
        m_dist = min(m_dist, length(diff));
      }
    }
    return m_dist;
  }

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    st.x *= u_resolution.x / u_resolution.y;

    float n1 = snoise(st * 1.5 + u_time * 0.1);
    float n2 = snoise(st * 2.0 - u_time * 0.15);

    vec3 col1 = vec3(0.85, 0.0, 1.0);   // Magenta
    vec3 col2 = vec3(0.0, 0.8, 1.0);    // Cyan
    vec3 col3 = vec3(0.0, 1.0, 0.3);    // Green
    vec3 col4 = vec3(1.0, 0.4, 0.0);    // Orange

    vec3 bg = mix(col1, col2, smoothstep(-1.0, 1.0, n1));
    bg = mix(bg, col3, smoothstep(-0.5, 1.5, n2));
    bg = mix(bg, col4, smoothstep(0.0, 1.0, n1 * n2));

    float crackle = cellularNoise(st * 8.0);
    crackle += snoise(st * 30.0) * 0.1;

    float mask = smoothstep(0.43, 0.47, crackle);
    vec3 finalColor = mix(vec3(0.015), bg, mask);

    float dist = distance(st, vec2(0.5));
    finalColor *= smoothstep(1.2, 0.2, dist);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function initWebGL(canvas) {
  if (!canvas || !window.THREE) return false;

  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        u_resolution: { value: new THREE.Vector2() },
        u_time: { value: 0 }
      }
    });

    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    resizeWebGL();
    window.addEventListener('resize', resizeWebGL);
    animate(0);
    return true;
  } catch (e) {
    console.warn('WebGL init failed:', e);
    return false;
  }
}

function animate(time) {
  if (!renderer) return;
  material.uniforms.u_time.value = time * 0.001;
  renderer.render(scene, camera);
  rafId = requestAnimationFrame(animate);
}

export function resizeWebGL() {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  material.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);
}

export function destroyWebGL() {
  if (rafId) cancelAnimationFrame(rafId);
  window.removeEventListener('resize', resizeWebGL);
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); material.dispose(); }
  if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
  renderer = scene = camera = material = mesh = rafId = null;
}
