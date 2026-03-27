// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   COMPLIANCE OVERLAY — 3D visual indicators
   ================================================================

   Adiciona halos visuais aos meshes 3D dos elementos baseado
   no pior severity de compliance das observacoes.

   - Intervention (VI/CMA): anel vermelho pulsante
   - Prevention (VP): anel amarelo
   - Reference (VR): anel azul sutil
   - null: sem overlay

   ================================================================ */

import * as THREE from 'three';
import { getThresholds, getExceededThreshold } from '../validation/rules.js';
import { resolveRegulatoryContext } from '../calculator/contextResolver.js';

// ----------------------------------------------------------------
// SEVERITY RANKING
// ----------------------------------------------------------------

const SEVERITY_RANK = { intervention: 4, prevention: 3, reference: 2, info: 1 };

const SEVERITY_COLORS = {
    intervention: new THREE.Color(0xef4444),
    prevention: new THREE.Color(0xfbbf24),
    reference: new THREE.Color(0x60a5fa),
};

// Track overlays by element ID for cleanup
const _overlays = new Map();

// ----------------------------------------------------------------
// COMPUTE COMPLIANCE
// ----------------------------------------------------------------

/**
 * Compute worst compliance severity for an element.
 * Calcula a pior severity de compliance de todas as observacoes do elemento.
 * @param {Object} element - Elemento do manager
 * @returns {string|null} - 'intervention'|'prevention'|'reference'|'info'|null
 */
export function computeElementCompliance(element) {
    let worstSeverity = null;
    let worstRank = 0;

    for (const obs of element.data?.observations || []) {
        if (obs.value == null || isNaN(obs.value)) continue;

        const matrix = resolveRegulatoryContext(obs.variables, element.family);
        const thresholds = getThresholds(obs.parameterId, matrix);
        if (thresholds.length === 0) continue;

        const exceeded = getExceededThreshold(obs.value, thresholds);
        if (exceeded) {
            const rank = SEVERITY_RANK[exceeded.severity] || 0;
            if (rank > worstRank) {
                worstRank = rank;
                worstSeverity = exceeded.severity;
            }
        }
    }

    return worstSeverity;
}

// ----------------------------------------------------------------
// 3D OVERLAY
// ----------------------------------------------------------------

/**
 * Update compliance halo on an element mesh.
 * Adiciona/atualiza/remove anel 3D baseado na severity.
 * @param {string} elementId
 * @param {THREE.Mesh} mesh - Mesh do elemento na scene
 * @param {string|null} severity - Severity ou null para remover
 */
export function updateMeshOverlay(elementId, mesh, severity) {
    // Remove existing overlay
    const existing = _overlays.get(elementId);
    if (existing) {
        mesh.remove(existing);
        existing.geometry.dispose();
        existing.material.dispose();
        _overlays.delete(elementId);
    }

    if (!severity || !SEVERITY_COLORS[severity]) return;

    // Create halo ring
    const bbox = new THREE.Box3().setFromObject(mesh);
    const size = bbox.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.6;

    const geometry = new THREE.RingGeometry(radius, radius + 0.15, 32);
    const material = new THREE.MeshBasicMaterial({
        color: SEVERITY_COLORS[severity],
        transparent: true,
        opacity: severity === 'intervention' ? 0.7 : severity === 'prevention' ? 0.5 : 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2; // Lay flat
    ring.position.y = 0.02; // Slightly above ground

    // Pulse animation data for intervention
    if (severity === 'intervention') {
        ring.userData.compliancePulse = true;
        ring.userData.pulseTime = 0;
    }

    ring.userData.complianceOverlay = true;
    mesh.add(ring);
    _overlays.set(elementId, ring);
}

/**
 * Update pulse animation for intervention halos.
 * Chamado no loop de render (requestAnimationFrame).
 * @param {number} deltaTime - Tempo desde ultimo frame
 */
export function updatePulseAnimations(deltaTime) {
    for (const ring of _overlays.values()) {
        if (!ring.userData.compliancePulse) continue;
        ring.userData.pulseTime += deltaTime;
        const t = ring.userData.pulseTime;
        ring.material.opacity = 0.4 + 0.3 * Math.sin(t * 3);
    }
}

/**
 * Remove all overlays (cleanup).
 */
export function clearAllOverlays() {
    for (const [id, ring] of _overlays) {
        if (ring.parent) ring.parent.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
    }
    _overlays.clear();
}

/**
 * Get current overlay severity for an element.
 * @param {string} elementId
 * @returns {string|null}
 */
export function getOverlaySeverity(elementId) {
    const ring = _overlays.get(elementId);
    if (!ring) return null;
    for (const [sev, color] of Object.entries(SEVERITY_COLORS)) {
        if (ring.material.color.equals(color)) return sev;
    }
    return null;
}

/**
 * Check if at least one overlay has pulse animation enabled.
 * @returns {boolean}
 */
export function hasPulsingOverlays() {
    for (const ring of _overlays.values()) {
        if (ring?.userData?.compliancePulse) return true;
    }
    return false;
}
