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
   FABRICA DE OBJETOS 3D (MESH FACTORY)
   ================================================================

   Este modulo cria os objetos 3D para cada tipo de elemento.

   PADRAO DE PROJETO: Factory (Fabrica)
   - Um ponto central para criar objetos de diferentes tipos
   - Facilita adicionar novos tipos sem mudar outros codigos
   - Mantem a logica de criacao organizada

   TIPOS DE ELEMENTOS:
   - Pluma: esfera achatada (elipsoide) semi-transparente
   - Poco: cilindro vertical (tubo) ou perfil detalhado com litologia
   - Marcador: esfera solida colorida

   NOVO: Well Profile 3D
   - Quando element.data.profile existe, agenda construcao assincrona
   - Cilindro base eh criado sincronamente (feedback imediato)
   - Profile detalhado (textura litologica + revestimento) substitui depois

   CONCEITOS 3D:
   - Mesh = Geometria + Material
   - Geometria = forma (esfera, cubo, cilindro)
   - Material = aparencia (cor, transparencia, brilho)

   ================================================================ */

import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { requestRender } from '../../utils/scene/setup.js';
import { parseColor, normalizeUVs, applyRotationDegrees, DEG2RAD } from './meshHelpers.js';
import { createSpriteBillboard } from './spriteFactory.js';
import {
    createAreaMesh,
    createIndividualMesh,
    createIncidentMesh,
    createEmissionSourceMesh,
    createWasteStreamMesh,
    createEffluentPointMesh,
    createHabitatMesh,
} from './meshESG.js';

// ----------------------------------------------------------------
// ECBT01: CACHE DE GEOMETRIAS E MATERIAIS
// Evita duplicacao de recursos GPU (VRAM) reutilizando instancias.
// ----------------------------------------------------------------

/** Cache de geometrias unitarias (1x1x1), dimensionadas via mesh.scale */
const _geometryCache = new Map();

/** Cache de materiais por chave composta (cor+transparencia+opacidade+tipo) */
const _materialCache = new Map();

/**
 * Retorna geometria do cache ou cria e armazena.
 * @param {string} key - Identificador unico do tipo de geometria
 * @param {Function} factory - Funcao que cria a geometria se nao existir
 * @returns {THREE.BufferGeometry}
 */
export function getCachedGeometry(key, factory) {
    if (!_geometryCache.has(key)) {
        const geom = factory();
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
        _geometryCache.set(key, geom);
    }
    return _geometryCache.get(key);
}

/**
 * Retorna material do cache ou cria e armazena.
 * @param {string} key - Chave composta (cor_transparent_opacity_type)
 * @param {Function} factory - Funcao que cria o material se nao existir
 * @returns {THREE.Material}
 */
export function getCachedMaterial(key, factory) {
    if (!_materialCache.has(key)) {
        _materialCache.set(key, factory());
    }
    return _materialCache.get(key);
}

// ----------------------------------------------------------------
// FUNCAO PRINCIPAL (FACTORY)
// ----------------------------------------------------------------

/**
 * Cria o mesh 3D apropriado para um elemento.
 * Esta e a funcao principal - decide qual tipo criar.
 *
 * @param {Object} element - Dados do elemento
 * @param {string} element.family - Tipo do elemento ('plume', 'well', etc)
 * @param {Object} element.data - Dados especificos do elemento
 * @returns {THREE.Mesh|null} - Objeto 3D criado ou null se tipo desconhecido
 *
 * EXEMPLO:
 *   const mesh = createMesh({
 *     family: 'plume',
 *     data: {
 *       depth: { level: 'shallow' },
 *       shape: { radiusX: 10, radiusY: 8, radiusZ: 4 },
 *       center: { x: 0, y: -7.5, z: 0 }
 *     }
 *   });
 */
/**
 * Disposes a mesh and its resources to free GPU memory.
 * @param {THREE.Mesh} mesh - The mesh to dispose
 */
export function disposeMesh(mesh) {
    if (!mesh) return;

    // Dispose geometry
    if (mesh.geometry) {
        mesh.geometry.dispose();
    }

    // Dispose material(s)
    if (mesh.material) {
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
        } else {
            mesh.material.dispose();
        }
    }

    // Remove references
    mesh.clear();
}

/**
 * Updates a mesh's properties (position, scale, rotation, color).
 * Atualiza propriedades de um mesh (posicao, escala, rotacao, cor).
 *
 * @param {THREE.Mesh} mesh - The mesh to update
 * @param {Object} options - Properties to update
 * @param {Object} options.position - Position {x, y, z}
 * @param {Object} options.scale - Scale {x, y, z}
 * @param {Object} options.rotation - Rotation {x, y, z} in degrees
 * @param {number|string} options.color - Color value
 */
