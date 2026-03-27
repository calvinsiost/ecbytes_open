// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Architecture: Digital Twin Architecture (Blockchain + ML + LLM)
// Application: EHS & Mining
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   CONFIGURACAO DA CENA 3D
   ================================================================

   Este modulo inicializa o Three.js e configura a cena 3D.

   COMPONENTES CRIADOS:
   - Scene: o "mundo" 3D onde tudo existe
   - Camera: o "olho" que ve a cena
   - Renderer: o "desenhista" que pinta na tela
   - Lights: as "lampadas" que iluminam os objetos

   Three.js e uma biblioteca JavaScript para graficos 3D.
   Ela usa WebGL para renderizar graficos acelerados por GPU.

   ================================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getPerfMonitor } from '../performance/monitor.js';

// ----------------------------------------------------------------
// RENDER & RESIZE HOOKS — extensao do loop para modulos externos
// Permite que labels, post-processing, etc. se registrem sem
// modificar o core do animate().
// ----------------------------------------------------------------
const _renderHooks = [];
const _resizeHooks = [];
let _resizePendingSceneWarned = false;

/** Registra callback chamado apos cada render frame: fn(scene, camera) */
export function addRenderHook(fn) {
    _renderHooks.push(fn);
}

/** Registra callback chamado apos resize: fn(width, height) */
export function addResizeHook(fn) {
    _resizeHooks.push(fn);
}

// ----------------------------------------------------------------
// VARIAVEIS DO MODULO
// ----------------------------------------------------------------

/**
 * A cena 3D - container de todos os objetos.
 * Pense como um "palco" onde os atores (objetos 3D) sao colocados.
 */
let scene = null;

/**
 * A camera - define o ponto de vista.
 * Usamos camera ortografica para visualizacao tecnica (sem perspectiva).
 */
let camera = null;

/**
 * O renderer - renderiza a cena na tela.
 * Converte a cena 3D em pixels que vemos no canvas.
 */
let renderer = null;

/**
 * Os controles de orbita - permitem rotacionar/mover a camera.
 * O usuario pode arrastar para girar, scroll para zoom.
 */
let controls = null;

/**
 * Grupos de objetos - organizam elementos na cena.
 * Agrupar facilita mostrar/esconder categorias inteiras.
 */
let elementsGroup = null; // Grupo dos elementos do modelo
let editHandlesGroup = null; // Grupo dos handles de edição de formas (acima dos elementos)
let interpolationGroup = null; // Grupo das superfícies interpoladas (terreno, nível d'água, etc.)
let voxelGroup = null; // Grupo dos volumes voxelizados (geologia, entre interpolação e elementos)
let issuesGroup = null; // Grupo dos marcadores de issues 3D (acima dos elementos)

/** Extent do modelo — atualizado por controls.js via setModelExtent() */
let _lastModelExtent = 200;

/**
 * Define extent do modelo para calculo dinamico de near/far.
 * Chamado por controls.js ao posicionar a camera.
 * @param {number} extent
 */
export function setModelExtent(extent) {
    _lastModelExtent = extent;
}

/**
 * Recalcula near/far planes baseado na posicao atual da camera.
 * Chamado a cada frame que a camera se move (animate loop).
 */
function _syncNearFar() {
    if (!camera || !controls) return;
    const dx = camera.position.x - controls.target.x;
    const dy = camera.position.y - controls.target.y;
    const dz = camera.position.z - controls.target.z;
    const camDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const radius = _lastModelExtent * 1.5;
    camera.near = Math.max(0.1, camDist - radius);
    camera.far = Math.max(1000, camDist + radius);
    camera.updateProjectionMatrix();
}

// ----------------------------------------------------------------
// FUNCAO PRINCIPAL DE INICIALIZACAO
// ----------------------------------------------------------------

