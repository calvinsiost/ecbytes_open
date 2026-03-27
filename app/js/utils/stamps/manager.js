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
   GERENCIADOR DE ESTAMPAS (STAMP MANAGER)
   ================================================================

   CRUD e operacoes sobre estampas de ativos.

   OPERACOES:
   - addStamp: Adiciona estampa a um elemento
   - removeStamp: Remove estampa de um elemento
   - updateStamp: Atualiza valor de estampa
   - getStamps: Lista estampas de um elemento
   - findByStamp: Busca elementos por estampa

   ================================================================ */

import { getStampType, validateStampValue, STAMP_CATEGORIES } from './types.js';
import { generateId } from '../helpers/id.js';

// ----------------------------------------------------------------
// FUNCOES DE GERACAO DE ID
// ----------------------------------------------------------------

/**
 * Gera ID unico para estampa.
 * @returns {string}
 */
function generateStampId() {
    return generateId('stamp');
}

// ----------------------------------------------------------------
// CRUD DE ESTAMPAS
// ----------------------------------------------------------------

/**
 * Adiciona estampa a um elemento.
 * @param {Object} element - Elemento alvo
 * @param {string} typeId - ID do tipo de estampa
 * @param {Object} value - Valor da estampa
 * @param {Object} options - Opcoes adicionais
 * @param {string} options.appliedBy - Usuario que aplicou
 * @param {string} options.signature - Assinatura digital (opcional)
 * @param {string} options.expiresAt - Data de expiracao (opcional)
 * @param {string} options.classification - 'passive' ou 'active' (default: 'passive')
 * @returns {{ success: boolean, stamp?: Object, errors?: string[] }}
 */
export function addStamp(element, typeId, value, options = {}) {
    // Validar tipo
    const stampType = getStampType(typeId);
    if (!stampType) {
        return { success: false, errors: [`Tipo de estampa desconhecido: ${typeId}`] };
    }

    // Validar valor
    const validation = validateStampValue(typeId, value);
    if (!validation.valid) {
        return { success: false, errors: validation.errors };
    }

    // Inicializar array de estampas se necessario
    if (!element.stamps) {
        element.stamps = [];
    }

    // Criar estampa
    const stamp = {
        id: generateStampId(),
        category: stampType.category,
        type: typeId,
        classification: options.classification || 'passive',
        value: { ...value },
        appliedAt: new Date().toISOString(),
        appliedBy: options.appliedBy || 'system',
    };

    // Adicionar campos opcionais
    if (options.signature) {
        stamp.signature = options.signature;
    }
    if (options.expiresAt) {
        stamp.expiresAt = options.expiresAt;
    }

    element.stamps.push(stamp);

    return { success: true, stamp };
}

/**
 * Remove estampa de um elemento.
 * @param {Object} element - Elemento alvo
 * @param {string} stampId - ID da estampa a remover
 * @returns {{ success: boolean, error?: string }}
 */
export function removeStamp(element, stampId) {
    if (!element.stamps || !Array.isArray(element.stamps)) {
        return { success: false, error: 'Elemento nao possui estampas' };
    }

    const index = element.stamps.findIndex((s) => s.id === stampId);
    if (index === -1) {
        return { success: false, error: `Estampa nao encontrada: ${stampId}` };
    }

    element.stamps.splice(index, 1);
    return { success: true };
}

/**
 * Atualiza valor de uma estampa.
 * @param {Object} element - Elemento alvo
 * @param {string} stampId - ID da estampa
 * @param {Object} newValue - Novo valor
 * @returns {{ success: boolean, stamp?: Object, errors?: string[] }}
 */
export function updateStamp(element, stampId, newValue) {
    if (!element.stamps || !Array.isArray(element.stamps)) {
        return { success: false, errors: ['Elemento nao possui estampas'] };
    }

    const stamp = element.stamps.find((s) => s.id === stampId);
    if (!stamp) {
        return { success: false, errors: [`Estampa nao encontrada: ${stampId}`] };
    }

    // Validar novo valor
    const validation = validateStampValue(stamp.type, newValue);
    if (!validation.valid) {
        return { success: false, errors: validation.errors };
    }

    // Atualizar
    stamp.value = { ...newValue };
    stamp.modifiedAt = new Date().toISOString();

    return { success: true, stamp };
}