export function updateMesh(mesh, options = {}) {
    if (!mesh) return;

    if (options.position) {
        mesh.position.set(
            options.position.x ?? mesh.position.x,
            options.position.y ?? mesh.position.y,
            options.position.z ?? mesh.position.z,
        );
    }

    if (options.scale) {
        mesh.scale.set(
            options.scale.x ?? mesh.scale.x,
            options.scale.y ?? mesh.scale.y,
            options.scale.z ?? mesh.scale.z,
        );
    }

    if (options.rotation) {
        mesh.rotation.x = (options.rotation.x ?? mesh.rotation.x * (180 / Math.PI)) * (Math.PI / 180);
        mesh.rotation.y = (options.rotation.y ?? mesh.rotation.y * (180 / Math.PI)) * (Math.PI / 180);
        mesh.rotation.z = (options.rotation.z ?? mesh.rotation.z * (180 / Math.PI)) * (Math.PI / 180);
    }

    if (options.color !== undefined && mesh.material) {
        const color = parseColor(options.color);
        if (color !== null) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach((m) => m.color.setHex(color));
            } else {
                mesh.material.color.setHex(color);
            }
        }
    }

    requestRender();
}

/**
 * Loads an overlay texture from a URL and applies it to a material.
 * Carrega uma textura de overlay a partir de uma URL e aplica a um material.
 *
 * @param {string[]} urls - Array of URLs to try (for fallback)
 * @param {THREE.Material} material - The material to apply the texture to
 * @returns {Promise<THREE.Texture|null>}
 */
export function loadOverlayTexture(urls, material) {
    return new Promise((resolve, reject) => {
        if (!urls || urls.length === 0) {
            reject(new Error('No URLs provided'));
            return;
        }

        const loader = new THREE.TextureLoader();
        let urlIndex = 0;

        function tryLoad() {
            if (urlIndex >= urls.length) {
                reject(new Error('All URLs failed to load'));
                return;
            }

            const url = urls[urlIndex++];
            loader.load(
                url,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    if (material) {
                        material.map = texture;
                        material.needsUpdate = true;
                    }
                    requestRender();
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.warn(`[meshFactory] Failed to load texture from ${url}:`, error);
                    tryLoad();
                },
            );
        }

        tryLoad();
    });
}

export function createMesh(element) {
    const { family, data } = element;

    // Escolhe o criador baseado no tipo
    switch (family) {
        case 'plume':
            return createPlumeMesh(data, element);

        case 'well':
            return createWellMesh(data, element);

        case 'marker':
            return createMarkerMesh(data, element);

        case 'lake':
            return createLakeMesh(data, element);

        case 'river':
            return createRiverMesh(data, element);

        case 'building':
            return createBuildingMesh(data, element);

        case 'tank':
            return createTankMesh(data, element);

        case 'boundary':
            return createBoundaryMesh(data, element);

        case 'stratum':
            return createStratumMesh(data, element);

        case 'spring':
            return createSpringMesh(data, element);

        case 'sample':
            return createSampleMesh(data, element);

        // === NOVAS FAMILIAS ESG ===
        case 'area':
            return createAreaMesh(data, element);

        case 'individual':
            return createIndividualMesh(data, element);

        case 'incident':
            return createIncidentMesh(data, element);

        case 'emission_source':
            return createEmissionSourceMesh(data, element);

        case 'waste_stream':
            return createWasteStreamMesh(data, element);

        case 'effluent_point':
            return createEffluentPointMesh(data, element);

        case 'habitat':
            return createHabitatMesh(data, element);

        // === UTILITY/GENERIC FAMILIES ===
        case 'blueprint':
            return createBlueprintMesh(data, element);

        case 'sensor':
            return createSensorMesh(data, element);

        case 'intangible':
            return createIntangibleMesh(data, element);

        case 'generic':
            return createGenericMesh(data, element);

        default:
            console.warn(`[meshFactory] Tipo de elemento desconhecido: ${family}`);
            return null;
    }
}

// ----------------------------------------------------------------
// CRIADORES ESPECIFICOS POR TIPO
// ----------------------------------------------------------------

/**
 * Cria mesh de pluma de contaminacao.
 *
 * REPRESENTACAO:
 * - Esfera achatada (elipsoide) semi-transparente
 * - Tamanho varia com a profundidade
 * - Cor varia com o nivel de contaminacao (verde → amarelo → vermelho)
 *
 * @param {Object} data - Dados da pluma
 * @param {Object} data.depth - Informacoes de profundidade
 * @param {string} data.depth.level - Nivel ('shallow', 'middle', 'deep')
 * @param {Object} data.shape - Dimensoes do elipsoide
 * @param {Object} data.center - Posicao central
 * @returns {THREE.Mesh}
 */
