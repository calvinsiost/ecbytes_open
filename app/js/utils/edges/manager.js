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
   GERENCIADOR DE RELACOES (EDGE MANAGER)
   ================================================================

   CRUD e operacoes sobre relacoes entre ativos.
   Implementa grafo Any-to-Any com travessia e busca.

   OPERACOES:
   - addEdge: Cria relacao entre elementos
   - removeEdge: Remove relacao
   - updateEdge: Atualiza propriedades
   - getEdges: Lista relacoes de um elemento
   - traverse: Navega pelo grafo

   ================================================================ */

import { getEdgeType, isValidEdge, isBidirectional, getInverseEdgeType } from './types.js';
import { generateId } from '../helpers/id.js';

// ----------------------------------------------------------------
// ARMAZENAMENTO DE EDGES
// ----------------------------------------------------------------

/**
 * Armazena todas as edges do modelo.
 * Mantido separado dos elementos para facilitar travessia.
 */
let edges = [];

/**
 * Indice de edges por sourceId para busca rapida.
 */
let edgesBySource = new Map();

/**
 * Indice de edges por targetId para busca rapida.
 */
let edgesByTarget = new Map();

// ----------------------------------------------------------------
// FUNCOES DE GERACAO DE ID
// ----------------------------------------------------------------

/**
 * Gera ID unico para edge.
 * @returns {string}
 */
function generateEdgeId() {
    return generateId('edge');
}

// ----------------------------------------------------------------
// INICIALIZACAO E RESET
// ----------------------------------------------------------------

/**
 * Inicializa o gerenciador com edges existentes.
 * @param {Object[]} existingEdges - Edges a carregar
 */
export function initEdges(existingEdges = []) {
    edges = [];
    edgesBySource = new Map();
    edgesByTarget = new Map();

    existingEdges.forEach((edge) => {
        addEdgeToIndex(edge);
    });
}

/**
 * Adiciona edge aos indices internos.
 * @param {Object} edge - Edge a indexar
 */
function addEdgeToIndex(edge) {
    edges.push(edge);

    // Indexar por source
    if (!edgesBySource.has(edge.sourceId)) {
        edgesBySource.set(edge.sourceId, []);
    }
    edgesBySource.get(edge.sourceId).push(edge);

    // Indexar por target
    if (!edgesByTarget.has(edge.targetId)) {
        edgesByTarget.set(edge.targetId, []);
    }
    edgesByTarget.get(edge.targetId).push(edge);
}

/**
 * Remove edge dos indices internos.
 * @param {Object} edge - Edge a remover
 */
function removeEdgeFromIndex(edge) {
    // Remover do array principal
    const mainIndex = edges.findIndex((e) => e.id === edge.id);
    if (mainIndex !== -1) {
        edges.splice(mainIndex, 1);
    }

    // Remover do indice por source
    const sourceEdges = edgesBySource.get(edge.sourceId);
    if (sourceEdges) {
        const idx = sourceEdges.findIndex((e) => e.id === edge.id);
        if (idx !== -1) sourceEdges.splice(idx, 1);
    }

    // Remover do indice por target
    const targetEdges = edgesByTarget.get(edge.targetId);
    if (targetEdges) {
        const idx = targetEdges.findIndex((e) => e.id === edge.id);
        if (idx !== -1) targetEdges.splice(idx, 1);
    }
}

// ----------------------------------------------------------------
// CRUD DE EDGES
// ----------------------------------------------------------------

/**
 * Cria relacao entre dois elementos.
 * @param {string} sourceId - ID do elemento origem
 * @param {string} targetId - ID do elemento destino
 * @param {string} typeId - ID do tipo de relacao
 * @param {Object} options - Opcoes adicionais
 * @param {Object} options.properties - Propriedades da relacao
 * @param {string} options.createdBy - Usuario que criou
 * @param {Function} options.getElement - Funcao para obter elemento por ID
 * @returns {{ success: boolean, edge?: Object, errors?: string[] }}
 */
