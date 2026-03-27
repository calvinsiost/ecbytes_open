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
   SENSOR HANDLERS — User actions for IoT sensor elements
   Ações do usuário para elementos de sensor IoT

   Permite buscar dados externos, editar configuração do sensor,
   e converter leituras em observações do modelo.
   ================================================================ */

import { getElementById, getAllElements, updateElement, setSelectedElement } from '../../core/elements/manager.js';
import { getAllCampaigns } from '../../core/campaigns/manager.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { CONFIG } from '../../config.js';
import { activateTabById } from '../ui/tabs.js';
import { zoomToElement } from '../scene/controls.js';
import {
    renderSensorCenterTab,
    setSensorCenterSearch,
    setSensorCenterStatusFilter,
    setSensorCenterSort,
    setSensorCenterPage,
    toggleSensorCenterExpanded,
    setSensorCenterBulkInterval,
    focusSensorInCenter,
    resetSensorCenterFilters,
    getSensorCenterBulkInterval,
} from '../ui/sensorCenterPanel.js';

let _updateAllUI = null;
const SENSOR_CAMPAIGN_FALLBACK = 'UNASSIGNED_SENSOR_IMPORT';

/**
 * Inject updateAllUI dependency.
 * @param {Function} fn
 */
export function setUpdateAllUI(fn) {
    _updateAllUI = fn;
}

function updateAllUI() {
    if (_updateAllUI) _updateAllUI();
}

const SENSOR_CENTER_INTERVALS = new Set(['5min', '15min', '30min']);

function _normalizeInterval(intervalKey) {
    return SENSOR_CENTER_INTERVALS.has(intervalKey) ? intervalKey : '15min';
}

function _getAllSensors() {
    return getAllElements().filter((el) => el.family === 'sensor');
}

function _toDateTs(dateLike) {
    if (!dateLike) return NaN;
    const ts = Date.parse(dateLike);
    return Number.isFinite(ts) ? ts : NaN;
}

function _campaignTouchesArea(campaign, areaId, elementById) {
    if (!areaId) return true;
    if (campaign?.areaId && campaign.areaId === areaId) return true;
    if (!Array.isArray(campaign?.plannedReadings)) return false;
    return campaign.plannedReadings.some((reading) => {
        const el = elementById.get(reading?.elementId);
        return !!el && el.data?.areaId === areaId;
    });
}

function _resolveCampaignForSensor(element, data) {
    const campaigns = getAllCampaigns();
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
    const areaId = data?.areaId || element?.data?.areaId || null;
    const allElements = getAllElements();
    const elementById = new Map(allElements.map((el) => [el.id, el]));

    // 1) payload valido
    const payloadCampaignId = data?.campaignId || data?.latestReadings?.find((r) => r?.campaignId)?.campaignId || null;
    if (payloadCampaignId && campaignMap.has(payloadCampaignId)) {
        return { campaignId: payloadCampaignId, source: 'payload' };
    }

    const now = Date.now();
    const scoped = campaigns.filter((c) => _campaignTouchesArea(c, areaId, elementById));

    // 2) campanha ativa da area (start <= now <= end|open)
    const active = scoped
        .filter((c) => {
            const startTs = _toDateTs(c.startDate);
            const endTs = _toDateTs(c.endDate);
            if (!Number.isFinite(startTs)) return false;
            if (startTs > now) return false;
            return !Number.isFinite(endTs) || endTs >= now;
        })
        .sort((a, b) => (_toDateTs(b.startDate) || 0) - (_toDateTs(a.startDate) || 0));
    if (active.length > 0) {
        return { campaignId: active[0].id, source: 'active' };
    }

    // 3) ultima campanha da area (30 dias)
    const recent = scoped
        .map((c) => {
            const endTs = _toDateTs(c.endDate);
            const startTs = _toDateTs(c.startDate);
            const refTs = Number.isFinite(endTs) ? endTs : startTs;
            return { campaign: c, refTs };
        })
        .filter(
            (item) => Number.isFinite(item.refTs) && item.refTs <= now && now - item.refTs <= 30 * 24 * 60 * 60 * 1000,
        )
        .sort((a, b) => b.refTs - a.refTs);
    if (recent.length > 0) {
        return { campaignId: recent[0].campaign.id, source: 'recent' };
    }

    // 4) fallback explicito
    return { campaignId: SENSOR_CAMPAIGN_FALLBACK, source: 'fallback' };
}