function createPlumeMesh(data, element) {
    /**
     * Determina cor baseado na profundidade.
     * Plumas mais rasas sao mais preocupantes (vermelho).
     */
    const depthLevel = data.depth?.level || 'shallow';
    const baseColor = CONFIG.COLORS.plume[depthLevel] || CONFIG.COLORS.plume.shallow;
    const color = parseColor(element?.color) || baseColor;

    const rx = data.shape?.radiusX || 10;
    const ry = data.shape?.radiusY || 8;
    const rz = data.shape?.radiusZ || 4;

    /**
     * Efeito de krigagem: cascas concentricas com opacidade decrescente.
     * Simula gradiente de concentracao — centro denso, bordas difusas.
     * Cada casca representa uma isossuperficie de concentracao.
     */
    const SHELLS = [
        { frac: 0.25, opacity: 0.65 }, // Nucleo (alta concentracao)
        { frac: 0.5, opacity: 0.4 }, // Zona intermediaria
        { frac: 0.75, opacity: 0.22 }, // Zona de transicao
        { frac: 1.0, opacity: 0.08 }, // Borda difusa (frente da pluma)
    ];

    const group = new THREE.Group();

    const sphereGeom = getCachedGeometry('sphere_24', () => new THREE.SphereGeometry(1, 24, 24));

    SHELLS.forEach((shell) => {
        const matKey = `std_${color}_t_${shell.opacity}_dw0`;
        const material = getCachedMaterial(
            matKey,
            () =>
                new THREE.MeshStandardMaterial({
                    color: color,
                    transparent: true,
                    opacity: shell.opacity,
                    roughness: 0.4,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                }),
        );
        const mesh = new THREE.Mesh(sphereGeom, material);
        mesh.scale.set(rx * shell.frac, rz * shell.frac, ry * shell.frac);
        group.add(mesh);
    });

    group.position.set(data.center?.x || 0, data.center?.y || -7.5, data.center?.z || 0);

    return group;
}

/**
 * Cria mesh de poco de monitoramento.
 *
 * REPRESENTACAO:
 * - Se houver profile data: agenda construcao do perfil completo
 * - Inicialmente: cilindro base que sera substituido pelo profile detalhado
 * - Fallback sem profile: cilindro cinza simples permanente
 *
 * NOTA: A construcao do profile 3D eh agendada assincronamente para nao
 * bloquear a criacao inicial do mesh.
 *
 * @param {Object} data - Dados do poco
 * @param {Object} data.coordinates - Posicao (easting, northing)
 * @param {Object} data.construction - Dados construtivos (profundidade, diametro)
 * @param {Object} element - Elemento completo (para acesso a profile)
 * @returns {THREE.Group}
 */
function createWellMesh(data, element) {
    const depth = data.construction?.totalDepth || 50;
    const radius = 0.4;

    // Cria grupo base (mesmo que nao tenha profile)
    const group = new THREE.Group();
    group.name = 'well-mesh-group';

    // Cilindro base (sempre presente inicialmente)
    const geometry = getCachedGeometry('cyl_16', () => new THREE.CylinderGeometry(1, 1, 1, 16));
    const wellColor = parseColor(element?.color) || 0x555555;
    const matKey = `std_${wellColor}_o_1`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: wellColor,
                roughness: 0.5,
            }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'well-base-cylinder';
    mesh.scale.set(radius, depth, radius);
    mesh.position.set(0, -depth / 2, 0);
    group.add(mesh);

    // Se houver profile, agenda atualizacao assincrona
    if (element?.data?.profile?.lithologic || element?.data?.profile?.constructive) {
        group.userData.hasProfile = true;
        group.userData.elementData = element;
        group.userData.depth = depth;

        // Agenda construcao do profile 3D (nao bloqueia)
        scheduleProfileBuild(group, element);
    }

    // Posiciona grupo na coordenada do poco
    group.position.set(data.coordinates?.easting || 0, 0, data.coordinates?.northing || 0);

    return group;
}

/**
 * Agenda a construcao assincrona do profile 3D.
 * Nao bloqueia a criacao inicial do mesh.
 */
function scheduleProfileBuild(group, element) {
    // Usa requestIdleCallback se disponivel, senao setTimeout
    const schedule = typeof requestIdleCallback !== 'undefined' ? requestIdleCallback : (cb) => setTimeout(cb, 50);

    schedule(async () => {
        try {
            const profileModule = await import('./families/well/wellProfile3D.js');
            const profileGroup = profileModule.createWellProfile3D(element);

            if (profileGroup && group.parent) {
                // Remove cilindro base
                const baseCylinder = group.getObjectByName('well-base-cylinder');
                if (baseCylinder) {
                    group.remove(baseCylinder);
                    baseCylinder.geometry.dispose();
                    baseCylinder.material.dispose();
                }

                // Adiciona filhos do profile
                while (profileGroup.children.length > 0) {
                    group.add(profileGroup.children[0]);
                }

                // Marca como atualizado
                group.userData.profileBuilt = true;

                // Dispara evento para atualizacao de cena
                window.dispatchEvent(
                    new CustomEvent('wellProfileBuilt', {
                        detail: { elementId: element.id, group },
                    }),
                );

                // Solicita render
                requestRender();
            }
        } catch (err) {
            console.warn('[meshFactory] Falha ao construir profile 3D:', err);
            // Mantem cilindro base como fallback
        }
    });
}

