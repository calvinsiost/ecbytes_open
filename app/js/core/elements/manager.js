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
   GERENCIADOR DE ELEMENTOS
   ================================================================

   Este modulo gerencia os elementos do modelo hidrogeologico.

   ELEMENTO = OBJETO NO MODELO
   Cada elemento tem:
   - family: tipo (pluma, poco, marcador, etc)
   - id: identificador unico
   - name: nome de exibicao
   - visible: se esta visivel na cena
   - data: dados especificos do tipo

   FUNCIONALIDADES:
   - Adicionar/remover elementos
   - Mostrar/esconder elementos
   - Sincronizar com a cena 3D
   - Listar e filtrar elementos

   ================================================================ */

import { createMesh, disposeMesh } from './meshFactory.js';
import { getFamily, getFamilyName } from './families.js';
import { getElementsGroup, requestRender } from '../../utils/scene/setup.js';
import { getCurrentLanguage } from '../../utils/i18n/translations.js';
import { CONFIG } from '../../config.js';

// ----------------------------------------------------------------
// ESTADO DO MODULO
// ----------------------------------------------------------------

/**
 * Lista de todos os elementos do modelo.
 * Array de objetos com dados de cada elemento.
 */
let elements = [];

/**
 * Mapa de lookup rapido (id -> elemento).
 * Mantido em sincronia com o array elements para O(1) getElementById.
 */
const elementMap = new Map();

/**
 * Contador para gerar IDs unicos.
 * Incrementa a cada novo elemento.
 */
let elementCounter = 0;

/**
 * ID do elemento selecionado na UI.
 */
let selectedElementId = null;

/**
 * Mapa de meshes (ID -> mesh 3D).
 * Relaciona elementos aos seus objetos 3D na cena.
 */
const meshMap = new Map();

/**
 * Cache de visibilidade efetiva (id -> boolean).
 * Invalida quando visible/hierarchy muda.
 */
const _effectiveVisibilityCache = new Map();
let _effectiveVisibilityDirty = true;

// ----------------------------------------------------------------
// FUNCOES DE ACESSO
// ----------------------------------------------------------------

/**
 * Retorna todos os elementos.
 *
 * @returns {Object[]} - Array de elementos
 */
export function getAllElements() {
    return elements;
}

/**
 * Retorna elemento selecionado.
 *
 * @returns {Object|null}
 */
export function getSelectedElement() {
    return elementMap.get(selectedElementId) || null;
}

/**
 * Define elemento selecionado.
 *
 * @param {string|null} id - ID do elemento
 */
export function setSelectedElement(id) {
    selectedElementId = id;
}

/**
 * Retorna elemento pelo ID.
 *
 * @param {string} id - ID do elemento
 * @returns {Object|undefined} - Elemento ou undefined
 */
export function getElementById(id) {
    return elementMap.get(id);
}

/**
 * Retorna e incrementa o contador de elementos.
 * Usado internamente pelo randomModel para gerar IDs unicos.
 * @returns {number} Proximo valor do contador
 */
export function nextElementCounter() {
    return ++elementCounter;
}

/**
 * Retorna elementos de uma familia especifica.
 *
 * @param {string} familyId - ID da familia
 * @returns {Object[]} - Elementos da familia
 */
export function getElementsByFamily(familyId) {
    return elements.filter((e) => e.family === familyId);
}

/**
 * Conta elementos por familia.
 *
 * @returns {Object} - Contagem {familyId: count}
 */
export function countByFamily() {
    const counts = {};
    elements.forEach((e) => {
        counts[e.family] = (counts[e.family] || 0) + 1;
    });
    return counts;
}

/**
 * Retorna total de elementos.
 *
 * @returns {number} - Quantidade de elementos
 */
export function getElementCount() {
    return elements.length;
}

/**
 * Retorna mesh 3D de um elemento pelo ID.
 *
 * @param {string} id - ID do elemento
 * @returns {THREE.Mesh|null} - Mesh 3D ou null
 */
export function getMeshByElementId(id) {
    return meshMap.get(id) || null;
}

/**
 * Rebind all known element meshes to the active scene group.
 * Re-vincula meshes criados antes do initScene() ao elementsGroup atual.
 * Idempotente: meshes já vinculados ao grupo são ignorados.
 *
 * @returns {{ totalMeshes: number, attached: number, alreadyAttached: number, skipped: number, hasGroup: boolean }}
 */
