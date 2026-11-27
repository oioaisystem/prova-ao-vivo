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
  foto01:     { nome: 'Real (foto)', foto: 'armacoes/foto-01', calibre: [52, 18], altura: 41 },
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
const MOVEL = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
// No celular a tela já é muito densa: desenhar em 1x economiza GPU para a detecção.
renderer.setPixelRatio(MOVEL ? 1 : Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
oclusor.scale.set(74, 98, 92);
oclusor.position.set(0, -14, -100);
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

// Sombra suave da armação sobre a pele (textura gerada uma vez por armação).
function texturaSombra(contornos, larguraMm, alturaMm) {
  const k = 4; // px por mm na textura
  const c = document.createElement('canvas');
  c.width = Math.ceil(larguraMm * k); c.height = Math.ceil(alturaMm * k);
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(10px)';
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = 3.5 * k;
  for (const { pts, dx } of contornos) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = (p.x + dx + larguraMm / 2) * k, y = (alturaMm / 2 - p.y) * k;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Armação a partir de fotos (frente + haste), preparada por ferramentas/preparar_armacao.py ----------
const cacheFoto = {};
async function carregarFoto(base) {
  if (cacheFoto[base]) return cacheFoto[base];
  const carregador = new THREE.TextureLoader();
  const tex = (u) => new Promise((ok, erro) => carregador.load(u, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ok(t); }, undefined, erro));
  const [info, frente, lente, haste] = await Promise.all([
    fetch(base + '.json').then((r) => r.json()), tex(base + '-frente.png'), tex(base + '-lente.png'), tex(base + '-haste.png'),
  ]);
  lente.colorSpace = THREE.NoColorSpace;
  return (cacheFoto[base] = { info, frente, lente, haste });
}

function montarOculosFoto(m, d) {
  const [L, B] = escolha.calibre || m.calibre;
  const k = (2 * L + B) / (2 * m.calibre[0] + m.calibre[1]);   // calibre maior = armação maior
  const W = d.info.largura_mm * k, Hf = d.info.altura_mm * k;
  const cy = -d.info.centro_lente_y_mm * k;                     // centro das lentes em y = 0
  const le = LENTES[escolha.lente];
  const g = new THREE.Group();

  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.03, Hf * 1.08), new THREE.MeshBasicMaterial({
    map: d.frente, color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false,
  }));
  sombra.position.set(0, cy - 2.5, -4);
  sombra.renderOrder = 1;
  g.add(sombra);

  const lente = new THREE.Mesh(new THREE.PlaneGeometry(W, Hf), new THREE.MeshPhysicalMaterial({
    color: le.cor, transparent: true, opacity: le.opac, alphaMap: d.lente, roughness: 0.02, metalness: 0,
    clearcoat: 1, envMapIntensity: 2.2, depthWrite: false,
  }));
  lente.position.set(0, cy, -0.4);
  lente.renderOrder = 2;
  g.add(lente);

  const frente = new THREE.Mesh(new THREE.PlaneGeometry(W, Hf), new THREE.MeshBasicMaterial({
    map: d.frente, transparent: true, alphaTest: 0.02, toneMapped: false,
  }));
  frente.position.set(0, cy, 0);
  frente.renderOrder = 3;
  g.add(frente);

  const h = d.info.haste;
  const comp = h.comprimento_mm * k, alt = h.altura_mm * k;
  const topo = cy + Hf / 2;
  for (const lado of [1, -1]) {
    const pivo = new THREE.Group();
    pivo.position.set(lado * (W / 2 - 3), topo - h.abaixo_do_topo_mm * k, -1.5);
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(comp, alt), new THREE.MeshBasicMaterial({
      map: d.haste, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, toneMapped: false,
    }));
    placa.rotation.y = Math.PI / 2;            // dobradiça (lado esquerdo da foto) na frente
    placa.position.set(0, -alt / 2, -comp / 2);
    pivo.add(placa);
    pivo.rotation.x = -0.16;                   // compensa a inclinação da frente: desce até a orelha
    pivo.rotation.y = lado * -0.05;
    g.add(pivo);
  }
  g.rotation.x = 0.12;
  g.position.set(0, -2, 3);
  return g;
}