/**
 * Cria mesh de marcador generico.
 *
 * REPRESENTACAO:
 * - Esfera solida colorida
 * - Tamanho fixo para boa visibilidade
 * - Cor azul padrao
 *
 * @param {Object} data - Dados do marcador
 * @param {Object} data.position - Posicao (x, y, z)
 * @returns {THREE.Mesh}
 */
function createMarkerMesh(data, element) {
    const geometry = getCachedGeometry('sphere_16', () => new THREE.SphereGeometry(1, 16, 16));

    const markerColor = parseColor(element?.color) || 0x3b82f6;
    const matKey = `std_${markerColor}_o_1`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: markerColor,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(1.5, 1.5, 1.5);

    mesh.position.set(data.position?.x || 0, data.position?.y || 0, data.position?.z || 0);

    return mesh;
}

/**
 * Cria mesh de lago/corpo d'agua.
 *
 * REPRESENTACAO:
 * - Disco achatado (cilindro com altura pequena)
 * - Cor azul-agua
 * - Semi-transparente
 *
 * @param {Object} data - Dados do lago
 * @param {Object} data.shape - Dimensoes { radiusX, radiusY }
 * @param {Object} data.position - Posicao { x, y, z }
 * @returns {THREE.Mesh}
 */
function createLakeMesh(data, element) {
    const rx = data.shape?.radiusX || 15;
    const ry = data.shape?.radiusY || 10;

    const geometry = getCachedGeometry('cyl_32', () => new THREE.CylinderGeometry(1, 1, 1, 32));

    const lakeColor = parseColor(element?.color) || 0x3b82f6;
    const matKey = `std_${lakeColor}_t_0.6`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: lakeColor,
                transparent: true,
                opacity: 0.6,
                roughness: 0.3,
                side: THREE.DoubleSide,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(rx, 0.5, ry);

    mesh.position.set(data.position?.x || 0, data.position?.y || 0, data.position?.z || 0);

    return mesh;
}

/**
 * Cria mesh de rio/linha d'agua.
 *
 * REPRESENTACAO:
 * - Linha tubular (tubo ao longo do caminho)
 * - Cor azul-rio
 * - Largura proporcional ao fluxo
 *
 * @param {Object} data - Dados do rio
 * @param {Array} data.path - Array de pontos {x, y, z}
 * @param {number} data.width - Largura do rio
 * @returns {THREE.Mesh}
 */
function createRiverMesh(data, element) {
    const path = data.path || [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
    ];
    const width = data.width || 3;

    // Cria curva a partir dos pontos
    const points = path.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(points);

    // Geometria tubular
    const geometry = getCachedGeometry(
        `tube_${points.length}`,
        () => new THREE.TubeGeometry(curve, points.length * 4, 1, 8, false),
    );

    const riverColor = parseColor(element?.color) || 0x60a5fa;
    const matKey = `std_${riverColor}_t_0.7`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: riverColor,
                transparent: true,
                opacity: 0.7,
                roughness: 0.4,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(width, 1, width);

    return mesh;
}

/**
 * Cria mesh de edificacao/estrutura.
 *
 * REPRESENTACAO:
 * - Cubo ou forma extrudada
 * - Cor cinza ou definida pelo usuario
 * - Opaca
 *
 * @param {Object} data - Dados do edificio
 * @param {Object} data.dimensions - Dimensoes { width, height, depth }
 * @param {Object} data.position - Posicao { x, y, z }
 * @returns {THREE.Mesh}
 */
function createBuildingMesh(data, element) {
    const w = data.dimensions?.width || 10;
    const h = data.dimensions?.height || 5;
    const d = data.dimensions?.depth || 10;

    const geometry = getCachedGeometry('box_1', () => new THREE.BoxGeometry(1, 1, 1));

    const buildingColor = parseColor(element?.color) || 0x9ca3af;
    const matKey = `std_${buildingColor}_o_1`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: buildingColor,
                roughness: 0.8,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(data.position?.x || 0, data.position?.y || h / 2, data.position?.z || 0);

    return mesh;
}

/**
 * Cria mesh de tanque/reservatorio.
 *
 * REPRESENTACAO:
 * - Cilindro vertical (para tanques verticais)
 * - Ou cubo (para tanques retangulares)
 * - Cor definida pelo tipo de conteudo
 *
 * @param {Object} data - Dados do tanque
 * @param {string} data.type - Tipo ('vertical', 'horizontal', 'rectangular')
 * @param {Object} data.dimensions - Dimensoes
 * @param {Object} data.position - Posicao
 * @returns {THREE.Mesh}
 */
