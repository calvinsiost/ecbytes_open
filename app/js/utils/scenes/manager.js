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
   GERENCIADOR DE CENAS
   ================================================================

   Este modulo gerencia cenas criadas pelo usuario.

   CENA = CONJUNTO DE CONFIGURACOES
   - viewStart/viewEnd: estados de camera
   - campaignsStart/campaignsEnd: campanhas usadas
   - filters: filtros de elementos visiveis

   ================================================================ */

import { getCameraState } from '../scene/controls.js';

// ----------------------------------------------------------------
// ESTADO DO MODULO
// ----------------------------------------------------------------

let scenes = [];
let sceneCounter = 0;

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function createId() {
    sceneCounter += 1;
    return `scene-${sceneCounter}`;
}

function normalizeScene(scene) {
    return {
        id: scene.id || createId(),
        name: scene.name || `Cena ${sceneCounter}`,
        viewStart: scene.viewStart || null,
        viewEnd: scene.viewEnd || null,
        campaignsStart: Array.isArray(scene.campaignsStart) ? scene.campaignsStart : [],
        campaignsEnd: Array.isArray(scene.campaignsEnd) ? scene.campaignsEnd : [],
        elementVisibility: scene.elementVisibility || {},
    };
}

// ----------------------------------------------------------------
// FUNCOES DE ACESSO
// ----------------------------------------------------------------

export function getAllScenes() {
    return scenes;
}

export function getSceneById(id) {
    return scenes.find((scene) => scene.id === id);
}

// ----------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------

export function addScene(data = {}) {
    const scene = normalizeScene(data);
    scenes.push(scene);
    return scene;
}

export function updateScene(id, updates) {
    const scene = getSceneById(id);
    if (!scene) return null;

    Object.assign(scene, updates);
    scene.campaignsStart = Array.isArray(scene.campaignsStart) ? scene.campaignsStart : [];
    scene.campaignsEnd = Array.isArray(scene.campaignsEnd) ? scene.campaignsEnd : [];
    scene.elementVisibility = scene.elementVisibility || {};
    return scene;
}

export function removeScene(id) {
    const index = scenes.findIndex((scene) => scene.id === id);
    if (index === -1) return false;
    scenes.splice(index, 1);
    return true;
}

// ----------------------------------------------------------------
// CAPTURA DE VISTAS
// ----------------------------------------------------------------

export function captureViewStart(sceneId) {
    const scene = getSceneById(sceneId);
    if (!scene) return null;
    scene.viewStart = getCameraState();
    return scene.viewStart;
}

export function captureViewEnd(sceneId) {
    const scene = getSceneById(sceneId);
    if (!scene) return null;
    scene.viewEnd = getCameraState();
    return scene.viewEnd;
}

// ----------------------------------------------------------------
// SERIALIZACAO
// ----------------------------------------------------------------

export function exportScenes() {
    return scenes.map((scene) => ({ ...scene }));
}

export function importScenes(imported) {
    if (!Array.isArray(imported)) {
        scenes = [];
        sceneCounter = 0;
        return;
    }

    scenes = imported.map((scene) => normalizeScene(scene));
    sceneCounter = scenes.length;
}

export function clearScenes() {
    scenes = [];
    sceneCounter = 0;
}