// ----------------------------------------------------------------
// FETCH SENSOR DATA
// Busca dados do sensor de APIs externas
// ----------------------------------------------------------------

/**
 * Fetch and update sensor data from external APIs.
 * Executa o pipeline de hidratação e atualiza o elemento.
 *
 * @param {string} elementId - ID of the sensor element
 */
export async function handleFetchSensorData(elementId) {
    const element = getElementById(elementId);
    if (!element || element.family !== 'sensor') {
        showToast(t('sensorNotFound'), 'error');
        return;
    }

    showToast(t('sensorFetching'), 'info');

    try {
        // Dynamic import — sensor module loaded only when needed
        const { getAppData } = await import('../../core/sensor/index.js');
        const newData = await getAppData(element);

        updateElement(elementId, { data: newData });
        updateAllUI();

        if (newData.errors && newData.errors.length > 0) {
            showToast(`${t('sensorPartialSuccess')}: ${newData.errors.length} error(s)`, 'warning');
        } else {
            showToast(t('sensorFetchSuccess'), 'success');
        }
    } catch (error) {
        console.error('Sensor fetch failed:', error);
        showToast(`${t('sensorFetchFailed')}: ${error.message}`, 'error');
    }
}

// ----------------------------------------------------------------
// SENSOR FIELD EDITING
// Edição de campos do sensor (tipo, userId, conector)
// ----------------------------------------------------------------

/**
 * Update a sensor-specific field.
 * Atualiza campos do sensor: sensorType, userId, connectorKey.
 *
 * @param {string} elementId - Sensor element ID
 * @param {string} field - Field name (sensorType, userId, connectorKey)
 * @param {*} value - New value
 */
export function handleSensorFieldChange(elementId, field, value) {
    const element = getElementById(elementId);
    if (!element) return;

    const data = { ...element.data };

    // Campos numéricos
    if (field === 'userId') {
        data[field] = Math.min(Math.max(parseInt(value) || 1, 1), 10);
    } else {
        data[field] = value;
    }

    updateElement(elementId, { data });
}

/**
 * Toggle a monitored parameter on/off for a sensor.
 * Alterna um parâmetro na lista de parâmetros monitorados.
 *
 * @param {string} elementId - Sensor element ID
 * @param {string} parameterId - Parameter to toggle
 * @param {boolean} enabled - Whether to enable or disable
 */
export function handleSensorParameterToggle(elementId, parameterId, enabled) {
    const element = getElementById(elementId);
    if (!element) return;

    const data = { ...element.data };
    const current = Array.isArray(data.monitoredParameters) ? [...data.monitoredParameters] : [];

    if (enabled && !current.includes(parameterId)) {
        current.push(parameterId);
    } else if (!enabled) {
        const idx = current.indexOf(parameterId);
        if (idx >= 0) current.splice(idx, 1);
    }

    data.monitoredParameters = current;
    updateElement(elementId, { data });
    updateAllUI();
}

// ----------------------------------------------------------------
// CONNECTOR KEY (generic, replaces OWM-specific handler)
// Chave do conector externo (genérica)
// ----------------------------------------------------------------

/**
 * Set the external connector API key for a sensor.
 * Define a chave do conector externo para um sensor.
 *
 * @param {string} elementId - Sensor element ID
 * @param {string} apiKey - Connector API key
 */
export function handleSetSensorApiKey(elementId, apiKey) {
    const element = getElementById(elementId);
    if (!element) return;

    updateElement(elementId, {
        data: { ...element.data, connectorKey: apiKey },
    });
}

// ----------------------------------------------------------------
// SENSOR READING → OBSERVATION
// Converte leituras do sensor em observações do modelo
// ----------------------------------------------------------------

/**
 * Create observations from sensor data readings.
 * Cria observações a partir dos dados atuais do sensor,
 * usando os parâmetros monitorados configurados.
 *
 * @param {string} elementId - Sensor element ID
 */