function createTankMesh(data, element) {
    const type = data.type || 'vertical';
    const dims = data.dimensions || { radius: 3, height: 6 };

    let geometry;
    if (type === 'vertical') {
        geometry = getCachedGeometry('cyl_16', () => new THREE.CylinderGeometry(1, 1, 1, 16));
    } else if (type === 'horizontal') {
        geometry = getCachedGeometry('cyl_16', () => new THREE.CylinderGeometry(1, 1, 1, 16));
    } else {
        geometry = getCachedGeometry('box_1', () => new THREE.BoxGeometry(1, 1, 1));
    }

    const tankColor = parseColor(element?.color) || 0xf59e0b;
    const matKey = `std_${tankColor}_o_1`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: tankColor,
                roughness: 0.5,
                metalness: 0.3,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);

    if (type === 'vertical') {
        mesh.scale.set(dims.radius, dims.height, dims.radius);
        mesh.position.set(data.position?.x || 0, (data.position?.y || 0) + dims.height / 2, data.position?.z || 0);
    } else if (type === 'horizontal') {
        mesh.scale.set(dims.radius, dims.length || 6, dims.radius);
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(data.position?.x || 0, (data.position?.y || 0) + dims.radius, data.position?.z || 0);
    } else {
        mesh.scale.set(dims.width, dims.height, dims.depth);
        mesh.position.set(data.position?.x || 0, (data.position?.y || 0) + dims.height / 2, data.position?.z || 0);
    }

    return mesh;
}

/**
 * Cria mesh de limite de area (boundary).
 *
 * REPRESENTACAO:
 * - THREE.Group com dois filhos:
 *   1. Line 'outline' — contorno laranja fechado
 *   2. Mesh 'overlay' — plano preenchido com textura aerea (se overlayUrl)
 * - Suporta imagem de satelite via loadOverlayTexture
 *
 * @param {Object} data - Dados do boundary
 * @param {Array} data.vertices - Array de vertices {x, z}
 * @param {string} [data.overlayUrl] - URL da imagem aerea (data URL ou HTTP)
 * @param {string[]} [data.overlayFallbackUrls] - URLs alternativas
 * @param {number} [data.overlayOpacity=0.85] - Opacidade do overlay
 * @param {Object} element - Elemento completo
 * @returns {THREE.Group}
 */
function createBoundaryMesh(data, element) {
    const vertices = data.vertices || [];
    if (vertices.length < 3) return null;

    const group = new THREE.Group();
    const boundaryColor = parseColor(element?.color) || 0xff9900;

    // 1. Linha de contorno (outline)
    const points = vertices.map((v) => new THREE.Vector3(v.x, v.y || 0.2, v.z));
    points.push(points[0].clone()); // Fecha o loop

    const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
    const lineMatKey = `line_${boundaryColor}`;
    const lineMat = getCachedMaterial(
        lineMatKey,
        () =>
            new THREE.LineBasicMaterial({
                color: boundaryColor,
                linewidth: 2,
            }),
    );
    const line = new THREE.Line(lineGeom, lineMat);
    line.name = 'outline';
    line.frustumCulled = false;
    group.add(line);

    // 2. Plano preenchido com suporte a overlay de imagem aerea
    const shape = new THREE.Shape();
    shape.moveTo(vertices[0].x, vertices[0].z);
    for (let i = 1; i < vertices.length; i++) {
        shape.lineTo(vertices[i].x, vertices[i].z);
    }
    shape.closePath();

    const planeGeom = new THREE.ShapeGeometry(shape);
    normalizeUVs(planeGeom);
    planeGeom.rotateX(-Math.PI / 2);
    planeGeom.translate(0, 0.1, 0);

    const planeMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: data.overlayOpacity ?? 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });

    // Carrega imagem aerea se URL fornecida
    if (data.overlayUrl) {
        const urls = [data.overlayUrl, ...(data.overlayFallbackUrls || [])];
        loadOverlayTexture(urls, planeMat);
    }

    const plane = new THREE.Mesh(planeGeom, planeMat);
    plane.name = 'overlay';
    plane.frustumCulled = false;
    group.add(plane);

    return group;
}

/**
 * Cria mesh de estrato geologico.
 *
 * REPRESENTACAO:
 * - Volume 3D entre duas superficies
 * - Ou lamina representativa
 * - Cor baseada no tipo litologico
 *
 * @param {Object} data - Dados do estrato
 * @param {Object} data.topology - Top e bottom surfaces
 * @param {string} data.lithology - Tipo de solo/rocha
 * @returns {THREE.Mesh}
 */
