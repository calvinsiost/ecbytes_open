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
   OBSERVATION HANDLERS — Field measurements and readings
   Acoes sobre observacoes (medicoes feitas em campo)

   Uma "observacao" e uma medicao coletada em campo por um tecnico:
   - pH da agua subterranea
   - Concentracao de benzeno em mg/L
   - Condutividade eletrica em uS/cm
   - Temperatura da agua em graus Celsius

   Cada observacao esta vinculada a um elemento (poco, ponto de coleta)
   e a uma campanha de amostragem (data e equipe).
   ================================================================ */

import { getSelectedElement, updateElement, getElementById, getAllElements } from '../../core/elements/manager.js';
import { CONFIG } from '../../config.js';
import { convert } from '../../core/units/converter.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { buildElementCostEntry } from '../../core/ingestion/documents/costCatalog.js';
import { updateElementDetails, updateCampaignsList } from '../ui/lists.js';
import { canEditElement, isAccessControlActive } from '../auth/permissions.js';
import { getCurrentUser } from '../auth/session.js';
import {
    addPlannedReading,
    removePlannedReading,
    getCampaignById,
    getAllCampaigns,
} from '../../core/campaigns/manager.js';
import { getUserConstants, getUserConstantById } from '../../core/constants/manager.js';
import { generateId } from '../helpers/id.js';
import { escapeHtml } from '../helpers/html.js';
import { createBinding, removeBinding, isBound } from '../../core/bindings/resolver.js';

// ----------------------------------------------------------------
// updateAllUI injection — evita dependencia circular com main.js
// ----------------------------------------------------------------

let _updateAllUI = null;

/**
 * Set the updateAllUI callback.
 * Chamada pelo index.js durante a inicializacao.
 * @param {Function} fn - The updateAllUI function
 */
export function setUpdateAllUI(fn) {
    _updateAllUI = fn;
}

function updateAllUI() {
    if (_updateAllUI) _updateAllUI();
}

// ----------------------------------------------------------------
// HELPER: Get observations from element
// Obtem a lista de observacoes do elemento selecionado.
// ----------------------------------------------------------------

/**
 * Get a copy of the observations array from an element.
 * Retorna uma copia das observacoes do elemento para edicao segura.
 *
 * @param {Object} element - The element object
 * @returns {Array} Copy of observations array
 */
function getObservations(element) {
    return Array.isArray(element?.data?.observations) ? [...element.data.observations] : [];
}

/**
 * Save observations back to the element.
 * Salva as observacoes modificadas de volta no elemento.
 *
 * @param {string} elementId - Element ID
 * @param {Object} element - Element object
 * @param {Array} observations - Updated observations array
 */
function saveObservations(elementId, element, observations) {
    updateElement(elementId, {
        data: { ...element.data, observations },
    });
}

// ----------------------------------------------------------------
// OBSERVATION CRUD
// Adicionar, editar e remover observacoes (medicoes de campo).
// ----------------------------------------------------------------

/**
 * Add a new empty observation to an element.
 * Adiciona uma nova medicao vazia a um elemento.
 * O tecnico depois preenche os dados (parametro, valor, unidade).
 *
 * @param {string} elementId - ID of the element
 */
