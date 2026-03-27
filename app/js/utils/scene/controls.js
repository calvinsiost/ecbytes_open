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
   CONTROLES DE VISUALIZACAO
   ================================================================

   Este modulo gerencia as vistas e zoom da cena 3D.

   FUNCIONALIDADES:
   - Vistas pre-definidas (isometrica, topo, frontal)
   - Controle de zoom
   - Reset de visualizacao

   SISTEMA DE COORDENADAS:
   - X: leste-oeste (positivo = leste)
   - Y: cima-baixo (positivo = cima)
   - Z: norte-sul (positivo = sul)

   A camera ortografica nao tem perspectiva:
   - Objetos distantes tem o mesmo tamanho dos proximos
   - Ideal para visualizacao tecnica/engenharia
   - Linhas paralelas permanecem paralelas

   ================================================================ */

import { getCamera, getControls, getScene, requestRender, setModelExtent } from './setup.js';
import { getAllElements, getElementById } from '../../core/elements/manager.js';
import { getElementPosition } from '../../core/io/geo/coordinates.js';

// ECBT01: Objetos reutilizaveis para evitar GC jank em loops
const _tempPos = { x: 0, y: 0, z: 0 };

// ----------------------------------------------------------------
// VIEW MODE — Alternância 2D/3D
// ----------------------------------------------------------------

let _viewMode = '3d'; // '3d' | '2d' | '2d-depth'
let _saved3DState = null; // Estado da câmera 3D salvo para restauração

// ----------------------------------------------------------------
// HELPER: NEAR/FAR PLANES
// ----------------------------------------------------------------

/**
 * Ajusta near e far planes da camera ortografica.
 * Garante que todo o modelo fique dentro do frustum ao rotacionar.
 * Propaga extent para setup.js via setModelExtent() para recalculo
 * continuo no animate loop.
 *
 * @param {THREE.OrthographicCamera} camera
 * @param {number} camDist - Distancia da camera ao target
 * @param {number} extent  - Extensao do modelo (maior dimensao)
 */
function _updateCameraPlanes(camera, camDist, extent) {
    setModelExtent(extent);
    const radius = extent * 1.5; // margem de seguranca
    camera.near = Math.max(0.1, camDist - radius);
    camera.far = Math.max(1000, camDist + radius);
    camera.updateProjectionMatrix();
}

// ----------------------------------------------------------------
// CONFIGURACAO DE VISTAS
// ----------------------------------------------------------------

/**
 * Configuracoes das vistas pre-definidas.
 * Cada vista define posicao da camera e ponto de foco.
 */
const VIEW_PRESETS = {
    /**
     * Vista isometrica (3D diagonal).
     * Permite ver tres faces do objeto ao mesmo tempo.
     * Camera posicionada em diagonal (X=Y=Z).
     */
    isometric: {
        camera: { x: 80, y: 80, z: 80 },
        target: { x: 0, y: -20, z: 0 },
    },

    /**
     * Vista de topo (planta baixa).
     * Camera olhando de cima para baixo.
     * Util para ver distribuicao horizontal.
     */
    top: {
        camera: { x: 0, y: 150, z: 0 },
        target: { x: 0, y: -20, z: 0 },
    },

    /**
     * Vista frontal (corte).
     * Camera olhando de frente (sul para norte).
     * Util para ver profundidade/estratigrafia.
     */
    front: {
        camera: { x: 0, y: -20, z: 150 },
        target: { x: 0, y: -20, z: 0 },
    },
};

/**
 * Limites de zoom.
 */
const ZOOM_LIMITS = {
    min: 0.05, // Maximo afastado (ve mais area)
    max: 4, // Maximo aproximado (ve detalhes)
    step: 1.2, // Fator de incremento por clique
};

// ----------------------------------------------------------------
// FUNCOES DE VISTA
// ----------------------------------------------------------------

/**
 * Define vista isometrica (3D diagonal).
 * Esta e a vista padrao que mostra o modelo em perspectiva 3D.
 */