export function rebindMeshesToScene() {
    const elementsGroup = getElementsGroup();
    if (!elementsGroup) {
        return {
            totalMeshes: meshMap.size,
            attached: 0,
            alreadyAttached: 0,
            skipped: meshMap.size,
            hasGroup: false,
        };
    }

    let attached = 0;
    let alreadyAttached = 0;
    let skipped = 0;

    for (const mesh of meshMap.values()) {
        if (!mesh || typeof mesh !== 'object') {
            skipped++;
            continue;
        }

        if (mesh.parent === elementsGroup) {
            alreadyAttached++;
            continue;
        }

        try {
            if (mesh.parent && typeof mesh.parent.remove === 'function') {
                mesh.parent.remove(mesh);
            }
            elementsGroup.add(mesh);
            attached++;
        } catch {
            skipped++;
        }
    }

    if (attached > 0) requestRender();

    return {
        totalMeshes: meshMap.size,
        attached,
        alreadyAttached,
        skipped,
        hasGroup: true,
    };
}

/**
 * Retorna filhos diretos de um parent.
 *
 * @param {string|null} parentId
 * @returns {Object[]}
 */
export function getElementsByParent(parentId) {
    return elements
        .filter((e) => (e.hierarchy?.parentId ?? null) === (parentId ?? null))
        .sort((a, b) => (a.hierarchy?.order ?? 0) - (b.hierarchy?.order ?? 0));
}

/**
 * Retorna ancestrais de um elemento (pai imediato -> raiz).
 *
 * @param {string} elementId
 * @returns {Object[]}
 */
export function getAncestors(elementId) {
    const out = [];
    const seen = new Set();
    let current = getElementById(elementId);
    while (current?.hierarchy?.parentId) {
        const pid = current.hierarchy.parentId;
        if (seen.has(pid)) break;
        seen.add(pid);
        const parent = getElementById(pid);
        if (!parent) break;
        out.push(parent);
        current = parent;
    }
    return out;
}

/**
 * Retorna descendentes de um elemento.
 *
 * @param {string} elementId
 * @returns {Object[]}
 */
export function getDescendants(elementId) {
    const out = [];
    const seen = new Set();
    const visit = (id) => {
        if (seen.has(id)) return;
        seen.add(id);
        const children = getElementsByParent(id);
        for (const child of children) {
            out.push(child);
            visit(child.id);
        }
    };
    visit(elementId);
    return out;
}

/**
 * Retorna arvore completa de elementos (roots + children recursivo).
 *
 * @returns {Object[]}
 */
export function getElementTree() {
    const buildNode = (el) => ({
        element: el,
        children: getElementsByParent(el.id).map(buildNode),
    });
    return getElementsByParent(null).map(buildNode);
}

/**
 * Define parent de um elemento, validando ciclo e parent container.
 *
 * @param {string} elementId
 * @param {string|null} parentId
 * @returns {boolean}
 */
export function setParent(elementId, parentId) {
    const element = getElementById(elementId);
    if (!element) return false;
    if (parentId === elementId) return false;

    if (parentId != null) {
        const parent = getElementById(parentId);
        if (!parent) return false;
        if (!_isContainerFamily(parent.family)) return false;

        // Valida ciclo: parent nao pode ser descendente do proprio elemento
        const descendants = getDescendants(elementId);
        if (descendants.some((d) => d.id === parentId)) return false;
    }

    element.hierarchy = element.hierarchy || _defaultHierarchy(0);
    element.hierarchy.parentId = parentId ?? null;
    _normalizeSiblingOrder(parentId ?? null);
    _invalidateEffectiveVisibility();
    _syncEffectiveVisibilityForSubtree(elementId);
    window.dispatchEvent(new CustomEvent('ecbt:elementUpdated', { detail: { id: elementId } }));
    return true;
}

/**
 * Move elemento para novo parent/ordem.
 *
 * @param {string} elementId
 * @param {string|null} parentId
 * @param {number} order
 * @returns {boolean}
 */
