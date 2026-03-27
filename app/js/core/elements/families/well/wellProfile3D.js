// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: Well Family — 3D Profile Renderer
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   WELL PROFILE 3D RENDERER
   ================================================================

   Gera representações 3D detalhadas de perfis de poço:
   - Textura cilíndrica baseada em camadas litológicas (ABGE)
   - Elementos construtivos 3D (revestimento, tela, selagem)
   - Atualização dinâmica quando o profile é editado

   REPRESENTAÇÃO 3D:
   - Cilindro externo: camadas litológicas (textura UV mapeada)
   - Cilindro interno: revestimento (casing) em aço
   - Tubo perfurado: tela (screen) com openings visíveis
   - Anel superior: selagem superficial
   - Anel inferior: selagem de fundo (quando presente)

   COORDENADAS UV:
   - U: ângulo ao redor do poço (0-1 = 0-360°)
   - V: profundidade (0 = topo, 1 = fundo)

   ================================================================ */

import * as THREE from 'three';

// ----------------------------------------------------------------
// CORES ABGE PADRONIZADAS (litologia)
// ----------------------------------------------------------------

const ABGE_COLORS = {
    organic_soil: '#3D2B1F', // Turfa/organico
    fill: '#8B7355', // Aterro
    clay: '#B87333', // Argila
    silty_clay: '#CD853F', // Argila siltosa
    silt: '#D2B48C', // Silte
    sandy_silt: '#DEB887', // Silte arenoso
    fine_sand: '#F4A460', // Areia fina
    medium_sand: '#F5DEB3', // Areia media
    coarse_sand: '#FFE4B5', // Areia grossa
    gravel: '#FFF8DC', // Cascalho
    boulder: '#D3D3D3', // Matacoes
    rock: '#696969', // Rocha
};

// Cores para elementos construtivos
const CONSTRUCTION_COLORS = {
    casing: 0x888888, // Aço cinza
    screen: 0x666666, // Aço mais escuro
    seal: 0x8b4513, // Bentonita marrom
    gravel: 0xdaa520, // Pack de areia/dourado
    cap: 0xcccccc, // Concreto/tampa
};

// ----------------------------------------------------------------
// GERAÇÃO DE TEXTURA LITOLÓGICA
// ----------------------------------------------------------------

/**
 * Cria uma textura Canvas 2D baseada nas camadas litológicas.
 * A textura é mapeada no cilindro UV: U=ângulo, V=profundidade.
 *
 * @param {Array} layers - Camadas litológicas [{from, to, soilType, color}]
 * @param {number} totalDepth - Profundidade total do poço em metros
 * @param {number} width - Largura da textura em pixels (padrão: 512)
 * @param {number} height - Altura da textura em pixels (padrão: 1024)
 * @returns {THREE.CanvasTexture}
 */
export function createLithologyTexture(layers, totalDepth, width = 512, height = 1024) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fundo: cinza neutro (caso não haja camadas)
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, width, height);

    if (!layers || layers.length === 0) {
        // Sem camadas: textura padrao com hachura
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 2;
        for (let i = 0; i < height; i += 20) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(width, i + 10);
            ctx.stroke();
        }
    } else {
        // Renderiza cada camada
        layers.forEach((layer) => {
            const from = Math.max(0, layer.from || 0);
            const to = Math.min(totalDepth, layer.to || totalDepth);
            if (to <= from) return;

            // Mapeia profundidade para coordenadas Y (invertido: 0=topo)
            const y1 = Math.floor((from / totalDepth) * height);
            const y2 = Math.floor((to / totalDepth) * height);
            const layerHeight = y2 - y1;

            // Cor da camada
            const color = layer.color || ABGE_COLORS[layer.soilType] || '#888888';
            ctx.fillStyle = color;
            ctx.fillRect(0, y1, width, layerHeight);

            // Borda sutil entre camadas
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y1);
            ctx.lineTo(width, y1);
            ctx.stroke();

            // Padrao textural baseado no tipo de solo
            drawSoilPattern(ctx, layer.soilType, 0, y1, width, layerHeight);

            // Rótulo da camada (se houver espaço)
            if (layerHeight > 30 && layer.soilType) {
                ctx.fillStyle = getContrastColor(color);
                ctx.font = 'bold 20px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(getSoilLabel(layer.soilType), width / 2, y1 + layerHeight / 2 + 7);
            }
        });
    }

    // Borda externa
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, width, height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    return texture;
}

/**
 * Desenha padrão textural para tipo de solo.
 */
