// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: SpatialBlueprint — Environmental Compliance Checking
// ADR: ADR-021

// ================================================================
// compliance.js — Verificacao de compliance ambiental via overlay
// Usa turf.js para intersecao fisica (nao booleana) entre o
// blueprint e zonas de referencia ambiental.
//
// REGRA DE OURO #3: NUNCA usar .intersects() booleano.
// Flutuacoes milimetricas de reprojecao geram falsos positivos.
// Usar overlay fisico + limiar de area minima.
// ================================================================

import { importCDN } from '../../utils/helpers/cdnLoader.js';

/** @type {Object|null} cache do modulo turf */
let _turf = null;

/**
 * Carrega turf.js sob demanda via CDN.
 * @returns {Promise<Object>}
 */
async function loadTurf() {
    if (_turf) return _turf;
    const mod = await importCDN('https://esm.sh/@turf/turf@7.1.0', { name: 'turf.js' });
    _turf = mod;
    return _turf;
}

/**
 * Zonas de referencia ambiental brasileiras (defaults).
 * Baseadas em legislacao CONAMA.
 */
export const REFERENCE_ZONES = {
    APP: {
        name: 'APP — Área de Preservação Permanente',
        regulation: 'CONAMA 303/2002',
        bufferMeters: 30,
        description: "Faixa marginal de cursos d'água, nascentes, topos de morro",
    },
    risk: {
        name: 'Zona de Risco de Contaminação',
        regulation: 'CONAMA 420/2009',
        bufferMeters: 50,
        description: 'Área com valores de referência excedidos para solo/água subterrânea',
    },
    buffer: {
        name: 'Faixa de Proteção Ambiental',
        regulation: 'CONAMA 369/2006',
        bufferMeters: 100,
        description: 'Buffer de proteção em entorno de unidades de conservação',
    },
    operational: {
        name: 'Zona Operacional',
        regulation: 'NR-15 / NR-25',
        bufferMeters: 0,
        description: 'Perímetro de operação industrial com controle ocupacional',
    },
};

/**
 * @typedef {Object} ComplianceResult
 * @property {string} regulation - Codigo da regulamentacao
 * @property {string} zone_type - Tipo da zona (APP, risk, buffer, operational)
 * @property {'compliant'|'non_compliant'|'warning'} status
 * @property {number} overlapAreaM2 - Area real de sobreposicao em m2
 * @property {Object|null} overlapGeometry - GeoJSON da intersecao (se houver)
 */

/**
 * Verifica compliance de um blueprint contra zonas de referencia.
 * Implementa Regra de Ouro #3 — overlay fisico, nao booleano.
 *
 * Estrategia:
 * 1. Computa intersecao geometrica (overlay fisico) com turf.intersect()
 * 2. Calcula area real da intersecao com turf.area()
 * 3. Compara contra limiar minimo para evitar falsos positivos
 *
 * @param {Object} blueprintGeoJSON - GeoJSON Polygon do blueprint (WGS84)
 * @param {Object[]} referenceZones - Array de {geometry: GeoJSON, type: string, regulation: string}
 * @param {number} [minOverlapM2=1.0] - Area minima de sobreposicao para declarar nao-conformidade
 * @returns {Promise<ComplianceResult[]>}
 */
export async function checkCompliance(blueprintGeoJSON, referenceZones = [], minOverlapM2 = 1.0) {
    if (!referenceZones || referenceZones.length === 0) return [];

    const turf = await loadTurf();
    const results = [];

    // Garante que o blueprint e um Feature
    const blueprintFeature =
        blueprintGeoJSON.type === 'Feature'
            ? blueprintGeoJSON
            : { type: 'Feature', properties: {}, geometry: blueprintGeoJSON };

    for (const zone of referenceZones) {
        const zoneFeature =
            zone.geometry.type === 'Feature'
                ? zone.geometry
                : { type: 'Feature', properties: {}, geometry: zone.geometry };

        try {
            // Overlay fisico — extrai geometria da intersecao real
            const intersection = turf.intersect(turf.featureCollection([blueprintFeature, zoneFeature]));

            if (!intersection) {
                // Sem intersecao — compliant
                results.push({
                    regulation: zone.regulation || 'unknown',
                    zone_type: zone.type || 'unknown',
                    status: 'compliant',
                    overlapAreaM2: 0,
                    overlapGeometry: null,
                });
                continue;
            }

            // Calcula area real da intersecao em m2
            const overlapAreaM2 = turf.area(intersection);

            if (overlapAreaM2 < minOverlapM2) {
                // Area abaixo do limiar — ruido de reprojecao, considerar compliant
                results.push({
                    regulation: zone.regulation || 'unknown',
                    zone_type: zone.type || 'unknown',
                    status: 'compliant',
                    overlapAreaM2,
                    overlapGeometry: null,
                });
            } else {
                // Sobreposicao real — nao-conformidade
                results.push({
                    regulation: zone.regulation || 'unknown',
                    zone_type: zone.type || 'unknown',
                    status: 'non_compliant',
                    overlapAreaM2,
                    overlapGeometry: intersection.geometry,
                });
            }
        } catch (e) {
            console.warn(`[Spatial] Compliance check falhou para zona ${zone.type}:`, e.message);
            results.push({
                regulation: zone.regulation || 'unknown',
                zone_type: zone.type || 'unknown',
                status: 'warning',
                overlapAreaM2: 0,
                overlapGeometry: null,
            });
        }
    }

    return results;
}
