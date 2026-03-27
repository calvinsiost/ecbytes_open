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
   SNAPSHOT — Captura de screenshot do canvas 3D como PNG
   Permite ao usuario exportar uma imagem limpa da cena 3D.
   ================================================================ */

import { getRenderer, getScene, getCamera, requestRender } from '../scene/setup.js';

/**
 * Captura o canvas WebGL e faz download como PNG.
 * Tira um screenshot limpo da cena 3D atual.
 */
export function captureSnapshot() {
    const renderer = getRenderer();
    const scene = getScene();
    const camera = getCamera();
    if (!renderer || !scene || !camera) return;

    // Forcar render para garantir frame atualizado
    requestRender();
    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL('image/png');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `ecbyts-snapshot-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