export function moveElement(elementId, parentId, order) {
    const ok = setParent(elementId, parentId ?? null);
    if (!ok) return false;
    const element = getElementById(elementId);
    if (!element) return false;
    element.hierarchy.order = Number.isFinite(order) ? Math.max(0, order) : 0;
    _normalizeSiblingOrder(parentId ?? null);
    _invalidateEffectiveVisibility();
    _syncEffectiveVisibilityForSubtree(elementId);
    return true;
}

/**
 * Visibilidade efetiva: visible local && todos ancestrais visiveis.
 *
 * @param {string} elementId
 * @returns {boolean}
 */
export function isEffectivelyVisible(elementId) {
    if (_effectiveVisibilityDirty) {
        _effectiveVisibilityCache.clear();
        _effectiveVisibilityDirty = false;
    }
    if (_effectiveVisibilityCache.has(elementId)) {
        return _effectiveVisibilityCache.get(elementId);
    }
    const element = getElementById(elementId);
    if (!element) return false;
    if (element.visible === false) {
        _effectiveVisibilityCache.set(elementId, false);
        return false;
    }
    const seen = new Set([elementId]);
    let pid = element.hierarchy?.parentId ?? null;
    while (pid) {
        if (seen.has(pid)) {
            _effectiveVisibilityCache.set(elementId, false);
            return false;
        }
        seen.add(pid);
        const parent = getElementById(pid);
        if (!parent) break;
        if (parent.visible === false) {
            _effectiveVisibilityCache.set(elementId, false);
            return false;
        }
        pid = parent.hierarchy?.parentId ?? null;
    }
    _effectiveVisibilityCache.set(elementId, true);
    return true;
}

// ----------------------------------------------------------------
// FUNCOES DE ADICAO
// ----------------------------------------------------------------

/**
 * Adiciona um elemento ao modelo.
 *
 * @param {string} family - ID da familia
 * @param {string} id - ID unico do elemento
 * @param {string} name - Nome de exibicao
 * @param {Object} data - Dados especificos do elemento
 * @returns {Object} - Elemento criado
 *
 * PROCESSO:
 * 1. Cria registro do elemento
 * 2. Cria mesh 3D correspondente
 * 3. Adiciona mesh a cena
 * 4. Registra no mapa de meshes
 */

/**
 * ECBT01: Congela matrixAutoUpdate recursivamente (Groups + children).
 * Calcula a matriz final e desabilita re-calculo automatico por frame.
 */
function _freezeMatrix(obj) {
    obj.updateMatrix();
    obj.matrixAutoUpdate = false;
    if (obj.children) {
        for (const child of obj.children) _freezeMatrix(child);
    }
}

export function addElement(family, id, name, data, meta = {}) {
    const familyDef = getFamily(family) || {};
    const elementId = id || `${family}-${nextElementCounter()}`;

    // Cria objeto do elemento
    const element = {
        family,
        id: elementId,
        name,
        visible: true,
        iconClass: meta.iconClass || '',
        color: meta.color || '',
        description: meta.description || '',
        label: meta.label || name,
        labels: meta.labels && typeof meta.labels === 'object' ? { ...meta.labels } : {},
        autoLabel: meta.autoLabel === true,
        data,
        stamps: Array.isArray(meta.stamps) ? meta.stamps : Array.isArray(data?.stamps) ? data.stamps : [],
        messages: Array.isArray(meta.messages) ? meta.messages : [],
        hierarchy: _normalizeHierarchy(meta.hierarchy, family, null),
    };

    // Adiciona a lista e ao mapa de lookup
    elements.push(element);
    elementMap.set(elementId, element);

    // Containers nao possuem mesh 3D
    if (!familyDef.isContainer) {
        const mesh = createMesh(element);
        if (mesh) {
            mesh.userData.elementId = elementId;

            // ECBT01: Congela matriz de transformacao (CPU optimization)
            // Meshes sao estaticos apos criacao; updateMatrix() chamado manualmente quando movidos
            _freezeMatrix(mesh);

            const elementsGroup = getElementsGroup();
            if (elementsGroup) {
                elementsGroup.add(mesh);
            }
            meshMap.set(elementId, mesh);
        }
    }

    _normalizeSiblingOrder(element.hierarchy.parentId);
    _invalidateEffectiveVisibility();
    _syncEffectiveVisibilityForSubtree(elementId);
    requestRender();
    window.dispatchEvent(new CustomEvent('ecbt:elementAdded', { detail: { id: elementId } }));
    window.dispatchEvent(new CustomEvent('elementAdded', { detail: { id: elementId } }));
    return element;
}