export function setIsometricView() {
    applyViewPreset('isometric');
}

/**
 * Define vista de topo (planta).
 * Camera posicionada bem acima, olhando para baixo.
 */
export function setTopView() {
    applyViewPreset('top');
}

/**
 * Define vista frontal (corte).
 * Camera posicionada na frente, olhando para o centro.
 */
export function setFrontView() {
    applyViewPreset('front');
}

/**
 * Calcula centroide e extensao de todos os elementos no modelo.
 * Retorna target e distancia otima para enquadrar tudo.
 *
 * @returns {{ center: {x,y,z}, extent: number }|null}
 */
function computeElementsBounds() {
    const elements = getAllElements();
    if (elements.length === 0) return null;

    let minX = Infinity,
        maxX = -Infinity;
    let minY = Infinity,
        maxY = -Infinity;
    let minZ = Infinity,
        maxZ = -Infinity;

    for (const el of elements) {
        // ECBT01: Reutiliza objeto temporario (evita alocacao por iteracao)
        const pos = getElementPosition(el);
        _tempPos.x = pos.x;
        _tempPos.y = pos.y;
        _tempPos.z = pos.z;
        if (_tempPos.x < minX) minX = _tempPos.x;
        if (_tempPos.x > maxX) maxX = _tempPos.x;
        if (_tempPos.y < minY) minY = _tempPos.y;
        if (_tempPos.y > maxY) maxY = _tempPos.y;
        if (_tempPos.z < minZ) minZ = _tempPos.z;
        if (_tempPos.z > maxZ) maxZ = _tempPos.z;

        // Inclui extensao real de boundaries (vertices) e rios/paths
        const d = el.data || {};
        const verts = d.vertices || d.path;
        if (verts && verts.length > 0) {
            for (const v of verts) {
                if (v.x < minX) minX = v.x;
                if (v.x > maxX) maxX = v.x;
                if ((v.y || 0) < minY) minY = v.y || 0;
                if ((v.y || 0) > maxY) maxY = v.y || 0;
                if (v.z < minZ) minZ = v.z;
                if (v.z > maxZ) maxZ = v.z;
            }
        }
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const dx = maxX - minX;
    const dz = maxZ - minZ;
    const extent = Math.max(dx, dz, 60); // Minimo 60 para nao ficar zoom excessivo

    return { center: { x: cx, y: cy, z: cz }, extent };
}

/**
 * Aplica uma configuracao de vista pre-definida.
 * Centraliza no centroide dos elementos quando existem.
 *
 * @param {string} presetName - Nome da vista ('isometric', 'top', 'front')
 */
function applyViewPreset(presetName) {
    const preset = VIEW_PRESETS[presetName];
    if (!preset) {
        console.warn(`Vista desconhecida: ${presetName}`);
        return;
    }

    const camera = getCamera();
    const controls = getControls();

    if (!camera || !controls) {
        console.warn('Camera ou controles nao inicializados');
        return;
    }

    // Calcula centroide dos elementos para centralizar a vista
    const bounds = computeElementsBounds();
    const target = bounds
        ? { x: bounds.center.x, y: Math.min(bounds.center.y, -5), z: bounds.center.z }
        : preset.target;

    // Calcula offset da camera relativo ao target
    const offset = {
        x: preset.camera.x - preset.target.x,
        y: preset.camera.y - preset.target.y,
        z: preset.camera.z - preset.target.z,
    };

    // Escala offset para enquadrar elementos (normaliza e multiplica pela extensao)
    const offsetLen = Math.sqrt(offset.x * offset.x + offset.y * offset.y + offset.z * offset.z) || 1;
    const scale = bounds ? Math.max(bounds.extent, 60) / offsetLen : 1;

    // Define ponto de foco (ANTES de posicionar camera)
    controls.target.set(target.x, target.y, target.z);

    // Move camera e aponta para o target
    camera.position.set(target.x + offset.x * scale, target.y + offset.y * scale, target.z + offset.z * scale);
    camera.lookAt(target.x, target.y, target.z);

    // Ajusta zoom e far plane para enquadrar elementos
    if (bounds) {
        camera.zoom = Math.max(0.05, Math.min(2, 60 / bounds.extent));
        // Atualiza far plane para cenas grandes (camera pode estar muito longe)
        const camDist = Math.sqrt(
            Math.pow(camera.position.x - target.x, 2) +
                Math.pow(camera.position.y - target.y, 2) +
                Math.pow(camera.position.z - target.z, 2),
        );
        _updateCameraPlanes(camera, camDist, bounds.extent);

        // Escala fog para cenas grandes (evita objetos ficarem invisiveis)
        const scene = getScene();
        if (scene && scene.fog) {
            scene.fog.near = Math.max(150, camDist * 0.8);
            scene.fog.far = Math.max(400, camDist * 2 + bounds.extent);
        }
    }

    // Desabilita damping temporariamente para aplicar posicao imediatamente
    const wasDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = wasDamping;
    requestRender();
}

/**
 * Enquadra todos os elementos na vista atual.
 * Recalcula target e zoom para mostrar todos os objetos.
 */
export function fitAllElements() {
    const camera = getCamera();
    const controls = getControls();
    if (!camera || !controls) return;

    const bounds = computeElementsBounds();
    if (!bounds) return;

    const target = { x: bounds.center.x, y: Math.min(bounds.center.y, -5), z: bounds.center.z };

    // Mantem direcao atual da camera, recentra no target
    const dir = {
        x: camera.position.x - controls.target.x,
        y: camera.position.y - controls.target.y,
        z: camera.position.z - controls.target.z,
    };
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
    const scale = Math.max(bounds.extent, 60);

    camera.position.set(
        target.x + (dir.x / len) * scale,
        target.y + (dir.y / len) * scale,
        target.z + (dir.z / len) * scale,
    );

    controls.target.set(target.x, target.y, target.z);

    camera.zoom = Math.max(0.05, Math.min(2, 60 / bounds.extent));
    // Atualiza far plane para cenas grandes
    const camDist = Math.sqrt(
        Math.pow(camera.position.x - target.x, 2) +
            Math.pow(camera.position.y - target.y, 2) +
            Math.pow(camera.position.z - target.z, 2),
    );
    _updateCameraPlanes(camera, camDist, bounds.extent);

    // Escala fog para cenas grandes (evita objetos ficarem invisiveis)
    const scene = getScene();
    if (scene && scene.fog) {
        scene.fog.near = Math.max(150, camDist * 0.8);
        scene.fog.far = Math.max(400, camDist * 2 + bounds.extent);
    }

    const wasDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = wasDamping;
    requestRender();
}

// ----------------------------------------------------------------
// FUNCOES DE ZOOM
// ----------------------------------------------------------------

/**
 * Aumenta o zoom (aproxima).
 * Cada clique aproxima um pouco mais.
 *
 * COMO FUNCIONA:
 * - Multiplica zoom atual pelo fator de incremento
 * - Limita ao zoom maximo configurado
 * - Atualiza matriz de projecao da camera
 */
export function zoomIn() {
    const camera = getCamera();
    if (!camera) return;

    // Aumenta zoom, mas nao passa do maximo
    camera.zoom = Math.min(camera.zoom * ZOOM_LIMITS.step, ZOOM_LIMITS.max);

    // Atualiza projecao (necessario para camera ortografica)
    camera.updateProjectionMatrix();
    requestRender();
}

/**
 * Diminui o zoom (afasta).
 * Cada clique afasta um pouco mais.
 *
 * COMO FUNCIONA:
 * - Divide zoom atual pelo fator de incremento
 * - Limita ao zoom minimo configurado
 */
export function zoomOut() {
    const camera = getCamera();
    if (!camera) return;

    // Diminui zoom, mas nao passa do minimo
    camera.zoom = Math.max(camera.zoom / ZOOM_LIMITS.step, ZOOM_LIMITS.min);

    camera.updateProjectionMatrix();
    requestRender();
}

/**
 * Reseta a visualizacao para o padrao.
 * Volta para vista isometrica centralizada nos elementos.
 *
 * Util quando o usuario se "perde" na navegacao 3D.
 */
export function resetView() {
    setIsometricView();
}

// ----------------------------------------------------------------
// FUNCOES DE CONSULTA
// ----------------------------------------------------------------

/**
 * Retorna estado atual da camera.
 * Util para salvar/restaurar visualizacao.
 *
 * @returns {Object} - Posicao, zoom e target atuais
 */
export function getCameraState() {
    const camera = getCamera();
    const controls = getControls();

    if (!camera || !controls) {
        return null;
    }

    return {
        camera: {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            zoom: camera.zoom,
        },
        target: {
            x: controls.target.x,
            y: controls.target.y,
            z: controls.target.z,
        },
    };
}

/**
 * Restaura estado da camera a partir de dados salvos.
 *
 * @param {Object} state - Estado a restaurar (de getCameraState)
 */
export function setCameraState(state) {
    if (!state) return;

    const camera = getCamera();
    const controls = getControls();

    if (!camera || !controls) return;

    // Restaura posicao
    if (state.camera) {
        camera.position.set(state.camera.x, state.camera.y, state.camera.z);
        camera.zoom = state.camera.zoom || 1;
        camera.updateProjectionMatrix();
    }

    // Restaura target
    if (state.target) {
        controls.target.set(state.target.x, state.target.y, state.target.z);
    }

    controls.update();
    requestRender();
}

/**
 * Animate camera smoothly from current state to target state.
 * Interpola posicao, zoom e target ao longo do tempo especificado.
 *
 * @param {Object} targetState - Target state from getCameraState()
 * @param {number} durationMs - Animation duration in milliseconds (default 500)
 * @returns {Promise<void>} Resolves when animation completes
 */
export function animateCameraState(targetState, durationMs = 500) {
    return new Promise((resolve) => {
        if (!targetState) {
            resolve();
            return;
        }

        const camera = getCamera();
        const controls = getControls();
        if (!camera || !controls) {
            resolve();
            return;
        }

        const startState = getCameraState();
        const startTime = performance.now();

        function step(now) {
            const elapsed = now - startTime;
            const t = Math.min(1, elapsed / durationMs);
            // Ease-out cubic: desacelera no final para transicao suave
            const ease = 1 - Math.pow(1 - t, 3);

            camera.position.set(
                startState.camera.x + (targetState.camera.x - startState.camera.x) * ease,
                startState.camera.y + (targetState.camera.y - startState.camera.y) * ease,
                startState.camera.z + (targetState.camera.z - startState.camera.z) * ease,
            );
            camera.zoom = startState.camera.zoom + (targetState.camera.zoom - startState.camera.zoom) * ease;
            camera.updateProjectionMatrix();

            controls.target.set(
                startState.target.x + (targetState.target.x - startState.target.x) * ease,
                startState.target.y + (targetState.target.y - startState.target.y) * ease,
                startState.target.z + (targetState.target.z - startState.target.z) * ease,
            );
            controls.update();
            requestRender();

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(step);
    });
}

// ----------------------------------------------------------------
// ZOOM TO ELEMENT / FAMILY
// ----------------------------------------------------------------

/**
 * Anima camera ate centralizar em um elemento especifico.
 * Mantem direcao atual da camera, ajusta target e zoom.
 *
 * @param {string} elementId - ID do elemento
 */
export function zoomToElement(elementId) {
    const { getElementById } = require_getElementById();
    const element = getElementById(elementId);
    if (!element) return;

    const camera = getCamera();
    const controls = getControls();
    if (!camera || !controls) return;

    const pos = getElementPosition(element);
    const targetY = Math.min(pos.y, -2);

    // Mantem direcao relativa da camera, move target para o elemento
    const dir = {
        x: camera.position.x - controls.target.x,
        y: camera.position.y - controls.target.y,
        z: camera.position.z - controls.target.z,
    };

    const targetState = {
        camera: {
            x: pos.x + dir.x * 0.3,
            y: targetY + dir.y * 0.3,
            z: pos.z + dir.z * 0.3,
            zoom: 1.5,
        },
        target: { x: pos.x, y: targetY, z: pos.z },
    };

    // Ajusta fog e far plane para o destino
    const scene = getScene();
    if (scene && scene.fog) {
        scene.fog.near = 150;
        scene.fog.far = 400;
    }
    const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    _updateCameraPlanes(camera, Math.max(dirLen * 0.3, 200), 200);

    animateCameraState(targetState, 600);
}

/**
 * Anima camera para enquadrar todos os elementos de uma familia.
 * Similar a fitAllElements mas filtrado por familia.
 *
 * @param {string} familyId - ID da familia
 */
export function zoomToFamily(familyId) {
    const elements = getAllElements().filter((el) => el.family === familyId && el.visible !== false);
    if (elements.length === 0) return;

    const camera = getCamera();
    const controls = getControls();
    if (!camera || !controls) return;

    // Calcula bounding box dos elementos da familia
    let minX = Infinity,
        maxX = -Infinity;
    let minY = Infinity,
        maxY = -Infinity;
    let minZ = Infinity,
        maxZ = -Infinity;

    for (const el of elements) {
        const pos = getElementPosition(el);
        if (pos.x < minX) minX = pos.x;
        if (pos.x > maxX) maxX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.y > maxY) maxY = pos.y;
        if (pos.z < minZ) minZ = pos.z;
        if (pos.z > maxZ) maxZ = pos.z;
    }

    const cx = (minX + maxX) / 2;
    const cy = Math.min((minY + maxY) / 2, -2);
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxZ - minZ, 30);

    // Mantem direcao da camera
    const dir = {
        x: camera.position.x - controls.target.x,
        y: camera.position.y - controls.target.y,
        z: camera.position.z - controls.target.z,
    };
    const len = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2) || 1;
    const scale = extent / len;

    const targetState = {
        camera: {
            x: cx + dir.x * scale,
            y: cy + dir.y * scale,
            z: cz + dir.z * scale,
            zoom: Math.max(0.1, Math.min(2, 60 / extent)),
        },
        target: { x: cx, y: cy, z: cz },
    };

    // Ajusta fog e far plane
    const camDist = extent * scale;
    const scene = getScene();
    if (scene && scene.fog) {
        scene.fog.near = Math.max(150, camDist * 0.8);
        scene.fog.far = Math.max(400, camDist * 2 + extent);
    }
    _updateCameraPlanes(camera, camDist, extent);

    animateCameraState(targetState, 600);
}