/**
 * Obtem estampas de um elemento.
 * @param {Object} element - Elemento alvo
 * @param {Object} filter - Filtro opcional
 * @param {string} filter.category - Filtrar por categoria
 * @param {string} filter.type - Filtrar por tipo
 * @returns {Object[]}
 */
export function getStamps(element, filter = {}) {
    if (!element.stamps || !Array.isArray(element.stamps)) {
        return [];
    }

    let stamps = [...element.stamps];

    if (filter.category) {
        stamps = stamps.filter((s) => s.category === filter.category);
    }

    if (filter.type) {
        stamps = stamps.filter((s) => s.type === filter.type);
    }

    return stamps;
}

/**
 * Obtem estampa por ID.
 * @param {Object} element - Elemento alvo
 * @param {string} stampId - ID da estampa
 * @returns {Object|null}
 */
export function getStampById(element, stampId) {
    if (!element.stamps || !Array.isArray(element.stamps)) {
        return null;
    }
    return element.stamps.find((s) => s.id === stampId) || null;
}

// ----------------------------------------------------------------
// BUSCA POR ESTAMPAS
// ----------------------------------------------------------------

/**
 * Busca elementos por estampa.
 * @param {Object[]} elements - Lista de elementos
 * @param {Object} query - Criterios de busca
 * @param {string} query.type - Tipo de estampa
 * @param {string} query.category - Categoria de estampa
 * @param {Object} query.valueMatch - Valores para match parcial
 * @returns {Object[]}
 */
export function findByStamp(elements, query) {
    return elements.filter((element) => {
        if (!element.stamps || !Array.isArray(element.stamps)) {
            return false;
        }

        return element.stamps.some((stamp) => {
            // Match por tipo
            if (query.type && stamp.type !== query.type) {
                return false;
            }

            // Match por categoria
            if (query.category && stamp.category !== query.category) {
                return false;
            }

            // Match por valores
            if (query.valueMatch) {
                for (const [key, value] of Object.entries(query.valueMatch)) {
                    if (stamp.value[key] !== value) {
                        return false;
                    }
                }
            }

            return true;
        });
    });
}

/**
 * Busca elementos por tipo de estampa GRI.
 * @param {Object[]} elements - Lista de elementos
 * @param {string} disclosure - Codigo GRI (ex: '303-1')
 * @returns {Object[]}
 */
export function findByGRI(elements, disclosure) {
    return findByStamp(elements, {
        type: 'gri',
        valueMatch: { disclosure },
    });
}

/**
 * Busca elementos por pilar ESG.
 * @param {Object[]} elements - Lista de elementos
 * @param {string} pillar - E|S|G
 * @returns {Object[]}
 */
export function findByESGPillar(elements, pillar) {
    return findByStamp(elements, {
        type: 'esg_category',
        valueMatch: { pillar },
    });
}

/**
 * Busca elementos por ODS.
 * @param {Object[]} elements - Lista de elementos
 * @param {number} goal - Numero do ODS (1-17)
 * @returns {Object[]}
 */
export function findBySDG(elements, goal) {
    return findByStamp(elements, {
        type: 'sdg',
        valueMatch: { goal },
    });
}

// ----------------------------------------------------------------
// ESTATISTICAS DE ESTAMPAS
// ----------------------------------------------------------------

/**
 * Conta estampas por categoria.
 * @param {Object[]} elements - Lista de elementos
 * @returns {Object} Contagem por categoria
 */
export function countStampsByCategory(elements) {
    const counts = {
        governance: 0,
        context: 0,
        reporting: 0,
    };

    elements.forEach((element) => {
        if (element.stamps && Array.isArray(element.stamps)) {
            element.stamps.forEach((stamp) => {
                if (counts[stamp.category] !== undefined) {
                    counts[stamp.category]++;
                }
            });
        }
    });

    return counts;
}

/**
 * Conta estampas por tipo.
 * @param {Object[]} elements - Lista de elementos
 * @returns {Object} Contagem por tipo
 */
export function countStampsByType(elements) {
    const counts = {};

    elements.forEach((element) => {
        if (element.stamps && Array.isArray(element.stamps)) {
            element.stamps.forEach((stamp) => {
                counts[stamp.type] = (counts[stamp.type] || 0) + 1;
            });
        }
    });

    return counts;
}