function drawSoilPattern(ctx, soilType, x, y, w, h) {
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;

    switch (soilType) {
        case 'clay':
        case 'silty_clay':
            // Linhas onduladas horizontais (argila)
            for (let i = y + 5; i < y + h; i += 8) {
                ctx.beginPath();
                for (let j = x; j < x + w; j += 10) {
                    ctx.lineTo(j, i + Math.sin(j * 0.1) * 3);
                }
                ctx.stroke();
            }
            break;

        case 'fine_sand':
        case 'medium_sand':
        case 'coarse_sand':
            // Pontos aleatórios (areia)
            for (let i = 0; i < (w * h) / 100; i++) {
                const px = x + Math.random() * w;
                const py = y + Math.random() * h;
                ctx.fillStyle = 'rgba(0,0,0,0.2)';
                ctx.fillRect(px, py, 2, 2);
            }
            break;

        case 'gravel':
        case 'boulder':
            // Círculos irregulares (cascalho/matacoes)
            for (let i = 0; i < (w * h) / 400; i++) {
                const cx = x + Math.random() * w;
                const cy = y + Math.random() * h;
                const r = 3 + Math.random() * 5;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fill();
            }
            break;

        case 'rock':
            // Linhas diagonais (rocha)
            ctx.beginPath();
            for (let i = -h; i < w; i += 15) {
                ctx.moveTo(x + i, y + h);
                ctx.lineTo(x + i + h * 0.5, y);
            }
            ctx.stroke();
            break;

        default:
            // Sem padrão específico
            break;
    }
}

/**
 * Retorna cor de contraste (branco/preto) para legibilidade.
 */