// ----------------------------------------------------------------
// VIEW MODE — Toggle 2D/3D
// ----------------------------------------------------------------

/**
 * Retorna o modo de visualização atual.
 * @returns {'2d'|'3d'}
 */
export function getViewMode() {
    return _viewMode;
}

/**
 * Cicla entre modos: actions -> 2d -> 2d-depth -> 3d -> actions.
 * Salva preferência em localStorage.
 */
export function toggleViewMode() {
    // Delega para viewRouter como fonte unica de verdade
    // Cicla entre modos: actions -> 2d -> 2d-depth -> 3d -> actions
    import('./viewRouter.js')
        .then(({ switchView, getCurrentView }) => {
            const cycle = { actions: '2d', '2d': '2d-depth', '2d-depth': '3d', '3d': 'actions' };
            const current = getCurrentView();
            const next = cycle[current] || 'actions';
            switchView(next);
        })
        .catch(() => {
            // Fallback se viewRouter nao disponivel
            const cycle = { '3d': '2d', '2d': '2d-depth', '2d-depth': '3d' };
            _viewMode = cycle[_viewMode] || '3d';
            applyViewMode();
            try {
                localStorage.setItem('ecbyts-view-mode', _viewMode);
            } catch (_) {
                /* quota */
            }
        });
}