// ----------------------------------------------------------------
// VERIFICACAO DE GOVERNANCA
// ----------------------------------------------------------------

/**
 * Verifica se elemento tem RT definido.
 * @param {Object} element - Elemento
 * @returns {boolean}
 */
export function hasResponsibleTechnical(element) {
    return getStamps(element, { type: 'responsible_technical' }).length > 0;
}

/**
 * Verifica se elemento tem assinatura digital.
 * @param {Object} element - Elemento
 * @returns {boolean}
 */
export function hasDigitalSignature(element) {
    return getStamps(element, { type: 'digital_signature' }).length > 0;
}

/**
 * Verifica se elemento esta aprovado.
 * @param {Object} element - Elemento
 * @returns {{ approved: boolean, status?: string, approver?: string }}
 */
export function getApprovalStatus(element) {
    const approvals = getStamps(element, { type: 'approval' });
    if (approvals.length === 0) {
        return { approved: false };
    }

    // Pegar a aprovacao mais recente
    const latest = approvals.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt))[0];

    return {
        approved: latest.value.status === 'approved',
        status: latest.value.status,
        approver: latest.value.approver,
        date: latest.value.date,
    };
}

// ----------------------------------------------------------------
// EXPORTACAO DE ESTAMPAS
// ----------------------------------------------------------------

/**
 * Exporta estampas de um elemento para formato simplificado.
 * @param {Object} element - Elemento
 * @returns {Object[]}
 */
export function exportStamps(element) {
    if (!element.stamps) return [];

    return element.stamps.map((stamp) => ({
        id: stamp.id,
        category: stamp.category,
        type: stamp.type,
        classification: stamp.classification || 'passive',
        value: stamp.value,
        appliedAt: stamp.appliedAt,
        appliedBy: stamp.appliedBy,
        ...(stamp.signature && { signature: stamp.signature }),
        ...(stamp.expiresAt && { expiresAt: stamp.expiresAt }),
    }));
}

/**
 * Importa estampas para um elemento.
 * @param {Object} element - Elemento
 * @param {Object[]} stamps - Estampas a importar
 * @param {boolean} validate - Se deve validar estampas
 * @returns {{ success: boolean, imported: number, errors: string[] }}
 */
export function importStamps(element, stamps, validate = true) {
    if (!Array.isArray(stamps)) {
        return { success: false, imported: 0, errors: ['Estampas deve ser um array'] };
    }

    element.stamps = element.stamps || [];
    const errors = [];
    let imported = 0;

    stamps.forEach((stamp, index) => {
        if (validate) {
            const validation = validateStampValue(stamp.type, stamp.value);
            if (!validation.valid) {
                errors.push(`Estampa ${index}: ${validation.errors.join(', ')}`);
                return;
            }
        }

        element.stamps.push({
            id: stamp.id || generateStampId(),
            category: stamp.category,
            type: stamp.type,
            classification: stamp.classification || 'passive',
            value: stamp.value,
            appliedAt: stamp.appliedAt || new Date().toISOString(),
            appliedBy: stamp.appliedBy || 'import',
            ...(stamp.signature && { signature: stamp.signature }),
            ...(stamp.expiresAt && { expiresAt: stamp.expiresAt }),
        });
        imported++;
    });

    return {
        success: errors.length === 0,
        imported,
        errors,
    };
}

// ----------------------------------------------------------------
// CLASSIFICACAO PASSIVO/ATIVO
// ----------------------------------------------------------------

/**
 * Resumo de classificacao das estampas de um elemento.
 * @param {Object} element - Elemento
 * @returns {{ passive: number, active: number }}
 */
export function getStampSummary(element) {
    if (!element.stamps || !Array.isArray(element.stamps)) {
        return { passive: 0, active: 0 };
    }
    let passive = 0;
    let active = 0;
    element.stamps.forEach((s) => {
        if (s.classification === 'active') active++;
        else passive++;
    });
    return { passive, active };
}

/**
 * Filtra estampas por classificacao.
 * @param {Object} element - Elemento
 * @param {'passive'|'active'} classification
 * @returns {Object[]}
 */
export function filterStampsByClassification(element, classification) {
    if (!element.stamps || !Array.isArray(element.stamps)) {
        return [];
    }
    return element.stamps.filter((s) => s.classification === classification);
}