/**
 * Inicializa toda a estrutura 3D.
 * Deve ser chamada uma vez quando a aplicacao inicia.
 *
 * @param {HTMLElement} container - Elemento HTML onde o canvas sera inserido
 * @returns {Object} - Objetos criados para uso em outros modulos
 *
 * EXEMPLO:
 *   const container = document.getElementById('canvas-container');
 *   const { scene, camera } = initScene(container);
 */
export function initScene(container) {
    // ----------------------------------------
    // 1. CRIAR A CENA
    // ----------------------------------------

    /**
     * Scene e o container principal de todos os objetos 3D.
     * Definimos cor de fundo escura e neblina para profundidade.
     */
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d23); // Azul escuro

    // Fog desabilitado por padrao — escondia elementos distantes
    scene.fog = null;

    // ----------------------------------------
    // 2. CRIAR A CAMERA
    // ----------------------------------------

    /**
     * Calculamos proporcao do container (largura/altura).
     * Isso garante que a imagem nao fique distorcida.
     */
    const aspect = container.clientWidth / container.clientHeight;

    /**
     * Frustum define o tamanho visivel da camera ortografica.
     * Valores maiores = ve mais da cena.
     */
    const frustum = 100;

    /**
     * OrthographicCamera - camera sem perspectiva.
     * Linhas paralelas permanecem paralelas (ideal para engenharia).
     *
     * Parametros: esquerda, direita, cima, baixo, perto, longe
     */
    camera = new THREE.OrthographicCamera(
        (-frustum * aspect) / 2, // Limite esquerdo
        (frustum * aspect) / 2, // Limite direito
        frustum / 2, // Limite superior
        -frustum / 2, // Limite inferior
        1, // Plano proximo (near) — ajustado dinamicamente por controls.js
        1000, // Plano distante (far)
    );

    /**
     * Posicao inicial da camera.
     * Valores iguais em X, Y, Z criam vista isometrica (diagonal).
     */
    camera.position.set(80, 80, 80);
    camera.zoom = 1;
    camera.updateProjectionMatrix(); // Aplica mudancas

    // ----------------------------------------
    // 3. CRIAR O RENDERER
    // ----------------------------------------

    /**
     * WebGLRenderer - renderiza usando aceleracao de hardware (GPU).
     * antialiasing: true = bordas mais suaves (menos "serrilhadas")
     */
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        logarithmicDepthBuffer: true,
    });

    /**
     * Define tamanho do canvas igual ao container.
     */
    renderer.setSize(container.clientWidth, container.clientHeight);

    /**
     * Pixel ratio controla nitidez em telas de alta resolucao (Retina).
     * Limitamos a 2 para nao sobrecarregar GPUs fracas.
     */
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    /**
     * Habilita sombras para mais realismo.
     * PCFSoftShadowMap = sombras suaves (mais bonitas).
     */
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    /**
     * Habilita clipping planes locais nos materiais.
     * Permite cortar geometrias para revelar o interior do modelo.
     */
    renderer.localClippingEnabled = true;

    /**
     * Adiciona o canvas (elemento <canvas>) ao container HTML.
     */
    container.appendChild(renderer.domElement);

    // ResizeObserver para auto-redimensionar o renderer quando o container muda de tamanho
    // (ex: constellation expand/collapse altera o flex layout do main-area)
    new ResizeObserver(() => {
        handleResize(container);
    }).observe(container);

    // ----------------------------------------
    // 4. CRIAR CONTROLES DE ORBITA
    // ----------------------------------------

    /**
     * OrbitControls permite interacao com mouse/toque:
     * - Arrastar: rotaciona a cena
     * - Scroll: zoom
     * - Botao direito: pan (mover)
     */
    controls = new OrbitControls(camera, renderer.domElement);

    /**
     * Damping = "amortecimento" - movimento continua suavemente.
     * Cria sensacao mais natural e profissional.
     */
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    /**
     * Target = ponto para onde a camera olha.
     * Colocamos um pouco abaixo da superficie para ver o subsolo.
     */
    controls.target.set(0, -20, 0);

    /**
     * Limites de zoom.
     * Evita que usuario faca zoom demais ou de menos.
     */
    controls.minZoom = 0.05; // Maximo afastado (permite cenas grandes com boundaries extensas)
    controls.maxZoom = 4; // Maximo aproximado

    /**
     * Zoom segue cursor — ao fazer scroll, o zoom converge
     * para o ponto sob o mouse (UX estilo Google Maps).
     */
    controls.zoomToCursor = true;

    // ECBT01: Render-on-demand — camera movement detected in animate() via before/after comparison
    // (Nao usamos 'change' event porque OrbitControls dispara change continuamente com damping ativo,
    // impedindo o smart pause de funcionar. A deteccao esta no loop animate().)

    // ECBT02: Wake render loop on interaction start (orbit/pan/zoom begin)
    controls.addEventListener('start', requestRender);

    // ECBT03: Persist camera state when user finishes interaction (orbit/pan/zoom end)
    controls.addEventListener('end', () => {
        window.dispatchEvent(new CustomEvent('cameraChanged'));
    });

    // ----------------------------------------
    // 5. CRIAR ILUMINACAO
    // ----------------------------------------

    /**
     * AmbientLight - luz ambiente que ilumina tudo igualmente.
     * Sem ela, partes nao iluminadas ficariam totalmente pretas.
     * Parametros: cor, intensidade (0-1)
     */
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    ambientLight.name = 'ambientLight';
    scene.add(ambientLight);

    /**
     * DirectionalLight - luz direcional (como o sol).
     * Cria sombras e da sensacao de volume aos objetos.
     */
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.name = 'mainLight';
    mainLight.position.set(50, 100, 50);
    mainLight.castShadow = true; // Esta luz projeta sombras
    scene.add(mainLight);

    /**
     * Segunda luz direcional mais fraca.
     * Ilumina o lado oposto para suavizar sombras.
     */
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-30, 50, -30);
    scene.add(fillLight);

    // ----------------------------------------
    // 6. CRIAR GRUPOS DE ORGANIZACAO
    // ----------------------------------------

    /**
     * Grupos organizam objetos relacionados.
     * Podemos mover, rotacionar ou esconder o grupo inteiro.
     */
    elementsGroup = new THREE.Group();
    editHandlesGroup = new THREE.Group();
    interpolationGroup = new THREE.Group();
    interpolationGroup.name = 'interpolationSurfaces';

    // Adiciona grupo de interpolação (abaixo dos elementos para não ocluir)
    scene.add(interpolationGroup);

    // Grupo de volumes voxelizados (entre interpolação e elementos)
    voxelGroup = new THREE.Group();
    voxelGroup.name = 'voxelVolumes';
    scene.add(voxelGroup);

    // Adiciona grupo de elementos a cena
    scene.add(elementsGroup);

    // Grupo de issues 3D (acima dos elementos, abaixo dos handles de edição)
    issuesGroup = new THREE.Group();
    issuesGroup.name = 'issueMarkers';
    scene.add(issuesGroup);

    // Grupo de handles renderiza acima dos elementos (para raycast prioritário)
    scene.add(editHandlesGroup);

    // ----------------------------------------
    // 7. WAKE LISTENERS — Retoma render loop ao interagir
    // ----------------------------------------

    // ECBT02: Qualquer interacao com o canvas acorda o loop de render
    // NOTA: OrbitControls com zoomToCursor aplica zoom+posicao DURANTE o evento
    // wheel (nao no update()). Entao precisamos setar _needsRender diretamente,
    // porque o snapshot antes/depois de controls.update() nao detecta a mudanca.
    renderer.domElement.addEventListener('pointerdown', requestRender);
    renderer.domElement.addEventListener('wheel', requestRender, { passive: true });

    // ECBT03: Page Visibility — pausa loop quando aba escondida
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            _loopRunning = false;
            if (_animationId) cancelAnimationFrame(_animationId);
            getPerfMonitor().setLoopRunning(false);
        } else {
            wakeRenderLoop();
        }
    });

    // ----------------------------------------
    // 8. DEBUG — Expoe referencias para testes de performance no console
    // ----------------------------------------

    window.__scene = scene;
    window.__camera = camera;
    window.__renderer = renderer;
    window.__controls = controls;

    // ----------------------------------------
    // 9. RETORNAR REFERENCIAS
    // ----------------------------------------

    return {
        scene,
        camera,
        renderer,
        controls,
        elementsGroup,
    };
}

