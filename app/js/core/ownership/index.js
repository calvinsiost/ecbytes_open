// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

import { getOwner, getUserRole } from '../../utils/auth/permissions.js';
import { getUserEmail } from '../../utils/auth/session.js';

/**
 * Evaluate ownership-based authorization for sensitive mutating operations.
 * Rule: actor must be owner OR have admin role.
 */
export function evaluateOwnershipPermission() {
    const actor = getUserEmail() || null;
    const owner = getOwner() || null;
    const role = getUserRole();
    const isOwner = !!actor && !!owner && actor === owner;
    const isAdmin = role === 'admin' || role === 'owner';

    return {
        ok: isOwner || isAdmin,
        actor,
        owner,
        role,
    };
}

/**
 * Check and return a structured result for enforcement points.
 * @param {string} actionLabel
 * @returns {{ok:boolean,error?:string,actor:string|null,owner:string|null,role:string}}
 */
export function requireOwnershipPermission(actionLabel = 'operation') {
    const result = evaluateOwnershipPermission();
    if (result.ok) return result;
    return {
        ...result,
        ok: false,
        error: `Ownership enforcement blocked ${actionLabel}. Only owner or admin can proceed.`,
    };
}
