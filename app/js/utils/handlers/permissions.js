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
   PERMISSIONS HANDLERS — Window functions for RBAC management
   Handlers para gerenciamento de permissoes de acesso
   ================================================================ */

/**
 * Open the permissions management modal.
 * Abre o modal de gerenciamento de regras de acesso (RBAC).
 */
async function handleOpenPermissions() {
    const { openPermissionsModal } = await import('../ui/permissionsModal.js');
    openPermissionsModal();
}

export const permissionsHandlers = {
    handleOpenPermissions,
};