export function handleAddObservation(elementIdOrParams) {
    // P2: Headless mode — add observation without UI (pipeline automation)
    if (typeof elementIdOrParams === 'object' && elementIdOrParams?._headless) {
        const { elementId, parameterId, value, unit, date, campaignId } = elementIdOrParams;
        const element = getElementById(elementId);
        if (!element) return { error: 'element_not_found' };

        const observations = getObservations(element);
        // Sanitizar incerteza no path headless (A3 fix)
        const rawUnc = elementIdOrParams.uncertainty;
        const rawUncType = elementIdOrParams.uncertaintyType;
        const rawK = elementIdOrParams.coverageFactor;
        observations.push({
            id: generateId('obs'),
            showPlanning: false,
            plannedDate: null,
            plannedParameterId: null,
            plannedUnitId: null,
            plannedX: null,
            plannedY: null,
            plannedZ: null,
            expectedValue: null,
            x: 0,
            y: 0,
            z: 0,
            date: date || new Date().toISOString().slice(0, 10),
            campaignId: campaignId || null,
            parameterId: parameterId || null,
            value: value ?? null,
            unitId: unit || null,
            autoConvert: false,
            additionalReadings: [],
            variables: {},
            detect_flag: null,
            qualifier: null,
            detection_limit: null,
            cas_number: null,
            lab_name: null,
            sample_code: null,
            analytical_method: null,
            dilution_factor: null,
            sample_matrix: null,
            uncertainty:
                rawUnc != null && Number.isFinite(Number(rawUnc)) && Number(rawUnc) >= 0 ? Number(rawUnc) : null,
            uncertaintyType: ['absolute', 'relative'].includes(rawUncType) ? rawUncType : null,
            coverageFactor: rawK != null && Number.isFinite(Number(rawK)) && Number(rawK) > 0 ? Number(rawK) : null,
            credentialLevel: getCurrentUser()?.credentialLevel || 'common',
            createdBy: getCurrentUser()?.email || null,
        });
        saveObservations(elementId, element, observations);
        return { success: true, observationCount: observations.length };
    }

    // Original UI path
    const element = getSelectedElement();
    if (!element) return;

    if (isAccessControlActive() && !canEditElement(element.id)) {
        showToast(t('permissionDenied') || 'Permission denied', 'error');
        return;
    }

    const observations = getObservations(element);
    observations.push({
        id: generateId('obs'),
        showPlanning: false,
        plannedDate: null,
        plannedParameterId: null,
        plannedUnitId: null,
        plannedX: null,
        plannedY: null,
        plannedZ: null,
        expectedValue: null,
        x: 0,
        y: 0,
        z: 0,
        date: new Date().toISOString().slice(0, 10),
        campaignId: null,
        parameterId: null,
        value: null,
        unitId: null,
        autoConvert: false,
        additionalReadings: [],
        variables: {},
        detect_flag: null,
        qualifier: null,
        detection_limit: null,
        cas_number: null,
        lab_name: null,
        sample_code: null,
        analytical_method: null,
        dilution_factor: null,
        sample_matrix: null,
        uncertainty: null,
        uncertaintyType: null,
        coverageFactor: null,
        credentialLevel: getCurrentUser()?.credentialLevel || 'common',
        createdBy: getCurrentUser()?.email || null,
    });

    saveObservations(element.id, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Update a field in an existing observation.
 * Atualiza um campo de uma observacao existente (data, posicao, etc.)
 *
 * @param {string} elementId - Element ID
 * @param {number} index - Observation index
 * @param {string} field - Field name
 * @param {*} value - New value
 */
export function handleObservationChange(elementId, index, field, value) {
    // Campos de auditoria sao imutaveis — definidos apenas na criacao
    if (field === 'credentialLevel' || field === 'createdBy') return;

    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[index]) return;

    // Protecao de mutacao: campo vinculado rejeita escrita manual
    if (isBound(observations[index], field)) {
        showToast(t('fieldBound') || 'Field is bound — unbind before editing', 'warning');
        return;
    }

    // Campos de texto mantem como string; campos numericos convertem para numero.
    const stringFields = [
        'date',
        'unit',
        'campaignId',
        'parameterId',
        'unitId',
        'plannedDate',
        'plannedParameterId',
        'plannedUnitId',
        'detect_flag',
        'qualifier',
        'cas_number',
        'lab_name',
        'sample_code',
        'analytical_method',
        'sample_matrix',
        'uncertaintyType',
    ];
    observations[index] = {
        ...observations[index],
        [field]: stringFields.includes(field) ? value : Number(value),
    };

    saveObservations(elementId, element, observations);
    updateAllUI();
}

/**
 * Remove an observation from an element.
 * Remove uma medicao de um elemento.
 *
 * @param {string} elementId - Element ID
 * @param {number} index - Observation index to remove
 */
export function handleRemoveObservation(elementId, index) {
    const element = getSelectedElement();
    if (!element) return;

    if (isAccessControlActive() && !canEditElement(element.id)) {
        showToast(t('permissionDenied') || 'Permission denied', 'error');
        return;
    }

    const observations = getObservations(element);
    observations.splice(index, 1);

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

// ----------------------------------------------------------------
// PLANNING TOGGLE
// Liga/desliga modo planejamento em uma observacao.
// Quando ligado, mostra campos planned e registra na campanha.
// ----------------------------------------------------------------

/**
 * Toggle planning mode for an observation.
 * Quando ativado, mostra todos os campos planejados e registra
 * automaticamente a leitura na campanha associada.
 *
 * @param {string} elementId - Element ID
 * @param {number} index - Observation index
 */
export function handleTogglePlanning(elementId, index) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[index]) return;

    const obs = observations[index];
    const newState = !obs.showPlanning;

    // Se ligando o planejamento, pre-preenche campos planned
    // com os valores atuais como ponto de partida
    if (newState && !obs.plannedDate) {
        obs.plannedDate = obs.date || new Date().toISOString().slice(0, 10);
    }
    if (newState && !obs.plannedParameterId && obs.parameterId) {
        obs.plannedParameterId = obs.parameterId;
    }
    if (newState && !obs.plannedUnitId && obs.unitId) {
        obs.plannedUnitId = obs.unitId;
    }
    if (newState && obs.plannedX == null) obs.plannedX = obs.x ?? 0;
    if (newState && obs.plannedY == null) obs.plannedY = obs.y ?? 0;
    if (newState && obs.plannedZ == null) obs.plannedZ = obs.z ?? 0;

    obs.showPlanning = newState;
    observations[index] = obs;

    if (obs.campaignId) {
        const campaign = getCampaignById(obs.campaignId);
        if (campaign) {
            if (newState) {
                // Ligando: registra como planned reading na campanha
                const alreadyPlanned = (campaign.plannedReadings || []).some(
                    (pr) => pr.elementId === elementId && pr.parameterId === obs.parameterId,
                );
                if (!alreadyPlanned && obs.parameterId) {
                    addPlannedReading(obs.campaignId, {
                        elementId,
                        parameterId: obs.plannedParameterId || obs.parameterId,
                        x: obs.plannedX,
                        y: obs.plannedY,
                        z: obs.plannedZ,
                        expectedValue: obs.expectedValue,
                    });
                }
            } else {
                // Desligando: remove planned reading correspondente da campanha
                const idx = (campaign.plannedReadings || []).findIndex(
                    (pr) => pr.elementId === elementId && pr.parameterId === obs.parameterId,
                );
                if (idx !== -1) {
                    removePlannedReading(obs.campaignId, idx);
                }
            }
        }
    }

    saveObservations(elementId, element, observations);
    updateElementDetails();
    // Atualiza painel de campanhas para refletir o novo planned reading
    updateCampaignsList();
    updateAllUI();
}