/**
 * Define o modo de visualização explicitamente.
 * @param {'3d'|'2d'|'2d-depth'} mode
 */
export function setViewMode(mode) {
    if (mode !== '3d' && mode !== '2d' && mode !== '2d-depth') return;
    if (mode === _viewMode) return;
    _viewMode = mode;
    applyViewMode();
    try {
        localStorage.setItem('ecbyts-view-mode', _viewMode);
    } catch (_) {
        /* quota */
    }
}

/**
 * Restaura o modo de visualização salvo no localStorage.
 * Chamar após initScene() / initCompass() / initGlobe().
 */
export function restoreViewMode() {
    const savedFromRouter = localStorage.getItem('ecbyts-default-view');
    const savedLegacy = localStorage.getItem('ecbyts-view-mode');
    const saved =
        savedFromRouter === '2d' || savedFromRouter === '2d-depth' || savedFromRouter === '3d'
            ? savedFromRouter
            : savedLegacy;
    if (saved === '2d' || saved === '2d-depth') {
        _viewMode = saved;
        applyViewMode();
    }
    updateViewModeButton();
}

/**
 * Aplica o modo de visualização atual.
 * 3D: órbita livre, restaura estado anterior.
 * 2D: trava rotação, câmera top-down (planta), apenas pan/zoom.
 * 2D-depth: trava rotação, câmera frontal (seção/corte), apenas pan/zoom.
 */