export function addEdge(sourceId, targetId, typeId, options = {}) {
    const errors = [];

    // Validar tipo
    const edgeType = getEdgeType(typeId);
    if (!edgeType) {
        return { success: false, errors: [`Tipo de relacao desconhecido: ${typeId}`] };
    }

    // Validar se nao e auto-referencia (exceto para alguns tipos)
    if (sourceId === targetId && !edgeType.allowSelfReference) {
        return { success: false, errors: ['Relacao nao pode ser auto-referenciada'] };
    }

    // Validar familias se funcao getElement fornecida
    if (options.getElement) {
        const source = options.getElement(sourceId);
        const target = options.getElement(targetId);

        if (!source) {
            errors.push(`Elemento origem nao encontrado: ${sourceId}`);
        }
        if (!target) {
            errors.push(`Elemento destino nao encontrado: ${targetId}`);
        }

        if (source && target) {
            if (!isValidEdge(typeId, source.family, target.family)) {
                errors.push(`Relacao ${typeId} invalida entre ${source.family} e ${target.family}`);
            }
        }
    }

    if (errors.length > 0) {
        return { success: false, errors };
    }

    // Verificar duplicata
    const existing = findEdge(sourceId, targetId, typeId);
    if (existing) {
        return { success: false, errors: ['Relacao ja existe'] };
    }

    // Criar edge
    const edge = {
        id: generateEdgeId(),
        sourceId,
        targetId,
        type: typeId,
        bidirectional: edgeType.bidirectional,
        properties: options.properties || {},
        createdAt: new Date().toISOString(),
        createdBy: options.createdBy || 'system',
    };

    addEdgeToIndex(edge);
    window.dispatchEvent(new CustomEvent('edgesChanged'));

    return { success: true, edge };
}

/**
 * Remove relacao.
 * @param {string} edgeId - ID da edge
 * @returns {{ success: boolean, error?: string }}
 */
export function removeEdge(edgeId) {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) {
        return { success: false, error: `Relacao nao encontrada: ${edgeId}` };
    }

    removeEdgeFromIndex(edge);
    window.dispatchEvent(new CustomEvent('edgesChanged'));
    return { success: true };
}

/**
 * Atualiza propriedades de uma relacao.
 * @param {string} edgeId - ID da edge
 * @param {Object} properties - Novas propriedades
 * @returns {{ success: boolean, edge?: Object, error?: string }}
 */
export function updateEdge(edgeId, properties) {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) {
        return { success: false, error: `Relacao nao encontrada: ${edgeId}` };
    }

    edge.properties = { ...edge.properties, ...properties };
    edge.modifiedAt = new Date().toISOString();

    return { success: true, edge };
}

/**
 * Busca edge especifica.
 * @param {string} sourceId - ID origem
 * @param {string} targetId - ID destino
 * @param {string} typeId - Tipo (opcional)
 * @returns {Object|null}
 */
export function findEdge(sourceId, targetId, typeId = null) {
    return (
        edges.find(
            (e) => e.sourceId === sourceId && e.targetId === targetId && (typeId === null || e.type === typeId),
        ) || null
    );
}

/**
 * Obtem edge por ID.
 * @param {string} edgeId - ID da edge
 * @returns {Object|null}
 */
export function getEdgeById(edgeId) {
    return edges.find((e) => e.id === edgeId) || null;
}

// ----------------------------------------------------------------
// CONSULTAS DE EDGES
// ----------------------------------------------------------------

/**
 * Obtem todas as edges de saida de um elemento.
 * @param {string} elementId - ID do elemento
 * @param {Object} filter - Filtros opcionais
 * @param {string} filter.type - Filtrar por tipo
 * @returns {Object[]}
 */
export function getOutgoingEdges(elementId, filter = {}) {
    let result = edgesBySource.get(elementId) || [];

    if (filter.type) {
        result = result.filter((e) => e.type === filter.type);
    }

    return [...result];
}

/**
 * Obtem todas as edges de entrada para um elemento.
 * @param {string} elementId - ID do elemento
 * @param {Object} filter - Filtros opcionais
 * @param {string} filter.type - Filtrar por tipo
 * @returns {Object[]}
 */