// ----------------------------------------------------------------
// QUALITATIVE FIELDS (qual fields)
// Campos qualitativos adicionais em cada observacao.
// Ex: cor da agua, odor, presenca de fase livre.
// ----------------------------------------------------------------

/**
 * Add a qualitative field to an observation.
 * Adiciona um campo qualitativo a uma observacao.
 * Campos qualitativos descrevem aspectos como cor, odor ou turbidez.
 *
 * @param {string} elementId - Element ID
 * @param {number} observationIndex - Observation index
 */
export function handleAddQualField(elementId, observationIndex) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[observationIndex]) return;

    const qualFields = Array.isArray(observations[observationIndex].qualFields)
        ? [...observations[observationIndex].qualFields]
        : [];

    const defaultField = CONFIG.QUAL_FIELDS?.[0];
    qualFields.push({
        fieldId: defaultField?.id || '__custom__',
        label: defaultField?.label || t('customField'),
        value: defaultField?.defaultValue || '',
        unit: defaultField?.unitOptions?.[0] || '',
        isCustom: !defaultField,
        outOfStandard: false,
    });

    observations[observationIndex] = { ...observations[observationIndex], qualFields };
    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Remove a qualitative field from an observation.
 * Remove um campo qualitativo de uma observacao.
 *
 * @param {string} elementId - Element ID
 * @param {number} observationIndex - Observation index
 * @param {number} fieldIndex - Qual field index to remove
 */
export function handleRemoveQualField(elementId, observationIndex, fieldIndex) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[observationIndex]) return;

    const qualFields = Array.isArray(observations[observationIndex].qualFields)
        ? [...observations[observationIndex].qualFields]
        : [];
    qualFields.splice(fieldIndex, 1);

    observations[observationIndex] = { ...observations[observationIndex], qualFields };
    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Check if a unit is within the allowed standard units.
 * Verifica se a unidade usada e uma das unidades padrao permitidas.
 *
 * @param {string} unit - Unit to check
 * @param {string[]} allowedUnits - List of allowed units
 * @returns {boolean}
 */
function isUnitStandard(unit, allowedUnits) {
    if (!allowedUnits || allowedUnits.length === 0) {
        return unit === '' || unit === null || unit === undefined;
    }
    return allowedUnits.includes(unit);
}

/**
 * Update a qualitative field value.
 * Atualiza o valor de um campo qualitativo.
 * Detecta automaticamente se a unidade e padrao ou fora do padrao.
 *
 * @param {string} elementId - Element ID
 * @param {number} observationIndex - Observation index
 * @param {number} fieldIndex - Qual field index
 * @param {string} field - Field property to update
 * @param {*} value - New value
 */
export function handleQualFieldChange(elementId, observationIndex, fieldIndex, field, value) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[observationIndex]) return;

    const qualFields = Array.isArray(observations[observationIndex].qualFields)
        ? [...observations[observationIndex].qualFields]
        : [];
    const current = { ...(qualFields[fieldIndex] || {}) };

    if (field === 'fieldId') {
        if (value === '__custom__') {
            current.fieldId = '__custom__';
            current.label = t('customField');
            current.unit = current.unit || '';
            current.isCustom = true;
            current.outOfStandard = current.unit ? !isUnitStandard(current.unit, null) : false;
        } else {
            const standard = CONFIG.QUAL_FIELDS?.find((opt) => opt.id === value);
            current.fieldId = value;
            current.label = standard?.label || value;
            current.unit = standard?.unitOptions?.[0] || '';
            current.value = standard?.defaultValue ?? current.value ?? '';
            current.isCustom = false;
            current.outOfStandard = !isUnitStandard(current.unit, standard?.unitOptions || []);
        }
    } else {
        current[field] = value;
        const standard = CONFIG.QUAL_FIELDS?.find((opt) => opt.id === current.fieldId);
        current.outOfStandard = !isUnitStandard(current.unit, standard?.unitOptions || []);
    }

    qualFields[fieldIndex] = current;
    observations[observationIndex] = { ...observations[observationIndex], qualFields };
    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

// ----------------------------------------------------------------
// PARAMETER & CUSTOM FIELD HANDLERS
// Mudar o parametro medido (benzeno, pH, etc.) ou campos extras.
// ----------------------------------------------------------------

/**
 * Handle parameter change in an observation.
 * Quando o tecnico muda o parametro (ex: de pH para benzeno),
 * a unidade padrao e atualizada automaticamente.
 *
 * @param {string} elementId - Element ID
 * @param {number} index - Observation index
 * @param {string} parameterId - New parameter ID
 */