let pedidoFoto = 0;
function montarOculos() {
  const m = MODELOS[escolha.modelo];
  if (m.foto) {
    const meu = ++pedidoFoto;
    carregarFoto(m.foto).then((d) => {
      if (meu !== pedidoFoto) return;
      trocarOculos(montarOculosFoto(m, d));
    }).catch((e) => { console.error(e); msgEl.textContent = 'Não consegui carregar a armação: ' + e.message; });
    return;
  }
  pedidoFoto++;
  const [L, B] = escolha.calibre || m.calibre;
  const Hl = m.altura * (L / m.calibre[0]); // altura acompanha o calibre
  const c = CORES[escolha.cor];
  const le = LENTES[escolha.lente];
  const metalico = c.metal > 0.5;
  const t = metalico ? 1.6 : 3.6;      // espessura do aro (mm)
  const prof = metalico ? 1.6 : 4.2;   // profundidade do aro (mm)
  const cx = B / 2 + L / 2;

  const matArm = new THREE.MeshPhysicalMaterial({
    color: c.cor, metalness: c.metal, roughness: c.rugos,
    clearcoat: metalico ? 0 : 1, clearcoatRoughness: 0.15,
    transparent: !!c.opac, opacity: c.opac ?? 1, envMapIntensity: metalico ? 1.4 : 1,
  });
  const matLente = new THREE.MeshPhysicalMaterial({
    color: le.cor, transparent: true, opacity: le.opac, roughness: 0.02, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.2,
    depthWrite: false, side: THREE.DoubleSide,
  });

  const g = new THREE.Group();
  const contornos = [];
  for (const lado of [1, -1]) {
    let pts = contornoLente(m.forma, L, Hl);
    if (lado < 0) pts = pts.map((p) => new THREE.Vector2(-p.x, p.y)).reverse();
    contornos.push({ pts, dx: lado * cx });

    if (metalico) {
      // Aro de metal: tubo fino e redondo seguindo o contorno da lente.
      const curva = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x * (L + t) / L, p.y * (Hl + t) / Hl, 0)), true);
      const aro = new THREE.Mesh(new THREE.TubeGeometry(curva, 120, t / 2 + 0.3, 10, true), matArm);
      aro.position.set(lado * cx, 0, 0);
      g.add(aro);
      // Plaquetas do nariz
      for (const dy of [-Hl * 0.12]) {
        const plaqueta = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshPhysicalMaterial({
          color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.1, clearcoat: 1,
        }));
        plaqueta.scale.set(1.4, 3, 0.8);
        plaqueta.position.set(lado * (B / 2 + 1), dy, -5);
        g.add(plaqueta);
      }
    } else {
      // Aro de acetato: extrudado com bordas bem arredondadas.
      const ext = pts.map((p) => new THREE.Vector2(p.x * (L + 2 * t) / L, p.y * (Hl + 2 * t) / Hl));
      const forma = new THREE.Shape(ext);
      forma.holes.push(new THREE.Path(pts));
      const aro = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, {
        depth: prof - 2, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.0, bevelSegments: 5, curveSegments: 16,
      }), matArm);
      aro.position.set(lado * cx, 0, -prof / 2);
      g.add(aro);
    }

    const lente = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), matLente);
    lente.position.set(lado * cx, 0, 0.3);
    lente.renderOrder = 2;
    g.add(lente);

    // Dobradiça + haste. A haste gira a partir da dobradiça e desce de leve até a orelha.
    const xh = lado * (cx + L / 2 + t * 0.5);
    const yh = Hl * 0.22;
    const dobradica = new THREE.Mesh(new THREE.BoxGeometry(metalico ? 2.5 : 4.5, metalico ? 3 : 6, 7), matArm);
    dobradica.position.set(xh, yh, -3.5);
    g.add(dobradica);
    const comp = 120;
    const pivo = new THREE.Group();
    pivo.position.set(xh + lado * 0.5, yh, -6);
    const haste = new THREE.Mesh(new THREE.BoxGeometry(metalico ? 1.4 : 2.6, metalico ? 1.8 : 4.5, comp), matArm);
    haste.position.set(0, 0, -comp / 2);
    pivo.add(haste);
    // Ponteira (curva atrás da orelha)
    const ponteira = new THREE.Mesh(new THREE.BoxGeometry(metalico ? 2 : 2.6, metalico ? 2.4 : 4.5, 26), matArm);
    ponteira.position.set(0, -9, -comp - 8);
    ponteira.rotation.x = -0.8;
    pivo.add(ponteira);
    pivo.rotation.x = -0.2;           // desce de leve até a orelha (compensa a inclinação da frente)
    pivo.rotation.y = lado * -0.06;   // abre de leve para acompanhar a cabeça
    g.add(pivo);
  }

  // Ponte
  const curva = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-B / 2 - 1.5, Hl * 0.16, 0.5),
    new THREE.Vector3(0, Hl * 0.28, 2),
    new THREE.Vector3(B / 2 + 1.5, Hl * 0.16, 0.5),
  );
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 24, metalico ? 0.9 : 1.9, 10, false), matArm));
  if (m.forma === 'aviador') {
    const barra = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, B + 12, 10), matArm);
    barra.rotation.z = Math.PI / 2;
    barra.position.set(0, Hl * 0.46, 0.3);
    g.add(barra);
  }

  // Sombra de contato: um "fantasma" desfocado da armação, um pouco atrás e abaixo.
  const largura = 2 * (cx + L / 2) + 20, altura = Hl + 24;
  const sombra = new THREE.Mesh(
    new THREE.PlaneGeometry(largura, altura),
    new THREE.MeshBasicMaterial({ map: texturaSombra(contornos, largura, altura), transparent: true, opacity: 0.28, depthWrite: false })
  );
  sombra.position.set(0, -2.5, -4);
  sombra.renderOrder = 1;
  g.add(sombra);

  // Inclinação pantoscópica (parte de baixo da lente mais perto do rosto) e posição na ponte do nariz.
  g.rotation.x = 0.12;
  g.position.set(0, -2, 3);

  trocarOculos(g);
}