// ----------------------------------------------------------------
// FUNCOES DE ACESSO (GETTERS)
// ----------------------------------------------------------------

/**
 * Retorna a cena 3D.
 * @returns {THREE.Scene}
 */
export function getScene() {
    return scene;
}

/**
 * Retorna a camera.
 * @returns {THREE.OrthographicCamera}
 */
export function getCamera() {
    return camera;
}

/**
 * Retorna o renderer.
 * @returns {THREE.WebGLRenderer}
 */
export function getRenderer() {
    return renderer;
}

/**
 * Retorna os controles de orbita.
 * @returns {OrbitControls}
 */
export function getControls() {
    return controls;
}

/**
 * Retorna o grupo de elementos.
 * @returns {THREE.Group}
 */
export function getElementsGroup() {
    return elementsGroup;
}

/**
 * Retorna o grupo de handles de edição.
 * @returns {THREE.Group}
 */
export function getEditHandlesGroup() {
    return editHandlesGroup;
}

/**
 * Retorna o grupo de superfícies interpoladas.
 * @returns {THREE.Group}
 */
export function getInterpolationGroup() {
    return interpolationGroup;
}

/**
 * Retorna o grupo de volumes voxelizados.
 * @returns {THREE.Group}
 */
export function getVoxelGroup() {
    return voxelGroup;
}