function getContrastColor(hexColor) {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

/**
 * Retorna label amigável para tipo de solo.
 */
function getSoilLabel(soilType) {
    const labels = {
        organic_soil: 'Organico',
        fill: 'Aterro',
        clay: 'Argila',
        silty_clay: 'Arg. Siltosa',
        silt: 'Silte',
        sandy_silt: 'Silte Aren.',
        fine_sand: 'Areia Fina',
        medium_sand: 'Areia Med.',
        coarse_sand: 'Areia Grossa',
        gravel: 'Cascalho',
        boulder: 'Matacoes',
        rock: 'Rocha',
    };
    return labels[soilType] || soilType;
}

// ----------------------------------------------------------------
// ELEMENTOS CONSTRUTIVOS 3D
// ----------------------------------------------------------------

/**
 * Cria geometria de revestimento (casing) como cilindro.
 *
 * @param {Object} construtive - Dados construtivos
 * @param {number} outerRadius - Raio externo
 * @param {number} innerRadius - Raio interno (espessura)
 * @returns {THREE.Mesh|null}
 */
export function createCasing3D(constructive, outerRadius = 0.35, innerRadius = 0.3) {
    if (!constructive || !constructive.elements) return null;

    const casingElements = constructive.elements.filter(
        (e) => e.type === 'casing' || e.type === 'blank_casing' || e.type === 'surface_completion',
    );
    if (casingElements.length === 0) return null;

    const group = new THREE.Group();

    casingElements.forEach((elem) => {
        const from = elem.from ?? elem.topDepth ?? 0;
        const to = elem.to ?? elem.bottomDepth ?? constructive.totalDepth ?? 50;
        const length = to - from;
        if (length <= 0) return;

        // Cilindro do revestimento (tubo oco = cilindro externo - interno)
        const geometry = new THREE.CylinderGeometry(outerRadius, outerRadius, length, 16, 1, true);
        const material = new THREE.MeshStandardMaterial({
            color: CONSTRUCTION_COLORS.casing,
            roughness: 0.4,
            metalness: 0.6,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);

        // Posiciona: centro do cilindro = (from + to) / 2, negativo (Y para baixo)
        mesh.position.y = -(from + length / 2);

        group.add(mesh);
    });

    return group;
}

/**
 * Cria geometria de tela (screen) como cilindro perfurado.
 *
 * @param {Object} constructive - Dados construtivos
 * @param {number} radius - Raio da tela
 * @returns {THREE.Mesh|null}
 */
export function createScreen3D(constructive, radius = 0.28) {
    if (!constructive || !constructive.elements) return null;

    const screenElements = constructive.elements.filter((e) => e.type === 'screen' || e.type === 'screen_tube');
    if (screenElements.length === 0) return null;

    const group = new THREE.Group();

    screenElements.forEach((elem) => {
        const from = elem.from ?? elem.topDepth ?? 0;
        const to = elem.to ?? elem.bottomDepth ?? constructive.totalDepth ?? 50;
        const length = to - from;
        if (length <= 0) return;

        // Tela como cilindro com textura de openings
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 16, 8, true);
        const material = new THREE.MeshStandardMaterial({
            color: CONSTRUCTION_COLORS.screen,
            roughness: 0.5,
            metalness: 0.5,
            wireframe: false,
            transparent: true,
            opacity: 0.9,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = -(from + length / 2);

        group.add(mesh);
    });

    return group;
}

/**
 * Cria anéis de selagem (seal) como torus.
 *
 * @param {Object} constructive - Dados construtivos
 * @param {number} radius - Raio do anel
 * @returns {THREE.Mesh|null}
 */
export function createSeal3D(constructive, radius = 0.36) {
    if (!constructive || !constructive.elements) return null;

    const sealElements = constructive.elements.filter(
        (e) =>
            e.type === 'seal' ||
            e.type === 'gravel_pack' ||
            e.type === 'cement_seal' ||
            e.type === 'bentonite_seal' ||
            e.type === 'sump' ||
            e.type === 'filter',
    );
    if (sealElements.length === 0) return null;

    const group = new THREE.Group();

    sealElements.forEach((elem) => {
        const from = elem.from ?? elem.topDepth ?? 0;
        const to = elem.to ?? elem.bottomDepth ?? from + 0.5;
        const length = Math.max(0.3, to - from);

        // Selagem como cilindro sólido
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 16);
        const color = elem.type === 'gravel_pack' ? CONSTRUCTION_COLORS.gravel : CONSTRUCTION_COLORS.seal;
        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.8,
            metalness: 0.1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = -(from + length / 2);

        group.add(mesh);
    });

    return group;
}

/**
 * Cria tampa/concreto superior.
 *
 * @param {number} radius - Raio da tampa
 * @param {number} height - Altura da tampa
 * @returns {THREE.Mesh}
 */
export function createWellCap3D(radius = 0.4, height = 0.3) {
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
    const material = new THREE.MeshStandardMaterial({
        color: CONSTRUCTION_COLORS.cap,
        roughness: 0.6,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height / 2; // Acima do solo (Y=0)
    return mesh;
}

// ----------------------------------------------------------------
// MONTAGEM COMPLETA DO PERFIL 3D
// ----------------------------------------------------------------

/**
 * Cria um grupo THREE.js completo representando o perfil do poço.
 *
 * @param {Object} element - Elemento completo com element.data.profile
 * @returns {THREE.Group|null}
 */
export function createWellProfile3D(element) {
    if (!element?.data?.profile) return null;

    const profile = element.data.profile;
    const constructive = profile.constructive;
    const lithologic = profile.lithologic;
    const totalDepth = constructive?.totalDepth || 50;

    const group = new THREE.Group();
    group.name = `well-profile-${element.id}`;

    // 1. Camada litológica externa (cilindro texturizado)
    const lithologyTexture = createLithologyTexture(lithologic, totalDepth);
    const lithRadius = 0.45; // Raio externo (maior que revestimento)
    const lithGeometry = new THREE.CylinderGeometry(lithRadius, lithRadius, totalDepth, 24, 1, true);
    const lithMaterial = new THREE.MeshStandardMaterial({
        map: lithologyTexture,
        roughness: 0.8,
        metalness: 0.0,
        side: THREE.DoubleSide,
    });
    const lithMesh = new THREE.Mesh(lithGeometry, lithMaterial);
    lithMesh.position.y = -totalDepth / 2;
    lithMesh.name = 'lithology-cylinder';
    group.add(lithMesh);

    // 2. Revestimento (casing)
    const casing = createCasing3D(constructive, 0.35, 0.3);
    if (casing) {
        casing.name = 'casing-group';
        group.add(casing);
    }

    // 3. Tela (screen)
    const screen = createScreen3D(constructive, 0.28);
    if (screen) {
        screen.name = 'screen-group';
        group.add(screen);
    }

    // 4. Selagens
    const seal = createSeal3D(constructive, 0.36);
    if (seal) {
        seal.name = 'seal-group';
        group.add(seal);
    }

    // 5. Tampa superior
    const cap = createWellCap3D(0.4, 0.3);
    cap.name = 'well-cap';
    group.add(cap);

    // Metadata para sincronização
    group.userData = {
        elementId: element.id,
        profileVersion: Date.now(),
        isWellProfile: true,
    };

    return group;
}

// ----------------------------------------------------------------
// ATUALIZAÇÃO DINÂMICA
// ----------------------------------------------------------------

/**
 * Atualiza um grupo 3D existente com novos dados do profile.
 * Usado quando o usuário edita o perfil no WellProfileModule.
 *
 * @param {THREE.Group} group - Grupo existente criado por createWellProfile3D
 * @param {Object} element - Elemento atualizado
 * @returns {boolean} - True se atualizado, false se precisa recriar
 */
export function updateWellProfile3D(group, element) {
    if (!group || !element?.data?.profile) return false;

    // Remove objetos antigos
    const toRemove = [];
    group.traverse((child) => {
        if (child.isMesh && child.name !== 'well-base-cylinder') {
            toRemove.push(child);
        }
    });
    toRemove.forEach((child) => {
        child.geometry?.dispose();
        child.material?.map?.dispose();
        child.material?.dispose();
        group.remove(child);
    });

    // Recria com novos dados
    const newGroup = createWellProfile3D(element);
    if (!newGroup) return false;

    // Transfere filhos do novo grupo para o grupo existente
    while (newGroup.children.length > 0) {
        group.add(newGroup.children[0]);
    }

    // Atualiza metadata
    group.userData.profileVersion = Date.now();

    return true;
}

// ----------------------------------------------------------------
// HELPERS DE DEBUG
// ----------------------------------------------------------------

/**
 * Gera uma prévia da textura litológica como Data URL (para UI).
 *
 * @param {Array} layers - Camadas litológicas
 * @param {number} totalDepth - Profundidade total
 * @param {number} width - Largura da preview
 * @param {number} height - Altura da preview
 * @returns {string} - Data URL PNG
 */
export function generateLithologyPreview(layers, totalDepth, width = 128, height = 256) {
    const texture = createLithologyTexture(layers, totalDepth, width, height);
    const canvas = texture.image;
    return canvas.toDataURL('image/png');
}
