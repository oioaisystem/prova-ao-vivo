// ÔIÔ AI · Protótipo T10: prova de óculos ao vivo, 100% no aparelho (sem custo de IA).
// Detecção do rosto: MediaPipe Face Landmarker (478 pontos). Desenho 3D: Three.js.
// A armação é desenhada em milímetros e escalada pela íris (≈ 11,7 mm), então aparece no TAMANHO REAL.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODELO_ROSTO = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const IRIS_MM = 11.7; // diâmetro médio da íris humana

const $ = (s) => document.querySelector(s);
const video = $('#video');
const foto = $('#foto');
const canvas = $('#cena');
const camada = $('#camada');
const statsEl = $('#stats');
const statusEl = $('#status');
const msgEl = $('#msg');

// ---------- Catálogo de teste (armações desenhadas por código) ----------
const MODELOS = {
  redonda:    { nome: 'Redonda',    forma: 'redonda',    calibre: [49, 20], altura: 44 },
  retangular: { nome: 'Retangular', forma: 'retangular', calibre: [54, 17], altura: 38 },
  gatinho:    { nome: 'Gatinho',    forma: 'gatinho',    calibre: [52, 18], altura: 41 },
  aviador:    { nome: 'Aviador',    forma: 'aviador',    calibre: [58, 14], altura: 50 },
};
const CORES = {
  preto:     { nome: 'Preto',     cor: 0x141414, metal: 0.1, rugos: 0.45 },
  tartaruga: { nome: 'Tartaruga', cor: 0x5b3419, metal: 0.1, rugos: 0.35 },
  dourado:   { nome: 'Dourado',   cor: 0xc9a24a, metal: 0.85, rugos: 0.25 },
  azul:      { nome: 'Azul',      cor: 0x013893, metal: 0.2, rugos: 0.4 },
  cristal:   { nome: 'Cristal',   cor: 0xdfe9ef, metal: 0.0, rugos: 0.15, opac: 0.55 },
};
const LENTES = {
  incolor: { nome: 'Incolor (grau)', cor: 0xffffff, opac: 0.08 },
  cinza:   { nome: 'Solar cinza',    cor: 0x1c1c1c, opac: 0.62 },
  marrom:  { nome: 'Solar marrom',   cor: 0x4a2a10, opac: 0.55 },
  verde:   { nome: 'Solar G15',      cor: 0x1f3a26, opac: 0.58 },
};
const CALIBRES = [[48, 20], [49, 20], [50, 19], [52, 18], [54, 17], [56, 16], [58, 14]];

const escolha = { modelo: 'redonda', cor: 'preto', lente: 'incolor', calibre: null };

// ---------- Cena 3D (câmera ortográfica em pixels do vídeo) ----------
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const cena = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
cena.add(new THREE.AmbientLight(0xffffff, 0.6));
const luz = new THREE.DirectionalLight(0xffffff, 1.2);
luz.position.set(0.2, 0.6, 1);
cena.add(luz);

let W = 640, H = 480;
const camera = new THREE.OrthographicCamera(0, W, 0, -H, -10000, 10000);

// "ancora" recebe a pose do rosto: origem no meio da ponte do nariz (ponto 168), unidade = mm.
const ancora = new THREE.Group();
ancora.matrixAutoUpdate = false;
ancora.visible = false;
cena.add(ancora);

// Cabeça invisível: esconde as hastes quando passam por trás do rosto.
const oclusor = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 24),
  new THREE.MeshBasicMaterial({ colorWrite: false })
);
oclusor.scale.set(72, 98, 100);
oclusor.position.set(0, -12, -94);
oclusor.renderOrder = -1;
ancora.add(oclusor);

let oculos = null;

function contornoLente(forma, w, h) {
  const s = new THREE.Shape();
  if (forma === 'redonda') {
    s.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false);
  } else if (forma === 'retangular') {
    const r = 7, x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  } else {
    // Lente do lado +x (lado da têmpora em +x). Pontos de controle em fração de w e h.
    const P = forma === 'gatinho'
      ? [[-0.5, 0.1], [-0.38, 0.4], [0.05, 0.44], [0.42, 0.62], [0.54, 0.46], [0.45, -0.12], [0.18, -0.46], [-0.22, -0.48], [-0.46, -0.24]]
      : [[-0.5, 0.28], [-0.25, 0.5], [0.25, 0.5], [0.5, 0.34], [0.48, -0.06], [0.28, -0.42], [0, -0.5], [-0.32, -0.36], [-0.48, -0.02]];
    const v = P.map(([a, b]) => new THREE.Vector2(a * w, b * h));
    s.moveTo(v[0].x, v[0].y);
    s.splineThru([...v.slice(1), v[0]]);
  }
  return s.getPoints(40);
}