export function getIncomingEdges(elementId, filter = {}) {
    let result = edgesByTarget.get(elementId) || [];

    if (filter.type) {
        result = result.filter((e) => e.type === filter.type);
    }

    return [...result];
}

/**
 * Obtem todas as edges conectadas a um elemento.
 * @param {string} elementId - ID do elemento
 * @param {Object} filter - Filtros opcionais
 * @returns {Object[]}
 */
export function getConnectedEdges(elementId, filter = {}) {
    const outgoing = getOutgoingEdges(elementId, filter);
    const incoming = getIncomingEdges(elementId, filter);
    return [...outgoing, ...incoming];
}

/**
 * Obtem IDs de elementos vizinhos.
 * @param {string} elementId - ID do elemento
 * @param {Object} options - Opcoes
 * @param {boolean} options.outgoing - Incluir vizinhos de saida
 * @param {boolean} options.incoming - Incluir vizinhos de entrada
 * @param {string} options.type - Filtrar por tipo de relacao
 * @returns {string[]}
 */
export function getNeighbors(elementId, options = { outgoing: true, incoming: true }) {
    const neighbors = new Set();

    if (options.outgoing !== false) {
        getOutgoingEdges(elementId, { type: options.type }).forEach((e) => {
            neighbors.add(e.targetId);
        });
    }

    if (options.incoming !== false) {
        getIncomingEdges(elementId, { type: options.type }).forEach((e) => {
            neighbors.add(e.sourceId);
        });
    }

    return Array.from(neighbors);
}

// ----------------------------------------------------------------
// TRAVESSIA DO GRAFO
// ----------------------------------------------------------------

/**
 * Busca em largura (BFS) a partir de um elemento.
 * @param {string} startId - ID do elemento inicial
 * @param {Object} options - Opcoes
 * @param {number} options.maxDepth - Profundidade maxima
 * @param {string} options.type - Tipo de relacao a seguir
 * @param {string} options.direction - 'outgoing'|'incoming'|'both'
 * @returns {{ visited: string[], paths: Map<string, string[]> }}
 */
export function bfs(startId, options = {}) {
    const maxDepth = options.maxDepth || Infinity;
    const direction = options.direction || 'both';

    const visited = new Set();
    const paths = new Map();
    const queue = [{ id: startId, depth: 0, path: [startId] }];

    visited.add(startId);
    paths.set(startId, [startId]);

    while (queue.length > 0) {
        const { id, depth, path } = queue.shift();

        if (depth >= maxDepth) continue;

        const neighbors = getNeighbors(id, {
            outgoing: direction !== 'incoming',
            incoming: direction !== 'outgoing',
            type: options.type,
        });

        for (const neighborId of neighbors) {
            if (!visited.has(neighborId)) {
                visited.add(neighborId);
                const newPath = [...path, neighborId];
                paths.set(neighborId, newPath);
                queue.push({ id: neighborId, depth: depth + 1, path: newPath });
            }
        }
    }

    return {
        visited: Array.from(visited),
        paths,
    };
}

/**
 * Encontra caminho mais curto entre dois elementos.
 * @param {string} startId - ID origem
 * @param {string} endId - ID destino
 * @param {Object} options - Opcoes de travessia
 * @returns {string[]|null} - Caminho ou null se nao existe
 */
export function findPath(startId, endId, options = {}) {
    const { paths } = bfs(startId, options);
    return paths.get(endId) || null;
}

/**
 * Encontra todos os elementos conectados transitivamente.
 * @param {string} elementId - ID do elemento
 * @param {string} edgeType - Tipo de relacao
 * @param {string} direction - 'outgoing'|'incoming'|'both'
 * @returns {string[]}
 */
export function findTransitiveClosure(elementId, edgeType, direction = 'outgoing') {
    const { visited } = bfs(elementId, { type: edgeType, direction });
    return visited.filter((id) => id !== elementId);
}

/**
 * Encontra elementos contidos (hierarquia).
 * @param {string} containerId - ID do container
 * @returns {string[]}
 */
export function findContainedElements(containerId) {
    return findTransitiveClosure(containerId, 'contains', 'outgoing');
}