export function handleSensorToObservation(elementId) {
    const element = getElementById(elementId);
    if (!element || element.family !== 'sensor') {
        showToast(t('sensorNotFound'), 'error');
        return;
    }

    const data = { ...element.data };
    const pos = data.position || { x: 0, y: 0, z: 0 };
    const observations = Array.isArray(data.observations) ? [...data.observations] : [];
    const monitoredParams = Array.isArray(data.monitoredParameters)
        ? data.monitoredParameters
        : ['temperature', 'pH', 'conductivity', 'water_level'];

    if (monitoredParams.length === 0) {
        showToast(t('sensorNoParameters'), 'warning');
        return;
    }

    // Leituras do último fetch (se existirem)
    const latestReadings = Array.isArray(data.latestReadings) ? data.latestReadings : [];
    const readingMap = {};
    latestReadings.forEach((r) => {
        readingMap[r.parameterId] = r.value;
    });

    // Primary parameter = first monitored
    const primaryParamId = monitoredParams[0];
    const primaryParam = CONFIG.PARAMETERS?.find((p) => p.id === primaryParamId);

    // Additional readings = remaining monitored parameters (auto-filled from fetch)
    const additionalReadings = monitoredParams.slice(1).map((paramId) => {
        const param = CONFIG.PARAMETERS?.find((p) => p.id === paramId);
        return {
            parameterId: paramId,
            value: readingMap[paramId] ?? null,
            unitId: param?.defaultUnitId || null,
            autoConvert: false,
        };
    });

    // Create observation (auto-filled with latest sensor readings)
    const campaignResolution = _resolveCampaignForSensor(element, data);

    const newObs = {
        x: pos.x || 0,
        y: pos.y || 0,
        z: pos.z || 0,
        date: new Date().toISOString().slice(0, 10),
        campaignId: campaignResolution.campaignId,
        campaignResolutionSource: campaignResolution.source,
        parameterId: primaryParamId,
        value: readingMap[primaryParamId] ?? null,
        unitId: primaryParam?.defaultUnitId || null,
        autoConvert: false,
        additionalReadings,
        source: 'sensor',
    };

    observations.push(newObs);
    data.observations = observations;
    updateElement(elementId, { data });
    updateAllUI();

    showToast(t('sensorObservationCreated'), 'success');
}

// ----------------------------------------------------------------
// AUTO-REFRESH HANDLERS
// Controle de polling automático por sensor
// ----------------------------------------------------------------

/**
 * Silent fetch — updates data without full UI rebuild.
 * Usado pelo auto-refresh para evitar DOM thrash a cada tick.
 *
 * @param {string} elementId - ID of the sensor element
 */
export async function handleFetchSensorDataSilent(elementId) {
    const element = getElementById(elementId);
    if (!element || element.family !== 'sensor') return;

    const { getAppData } = await import('../../core/sensor/index.js');
    const newData = await getAppData(element);
    updateElement(elementId, { data: newData });

    // Update DOM cirúrgico — só timestamp e indicador se sensor está selecionado
    const lastFetchEl = document.querySelector(`[data-sensor-lastfetch="${elementId}"]`);
    if (lastFetchEl) {
        const liveBadge = newData._autoRefreshActive
            ? `<span class="sensor-pulse"></span><span style="color:#22c55e; font-weight:500;">${t('sensorLiveData') || 'Live'}</span>`
            : '';
        lastFetchEl.innerHTML = `${liveBadge}${liveBadge ? ' ' : ''}Last: ${new Date(newData.lastFetch).toLocaleString()}`;
    }
}

/**
 * Toggle auto-refresh on/off for a sensor.
 *
 * @param {string} elementId
 * @param {boolean} enabled
 * @param {string} intervalKey - '5min', '15min', '30min'
 */
export async function handleToggleAutoRefresh(elementId, enabled, intervalKey, options = {}) {
    const element = getElementById(elementId);
    if (!element || element.family !== 'sensor') return;

    const silent = !!options?.silent;
    const skipUIUpdate = !!options?.skipUIUpdate;
    const safeInterval = _normalizeInterval(intervalKey);
    const { startAutoRefresh, stopAutoRefresh } = await import('../../core/sensor/autoRefresh.js');

    if (enabled) {
        startAutoRefresh(elementId, safeInterval, handleFetchSensorDataSilent);
        if (!silent) showToast(t('sensorAutoRefreshStarted') || 'Auto-refresh started', 'info');
    } else {
        stopAutoRefresh(elementId);
        if (!silent) showToast(t('sensorAutoRefreshStopped') || 'Auto-refresh stopped', 'info');
    }
    if (!skipUIUpdate) updateAllUI();
}