export function handleObservationParameterChange(elementId, index, parameterId) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[index]) return;

    // Busca a unidade padrao do parametro selecionado
    const parameter = CONFIG.PARAMETERS?.find((p) => p.id === parameterId);
    observations[index] = {
        ...observations[index],
        parameterId,
        unitId: parameter?.defaultUnitId || null,
        customFields: {},
    };

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Handle custom field change in an observation.
 * Atualiza campos personalizados de uma observacao.
 *
 * @param {string} elementId - Element ID
 * @param {number} observationIndex - Observation index
 * @param {string} fieldId - Custom field ID
 * @param {*} value - New value
 */
export function handleCustomFieldChange(elementId, observationIndex, fieldId, value) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[observationIndex]) return;

    const customFields = { ...(observations[observationIndex].customFields || {}) };
    customFields[fieldId] = value;
    observations[observationIndex] = { ...observations[observationIndex], customFields };

    saveObservations(elementId, element, observations);
    updateAllUI();
}

// ----------------------------------------------------------------
// OBSERVATION VARIABLES
// Variaveis de contexto da amostra (matriz, fracao, tipo, etc.).
// Cada observacao pode ter variaveis predefinidas e customizadas.
// ----------------------------------------------------------------

/**
 * Update a field (value or unit) of an observation variable.
 * Atualiza o valor ou a unidade de uma variavel de observacao.
 * Cada variavel e armazenada como { value, unit }.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {string} variableId - Variable ID
 * @param {string} field - 'value' or 'unit'
 * @param {*} newVal - New field value
 */
export function handleObservationVariableChange(elementId, obsIndex, variableId, field, newVal) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    const variables = { ...(observations[obsIndex].variables || {}) };
    const current = variables[variableId] || { value: '', unit: 'adimensional' };
    // Se for objeto, atualiza campo; se for valor legado, converte
    if (typeof current === 'object' && current !== null) {
        variables[variableId] = { ...current, [field]: newVal };
    } else {
        // Legado: valor simples → converte para formato { value, unit }
        variables[variableId] = {
            value: field === 'value' ? newVal : String(current),
            unit: field === 'unit' ? newVal : 'adimensional',
        };
    }
    observations[obsIndex] = { ...observations[obsIndex], variables };

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Add a user-defined variable to an observation.
 * Adiciona uma variavel customizada (nome livre) a uma observacao.
 * Gera um nome unico sequencial (var_1, var_2, etc.).
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 */
export function handleAddObservationVariable(elementId, obsIndex) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    const variables = { ...(observations[obsIndex].variables || {}) };
    // Gera nome unico sequencial
    let counter = 1;
    while (variables[`var_${counter}`] !== undefined) counter++;
    variables[`var_${counter}`] = { value: '', unit: 'adimensional' };

    observations[obsIndex] = { ...observations[obsIndex], variables };

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Remove a variable from an observation.
 * Remove uma variavel de uma observacao.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {string} variableId - Variable ID to remove
 */
export function handleRemoveObservationVariable(elementId, obsIndex, variableId) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    const variables = { ...(observations[obsIndex].variables || {}) };
    delete variables[variableId];
    observations[obsIndex] = { ...observations[obsIndex], variables };

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Rename a variable key in an observation.
 * Renomeia a chave de uma variavel, preservando o valor e a ordem.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {string} oldId - Current variable key
 * @param {string} newId - New variable key
 */
export function handleRenameObservationVariable(elementId, obsIndex, oldId, newId) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    // Sanitiza: remove espacos nas pontas, impede chave vazia
    const key = (newId || '').trim();
    if (!key || key === oldId) return;

    const oldVars = observations[obsIndex].variables || {};
    // Reconstroi objeto preservando ordem, trocando a chave
    const variables = {};
    for (const [k, v] of Object.entries(oldVars)) {
        if (k === oldId) {
            variables[key] = v;
        } else {
            variables[k] = v;
        }
    }
    observations[obsIndex] = { ...observations[obsIndex], variables };

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

// ----------------------------------------------------------------
// READING HANDLERS (with unit conversion)
// Leituras numericas com conversao automatica de unidades.
// ----------------------------------------------------------------

/**
 * Handle a change in a reading value (primary or additional).
 * Atualiza o valor de uma leitura (principal ou adicional).
 * Se o campo alterado for o parametro, a unidade e atualizada automaticamente.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {number} readingIndex - Reading index
 * @param {string} field - Field name
 * @param {*} value - New value
 * @param {boolean} isAdditional - Whether this is an additional reading
 */
export function handleReadingChange(elementId, obsIndex, readingIndex, field, value, isAdditional) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    if (isAdditional) {
        const additionalReadings = [...(observations[obsIndex].additionalReadings || [])];
        if (!additionalReadings[readingIndex]) return;

        if (field === 'parameterId') {
            const param = CONFIG.PARAMETERS?.find((p) => p.id === value);
            additionalReadings[readingIndex] = {
                ...additionalReadings[readingIndex],
                parameterId: value,
                unitId: param?.defaultUnitId || null,
            };
        } else {
            additionalReadings[readingIndex] = {
                ...additionalReadings[readingIndex],
                [field]:
                    field === 'value' || field === 'uncertainty' || field === 'coverageFactor'
                        ? value === ''
                            ? null
                            : Number(value)
                        : value,
            };
        }
        observations[obsIndex] = { ...observations[obsIndex], additionalReadings };
    } else {
        if (field === 'parameterId') {
            const param = CONFIG.PARAMETERS?.find((p) => p.id === value);
            observations[obsIndex] = {
                ...observations[obsIndex],
                parameterId: value,
                unitId: param?.defaultUnitId || null,
            };
        } else {
            observations[obsIndex] = {
                ...observations[obsIndex],
                [field]:
                    field === 'value' || field === 'uncertainty' || field === 'coverageFactor'
                        ? value === ''
                            ? null
                            : Number(value)
                        : value,
            };
        }
    }

    saveObservations(elementId, element, observations);
    if (field === 'parameterId') updateElementDetails();
    updateAllUI();
}