function createStratumMesh(data, element) {
    // Simplificacao: cria um bloco representativo
    const width = data.dimensions?.width || 50;
    const depth = data.dimensions?.depth || 50;
    const thickness = data.dimensions?.thickness || 2;

    const geometry = getCachedGeometry('box_1', () => new THREE.BoxGeometry(1, 1, 1));

    // Cor baseada na litologia
    const lithColors = {
        clay: 0x8b4513,
        sand: 0xf4a460,
        gravel: 0xd3d3d3,
        rock: 0x696969,
    };
    const stratumColor = parseColor(element?.color) || lithColors[data.lithology] || 0x8b4513;

    const matKey = `std_${stratumColor}_o_1`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: stratumColor,
                roughness: 0.9,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(width, thickness, depth);
    mesh.position.set(data.position?.x || 0, data.position?.y || -thickness / 2, data.position?.z || 0);

    return mesh;
}

/**
 * Cria mesh de nascente/vertente.
 *
 * REPRESENTACAO:
 * - Pequeno cone/circulo na superficie
 * - Cor azul-clara
 * - Marcador de ponto de agua
 *
 * @param {Object} data - Dados da nascente
 * @param {Object} data.position - Posicao {x, y, z}
 * @returns {THREE.Mesh}
 */
function createSpringMesh(data, element) {
    const geometry = getCachedGeometry('cone_8', () => new THREE.ConeGeometry(1, 1, 8));

    const springColor = parseColor(element?.color) || 0x60a5fa;
    const matKey = `std_${springColor}_o_1`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: springColor,
                roughness: 0.4,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(0.8, 1.5, 0.8);
    mesh.position.set(data.position?.x || 0, (data.position?.y || 0) + 0.75, data.position?.z || 0);

    return mesh;
}

/**
 * Cria mesh de ponto de amostragem.
 *
 * REPRESENTACAO:
 * - Pequena esfera ou diamante
 * - Cor varia com resultado (verde/vermelho/cinza)
 * - Posicao no ponto de coleta
 *
 * @param {Object} data - Dados da amostra
 * @param {Object} data.position - Posicao {x, y, z}
 * @param {string} data.result - Resultado ('positive', 'negative', 'pending')
 * @returns {THREE.Mesh}
 */
function createSampleMesh(data, element) {
    const geometry = getCachedGeometry('octa_1', () => new THREE.OctahedronGeometry(1));

    // Cor baseada no resultado
    const resultColors = {
        positive: 0xef4444, // Vermelho
        negative: 0x22c55e, // Verde
        pending: 0x9ca3af, // Cinza
    };
    const sampleColor = parseColor(element?.color) || resultColors[data.result] || 0x9ca3af;

    const matKey = `std_${sampleColor}_o_1`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: sampleColor,
                roughness: 0.5,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(0.5, 0.5, 0.5);
    mesh.position.set(data.position?.x || 0, data.position?.y || 0.5, data.position?.z || 0);

    return mesh;
}

// ----------------------------------------------------------------
// CRIADORES PARA FAMILIAS UTILITARIAS/GENERICAS
// ----------------------------------------------------------------

/**
 * Cria mesh de blueprint/espacial (importacao CAD/GIS).
 *
 * REPRESENTACAO:
 * - Linha de contorno no plano horizontal
 * - Similar ao boundary mas sem overlay de imagem
 * - Usado para footprints importados de DXF
 *
 * @param {Object} data - Dados do blueprint
 * @param {Array} data.vertices - Array de vertices {x, z}
 * @returns {THREE.Group}
 */
function createBlueprintMesh(data, element) {
    const vertices = data.vertices || [];
    if (vertices.length < 3) return null;

    const group = new THREE.Group();
    group.name = 'blueprint-mesh-group';
    const blueprintColor = parseColor(element?.color) || 0x3b82f6;

    // Linha de contorno (outline)
    const points = vertices.map((v) => new THREE.Vector3(v.x, 0.1, v.z));
    points.push(points[0].clone()); // Fecha o loop

    const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
    const lineMatKey = `line_${blueprintColor}`;
    const lineMat = getCachedMaterial(
        lineMatKey,
        () =>
            new THREE.LineBasicMaterial({
                color: blueprintColor,
                linewidth: 2,
            }),
    );
    const line = new THREE.Line(lineGeom, lineMat);
    line.name = 'outline';
    line.frustumCulled = false;
    group.add(line);

    // Plano preenchido semi-transparente
    const shape = new THREE.Shape();
    shape.moveTo(vertices[0].x, vertices[0].z);
    for (let i = 1; i < vertices.length; i++) {
        shape.lineTo(vertices[i].x, vertices[i].z);
    }
    shape.closePath();

    const planeGeom = new THREE.ShapeGeometry(shape);
    normalizeUVs(planeGeom);
    planeGeom.rotateX(-Math.PI / 2);
    planeGeom.translate(0, 0.05, 0);

    const planeMatKey = `basic_${blueprintColor}_t_0.15`;
    const planeMat = getCachedMaterial(
        planeMatKey,
        () =>
            new THREE.MeshBasicMaterial({
                color: blueprintColor,
                transparent: true,
                opacity: 0.15,
                side: THREE.DoubleSide,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1,
            }),
    );

    const plane = new THREE.Mesh(planeGeom, planeMat);
    plane.name = 'fill';
    plane.frustumCulled = false;
    group.add(plane);

    return group;
}