/**
 * Adiciona um novo elemento de uma familia especifica.
 * Gera ID e nome automaticamente.
 *
 * @param {string} familyId - ID da familia
 * @returns {Object|null} - Elemento criado ou null se falhou
 *
 * EXEMPLO:
 *   const element = addNewElement('plume');
 *   // Cria elemento com ID 'plume-1' e nome 'Contamination Plume 1'
 */
export function addNewElement(familyId) {
    const family = getFamily(familyId);
    if (!family) {
        console.warn(`Familia nao encontrada: ${familyId}`);
        return null;
    }

    // Incrementa contador para ID unico
    elementCounter++;

    // Gera ID e nome
    const id = `${familyId}-${elementCounter}`;
    const name = `${getFamilyName(family)} ${elementCounter}`;

    // Gera dados default baseado no tipo
    const data = generateDefaultData(familyId);
    const meta = generateDefaultMeta(familyId, name);
    meta.autoLabel = true;

    return addElement(familyId, id, name, data, meta);
}

/**
 * Gera dados padrao para novo elemento.
 * Cada tipo tem valores iniciais diferentes.
 *
 * @param {string} familyId - ID da familia
 * @returns {Object} - Dados padrao
 */
function generateDefaultData(familyId) {
    // Posicao aleatoria para variar novos elementos
    const randRange = (min, max) => Math.random() * (max - min) + min;

    switch (familyId) {
        case 'plume':
            return {
                depth: { level: 'shallow', top: 0, bottom: -15 },
                shape: { radiusX: 10, radiusY: 8, radiusZ: 4 },
                center: {
                    x: randRange(-10, 10),
                    y: -7.5,
                    z: randRange(-10, 10),
                },
            };

        case 'well':
            return {
                coordinates: {
                    easting: randRange(-15, 15),
                    northing: randRange(-15, 15),
                    elevation: 0,
                },
                construction: {
                    totalDepth: 50,
                    diameter: 4,
                },
            };

        case 'marker':
            return {
                position: {
                    x: randRange(-10, 10),
                    y: 0,
                    z: randRange(-10, 10),
                },
                observations: [
                    createObservation({
                        x: randRange(-10, 10),
                        y: 0,
                        z: randRange(-10, 10),
                    }),
                ],
            };

        case 'sensor':
            return {
                position: {
                    x: randRange(-15, 15),
                    y: 0,
                    z: randRange(-15, 15),
                },
                userId: Math.ceil(Math.random() * 10),
                connectorKey: '',
                sensorType: 'multiparameter',
                monitoredParameters: ['temperature', 'pH', 'conductivity', 'water_level'],
                endpoints: {
                    identity: 'https://jsonplaceholder.typicode.com/users/{userId}',
                    metadata:
                        'https://fakerapi.it/api/v1/custom?_quantity=1&uuid=uuid&serial=buildingNumber&coord_lat=latitude&coord_lon=longitude',
                    readings: 'https://fakerapi.it/api/v1/custom?_quantity=1&{fields}',
                },
                profile: null,
                evaluation: null,
                weather: null,
                latestReadings: [],
                lastFetch: null,
                errors: [],
                observations: [],
            };

        case 'intangible':
            return {
                position: {
                    x: randRange(-10, 10),
                    y: 3,
                    z: randRange(-10, 10),
                },
                assetType: 'contract',
                observations: [createObservation({})],
            };

        case 'generic':
            return {
                position: {
                    x: randRange(-10, 10),
                    y: 2,
                    z: randRange(-10, 10),
                },
                observations: [createObservation({})],
            };

        case 'blueprint':
            return {
                category: 'industrial',
                crs_source: 'EPSG:4326',
                geometry: null,
                area_m2: 0,
                vertices: [
                    { x: -30, z: -20 },
                    { x: 30, z: -20 },
                    { x: 30, z: 20 },
                    { x: -30, z: 20 },
                ],
                layers: [],
                compliance: [],
                sensors: [],
                metadata: {},
                observations: [createObservation({})],
            };

        case 'site_project':
        case 'site_area':
        case 'site_zone':
            return {};

        default:
            return {
                observations: [createObservation({})],
            };
    }
}