/**
 * Handle unit change with optional automatic conversion.
 * Quando o usuario muda a unidade, o valor pode ser convertido
 * automaticamente (ex: mg/L para ug/L) se a opcao estiver ativada.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {number} readingIndex - Reading index
 * @param {string} newUnitId - New unit ID
 * @param {boolean} isAdditional - Whether this is an additional reading
 */
export function handleUnitChange(elementId, obsIndex, readingIndex, newUnitId, isAdditional) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    // Identifica a leitura (principal ou adicional)
    let reading;
    if (isAdditional) {
        const additionalReadings = observations[obsIndex].additionalReadings || [];
        reading = additionalReadings[readingIndex];
    } else {
        reading = observations[obsIndex];
    }
    if (!reading) return;

    let newValue = reading.value;

    // Se a conversao automatica esta ativa, converte o valor
    if (reading.autoConvert && reading.value != null && reading.unitId && newUnitId) {
        const result = convert(reading.value, reading.unitId, newUnitId);
        if (result.success) {
            newValue = result.value;
        }

        // Feedback visual: pisca o campo para indicar conversao
        setTimeout(() => {
            const valueInput = document.getElementById(`value-${elementId}-${obsIndex}-${readingIndex}`);
            if (valueInput) {
                valueInput.classList.add('value-converted');
                setTimeout(() => valueInput.classList.remove('value-converted'), 600);
            }
        }, 50);
    }

    // Atualiza a leitura com nova unidade e valor
    if (isAdditional) {
        const additionalReadings = [...(observations[obsIndex].additionalReadings || [])];
        additionalReadings[readingIndex] = {
            ...additionalReadings[readingIndex],
            unitId: newUnitId,
            value: newValue,
        };
        observations[obsIndex] = { ...observations[obsIndex], additionalReadings };
    } else {
        observations[obsIndex] = { ...observations[obsIndex], unitId: newUnitId, value: newValue };
    }

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Add an additional reading to an observation.
 * Adiciona uma leitura extra a uma observacao.
 * Ex: alem do pH, medir tambem a condutividade no mesmo ponto.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 */
export function handleAddAdditionalReading(elementId, obsIndex) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    const additionalReadings = [...(observations[obsIndex].additionalReadings || [])];
    additionalReadings.push({
        parameterId: null,
        value: null,
        unitId: null,
        autoConvert: false,
    });

    observations[obsIndex] = { ...observations[obsIndex], additionalReadings };
    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Remove an additional reading from an observation.
 * Remove uma leitura extra de uma observacao.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {number} readingIndex - Additional reading index to remove
 */
export function handleRemoveAdditionalReading(elementId, obsIndex, readingIndex) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    const additionalReadings = [...(observations[obsIndex].additionalReadings || [])];
    additionalReadings.splice(readingIndex, 1);

    observations[obsIndex] = { ...observations[obsIndex], additionalReadings };
    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

// ----------------------------------------------------------------
// PARAMETER MODAL
// Modal para criar novos parametros de medicao.
// ----------------------------------------------------------------

/**
 * Open the parameter creation modal.
 * Abre o modal para criar um novo parametro de medicao.
 */
export function handleOpenParameterModal() {
    const modal = document.getElementById('parameter-modal');
    if (modal) {
        modal.classList.add('active');
        populateParameterModal();
    }
}

/**
 * Close the parameter creation modal.
 * Fecha o modal de criacao de parametro.
 */