/**
 * Retorna o grupo de marcadores de issues 3D.
 * @returns {THREE.Group}
 */
export function getIssuesGroup() {
    return issuesGroup;
}

// ----------------------------------------------------------------
// FUNCOES DE REDIMENSIONAMENTO
// ----------------------------------------------------------------

/**
 * Ajusta camera e renderer quando a janela muda de tamanho.
 * Deve ser chamada no evento window.resize.
 *
 * @param {HTMLElement} container - Container do canvas
 */
export function handleResize(container) {
    if (!container) return;

    const width = container.clientWidth || 0;
    const height = container.clientHeight || 0;
    if (width <= 0 || height <= 0) return;

    // Panel/layout modules can trigger resize before initScene() finishes.
    // Ignore safely until camera/renderer are ready.
    if (!camera || !renderer) {
        if (!_resizePendingSceneWarned) {
            _resizePendingSceneWarned = true;
            console.warn('[scene] Ignoring resize before scene initialization is complete');
        }
        return;
    }

    _resizePendingSceneWarned = false;
    const aspect = container.clientWidth / container.clientHeight;
    const frustum = 100;

    // Atualiza limites da camera
    camera.left = (-frustum * aspect) / 2;
    camera.right = (frustum * aspect) / 2;
    camera.top = frustum / 2;
    camera.bottom = -frustum / 2;
    camera.updateProjectionMatrix();

    // Atualiza tamanho do renderer
    renderer.setSize(width, height);

    // Propaga resize para hooks (CSS2DRenderer, etc.)
    for (const hook of _resizeHooks) hook(width, height);

    // ECBT01: Redesenha apos redimensionamento
    requestRender();
}

// ----------------------------------------------------------------
// RENDER-ON-DEMAND + SMART PAUSE (ECBT01/ECBT02)
// ----------------------------------------------------------------

/**
 * Flag indicando que a cena precisa ser redesenhada.
 * Apenas renderiza quando algo muda (interacao, dados, animacao).
 */
let _needsRender = true;
let _animationId = null;

/**
 * Smart pause state.
 * Quando a camera para de se mover e nada precisa renderizar,
 * o loop de animacao pausa para economizar CPU.
 */