/**
 * Gera metadados padrao para elemento.
 *
 * @param {string} familyId
 * @param {string} name
 * @returns {Object}
 */
function generateDefaultMeta(familyId, name) {
    return {
        iconClass: `icon-${familyId}`,
        color: '',
        label: name,
    };
}

/**
 * Cria uma observacao padrao.
 *
 * @param {Object} base
 * @returns {Object}
 */
function createObservation(base) {
    return {
        x: base.x || 0,
        y: base.y || 0,
        z: base.z || 0,
        reading: base.reading || 0,
        unit: base.unit || 'mg/L',
        date: base.date || new Date().toISOString().slice(0, 10),
        qualFields: Array.isArray(base.qualFields) ? base.qualFields : [],
    };
}

// ----------------------------------------------------------------
// FUNCOES DE REMOCAO
// ----------------------------------------------------------------

/**
 * Remove um elemento do modelo.
 *
 * @param {string} id - ID do elemento
 * @returns {boolean} - true se removido, false se nao encontrado
 *
 * PROCESSO:
 * 1. Remove mesh da cena
 * 2. Libera memoria do mesh
 * 3. Remove do mapa
 * 4. Remove da lista
 */
export function removeElement(id) {
    const index = elements.findIndex((e) => e.id === id);

    if (index === -1) {
        console.warn(`Elemento nao encontrado: ${id}`);
        return false;
    }

    // Remove mesh 3D
    const mesh = meshMap.get(id);
    if (mesh) {
        const elementsGroup = getElementsGroup();
        if (elementsGroup) {
            elementsGroup.remove(mesh);
        }
        disposeMesh(mesh);
        meshMap.delete(id);
    }

    // Filhos diretos passam a raiz quando parent e removido
    const children = getElementsByParent(id);
    for (const child of children) {
        child.hierarchy = child.hierarchy || _defaultHierarchy(0);
        child.hierarchy.parentId = null;
    }

    // Remove da lista e do mapa
    elements.splice(index, 1);
    elementMap.delete(id);

    _normalizeSiblingOrder(null);
    _invalidateEffectiveVisibility();
    for (const child of children) {
        _syncEffectiveVisibilityForSubtree(child.id);
    }
    requestRender();
    window.dispatchEvent(new CustomEvent('ecbt:elementRemoved', { detail: { id } }));
    return true;
}

/**
 * Remove todos os elementos de uma familia.
 *
 * @param {string} familyId - ID da familia
 * @returns {number} - Quantidade de elementos removidos
 */
export function removeElementsByFamily(familyId) {
    const toRemove = elements.filter((e) => e.family === familyId).map((e) => e.id);

    toRemove.forEach((id) => removeElement(id));

    return toRemove.length;
}

/**
 * Remove todos os elementos do modelo.
 */
export function clearAllElements() {
    // Remove todos os meshes
    elements.forEach((e) => {
        const mesh = meshMap.get(e.id);
        if (mesh) {
            const elementsGroup = getElementsGroup();
            if (elementsGroup) {
                elementsGroup.remove(mesh);
            }
            disposeMesh(mesh);
        }
    });

    // Limpa estruturas
    elements = [];
    elementMap.clear();
    meshMap.clear();
    elementCounter = 0;
    selectedElementId = null;
    _invalidateEffectiveVisibility();
    window.dispatchEvent(new CustomEvent('ecbt:elementsCleared'));
}

// ----------------------------------------------------------------
// FUNCOES DE VISIBILIDADE
// ----------------------------------------------------------------

/**
 * Alterna visibilidade de um elemento.
 *
 * @param {string} id - ID do elemento
 * @returns {boolean} - Novo estado de visibilidade
 */
export function toggleElementVisibility(id) {
    const element = elementMap.get(id);
    if (element) {
        element.visible = !element.visible;
        _invalidateEffectiveVisibility();
        _syncEffectiveVisibilityForSubtree(id);
        requestRender();
        return element.visible;
    }

    return false;
}

/**
 * Define visibilidade de um elemento.
 *
 * @param {string} id - ID do elemento
 * @param {boolean} visible - Novo estado
 */
export function setElementVisibility(id, visible) {
    const element = elementMap.get(id);

    if (element) {
        element.visible = visible;
    }
    if (element) {
        _invalidateEffectiveVisibility();
        _syncEffectiveVisibilityForSubtree(id);
    }
}