export function handleCloseParameterModal() {
    const modal = document.getElementById('parameter-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * Save a new custom parameter.
 * Salva um novo parametro criado pelo usuario.
 * O parametro fica disponivel para todas as observacoes do modelo.
 */
export function handleSaveParameter() {
    const name = document.getElementById('param-name')?.value?.trim();
    const unitId = document.getElementById('param-unit')?.value;

    if (!name) {
        showToast(t('enterIdAndName'), 'error');
        return;
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');

    if (CONFIG.PARAMETERS?.find((p) => p.id === id)) {
        showToast(t('familyExists'), 'error');
        return;
    }

    const allowedFields = [];
    document.querySelectorAll('#param-custom-fields input:checked').forEach((cb) => {
        allowedFields.push(cb.value);
    });

    CONFIG.PARAMETERS.push({
        id,
        name,
        defaultUnitId: unitId || 'none',
        type: 'custom',
        category: 'custom',
        allowedCustomFields: allowedFields,
    });

    showToast(t('added') + ': ' + name, 'success');
    handleCloseParameterModal();
    updateElementDetails();
}

/**
 * Populate the parameter modal with available units and fields.
 * Preenche o modal com as unidades e campos disponiveis.
 */
function populateParameterModal() {
    const unitSelect = document.getElementById('param-unit');
    if (unitSelect) {
        unitSelect.innerHTML = CONFIG.UNITS.map((u) => `<option value="${u.id}">${u.symbol} - ${u.name}</option>`).join(
            '',
        );
    }

    const fieldsContainer = document.getElementById('param-custom-fields');
    if (fieldsContainer) {
        fieldsContainer.innerHTML = CONFIG.CUSTOM_FIELDS.map(
            (f) => `<label class="checkbox-item"><input type="checkbox" value="${f.id}"><span>${f.name}</span></label>`,
        ).join('');
    }
}

// ----------------------------------------------------------------
// COST HANDLERS — L1 (Observation) + L2 (Element)
// Edição de custos por observation e por element/fiscal year.
// ----------------------------------------------------------------

/**
 * Handle cost item change on an observation (L1).
 * Edita o valor de um item de custo numa observação.
 *
 * @param {string} elementId - Element ID
 * @param {number} index - Observation index
 * @param {string} categoryId - Cost category ('opex', 'capex')
 * @param {string} itemId - Cost item ('analytical', 'sampling', etc.)
 * @param {string} value - New amount (string from input)
 */
export function handleObservationCostChange(elementId, index, categoryId, itemId, value) {
    const element = getSelectedElement();
    if (!element) return;

    const observations = getObservations(element);
    const obs = observations[index];
    if (!obs || !obs.cost) return;

    const item = obs.cost.items.find((i) => i.categoryId === categoryId && i.itemId === itemId);
    if (item) {
        item.amount = parseFloat(value) || 0;
        obs.cost.total = obs.cost.items.reduce((s, i) => s + i.amount, 0);
        obs.cost.source = 'user';
    }
    saveObservations(elementId, element, observations);
    updateAllUI();
}

/**
 * Handle cost item change on an element fiscal year (L2).
 * Edita o valor de um item de custo num ano fiscal do elemento.
 *
 * @param {string} elementId - Element ID
 * @param {number} fiscalYear - Fiscal year
 * @param {string} categoryId - Cost category
 * @param {string} itemId - Cost item
 * @param {string} value - New amount (string from input)
 */
export function handleElementCostItemChange(elementId, fiscalYear, categoryId, itemId, value) {
    const element = getElementById(elementId) || getSelectedElement();
    if (!element || !Array.isArray(element.data?.costs)) return;

    const entry = element.data.costs.find((c) => c.fiscalYear === fiscalYear);
    if (!entry) return;

    const item = entry.items.find((i) => i.categoryId === categoryId && i.itemId === itemId);
    if (item) {
        item.amount = parseFloat(value) || 0;
        entry.capexTotal = entry.items.filter((i) => i.categoryId === 'capex').reduce((s, i) => s + i.amount, 0);
        entry.opexTotal = entry.items.filter((i) => i.categoryId === 'opex').reduce((s, i) => s + i.amount, 0);
        entry.total = entry.capexTotal + entry.opexTotal;
        entry.basis = 'user';
    }

    updateElement(elementId, { data: { ...element.data, costs: element.data.costs } });
    updateElementDetails(element);
}

// ----------------------------------------------------------------
// COST YEAR MANAGEMENT — Add, remove, change basis (L2)
// Gerenciamento de anos fiscais de custo no elemento
// ----------------------------------------------------------------

/**
 * Add a new cost year to an element.
 * Adiciona ano fiscal de custo com itens default do catálogo.
 *
 * @param {string} elementId - Element ID
 * @param {number} [fiscalYear] - Fiscal year (default: current year)
 */
export function handleAddCostYear(elementId, fiscalYear) {
    const element = getElementById(elementId);
    if (!element) return;

    const year = fiscalYear || new Date().getFullYear();

    if (!element.data) element.data = {};
    if (!Array.isArray(element.data.costs)) element.data.costs = [];

    // Não duplicar ano
    if (element.data.costs.some((c) => c.fiscalYear === year)) {
        showToast(t('costYearExists') || `Year ${year} already exists`, 'warn');
        return;
    }

    const isFirst = element.data.costs.length === 0;
    const depth = element.data?.construction?.totalDepth || 0;
    const entry = buildElementCostEntry(element.family, year, {
        depth: isFirst ? depth : 0,
        includeCapex: isFirst,
        basis: 'estimate',
    });

    element.data.costs.push(entry);
    element.data.costs.sort((a, b) => a.fiscalYear - b.fiscalYear);

    updateElement(elementId, { data: element.data });
    updateElementDetails(element);
    showToast(t('costYearAdded') || `Cost year ${year} added`, 'success');
}

/**
 * Remove a cost year from an element.
 * Remove ano fiscal de custo do elemento.
 *
 * @param {string} elementId - Element ID
 * @param {number} fiscalYear - Fiscal year to remove
 */
export function handleRemoveCostYear(elementId, fiscalYear) {
    const element = getElementById(elementId);
    if (!element || !Array.isArray(element.data?.costs)) return;

    element.data.costs = element.data.costs.filter((c) => c.fiscalYear !== fiscalYear);
    updateElement(elementId, { data: element.data });
    updateElementDetails(element);
    showToast(t('costYearRemoved') || `Cost year ${fiscalYear} removed`, 'info');
}

/**
 * Change the basis of a cost year (estimate/budget/actual).
 * Altera a base de um ano fiscal de custo.
 *
 * @param {string} elementId - Element ID
 * @param {number} fiscalYear - Fiscal year
 * @param {string} basis - New basis: 'estimate' | 'budget' | 'actual'
 */
export function handleChangeCostBasis(elementId, fiscalYear, basis) {
    const element = getElementById(elementId);
    if (!element || !Array.isArray(element.data?.costs)) return;

    const entry = element.data.costs.find((c) => c.fiscalYear === fiscalYear);
    if (!entry) return;

    entry.basis = basis;
    updateElement(elementId, { data: element.data });
    updateElementDetails(element);
}

/**
 * All observation handler functions exposed to HTML via window.
 * Objeto com todas as funcoes de observacao para o HTML.
 */
// ----------------------------------------------------------------
// BINDING HANDLERS
// Vincular/desvincular campos de observacoes a entidades do modelo.
// ----------------------------------------------------------------

/**
 * Build resolution context for binding operations.
 * Constroi contexto com lookups de entidades para o resolver.
 *
 * @returns {Object} Resolution context
 */
function _buildBindingContext() {
    const elements = getAllElements();
    const campaigns = getAllCampaigns();

    const elementMap = new Map();
    const observationMap = new Map();
    for (const el of elements) {
        if (el?.id) elementMap.set(el.id, el);
        if (Array.isArray(el?.data?.observations)) {
            for (const obs of el.data.observations) {
                if (obs?.id) observationMap.set(obs.id, obs);
            }
        }
    }
    const campaignMap = new Map();
    for (const c of campaigns) {
        if (c?.id) campaignMap.set(c.id, c);
    }

    return {
        getElementById: (id) => elementMap.get(id),
        getCampaignById: (id) => campaignMap.get(id),
        getObservationById: (id) => observationMap.get(id),
        getCalculatorMetric: () => null, // TODO: integrar com calculator
        getConstantById: (id) => getUserConstantById(id),
    };
}

/**
 * Bind a field of an observation to a model entity property.
 * Vincula um campo (x, y, z, date, value, etc.) a uma propriedade de outra entidade.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {string} field - Field name to bind (e.g., 'z', 'date', 'value')
 * @param {Object} config - { targetType, targetId, targetPath, transform?, transformArgs? }
 */
export function handleBindField(elementId, obsIndex, field, config) {
    const element = getElementById(elementId);
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    const context = _buildBindingContext();
    const result = createBinding(observations[obsIndex], field, config, context);

    if (!result.success) {
        showToast(result.error || 'Failed to create binding', 'error');
        return;
    }

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Remove a binding from an observation field.
 * Desvincula um campo, preservando o ultimo valor resolvido.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {string} field - Field name to unbind
 */
export function handleUnbindField(elementId, obsIndex, field) {
    const element = getElementById(elementId);
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    removeBinding(observations[obsIndex], field);

    saveObservations(elementId, element, observations);
    updateElementDetails();
    updateAllUI();
}

/**
 * Open the binding picker UI for a field.
 * Abre o picker de vinculacao: mostra opcoes disponiveis para o campo.
 *
 * @param {string} elementId - Element ID
 * @param {number} obsIndex - Observation index
 * @param {string} field - Field name ('x', 'y', 'z', 'date', 'value', etc.)
 */
export function handleOpenBindingPicker(elementId, obsIndex, field) {
    const element = getElementById(elementId);
    if (!element) return;

    const observations = getObservations(element);
    if (!observations[obsIndex]) return;

    // Constroi lista de opcoes de binding baseada no campo e familia
    const options = _buildBindingOptions(element, field);

    if (options.length === 0) {
        showToast(t('noBindingOptions') || 'No binding options available for this field', 'info');
        return;
    }

    // Usa asyncConfirm para picker simples (evita criar modal custom)
    _showBindingPickerDialog(elementId, obsIndex, field, options, element);
}

/**
 * Build available binding options for a field.
 * Gera opcoes de vinculacao contextuais (depende do campo e familia).
 *
 * @param {Object} element - The element
 * @param {string} field - Field name
 * @returns {Array<{ label, targetType, targetId, targetPath, transform, transformArgs }>}
 */
function _buildBindingOptions(element, field) {
    const options = [];
    const isPositionField = ['x', 'y', 'z'].includes(field);
    const isDateField = field === 'date';
    const isValueField = field === 'value';

    if (isPositionField) {
        // Opcao: posicao do proprio elemento
        const posMap = { x: 'x', y: 'y', z: 'z' };
        options.push({
            label: `${t('elementPosition') || 'Element position'} ${field.toUpperCase()}`,
            targetType: 'element',
            targetId: element.id,
            targetPath: `data.position.${posMap[field]}`,
            transform: 'identity',
            transformArgs: {},
        });

        // Coordenadas UTM
        const utmMap = { x: 'easting', y: 'elevation', z: 'northing' };
        options.push({
            label: `UTM ${utmMap[field]}`,
            targetType: 'element',
            targetId: element.id,
            targetPath: `data.coordinates.${utmMap[field]}`,
            transform: 'identity',
            transformArgs: {},
        });

        // Perfil construtivo (apenas para wells com profile)
        if (element.family === 'well' && element.data?.profile?.constructive?.elements) {
            const constElements = element.data.profile.constructive.elements;
            for (const ce of constElements) {
                if (!ce?.type) continue;
                const label = ce.type.replace(/_/g, ' ');
                const depthRange = `${ce.topDepth ?? '?'} — ${ce.bottomDepth ?? '?'} m`;

                // Topo
                options.push({
                    label: `${label} — ${t('top') || 'Top'} (${depthRange})`,
                    targetType: 'element',
                    targetId: element.id,
                    targetPath: `data.profile.constructive.elements[type=${ce.type}].topDepth`,
                    transform: 'negate',
                    transformArgs: {},
                });
                // Base
                options.push({
                    label: `${label} — ${t('bottom') || 'Bottom'} (${depthRange})`,
                    targetType: 'element',
                    targetId: element.id,
                    targetPath: `data.profile.constructive.elements[type=${ce.type}].bottomDepth`,
                    transform: 'negate',
                    transformArgs: {},
                });
                // Ponto medio
                options.push({
                    label: `${label} — ${t('midpoint') || 'Midpoint'} (${depthRange})`,
                    targetType: 'element',
                    targetId: element.id,
                    targetPath: `data.profile.constructive.elements[type=${ce.type}].topDepth`,
                    transform: 'midpoint',
                    transformArgs: {
                        secondPath: `data.profile.constructive.elements[type=${ce.type}].bottomDepth`,
                    },
                });
            }
        }
    }

    if (isDateField) {
        // Campanhas disponiveis
        const campaigns = getAllCampaigns();
        for (const c of campaigns) {
            options.push({
                label: `${escapeHtml(c.name)} — ${t('startDate') || 'Start date'}`,
                targetType: 'campaign',
                targetId: c.id,
                targetPath: 'startDate',
                transform: 'identity',
                transformArgs: {},
            });
            if (c.endDate) {
                options.push({
                    label: `${escapeHtml(c.name)} — ${t('endDate') || 'End date'}`,
                    targetType: 'campaign',
                    targetId: c.id,
                    targetPath: 'endDate',
                    transform: 'identity',
                    transformArgs: {},
                });
            }
        }
    }

    if (isValueField) {
        const constants = getUserConstants();
        for (const c of constants) {
            if (c?.id == null) continue;
            options.push({
                label: `${escapeHtml(c.symbol || c.name || c.id)} — ${c.value}`,
                targetType: 'constant',
                targetId: c.id,
                targetPath: 'value',
                transform: 'identity',
                transformArgs: {},
            });
        }
    }

    return options;
}

/**
 * Show binding picker dialog.
 * Exibe dialogo de selecao de binding usando select nativo.
 *
 * @param {string} elementId
 * @param {number} obsIndex
 * @param {string} field
 * @param {Array} options
 * @param {Object} element
 */
function _showBindingPickerDialog(elementId, obsIndex, field, options, element) {
    // Cria modal simples inline
    const overlay = document.createElement('div');
    overlay.className = 'binding-picker-overlay';
    overlay.innerHTML = `
        <div class="binding-picker-dialog">
            <div class="binding-picker-header">
                <span>${t('bindField') || 'Bind field'}: ${field.toUpperCase()}</span>
                <button type="button" class="btn btn-icon binding-picker-close">&#10005;</button>
            </div>
            <div class="binding-picker-body">
                <select class="form-input binding-picker-select" size="${Math.min(options.length, 8)}">
                    ${options.map((opt, i) => `<option value="${i}">${opt.label}</option>`).join('')}
                </select>
            </div>
            <div class="binding-picker-footer">
                <button type="button" class="btn btn-primary binding-picker-apply">${t('apply') || 'Apply'}</button>
                <button type="button" class="btn binding-picker-cancel">${t('cancel') || 'Cancel'}</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    overlay.querySelector('.binding-picker-close').addEventListener('click', close);
    overlay.querySelector('.binding-picker-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    overlay.querySelector('.binding-picker-apply').addEventListener('click', () => {
        const select = overlay.querySelector('.binding-picker-select');
        const idx = parseInt(select.value);
        if (isNaN(idx) || !options[idx]) {
            close();
            return;
        }
        const opt = options[idx];
        handleBindField(elementId, obsIndex, field, {
            targetType: opt.targetType,
            targetId: opt.targetId,
            targetPath: opt.targetPath,
            transform: opt.transform,
            transformArgs: opt.transformArgs,
        });
        close();
    });
}

export const observationHandlers = {
    handleAddObservation,
    handleObservationChange,
    handleRemoveObservation,
    handleTogglePlanning,
    handleAddQualField,
    handleRemoveQualField,
    handleQualFieldChange,
    handleObservationParameterChange,
    handleCustomFieldChange,
    handleObservationVariableChange,
    handleAddObservationVariable,
    handleRemoveObservationVariable,
    handleRenameObservationVariable,
    handleReadingChange,
    handleUnitChange,
    handleAddAdditionalReading,
    handleRemoveAdditionalReading,
    handleOpenParameterModal,
    handleCloseParameterModal,
    handleSaveParameter,
    handleObservationCostChange,
    handleElementCostItemChange,
    handleAddCostYear,
    handleRemoveCostYear,
    handleChangeCostBasis,
    handleBindField,
    handleUnbindField,
    handleOpenBindingPicker,
};