function trocarOculos(g) {
  if (oculos) {
    ancora.remove(oculos);
    oculos.traverse((o) => {
      o.geometry?.dispose();
      const mp = o.material?.map;
      if (mp && !Object.values(cacheFoto).some((c) => c.frente === mp || c.haste === mp)) mp.dispose();
    });
  }
  oculos = g;
  ancora.add(g);
}

// ---------- Pose a partir dos pontos do rosto ----------
// Giro: matriz de pose do próprio MediaPipe (modelo 3D do rosto ajustado) — bem mais fiel ao virar a cabeça.
// Posição: ponto 168 (meio da ponte do nariz). Escala: íris.
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
let escala = 0;            // pixels por mm (suavizado)
let temPose = false;
let medidas = { dp: 0, rosto: 0 };
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();

function ponto(lm, i) {
  return new THREE.Vector3(lm[i].x * W, -lm[i].y * H, -lm[i].z * W);
}
function dist2d(lm, a, b) {
  return Math.hypot((lm[a].x - lm[b].x) * W, (lm[a].y - lm[b].y) * H);
}

function giroPelosPontos(lm) {
  const dirOlho = ponto(lm, 263).sub(ponto(lm, 33)).normalize();
  const cima = ponto(lm, 10).sub(ponto(lm, 152));
  const frente = new THREE.Vector3().crossVectors(dirOlho, cima).normalize();
  const y = new THREE.Vector3().crossVectors(frente, dirOlho).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dirOlho, y, frente));
}

function atualizarPose(lm, matriz) {
  let q;
  if (matriz) {
    _m.fromArray(matriz.data);
    _m.decompose(_p, _q, _s);
    q = _q.clone();
  } else {
    q = giroPelosPontos(lm);
  }

  // Escala pela íris: maior diâmetro visível (horizontal ou vertical) das duas íris.
  const irisPx = (Math.max(dist2d(lm, 469, 471), dist2d(lm, 470, 472)) +
                  Math.max(dist2d(lm, 474, 476), dist2d(lm, 475, 477))) / 2;
  const s = irisPx / IRIS_MM;
  const p = ponto(lm, 168);

  if (!temPose) { pos.copy(p); quat.copy(q); escala = s; temPose = true; }
  else {
    // Suavização adaptativa: parado = muito suave (sem tremer); mexendo rápido = acompanha na hora.
    const mov = p.distanceTo(pos) / Math.max(escala, 0.1);      // em mm
    const ang = quat.angleTo(q);                                 // em radianos
    const aPos = Math.min(0.9, 0.18 + mov * 0.12);
    const aRot = Math.min(0.9, 0.15 + ang * 6);
    pos.lerp(p, aPos);
    quat.slerp(q, aRot);
    escala += (s - escala) * 0.08;
  }

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
        outputFacialTransformationMatrixes: true,
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
      video: { facingMode: frontal ? 'user' : 'environment', width: { ideal: MOVEL ? 640 : 1280 }, height: { ideal: MOVEL ? 480 : 720 } },
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
        atualizarPose(r.faceLandmarks[0], r.facialTransformationMatrixes?.[0]);
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