/**
 * Cria mesh de sensor IoT.
 *
 * REPRESENTACAO:
 * - Pequena torre/estacao com base e antena
 * - Cor azul tecnologica
 *
 * @param {Object} data - Dados do sensor
 * @param {Object} data.position - Posicao {x, y, z}
 * @returns {THREE.Group}
 */
function createSensorMesh(data, element) {
    const group = new THREE.Group();
    group.name = 'sensor-mesh-group';
    const sensorColor = parseColor(element?.color) || 0x0ea5e9;

    _buildSensorBase(group, sensorColor);
    _buildSensorAntenna(group);

    group.position.set(data.position?.x || 0, data.position?.y || 0, data.position?.z || 0);
    return group;
}

/** @param {THREE.Group} group  @param {number} color */
function _buildSensorBase(group, color) {
    const geom = getCachedGeometry('cyl_8', () => new THREE.CylinderGeometry(1, 1, 1, 8));
    const mat = getCachedMaterial(
        `std_${color}_o_1`,
        () =>
            new THREE.MeshStandardMaterial({
                color,
                roughness: 0.4,
                metalness: 0.3,
            }),
    );
    const base = new THREE.Mesh(geom, mat);
    base.scale.set(0.3, 0.6, 0.3);
    base.position.y = 0.3;
    group.add(base);
}

/** @param {THREE.Group} group */
function _buildSensorAntenna(group) {
    const antennaGeom = getCachedGeometry('cyl_4', () => new THREE.CylinderGeometry(1, 1, 1, 4));
    const antennaColor = 0x64748b; // Cinza fixo — haste metalica neutra, independente da cor do sensor
    const antennaMat = getCachedMaterial(
        `std_${antennaColor}_o_1`,
        () => new THREE.MeshStandardMaterial({ color: antennaColor, roughness: 0.5 }),
    );
    const antenna = new THREE.Mesh(antennaGeom, antennaMat);
    antenna.scale.set(0.05, 0.8, 0.05);
    antenna.position.y = 1.0;
    group.add(antenna);

    const tipGeom = getCachedGeometry('sphere_8', () => new THREE.SphereGeometry(1, 8, 8));
    const tipColor = 0xef4444; // Vermelho fixo — indicador de ativo/alerta, cor de sinal universal
    const tipMat = getCachedMaterial(
        `std_${tipColor}_o_1`,
        () =>
            new THREE.MeshStandardMaterial({
                color: tipColor,
                emissive: tipColor,
                emissiveIntensity: 0.3,
            }),
    );
    const tip = new THREE.Mesh(tipGeom, tipMat);
    tip.scale.set(0.1, 0.1, 0.1);
    tip.position.y = 1.4;
    tip.name = 'sensor-tip';
    group.add(tip);
}

/**
 * Cria mesh para elemento intangivel (ativo nao-fisico).
 *
 * REPRESENTACAO:
 * - Diamante/flutuante etereo
 * - Cor roxa/ciano com brilho
 * - Indica elemento conceitual/nao fisico
 *
 * @param {Object} data - Dados do elemento
 * @param {Object} data.position - Posicao {x, y, z}
 * @returns {THREE.Mesh}
 */
function createIntangibleMesh(data, element) {
    const geometry = getCachedGeometry('octa_1', () => new THREE.OctahedronGeometry(1));

    const intangibleColor = parseColor(element?.color) || 0xa855f7;
    const matKey = `std_${intangibleColor}_t_0.7`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: intangibleColor,
                transparent: true,
                opacity: 0.7,
                emissive: intangibleColor,
                emissiveIntensity: 0.2,
                roughness: 0.2,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'intangible-mesh';
    mesh.scale.set(0.8, 1.2, 0.8);
    mesh.position.set(data.position?.x || 0, (data.position?.y || 0) + 0.6, data.position?.z || 0);

    return mesh;
}

/**
 * Cria mesh para elemento generico.
 *
 * REPRESENTACAO:
 * - Cubo simples como representacao generica
 * - Cor cinza ou definida pelo usuario
 * - Usado quando nao ha um tipo especifico
 *
 * @param {Object} data - Dados do elemento
 * @param {Object} data.position - Posicao {x, y, z}
 * @returns {THREE.Mesh}
 */