function applyViewMode() {
    const controls = getControls();
    const camera = getCamera();
    if (!controls || !camera) return;

    switch (_viewMode) {
        case '2d':
            if (!_saved3DState) _saved3DState = getCameraState();
            controls.enableRotate = false;
            controls.minPolarAngle = 0;
            controls.maxPolarAngle = 0;
            setTopView();
            break;

        case '2d-depth':
            if (!_saved3DState) _saved3DState = getCameraState();
            controls.enableRotate = false;
            controls.minPolarAngle = Math.PI / 2;
            controls.maxPolarAngle = Math.PI / 2;
            setFrontView();
            break;

        default: // '3d'
            controls.enableRotate = true;
            controls.minPolarAngle = 0;
            controls.maxPolarAngle = Math.PI;
            if (_saved3DState) {
                animateCameraState(_saved3DState, 400);
                _saved3DState = null;
            } else {
                setIsometricView();
            }
            break;
    }

    updateViewModeButton();
    window.dispatchEvent(new CustomEvent('viewModeChanged', { detail: { mode: _viewMode } }));
    requestRender();
}

/**
 * Atualiza o visual dos botões de toggle e o badge indicador de modo.
 */
function updateViewModeButton() {
    const labels = { '3d': '3D', '2d': '2D', '2d-depth': '2D+D' };
    const modeLabel = labels[_viewMode] || '3D';
    const isActive = _viewMode !== '3d';

    // Botão no view-controls
    const label = document.getElementById('view-mode-label');
    const btn = document.getElementById('view-mode-toggle');
    if (label) label.textContent = modeLabel;
    if (btn) btn.classList.toggle('active', isActive);

    // Botão no ribbon
    const ribbonLabel = document.getElementById('ribbon-view-mode-label');
    const ribbonBtn = document.getElementById('ribbon-view-mode-btn');
    if (ribbonLabel) ribbonLabel.textContent = modeLabel;
    if (ribbonBtn) ribbonBtn.classList.toggle('active', isActive);

    // Badge global e estado de roteamento ficam sob controle exclusivo de viewRouter.js.
}

// Wrapper para manter API compativel com chamadas existentes
function require_getElementById() {
    return { getElementById };
}
