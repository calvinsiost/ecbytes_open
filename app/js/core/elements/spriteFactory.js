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
   SPRITE BILLBOARD FACTORY
   ================================================================

   Cria sprites billboard (sempre virados para a camera) com
   glow radial e forma central customizavel.

   Usado por: intangible (losango) e generic (circulo).
   Extensivel para novas familias billboard.

   ================================================================ */

import * as THREE from 'three';
import { parseColor } from './meshHelpers.js';

/**
 * Cria sprite billboard com glow radial e forma central parametrizada.
 *
 * @param {Object} data - Dados do elemento (position)
 * @param {Object} element - Elemento completo (com color)
 * @param {Object} opts - Opcoes de configuracao
 * @param {number} opts.defaultColor - Cor padrao se elemento nao tiver cor
 * @param {number} opts.glowMidStop - Ponto medio do gradiente (0-1)
 * @param {Function} opts.drawShape - Funcao (ctx, cx, cy) que desenha forma central
 * @param {number} opts.baseScale - Escala base do sprite
 * @param {number} opts.defaultY - Posicao Y padrao (altura de flutuacao)
 * @returns {THREE.Sprite} Sprite billboard
 */
export function createSpriteBillboard(data, element, opts) {
    const { defaultColor, glowMidStop = 0.5, drawShape, baseScale = 5, defaultY = 3 } = opts;

    const baseColor = parseColor(element?.color) || defaultColor;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const cx = 64,
        cy = 64;

    // Glow radial (halo suave — cor do elemento com fade)
    const hex = '#' + (baseColor & 0xffffff).toString(16).padStart(6, '0');
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
    grad.addColorStop(0, hex);
    grad.addColorStop(glowMidStop, hex + '88');
    grad.addColorStop(1, hex + '00');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    // Forma central customizada (losango, circulo, etc.)
    if (drawShape) {
        drawShape(ctx, cx, cy);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        sizeAttenuation: true,
        fog: false, // Evita que fog esconda billboards
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(baseScale, baseScale, 1);
    sprite.position.set(data.position?.x || 0, data.position?.y || defaultY, data.position?.z || 0);

    // Escala adaptativa: mantem tamanho visual constante independente do zoom
    // Intangiveis nao tem dimensao fisica — tamanho na tela deve ser estavel
    sprite.onBeforeRender = function (_renderer, _scene, camera) {
        const s = baseScale / (camera.zoom || 1);
        this.scale.set(s, s, 1);
    };

    return sprite;
}