/**
 * Change the auto-refresh interval (restart if active).
 *
 * @param {string} elementId
 * @param {string} intervalKey
 */
export async function handleAutoRefreshIntervalChange(elementId, intervalKey) {
    const element = getElementById(elementId);
    if (!element || element.family !== 'sensor') return;
    const safeInterval = _normalizeInterval(intervalKey);

    // Persist intervalo mesmo com auto-refresh desligado
    updateElement(elementId, {
        data: { ...element.data, _autoRefreshInterval: safeInterval },
    });

    const { startAutoRefresh } = await import('../../core/sensor/autoRefresh.js');
    if (element.data?._autoRefreshActive) {
        startAutoRefresh(elementId, safeInterval, handleFetchSensorDataSilent);
    }
    updateAllUI();
}

/**
 * Stop all active auto-refresh polls globally.
 */
export async function handleStopAllAutoRefresh(options = {}) {
    const silent = !!options?.silent;
    const { stopAllAutoRefresh } = await import('../../core/sensor/autoRefresh.js');
    stopAllAutoRefresh();
    if (!silent) showToast(t('sensorAutoRefreshStopped') || 'Auto-refresh stopped', 'info');
    updateAllUI();
}

// ----------------------------------------------------------------
// SENSOR CENTER (UNIFIED TAB)
// Operacoes globais e navegacao da central de sensores
// ----------------------------------------------------------------

/**
 * Open sensors center tab and optionally focus a sensor row.
 *
 * @param {string|null} sensorId
 */
export function handleOpenSensorsCenter(sensorId = null) {
    activateTabById('sensors');

    if (sensorId) {
        resetSensorCenterFilters();
        focusSensorInCenter(sensorId);
    }

    updateAllUI();
    renderSensorCenterTab();
}

/**
 * Refresh all sensors once (silent fetch).
 */
export async function handleSensorCenterRefreshAll() {
    const sensors = _getAllSensors();
    if (sensors.length === 0) {
        showToast(t('sensorCenterNoSensors') || 'No sensors found in current model', 'warning');
        return;
    }

    let okCount = 0;
    for (const sensor of sensors) {
        try {
            await handleFetchSensorDataSilent(sensor.id);
            okCount++;
        } catch (error) {
            console.warn('[sensor-center] refresh failed:', sensor.id, error?.message || error);
        }
    }

    showToast(
        t('sensorCenterRefreshAllDone', { count: okCount }) || `Sensors refreshed: ${okCount}/${sensors.length}`,
        okCount === sensors.length ? 'success' : 'warning',
    );
    updateAllUI();
}

/**
 * Start auto-refresh for all sensors with one interval.
 *
 * @param {string} intervalKey
 */
export async function handleSensorCenterStartAll(intervalKey) {
    const sensors = _getAllSensors();
    if (sensors.length === 0) {
        showToast(t('sensorCenterNoSensors') || 'No sensors found in current model', 'warning');
        return;
    }

    const safeInterval = _normalizeInterval(intervalKey || getSensorCenterBulkInterval());
    setSensorCenterBulkInterval(safeInterval);

    for (const sensor of sensors) {
        await handleToggleAutoRefresh(sensor.id, true, safeInterval, { silent: true, skipUIUpdate: true });
    }

    showToast(
        t('sensorCenterStartAllDone', { count: sensors.length, interval: safeInterval }) ||
            `Auto-refresh started for ${sensors.length} sensors (${safeInterval})`,
        'success',
    );
    updateAllUI();
}

/**
 * Stop auto-refresh globally for all sensors.
 */
export async function handleSensorCenterStopAll() {
    const sensors = _getAllSensors();
    if (sensors.length === 0) {
        showToast(t('sensorCenterNoSensors') || 'No sensors found in current model', 'warning');
        return;
    }

    await handleStopAllAutoRefresh({ silent: true });
    showToast(
        t('sensorCenterStopAllDone', { count: sensors.length }) || `Auto-refresh stopped for ${sensors.length} sensors`,
        'info',
    );
    updateAllUI();
}

/**
 * Select sensor in 3D and animate camera focus.
 *
 * @param {string} sensorId
 */
