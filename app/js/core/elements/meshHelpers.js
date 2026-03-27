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
   HELPERS PARA CRIAÇÃO DE MESHES 3D
   ================================================================

   Funções utilitárias compartilhadas entre meshFactory, spriteFactory
   e meshESG — evitam duplicação de lógica comum.

   FUNCOES:
   - parseColor: converte hex string em numero
   - normalizeUVs: normaliza coordenadas UV para [0,1]
   - applyRotationDegrees: aplica rotação em graus a um mesh
   - DEG2RAD: constante de conversão graus→radianos

   ================================================================ */

import * as THREE from 'three';

// ----------------------------------------------------------------
// CONSTANTES
// ----------------------------------------------------------------

/** Fator de conversao graus → radianos */
export const DEG2RAD = Math.PI / 180;

// ----------------------------------------------------------------
// PARSECOLOR — Converte string hex em numero
// ----------------------------------------------------------------

/**
 * Converte string de cor (hex) em numero.
 * Aceita formato "#ff9900" ou "ff9900".
 *
 * @param {string} value - Cor em formato hex
 * @returns {number|null} Cor numerica ou null se invalida
 */
export function parseColor(value) {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.trim().replace('#', '');
    if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) {
        return null;
    }
    return parseInt(normalized, 16);
}

// ----------------------------------------------------------------
// NORMALIZE UVS — ShapeGeometry usa coordenadas brutas
// ----------------------------------------------------------------

/**
 * Normaliza coordenadas UV de uma geometria para o intervalo [0,1].
 * ShapeGeometry gera UVs em coordenadas do mundo — isso impede que
 * texturas de overlay (imagem aérea) fiquem posicionadas corretamente.
 *
 * @param {THREE.BufferGeometry} geometry - Geometria com atributo UV
 */
export function normalizeUVs(geometry) {
    const uvAttr = geometry.attributes.uv;
    if (!uvAttr) return;

    let minU = Infinity,
        maxU = -Infinity,
        minV = Infinity,
        maxV = -Infinity;
    for (let i = 0; i < uvAttr.count; i++) {
        const u = uvAttr.getX(i),
            v = uvAttr.getY(i);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
    }
    const du = maxU - minU || 1,
        dv = maxV - minV || 1;
    for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setXY(i, (uvAttr.getX(i) - minU) / du, (uvAttr.getY(i) - minV) / dv);
    }
    uvAttr.needsUpdate = true;
}

// ----------------------------------------------------------------
// APPLY ROTATION DEGREES — Converte graus para radianos e aplica
// ----------------------------------------------------------------

/**
 * Aplica rotação em graus a um mesh, convertendo para radianos.
 * Evita repetir a multiplicação por DEG2RAD em cada criador.
 *
 * @param {THREE.Object3D} mesh - Objeto 3D para rotacionar
 * @param {Object} rotation - Rotação em graus {x, y, z}
 */
export function applyRotationDegrees(mesh, rotation) {
    if (!rotation) return;
    mesh.rotation.set((rotation.x || 0) * DEG2RAD, (rotation.y || 0) * DEG2RAD, (rotation.z || 0) * DEG2RAD);
}