// ----------------------------------------------------------------
// FUNCOES DE SERIALIZACAO
// ----------------------------------------------------------------

/**
 * Exporta elementos para formato salvavel.
 *
 * @returns {Object[]} - Copia dos elementos
 */
export function exportElements() {
    return elements.map((e) => ({
        family: e.family,
        id: e.id,
        name: e.name,
        visible: e.visible,
        iconClass: e.iconClass || '',
        color: e.color || '',
        description: e.description || '',
        label: e.label || e.name,
        labels: e.labels || {},
        autoLabel: e.autoLabel === true,
        data: e.data,
        hierarchy: e.hierarchy || _defaultHierarchy(0),
        stamps: Array.isArray(e.stamps) ? e.stamps : [],
        messages: Array.isArray(e.messages) ? e.messages : [],
    }));
}

/**
 * Importa elementos de dados salvos.
 * Substitui todos os elementos atuais.
 *
 * @param {Object[]} importedElements - Elementos a importar
 */
export function importElements(importedElements) {
    // Limpa elementos atuais
    clearAllElements();

    // Adiciona elementos importados
    if (Array.isArray(importedElements)) {
        const pendingHierarchy = [];
        importedElements.forEach((e) => {
            addElement(e.family, e.id, e.name, e.data, {
                iconClass: e.iconClass,
                color: e.color,
                description: e.description,
                label: e.label,
                labels: e.labels,
                autoLabel: e.autoLabel,
                hierarchy: _defaultHierarchy(0),
                stamps: e.stamps,
                messages: e.messages,
            });
            pendingHierarchy.push({
                id: e.id,
                parentId: e.hierarchy?.parentId ?? null,
                order: Number.isFinite(e.hierarchy?.order) ? e.hierarchy.order : 0,
            });
            if (e.visible === false) {
                setElementVisibility(e.id, false);
            }
        });

        // Segunda passada para parent/order (com todos IDs já registrados)
        for (const item of pendingHierarchy) {
            const element = getElementById(item.id);
            if (!element) continue;
            if (item.parentId && !setParent(item.id, item.parentId)) {
                element.hierarchy.parentId = null;
            }
            element.hierarchy.order = item.order;
        }

        // Reindexa por parent para manter ordem consistente
        const parentIds = new Set(elements.map((e) => e.hierarchy?.parentId ?? null));
        parentIds.forEach((pid) => _normalizeSiblingOrder(pid));
        _invalidateEffectiveVisibility();
        elements.forEach((e) => _syncEffectiveVisibilityForSubtree(e.id));
    }
}

// ----------------------------------------------------------------
// FUNCOES DE ATUALIZACAO
// ----------------------------------------------------------------

/**
 * Atualiza label de todos os elementos para o idioma atual.
 * Prioridade: labels[lang] > autoLabel > labels fallback > label existente.
 * Chamado quando o idioma muda (evento languageChanged).
 */
export function refreshAutoLabelNames() {
    const lang = getCurrentLanguage();
    for (const element of elements) {
        // 1. Override customizado para este idioma
        if (element.labels?.[lang]) {
            element.label = element.labels[lang];
            // Se autoLabel, tambem atualiza o name
            if (element.autoLabel) {
                const family = getFamily(element.family);
                if (family) {
                    const match = element.id.match(/-(\d+)$/);
                    const counter = match ? match[1] : '';
                    const familyName = getFamilyName(family);
                    element.name = counter ? `${familyName} ${counter}` : familyName;
                }
            }
            continue;
        }
        // 2. Auto-traducao pela familia
        if (element.autoLabel) {
            const family = getFamily(element.family);
            if (!family) continue;
            const familyName = getFamilyName(family);
            const match = element.id.match(/-(\d+)$/);
            const counter = match ? match[1] : '';
            const newName = counter ? `${familyName} ${counter}` : familyName;
            element.name = newName;
            element.label = newName;
            continue;
        }
        // 3. Fallback para outro idioma no mapa labels
        if (element.labels) {
            const fallback = element.labels.en || Object.values(element.labels)[0];
            if (fallback) element.label = fallback;
        }
        // 4. Senao, element.label permanece como esta
    }
}

/**
 * Atualiza propriedades editaveis de um elemento.
 *
 * @param {string} id
 * @param {Object} updates
 */