function montarOculos() {
  const m = MODELOS[escolha.modelo];
  const [L, B] = escolha.calibre || m.calibre;
  const Hl = m.altura * (L / m.calibre[0]); // altura acompanha o calibre
  const c = CORES[escolha.cor];
  const le = LENTES[escolha.lente];
  const t = 3.4;      // espessura do aro (mm)
  const prof = 3.2;   // profundidade do aro (mm)
  const cx = B / 2 + L / 2;

  const matArm = new THREE.MeshStandardMaterial({
    color: c.cor, metalness: c.metal, roughness: c.rugos,
    transparent: !!c.opac, opacity: c.opac ?? 1,
  });
  const matLente = new THREE.MeshStandardMaterial({
    color: le.cor, transparent: true, opacity: le.opac, roughness: 0.05, metalness: 0.1,
    depthWrite: false, side: THREE.DoubleSide,
  });

  const g = new THREE.Group();
  for (const lado of [1, -1]) {
    let pts = contornoLente(m.forma, L, Hl);
    if (lado < 0) pts = pts.map((p) => new THREE.Vector2(-p.x, p.y)).reverse();
    const ext = pts.map((p) => new THREE.Vector2(p.x * (L + 2 * t) / L, p.y * (Hl + 2 * t) / Hl));
    const forma = new THREE.Shape(ext);
    forma.holes.push(new THREE.Path(pts));
    const aro = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, {
      depth: prof, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.5, bevelSegments: 2, curveSegments: 12,
    }), matArm);
    aro.position.set(lado * cx, 0, -prof / 2);
    g.add(aro);

    const lente = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), matLente);
    lente.position.set(lado * cx, 0, 0);
    lente.renderOrder = 2;
    g.add(lente);

    // Dobradiça + haste (vai para trás, até a orelha)
    const xh = lado * (cx + L / 2 + t * 0.6);
    const yh = Hl * 0.28;
    const dobradica = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 8), matArm);
    dobradica.position.set(xh, yh, -3);
    g.add(dobradica);
    const comp = 128;
    const haste = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4, comp), matArm);
    haste.position.set(xh + lado * 1.5, yh - 3, -comp / 2 - 5);
    haste.rotation.x = -0.05;
    haste.rotation.y = lado * 0.04;
    g.add(haste);
  }

  // Ponte
  const curva = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-B / 2 - 1.5, Hl * 0.16, 0.5),
    new THREE.Vector3(0, Hl * 0.3, 2.5),
    new THREE.Vector3(B / 2 + 1.5, Hl * 0.16, 0.5),
  );
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 16, 1.7, 8, false), matArm));
  if (m.forma === 'aviador') {
    const barra = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, B + 10, 8), matArm);
    barra.rotation.z = Math.PI / 2;
    barra.position.set(0, Hl * 0.47, 0.5);
    g.add(barra);
  }

  // Frente da armação fica um pouco à frente da ponte do nariz e um pouco abaixo do ponto 168.
  g.position.set(0, -3, 9);

  if (oculos) {
    ancora.remove(oculos);
    oculos.traverse((o) => { o.geometry?.dispose(); });
  }
  oculos = g;
  ancora.add(g);
}

// ---------- Pose a partir dos pontos do rosto ----------
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
let escala = 0;            // pixels por mm (suavizado)
let temPose = false;
let medidas = { dp: 0, rosto: 0 };

function ponto(lm, i) {
  return new THREE.Vector3(lm[i].x * W, -lm[i].y * H, -lm[i].z * W);
}
function dist2d(lm, a, b) {
  return Math.hypot((lm[a].x - lm[b].x) * W, (lm[a].y - lm[b].y) * H);
}

