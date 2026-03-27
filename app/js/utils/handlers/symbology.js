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
   ECBT — Symbology Handlers
   utils/handlers/symbology.js

   Handlers window.* para o sistema de perfis de simbologia.
   Registrados em handlers/index.js.
   Licença: AGPL-3.0-only
   ================================================================ */

import { cycleProfile, getActiveProfile, setSymbologyUpdateAllUI } from '../../core/symbology/manager.js';
import { openSymbologyEditor } from '../ui/symbologyModal.js';

// ----------------------------------------------------------------
// EXPORTAÇÕES PÚBLICAS
// ----------------------------------------------------------------

export const symbologyHandlers = {
    handleSymbologyClick,
    handleOpenSymbologyEditor,
};

/**
 * Injeta o callback de atualização de UI no manager de simbologia.
 * @param {Function} updateAllUIFn
 */
export function setSymbologyHandlerDeps(updateAllUIFn) {
    setSymbologyUpdateAllUI(updateAllUIFn);
}

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Clique no botão principal — cicla para o próximo perfil.
 */
function handleSymbologyClick() {
    const profile = cycleProfile();
    _updateBtn(profile);
}

/**
 * Abre o editor de perfis de simbologia.
 */
function handleOpenSymbologyEditor() {
    openSymbologyEditor();
}

// ----------------------------------------------------------------
// AUXILIARES
// ----------------------------------------------------------------

/**
 * Atualiza o texto exibido no botão de ciclo.
 * @param {SymbologyProfile|null} profile
 */
function _updateBtn(profile) {
    const label = document.getElementById('symbology-btn-label');
    if (!label) return;
    if (!profile) {
        label.innerHTML = '&#9670; Sym';
        label.title = 'Sem perfil ativo';
        return;
    }
    const name = profile.name.length > 8 ? profile.name.slice(0, 7) + '\u2026' : profile.name;
    label.textContent = '\u25C6 ' + name;
    label.title = profile.name;
}

// Escuta evento de mudança de perfil para manter botão sincronizado
// (ciclo pode ser disparado de outras fontes além do botão)
window.addEventListener('symbologyChanged', ({ detail }) => {
    _updateBtn(detail.profile);
});