export function updateElement(id, updates) {
    const element = getElementById(id);
    if (!element) return null;

    if (updates.name !== undefined) {
        element.name = updates.name;
    }
    if (updates.label !== undefined) {
        element.label = updates.label;
        // Salva no mapa por idioma (labels multilingual)
        if (!element.labels) element.labels = {};
        element.labels[getCurrentLanguage()] = updates.label;
    }
    if (updates.iconClass !== undefined) {
        element.iconClass = updates.iconClass;
    }
    if (updates.description !== undefined) {
        element.description = updates.description;
    }
    if (updates.color !== undefined) {
        element.color = updates.color;
    }
    if (updates.data !== undefined) {
        element.data = updates.data;
    }
    if (updates.hierarchy !== undefined) {
        const parentId = updates.hierarchy?.parentId ?? null;
        if (!setParent(id, parentId)) {
            // Se parent invalido, ainda normaliza outros campos do hierarchy.
            element.hierarchy = _normalizeHierarchy(updates.hierarchy, element.family, id);
        } else if (Number.isFinite(updates.hierarchy?.order)) {
            element.hierarchy.order = updates.hierarchy.order;
            _normalizeSiblingOrder(parentId);
        }
    }
    if (updates.visible !== undefined) {
        setElementVisibility(id, !!updates.visible);
    }

    _invalidateEffectiveVisibility();
    _syncEffectiveVisibilityForSubtree(id);
    window.dispatchEvent(new CustomEvent('ecbt:elementUpdated', { detail: { id } }));
    return element;
}

/**
 * Reconstroi a mesh 3D de um elemento.
 * Usado quando element.data muda de forma que afeta a geometria 3D
 * (ex: import DXF com novos vertices para blueprint).
 *
 * @param {string} id - ID do elemento
 * @returns {boolean} - true se reconstruiu com sucesso
 */
export function rebuildElementMesh(id) {
    const element = getElementById(id);
    if (!element) return false;

    const group = getElementsGroup();
    let oldMesh = null;

    // Remove mesh anterior
    oldMesh = meshMap.get(id);
    if (oldMesh) {
        if (group) group.remove(oldMesh);
        disposeMesh(oldMesh);
        meshMap.delete(id);
    }

    // Cria nova mesh com dados atualizados
    const newMesh = createMesh(element);
    if (newMesh) {
        newMesh.userData.elementId = id;
        _freezeMatrix(newMesh);
        if (group) group.add(newMesh);
        meshMap.set(id, newMesh);

        // Notifica observadores (ex: symbology manager) que a mesh foi trocada.
        window.dispatchEvent(
            new CustomEvent('meshReplaced', {
                detail: { elementId: id, oldMesh, newMesh },
            }),
        );
    }

    requestRender();
    return true;
}

function _defaultHierarchy(order = 0) {
    return { level: 'element', parentId: null, order: Number.isFinite(order) ? order : 0 };
}

function _normalizeHierarchy(input, familyId, elementId) {
    const h = input && typeof input === 'object' ? input : {};
    return {
        level: typeof h.level === 'string' ? h.level : 'element',
        parentId: typeof h.parentId === 'string' && h.parentId !== elementId ? h.parentId : null,
        order: Number.isFinite(h.order) ? h.order : 0,
    };
}

function _isContainerFamily(familyId) {
    return getFamily(familyId)?.isContainer === true;
}

function _normalizeSiblingOrder(parentId) {
    const siblings = getElementsByParent(parentId ?? null);
    siblings.forEach((el, idx) => {
        el.hierarchy = el.hierarchy || _defaultHierarchy(idx);
        el.hierarchy.order = idx;
    });
}

function _invalidateEffectiveVisibility() {
    _effectiveVisibilityDirty = true;
}

function _syncEffectiveVisibilityForSubtree(rootId) {
    const ids = [rootId, ...getDescendants(rootId).map((d) => d.id)];
    for (const id of ids) {
        const mesh = meshMap.get(id);
        if (mesh) {
            mesh.visible = isEffectivelyVisible(id);
        }
    }
}

// ----------------------------------------------------------------
// GERAÇÃO ALEATÓRIA — importada de randomModel.js
// Re-exporta para manter compatibilidade com call sites existentes
// ----------------------------------------------------------------
export { generateRandomModel, createDefaultElements } from './randomModel.js';