function createGenericMesh(data, element) {
    const geometry = getCachedGeometry('box_1', () => new THREE.BoxGeometry(1, 1, 1));

    const genericColor = parseColor(element?.color) || 0x6b7280;
    const matKey = `std_${genericColor}_o_1`;
    const material = getCachedMaterial(
        matKey,
        () =>
            new THREE.MeshStandardMaterial({
                color: genericColor,
                roughness: 0.6,
            }),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'generic-mesh';
    mesh.scale.set(0.8, 0.8, 0.8);
    mesh.position.set(data.position?.x || 0, (data.position?.y || 0) + 0.4, data.position?.z || 0);

    return mesh;
}

/**
 * Reconstrói geometria de boundary in-place (sem recriar mesh).
 * Usado pelo shape editor para atualizar durante arrasto de pontos.
 *
 * @param {THREE.Group} group - Grupo do boundary
 * @param {Array<{x:number, y?:number, z:number}>} vertices - Vértices do boundary
 * @param {Object} data - Dados do elemento (overlayOpacity, etc.)
 */
export function rebuildBoundaryGeometry(group, vertices, data) {
    if (!group || !vertices || vertices.length < 3) return;

    // 1. Reconstrói outline (Line)
    const outline = group.getObjectByName('outline');
    if (outline) {
        const points = vertices.map((v) => new THREE.Vector3(v.x, v.y || 0.2, v.z));
        points.push(points[0].clone()); // Fecha o loop
        if (outline.geometry) outline.geometry.dispose();
        outline.geometry = new THREE.BufferGeometry().setFromPoints(points);
    }

    // 2. Reconstrói overlay (ShapeGeometry preenchido)
    const overlay = group.getObjectByName('overlay');
    if (overlay) {
        const shape = new THREE.Shape();
        shape.moveTo(vertices[0].x, vertices[0].z);
        for (let i = 1; i < vertices.length; i++) {
            shape.lineTo(vertices[i].x, vertices[i].z);
        }
        shape.closePath();

        if (overlay.geometry) overlay.geometry.dispose();
        const planeGeom = new THREE.ShapeGeometry(shape);

        // Normaliza UVs para [0,1] e rotaciona para plano horizontal
        normalizeUVs(planeGeom);
        planeGeom.rotateX(-Math.PI / 2);
        planeGeom.translate(0, 0.1, 0);

        overlay.geometry = planeGeom;
    }
}

/**
 * Reconstrói geometria de rio in-place (sem recriar mesh).
 * Usado pelo shape editor para atualizar durante arrasto de pontos.
 *
 * @param {THREE.Group} group - Grupo do rio
 * @param {Array<{x:number, y?:number, z:number}>} path - Pontos do caminho
 * @param {number} width - Largura do rio
 */
export function rebuildRiverGeometry(group, path, width) {
    if (!group || !path || path.length < 2) return;

    const tubeMesh = group.getObjectByName('river-tube');
    if (!tubeMesh) return;

    // Cria nova curva a partir dos pontos
    const points = path.map((p) => new THREE.Vector3(p.x, p.y || 0, p.z));
    const curve = new THREE.CatmullRomCurve3(points);

    // Descarta geometria antiga e cria nova
    if (tubeMesh.geometry) tubeMesh.geometry.dispose();
    tubeMesh.geometry = new THREE.TubeGeometry(curve, points.length * 4, 1, 8, false);

    // Atualiza escala
    tubeMesh.scale.set(width, 1, width);

    requestRender();
}

/**
 * Reconstrói geometria extrudada (building/tank) in-place.
 * Usado pelo shape editor para atualizar durante arrasto de pontos.
 *
 * @param {THREE.Group} group - Grupo do elemento
 * @param {Array<{x:number, y?:number, z:number}>} vertices - Vértices da base
 * @param {Object} data - Dados do elemento (height, etc)
 */
export function rebuildExtrudedGeometry(group, vertices, data) {
    if (!group || !vertices || vertices.length < 3) return;

    const topMesh = group.getObjectByName('top');
    const sidesMesh = group.getObjectByName('sides');

    // Cria shape a partir dos vértices
    const shape = new THREE.Shape();
    shape.moveTo(vertices[0].x, vertices[0].z);
    for (let i = 1; i < vertices.length; i++) {
        shape.lineTo(vertices[i].x, vertices[i].z);
    }
    shape.closePath();

    const height = data?.height || 5;

    // Reconstrói topo (se existir)
    if (topMesh) {
        if (topMesh.geometry) topMesh.geometry.dispose();
        const topShape = new THREE.Shape();
        topShape.moveTo(vertices[0].x, vertices[0].z);
        for (let i = 1; i < vertices.length; i++) {
            topShape.lineTo(vertices[i].x, vertices[i].z);
        }
        topShape.closePath();
        topMesh.geometry = new THREE.ShapeGeometry(topShape);
        normalizeUVs(topMesh.geometry);
        topMesh.geometry.rotateX(-Math.PI / 2);
        topMesh.position.y = height;
    }

    // Reconstrói lados (se existir)
    if (sidesMesh) {
        if (sidesMesh.geometry) sidesMesh.geometry.dispose();
        const extrudeSettings = {
            depth: height,
            bevelEnabled: false,
        };
        sidesMesh.geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        sidesMesh.geometry.rotateX(-Math.PI / 2);
    }

    requestRender();
}