function atualizarPose(lm) {
  const dirOlho = ponto(lm, 263).sub(ponto(lm, 33)).normalize();
  const cima = ponto(lm, 10).sub(ponto(lm, 152));
  const frente = new THREE.Vector3().crossVectors(dirOlho, cima).normalize();
  const y = new THREE.Vector3().crossVectors(frente, dirOlho).normalize();
  const rot = new THREE.Matrix4().makeBasis(dirOlho, y, frente);
  const q = new THREE.Quaternion().setFromRotationMatrix(rot);

  // Escala pela íris: maior diâmetro visível (horizontal ou vertical) das duas íris.
  const irisPx = (Math.max(dist2d(lm, 469, 471), dist2d(lm, 470, 472)) +
                  Math.max(dist2d(lm, 474, 476), dist2d(lm, 475, 477))) / 2;
  const s = irisPx / IRIS_MM;

  const p = ponto(lm, 168);
  if (!temPose) { pos.copy(p); quat.copy(q); escala = s; temPose = true; }
  else { pos.lerp(p, 0.6); quat.slerp(q, 0.5); escala += (s - escala) * 0.25; }

  ancora.matrix.compose(pos, quat, new THREE.Vector3(escala, escala, escala));
  ancora.matrixWorldNeedsUpdate = true;

  // Medidas aproximadas (valem com o rosto de frente para a câmera) — base da T11.
  const dpPx = dist2d(lm, 468, 473);
  medidas.dp += (dpPx / escala - medidas.dp) * (medidas.dp ? 0.1 : 1);
  const rostoPx = dist2d(lm, 234, 454);
  medidas.rosto += (rostoPx / escala - medidas.rosto) * (medidas.rosto ? 0.1 : 1);
}