let _idleFrames = 0;
let _loopRunning = true;
const IDLE_THRESHOLD = 90; // ~1.5s a 60fps antes de pausar
const PERF_DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('ecbyts-perf-debug') === 'true';

// Camera position snapshot para detectar movimento (damping)
let _snapshotInitialized = false;

/**
 * Solicita um redesenho da cena no proximo frame.
 * Automaticamente acorda o loop se estiver pausado.
 */
export function requestRender() {
    _needsRender = true;
    wakeRenderLoop();
}

/**
 * Wake the render loop if paused.
 * Chamado por interacoes do usuario, requestRender(), ou visibilitychange.
 *
 * Chama animate() diretamente para renderizar sem delay (~0ms vs ~16ms do rAF).
 * Isso funciona porque o OrbitControls registra seus listeners no construtor
 * (antes dos nossos), entao zoom/pan ja foram aplicados a camera quando
 * nosso listener roda.
 */
export function wakeRenderLoop() {
    if (_loopRunning) return;
    _loopRunning = true;
    _idleFrames = 0;
    _needsRender = true; // Garante render no primeiro frame apos wake
    getPerfMonitor().setLoopRunning(true);
    animate();
}

/**
 * Loop de animacao com render-on-demand e smart pause.
 * Roda a 60fps durante interacao, mas pausa automaticamente apos
 * ~1.5s de inatividade (camera parada + nada para renderizar).
 */
export function animate() {
    if (!_loopRunning) return;
    _animationId = requestAnimationFrame(animate);

    const perf = getPerfMonitor();
    perf.tickFrame();

    // Atualiza controles (necessario para damping funcionar)
    if (controls) {
        // Snapshot posicao ANTES do controls.update()
        const bpx = camera.position.x,
            bpy = camera.position.y,
            bpz = camera.position.z;
        const btx = controls.target.x,
            bty = controls.target.y,
            btz = controls.target.z;
        const bzoom = camera.zoom; // OrthographicCamera: zoom nao muda position

        controls.update();

        // Detecta se controls.update() moveu a camera (damping, pan, zoom)
        const epsilon = 0.0001;
        const moved =
            _snapshotInitialized &&
            (Math.abs(camera.position.x - bpx) > epsilon ||
                Math.abs(camera.position.y - bpy) > epsilon ||
                Math.abs(camera.position.z - bpz) > epsilon ||
                Math.abs(controls.target.x - btx) > epsilon ||
                Math.abs(controls.target.y - bty) > epsilon ||
                Math.abs(controls.target.z - btz) > epsilon ||
                Math.abs(camera.zoom - bzoom) > epsilon);
        _snapshotInitialized = true;

        if (moved) {
            _needsRender = true;
            _idleFrames = 0;
            // Recalcula near/far para evitar clipping ao rotacionar
            _syncNearFar();
        } else {
            _idleFrames++;
        }
    }

    // Renderiza apenas se necessario (dirty flag)
    if (_needsRender && renderer && scene && camera) {
        const rt0 = performance.now();
        renderer.render(scene, camera);
        // Render hooks (CSS2DRenderer labels, etc.)
        for (const hook of _renderHooks) hook(scene, camera);
        const rdt = performance.now() - rt0;
        perf.tickRender();
        if (PERF_DEBUG && rdt > 16) {
            const info = renderer.info.render;
            console.warn(
                `[Render] ${rdt.toFixed(1)}ms — calls:${info.calls} tris:${info.triangles} lines:${info.lines} pts:${info.points}`,
            );
        }
        _needsRender = false;
        _idleFrames = 0; // Reset idle — acabamos de renderizar
    }

    perf.setIdleFrames(_idleFrames);

    // ECBT02: Smart pause — para o loop apos inatividade prolongada
    if (_idleFrames > IDLE_THRESHOLD) {
        _loopRunning = false;
        cancelAnimationFrame(_animationId);
        perf.setLoopRunning(false);
    }
}