export function handleSensorCenterFocusElement(sensorId) {
    const element = getElementById(sensorId);
    if (!element || element.family !== 'sensor') {
        showToast(t('sensorNotFound') || 'Sensor not found', 'error');
        return;
    }

    let selectedViaUI = false;
    if (typeof window.handleSelectElement === 'function') {
        try {
            window.handleSelectElement(sensorId);
            selectedViaUI = true;
        } catch (error) {
            console.warn('[sensor-center] handleSelectElement fallback:', error?.message || error);
        }
    }

    if (!selectedViaUI) {
        setSelectedElement(sensorId);
    }
    try {
        zoomToElement(sensorId);
    } catch (_) {}

    activateTabById('sensors');
    focusSensorInCenter(sensorId);
    updateAllUI();
}

// -- Sensor center local UI state handlers --
export function handleSensorCenterSearch(query) {
    setSensorCenterSearch(query);
}

export function handleSensorCenterFilter(status) {
    setSensorCenterStatusFilter(status);
}

export function handleSensorCenterSort(column) {
    setSensorCenterSort(column);
}

export function handleSensorCenterPage(page) {
    setSensorCenterPage(page);
}

export function handleSensorCenterToggleExpand(sensorId) {
    toggleSensorCenterExpanded(sensorId);
}

export function handleSensorCenterSetBulkInterval(intervalKey) {
    setSensorCenterBulkInterval(_normalizeInterval(intervalKey));
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

/**
 * Update a sensor endpoint URL.
 * Atualiza a URL de um endpoint específico do sensor.
 *
 * @param {string} elementId - Sensor element ID
 * @param {string} endpointKey - Endpoint key (identity, metadata, readings)
 * @param {string} url - New URL template
 */
export function handleSensorEndpointChange(elementId, endpointKey, url) {
    const element = getElementById(elementId);
    if (!element) return;

    const data = { ...element.data };
    const endpoints = { ...(data.endpoints || {}) };
    endpoints[endpointKey] = url;
    data.endpoints = endpoints;
    updateElement(elementId, { data });
}

// ----------------------------------------------------------------
// NESTED OBJECT EDITING (profile, evaluation)
// Edição de sub-objetos aninhados no data do sensor
// ----------------------------------------------------------------

/**
 * Update a field inside element.data.profile.
 * Atualiza um campo dentro do objeto profile do sensor.
 *
 * @param {string} elementId - Sensor element ID
 * @param {string} field - Field name (ownerName, city, serial, uuid)
 * @param {string} value - New value
 */
export function handleSensorProfileChange(elementId, field, value) {
    const element = getElementById(elementId);
    if (!element) return;

    const data = { ...element.data };
    const profile = { ...(data.profile || {}) };
    profile[field] = value;
    data.profile = profile;
    updateElement(elementId, { data });
}

/**
 * Update a field inside element.data.evaluation.
 * Atualiza um campo dentro do objeto evaluation do sensor.
 *
 * @param {string} elementId - Sensor element ID
 * @param {string} field - Field name (modelId, quantitative, key)
 * @param {*} value - New value
 */
export function handleSensorEvalChange(elementId, field, value) {
    const element = getElementById(elementId);
    if (!element) return;

    const data = { ...element.data };
    const evaluation = { ...(data.evaluation || {}) };
    // quantitative é numérico
    if (field === 'quantitative') {
        evaluation[field] = parseFloat(value) || 0;
    } else {
        evaluation[field] = value;
    }
    data.evaluation = evaluation;
    updateElement(elementId, { data });
}

export const sensorHandlers = {
    handleFetchSensorData,
    handleFetchSensorDataSilent,
    handleSetSensorApiKey,
    handleSensorFieldChange,
    handleSensorParameterToggle,
    handleSensorToObservation,
    handleSensorEndpointChange,
    handleSensorProfileChange,
    handleSensorEvalChange,
    handleToggleAutoRefresh,
    handleAutoRefreshIntervalChange,
    handleStopAllAutoRefresh,
    handleOpenSensorsCenter,
    handleSensorCenterRefreshAll,
    handleSensorCenterStartAll,
    handleSensorCenterStopAll,
    handleSensorCenterFocusElement,
    handleSensorCenterSearch,
    handleSensorCenterFilter,
    handleSensorCenterSort,
    handleSensorCenterPage,
    handleSensorCenterToggleExpand,
    handleSensorCenterSetBulkInterval,
};