// ---------- Detecção ----------
let detector = null;
let delegado = '';
async function criarDetector() {
  const arquivos = await FilesetResolver.forVisionTasks(WASM);
  for (const d of ['GPU', 'CPU']) {
    try {
      detector = await FaceLandmarker.createFromOptions(arquivos, {
        baseOptions: { modelAssetPath: MODELO_ROSTO, delegate: d },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      delegado = d;
      return;
    } catch (e) {
      console.warn('Falhou com', d, e);
    }
  }
  throw new Error('Não foi possível iniciar a detecção do rosto.');
}

// ---------- Fonte: câmera ou foto ----------
let modoFoto = false;
let frontal = true;
let fluxo = null;

function ajustarTamanho(w, h) {
  if (!w || !h || (w === W && h === H)) return;
  W = w; H = h;
  renderer.setSize(W, H, false);
  camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = -H;
  camera.updateProjectionMatrix();
}

async function abrirCamera() {
  msgEl.textContent = 'Abrindo a câmera…';
  try {
    if (fluxo) fluxo.getTracks().forEach((t) => t.stop());
    fluxo = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: frontal ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = fluxo;
    await video.play();
    modoFoto = false;
    foto.style.display = 'none';
    video.style.display = '';
    camada.classList.toggle('espelho', frontal);
    temPose = false;
    await garantirDetector();
    statusEl.classList.add('oculto');
  } catch (e) {
    console.error(e);
    msgEl.textContent = 'Não consegui abrir a câmera: ' + (e.message || e) +
      '. Confira a permissão do navegador. A câmera só funciona em https ou em localhost.';
  }
}

async function usarFoto(arquivo) {
  foto.src = URL.createObjectURL(arquivo);
  await foto.decode();
  if (fluxo) { fluxo.getTracks().forEach((t) => t.stop()); fluxo = null; }
  modoFoto = true;
  video.style.display = 'none';
  foto.style.display = 'block';
  camada.classList.remove('espelho');
  temPose = false;
  await garantirDetector();
  statusEl.classList.add('oculto');
}

async function garantirDetector() {
  if (detector) return;
  msgEl.textContent = 'Carregando a detecção do rosto (só na primeira vez)…';
  const t0 = performance.now();
  await criarDetector();
  stats.carga = Math.round(performance.now() - t0);
}

// ---------- Laço principal + medição de desempenho ----------
const stats = { quadros: 0, deteccoes: 0, somaDet: 0, inicio: 0, fps: 0, det: 0, carga: 0, semRosto: 0 };
let ultimoTempoVideo = -1;
let janela = { t: performance.now(), q: 0 };

function laco() {
  const fonte = modoFoto ? foto : video;
  const pronta = modoFoto ? foto.complete && foto.naturalWidth : video.readyState >= 2;
  if (detector && pronta) {
    ajustarTamanho(modoFoto ? foto.naturalWidth : video.videoWidth, modoFoto ? foto.naturalHeight : video.videoHeight);
    const novo = modoFoto || video.currentTime !== ultimoTempoVideo;
    if (novo) {
      ultimoTempoVideo = video.currentTime;
      const t0 = performance.now();
      const r = detector.detectForVideo(fonte, t0);
      const dt = performance.now() - t0;
      if (!stats.inicio) stats.inicio = t0;
      stats.deteccoes++; stats.somaDet += dt;
      stats.det += (dt - stats.det) * 0.1;
      if (r.faceLandmarks && r.faceLandmarks.length) {
        atualizarPose(r.faceLandmarks[0]);
        ancora.visible = true;
      } else {
        ancora.visible = false; temPose = false; stats.semRosto++;
      }
    }
  }
  renderer.render(cena, camera);

  stats.quadros++;
  janela.q++;
  const agora = performance.now();
  if (agora - janela.t >= 1000) {
    stats.fps = Math.round(janela.q * 1000 / (agora - janela.t));
    janela = { t: agora, q: 0 };
    mostrarStats();
  }
  requestAnimationFrame(laco);
}

function textoResultado() {
  const mediaDet = stats.deteccoes ? (stats.somaDet / stats.deteccoes).toFixed(1) : '-';
  return [
    `ÔIÔ AI · T10 · ${new Date().toLocaleString('pt-BR')}`,
    `Aparelho: ${navigator.userAgent}`,
    `Fonte: ${modoFoto ? 'foto' : (frontal ? 'câmera frontal' : 'câmera traseira')} ${W}x${H}`,
    `Detecção: ${delegado || '-'} · carga do modelo ${stats.carga} ms`,
    `FPS da tela: ${stats.fps} · detecção média ${mediaDet} ms (${stats.deteccoes} quadros)`,
    `DP estimada: ${medidas.dp ? medidas.dp.toFixed(1) : '-'} mm · largura do rosto: ${medidas.rosto ? medidas.rosto.toFixed(0) : '-'} mm`,
    `Armação: ${MODELOS[escolha.modelo].nome} ${(escolha.calibre || MODELOS[escolha.modelo].calibre).join('-')} · ${CORES[escolha.cor].nome} · ${LENTES[escolha.lente].nome}`,
  ].join('\n');
}

function mostrarStats() {
  const rosto = ancora.visible ? '' : ' · <b style="color:#ffb020">sem rosto</b>';
  statsEl.innerHTML =
    `<b>${stats.fps}</b> FPS · detecção <b>${stats.det.toFixed(0)}</b> ms (${delegado || '…'})${rosto}<br>` +
    `DP ≈ <b>${medidas.dp ? medidas.dp.toFixed(1) : '–'}</b> mm · rosto ≈ <b>${medidas.rosto ? medidas.rosto.toFixed(0) : '–'}</b> mm <span style="opacity:.7">(estimativa)</span>`;
}

// ---------- Botões ----------
function chips(linha, lista, chave, rotulo) {
  for (const [id, item] of Object.entries(lista)) {
    const b = document.createElement('button');
    b.dataset.id = id;
    b.innerHTML = rotulo(item);
    b.onclick = () => {
      escolha[chave] = id;
      if (chave === 'modelo') { escolha.calibre = null; preencherCalibres(); }
      linha.querySelectorAll('button').forEach((x) => x.classList.toggle('ativo', x.dataset.id === id));
      montarOculos();
    };
    if (escolha[chave] === id) b.classList.add('ativo');
    linha.appendChild(b);
  }
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
chips($('#linhaModelos'), MODELOS, 'modelo', (m) => m.nome);
chips($('#linhaCores'), CORES, 'cor', (c) => `<span class="bolinha" style="background:${hex(c.cor)}"></span>${c.nome}`);
chips($('#linhaLentes'), LENTES, 'lente', (l) => l.nome);

const selCalibre = $('#calibre');
function preencherCalibres() {
  const padrao = MODELOS[escolha.modelo].calibre.join('-');
  selCalibre.innerHTML = CALIBRES.map(([l, b]) => {
    const v = `${l}-${b}`;
    return `<option value="${v}" ${v === padrao ? 'selected' : ''}>${v}${v === padrao ? ' (padrão)' : ''}</option>`;
  }).join('');
}
selCalibre.onchange = () => { escolha.calibre = selCalibre.value.split('-').map(Number); montarOculos(); };
preencherCalibres();

$('#btnCamera').onclick = abrirCamera;
$('#btnTrocar').onclick = () => { frontal = !frontal; abrirCamera(); };
const arquivo = $('#arquivo');
$('#btnFoto').onclick = () => arquivo.click();
$('#btnFoto2').onclick = () => arquivo.click();
arquivo.onchange = () => { if (arquivo.files[0]) usarFoto(arquivo.files[0]).catch((e) => { msgEl.textContent = 'Erro: ' + e.message; }); };
$('#btnCopiar').onclick = async () => {
  const txt = textoResultado();
  try { await navigator.clipboard.writeText(txt); alert('Resultado copiado. Cole no WhatsApp para o Claude.'); }
  catch { prompt('Copie o resultado:', txt); }
};

// Para testes automáticos: window.__t10 expõe o estado.
window.__t10 = { stats, medidas, escolha, textoResultado, usarFotoUrl: async (url) => {
  const b = await (await fetch(url)).blob(); await usarFoto(b);
} };

montarOculos();
requestAnimationFrame(laco);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