/**
 * Encontra cadeia de monitoramento.
 * @param {string} monitorId - ID do ponto de monitoramento
 * @returns {string[]}
 */
export function findMonitoredTargets(monitorId) {
    return getNeighbors(monitorId, { outgoing: true, incoming: false, type: 'monitors' });
}

// ----------------------------------------------------------------
// ESTATISTICAS E ANALISE
// ----------------------------------------------------------------

/**
 * Conta edges por tipo.
 * @returns {Object}
 */
export function countEdgesByType() {
    const counts = {};
    edges.forEach((edge) => {
        counts[edge.type] = (counts[edge.type] || 0) + 1;
    });
    return counts;
}

/**
 * Obtem grau de um elemento (numero de conexoes).
 * @param {string} elementId - ID do elemento
 * @returns {{ in: number, out: number, total: number }}
 */
export function getDegree(elementId) {
    const inDegree = (edgesByTarget.get(elementId) || []).length;
    const outDegree = (edgesBySource.get(elementId) || []).length;
    return {
        in: inDegree,
        out: outDegree,
        total: inDegree + outDegree,
    };
}

/**
 * Encontra elementos isolados (sem conexoes).
 * @param {string[]} elementIds - Lista de IDs de elementos
 * @returns {string[]}
 */
export function findIsolatedElements(elementIds) {
    return elementIds.filter((id) => getDegree(id).total === 0);
}

/**
 * Encontra hubs (elementos com muitas conexoes).
 * @param {number} minConnections - Minimo de conexoes
 * @returns {Array<{ id: string, degree: Object }>}
 */
export function findHubs(minConnections = 5) {
    const hubs = [];
    const allIds = new Set([...edgesBySource.keys(), ...edgesByTarget.keys()]);

    for (const id of allIds) {
        const degree = getDegree(id);
        if (degree.total >= minConnections) {
            hubs.push({ id, degree });
        }
    }

    return hubs.sort((a, b) => b.degree.total - a.degree.total);
}

// ----------------------------------------------------------------
// EXPORTACAO E IMPORTACAO
// ----------------------------------------------------------------

/**
 * Exporta todas as edges.
 * @returns {Object[]}
 */
export function exportEdges() {
    return edges.map((edge) => ({
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        type: edge.type,
        bidirectional: edge.bidirectional,
        properties: edge.properties,
        createdAt: edge.createdAt,
        createdBy: edge.createdBy,
        ...(edge.modifiedAt && { modifiedAt: edge.modifiedAt }),
    }));
}

/**
 * Importa edges.
 * @param {Object[]} edgesToImport - Edges a importar
 * @param {Object} options - Opcoes
 * @param {boolean} options.replace - Substituir edges existentes
 * @returns {{ success: boolean, imported: number, errors: string[] }}
 */
export function importEdges(edgesToImport, options = {}) {
    if (options.replace) {
        initEdges([]);
    }

    const errors = [];
    let imported = 0;

    edgesToImport.forEach((edge, index) => {
        if (!edge.sourceId || !edge.targetId || !edge.type) {
            errors.push(`Edge ${index}: campos obrigatorios faltando`);
            return;
        }

        const edgeType = getEdgeType(edge.type);
        if (!edgeType) {
            errors.push(`Edge ${index}: tipo desconhecido ${edge.type}`);
            return;
        }

        addEdgeToIndex({
            id: edge.id || generateEdgeId(),
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            type: edge.type,
            bidirectional: edge.bidirectional || edgeType.bidirectional,
            properties: edge.properties || {},
            createdAt: edge.createdAt || new Date().toISOString(),
            createdBy: edge.createdBy || 'import',
        });
        imported++;
    });

    if (imported > 0) {
        window.dispatchEvent(new CustomEvent('edgesChanged'));
    }

    return {
        success: errors.length === 0,
        imported,
        errors,
    };
}

/**
 * Obtem todas as edges.
 * @returns {Object[]}
 */
export function getAllEdges() {
    return [...edges];
}

/**
 * Limpa todas as edges.
 */
export function clearEdges() {
    initEdges([]);
}
