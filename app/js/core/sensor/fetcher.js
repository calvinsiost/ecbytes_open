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
   SENSOR DATA FETCHER — Three-stage API pipeline
   Pipeline de busca de dados de sensor em 3 estágios

   Estágio 1: JSONPlaceholder → identidade do proprietário/localização
   Estágio 2: FakerAPI → metadados extendidos (UUID, serial, coordenadas)
   Estágio 3: Conector externo (opcional) → telemetria complementar

   Cada estágio é independente e resiliente — falha em um
   não corrompe a estrutura global.
   ================================================================ */

/** @type {number} Timeout in ms for each API call */
const FETCH_TIMEOUT = 5000;

// ----------------------------------------------------------------
// STAGE 1: PRIMARY IDENTITY SEED
// Semente de identidade do proprietário via JSONPlaceholder
// ----------------------------------------------------------------

/**
 * Fetch identity data from JSONPlaceholder.
 * Busca dados de identidade do proprietário do sensor.
 *
 * @param {number} userId - User ID seed (1-10)
 * @returns {Promise<Object>} Identity object with name, city, geo
 */
async function fetchIdentity(userId, endpointTemplate) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const id = Math.min(Math.max(Math.round(userId), 1), 10);
        const url = (endpointTemplate || 'https://jsonplaceholder.typicode.com/users/{userId}').replace('{userId}', id);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const user = await res.json();

        return {
            _status: 'ok',
            ownerName: user.name || 'Unknown',
            ownerUsername: user.username || '',
            ownerEmail: user.email || '',
            city: user.address?.city || 'London',
            geo: {
                lat: user.address?.geo?.lat || '0',
                lng: user.address?.geo?.lng || '0',
            },
        };
    } catch (err) {
        return {
            _status: 'error',
            _error: `Stage 1 (identity): ${err.message}`,
            ownerName: 'Unknown Sensor',
            ownerUsername: '',
            ownerEmail: '',
            city: 'London',
            geo: { lat: '0', lng: '0' },
        };
    } finally {
        clearTimeout(timer);
    }
}

// ----------------------------------------------------------------
// STAGE 2: EXTENDED METADATA LAYER
// Camada de metadados extendidos via FakerAPI
// ----------------------------------------------------------------

/**
 * Fetch extended metadata from FakerAPI.
 * Busca UUID, serial e coordenadas fictícias.
 *
 * @returns {Promise<Object>} Metadata with uuid, serial, fakeCoord
 */
async function fetchMetadata(endpointUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const url =
            endpointUrl ||
            'https://fakerapi.it/api/v1/custom?_quantity=1&uuid=uuid&serial=buildingNumber&coord_lat=latitude&coord_lon=longitude';
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const item = json.data?.[0] || {};

        return {
            _status: 'ok',
            uuid: item.uuid || crypto.randomUUID(),
            serial: item.serial ? `SN-${item.serial}` : 'SN-0000',
            fakeCoord: {
                lat: parseFloat(item.coord_lat) || 0,
                lng: parseFloat(item.coord_lon) || 0,
            },
        };
    } catch (err) {
        return {
            _status: 'error',
            _error: `Stage 2 (metadata): ${err.message}`,
            uuid: crypto.randomUUID(),
            serial: 'SN-0000',
            fakeCoord: { lat: 0, lng: 0 },
        };
    } finally {
        clearTimeout(timer);
    }
}

// ----------------------------------------------------------------
// STAGE 2B: MULTIPARAMETER READINGS VIA FAKERAPI
// Leituras multiparâmetro geradas via FakerAPI + escalonamento
// ----------------------------------------------------------------

/** Faixas realistas para escalonar valores do FakerAPI */
const PARAM_RANGES = {
    pH: { min: 5.5, max: 8.5, unit: 'pH', decimals: 2 },
    conductivity: { min: 100, max: 2000, unit: 'µS/cm', decimals: 0 },
    temperature: { min: 15, max: 32, unit: '°C', decimals: 1 },
    humidity: { min: 10, max: 100, unit: '%', decimals: 0 },
    pressure: { min: 950, max: 1050, unit: 'hPa', decimals: 1 },
    wind_speed: { min: 0, max: 30, unit: 'm/s', decimals: 1 },
    precipitation: { min: 0, max: 50, unit: 'mm', decimals: 1 },
    water_level: { min: -15, max: -0.5, unit: 'm', decimals: 2 },
    flow_rate: { min: 0.1, max: 10, unit: 'L/s', decimals: 2 },
    benzene: { min: 0.001, max: 5, unit: 'µg/L', decimals: 3 },
    tph: { min: 0.1, max: 100, unit: 'mg/L', decimals: 1 },
    btex: { min: 0.01, max: 50, unit: 'µg/L', decimals: 2 },
    voc: { min: 0.01, max: 20, unit: 'µg/L', decimals: 2 },
    bod: { min: 5, max: 300, unit: 'mg/L', decimals: 1 },
    cod: { min: 10, max: 600, unit: 'mg/L', decimals: 1 },
    tss: { min: 5, max: 200, unit: 'mg/L', decimals: 1 },
    pm25: { min: 5, max: 150, unit: 'µg/m³', decimals: 1 },
    pm10: { min: 10, max: 250, unit: 'µg/m³', decimals: 1 },
    nox: { min: 10, max: 500, unit: 'mg/Nm³', decimals: 0 },
    sox: { min: 5, max: 300, unit: 'mg/Nm³', decimals: 0 },
    noise_exposure: { min: 65, max: 95, unit: 'dBA', decimals: 1 },
    ghg_scope1: { min: 100, max: 50000, unit: 'tCO2e', decimals: 0 },
    species_count: { min: 5, max: 200, unit: 'count', decimals: 0 },
};

/** Passo máximo por parâmetro para random walk (variação realista entre leituras) */
const MAX_STEP = {
    pH: 0.1,
    conductivity: 20,
    temperature: 0.5,
    water_level: 0.1,
    flow_rate: 0.2,
    benzene: 0.05,
    tph: 1,
    btex: 0.5,
    voc: 0.3,
    bod: 5,
    cod: 10,
    tss: 3,
    pm25: 5,
    pm10: 8,
    nox: 15,
    sox: 10,
    noise_exposure: 1,
    ghg_scope1: 50,
    species_count: 1,
    humidity: 2,
    pressure: 1,
    wind_speed: 0.5,
    precipitation: 0.5,
};

/** Mapeamento Open-Meteo → parameterId (dados reais substituem random walk) */
const WEATHER_PARAM_MAP = {
    temperature_2m: 'temperature',
    relative_humidity_2m: 'humidity',
    pressure_msl: 'pressure',
    wind_speed_10m: 'wind_speed',
    precipitation: 'precipitation',
};

/**
 * Apply random walk from previous value (variação realista entre leituras).
 * Se não tem valor anterior, gera random dentro da faixa.
 *
 * @param {string} paramId - Parameter ID
 * @param {number|null} prevValue - Valor da leitura anterior (null = primeira leitura)
 * @returns {number} Novo valor com variação realista
 */
function randomWalkValue(paramId, prevValue) {
    const range = PARAM_RANGES[paramId] || { min: 0, max: 100, decimals: 2 };
    if (prevValue == null) {
        return range.min + Math.random() * (range.max - range.min);
    }
    const step = MAX_STEP[paramId] || (range.max - range.min) * 0.02;
    const delta = (Math.random() - 0.5) * 2 * step;
    return Math.max(range.min, Math.min(range.max, prevValue + delta));
}

/**
 * Fetch multiparameter readings with random walk continuity.
 * Usa FakerAPI como seed na primeira leitura; leituras subsequentes
 * aplicam random walk a partir do valor anterior (variação realista).
 *
 * @param {string[]} parameterIds - IDs dos parâmetros monitorados
 * @param {string} [endpointUrl] - URL override para FakerAPI
 * @param {Array} [previousReadings] - Leituras anteriores para random walk
 * @returns {Promise<Object>} { _status, readings: [{parameterId, value, unit, raw}] }
 */
async function fetchReadings(parameterIds, endpointUrl, previousReadings) {
    if (!parameterIds || parameterIds.length === 0) {
        return { _status: 'skipped', readings: [] };
    }

    // Mapa de valores anteriores para random walk
    const prevMap = {};
    if (Array.isArray(previousReadings)) {
        previousReadings.forEach((r) => {
            prevMap[r.parameterId] = r.value;
        });
    }

    const hasPrevious = Object.keys(prevMap).length > 0;

    // Se já temos valores anteriores, usar random walk local (sem API call)
    if (hasPrevious) {
        const readings = parameterIds.map((paramId) => {
            const range = PARAM_RANGES[paramId] || { min: 0, max: 100, unit: '-', decimals: 2 };
            const value = randomWalkValue(paramId, prevMap[paramId] ?? null);
            return {
                parameterId: paramId,
                value: parseFloat(value.toFixed(range.decimals)),
                unit: range.unit,
                raw: null,
                timestamp: new Date().toISOString(),
            };
        });
        return { _status: 'ok', readings };
    }

    // Primeira leitura: busca seed do FakerAPI
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const fields = parameterIds
            .slice(0, 10)
            .map((id) => `${id}=number`)
            .join('&');
        const url = endpointUrl || `https://fakerapi.it/api/v1/custom?_quantity=1&${fields}`;

        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const item = json.data?.[0] || {};

        const readings = parameterIds.map((paramId) => {
            const raw = parseFloat(item[paramId]) || Math.random() * 100;
            const range = PARAM_RANGES[paramId] || { min: 0, max: 100, unit: '-', decimals: 2 };
            const seed = (Math.abs(raw) % 10000) / 10000;
            const value = range.min + seed * (range.max - range.min);
            return {
                parameterId: paramId,
                value: parseFloat(value.toFixed(range.decimals)),
                unit: range.unit,
                raw: raw,
                timestamp: new Date().toISOString(),
            };
        });

        return { _status: 'ok', readings };
    } catch (err) {
        // Fallback: gera localmente se FakerAPI falhar
        const readings = parameterIds.map((paramId) => {
            const range = PARAM_RANGES[paramId] || { min: 0, max: 100, unit: '-', decimals: 2 };
            const value = range.min + Math.random() * (range.max - range.min);
            return {
                parameterId: paramId,
                value: parseFloat(value.toFixed(range.decimals)),
                unit: range.unit,
                raw: null,
                timestamp: new Date().toISOString(),
            };
        });
        return {
            _status: 'error',
            _error: `Stage 2B (readings): ${err.message}`,
            readings,
        };
    } finally {
        clearTimeout(timer);
    }
}

// ----------------------------------------------------------------
// STAGE 3A: OPEN-METEO (default, no API key required)
// Dados meteorológicos reais via Open-Meteo — gratuito e open-source
// ----------------------------------------------------------------

/**
 * Fetch real-time weather from Open-Meteo (no API key required).
 * Busca dados meteorológicos reais que variam continuamente.
 *
 * @param {number} latitude - WGS84 latitude
 * @param {number} longitude - WGS84 longitude
 * @returns {Promise<Object>} Weather data compatible with fetchWeather shape
 */
async function fetchOpenMeteo(latitude, longitude) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${latitude}&longitude=${longitude}` +
            `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,pressure_msl,precipitation` +
            `&timezone=auto`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const c = data.current || {};

        return {
            _status: 'ok',
            temperature: `${c.temperature_2m ?? 0} °C`,
            temperatureRaw: c.temperature_2m ?? 0,
            humidity: c.relative_humidity_2m ?? null,
            pressure: c.pressure_msl ?? null,
            windSpeed: c.wind_speed_10m ?? null,
            precipitation: c.precipitation ?? null,
            description: 'Open-Meteo live',
            operationalStatus: true,
            source: 'open-meteo',
            fetchedAt: c.time || new Date().toISOString(),
            _rawCurrent: c,
        };
    } catch (err) {
        return {
            _status: 'error',
            _error: `Stage 3 (Open-Meteo): ${err.message}`,
            temperature: null,
            temperatureRaw: null,
            humidity: null,
            pressure: null,
            description: 'unavailable',
            operationalStatus: false,
            source: 'open-meteo',
        };
    } finally {
        clearTimeout(timer);
    }
}

// ----------------------------------------------------------------
// STAGE 3B: OPENWEATHERMAP (optional, requires API key)
// Conector externo legado — mantido para backward compatibility
// ----------------------------------------------------------------

/**
 * Fetch environmental context from OpenWeatherMap.
 * Busca telemetria complementar via OWM (requer API key).
 *
 * @param {string} city - City name from Stage 1
 * @param {string} apiKey - OpenWeatherMap API key
 * @returns {Promise<Object>} Weather data with temperature, humidity, etc.
 */
async function fetchWeather(city, apiKey) {
    if (!apiKey) {
        return {
            _status: 'skipped',
            temperature: null,
            humidity: null,
            pressure: null,
            description: 'unavailable',
            operationalStatus: false,
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const q = encodeURIComponent(city);
        const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${apiKey}&units=metric`, {
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        return {
            _status: 'ok',
            temperature: `${data.main?.temp ?? 0} °C`,
            temperatureRaw: data.main?.temp ?? 0,
            humidity: data.main?.humidity ?? null,
            pressure: data.main?.pressure ?? null,
            description: data.weather?.[0]?.description || 'unknown',
            operationalStatus: true,
            source: 'openweathermap',
        };
    } catch (err) {
        return {
            _status: 'error',
            _error: `Stage 3 (weather): ${err.message}`,
            temperature: null,
            temperatureRaw: null,
            humidity: null,
            pressure: null,
            description: 'unavailable',
            operationalStatus: false,
        };
    } finally {
        clearTimeout(timer);
    }
}

// ----------------------------------------------------------------
// ORCHESTRATOR
// Orquestrador do pipeline: Estágio 1 → (Estágio 2 + 3 paralelos)
// ----------------------------------------------------------------

/**
 * Execute the 3-stage sensor data pipeline.
 * Estágio 1 roda primeiro (fornece city para Estágio 3).
 * Estágios 2, 2B e 3 rodam em paralelo via Promise.allSettled.
 * Stage 3 usa Open-Meteo (default, sem key) ou OWM (com apiKey).
 *
 * @param {Object} options
 * @param {number} [options.userId=1] - JSONPlaceholder user ID (1-10)
 * @param {string} [options.apiKey=''] - OWM API key (optional, fallback)
 * @param {Object} [options.geoCoordinates] - { latitude, longitude } para Open-Meteo
 * @param {Array} [options.previousReadings] - Leituras anteriores para random walk
 * @returns {Promise<{identity: Object, metadata: Object, weather: Object, errors: string[]}>}
 */
/** Default endpoint templates */
const DEFAULT_ENDPOINTS = {
    identity: 'https://jsonplaceholder.typicode.com/users/{userId}',
    metadata:
        'https://fakerapi.it/api/v1/custom?_quantity=1&uuid=uuid&serial=buildingNumber&coord_lat=latitude&coord_lon=longitude',
    readings: 'https://fakerapi.it/api/v1/custom?_quantity=1&{fields}',
};

export async function fetchSensorData(options = {}) {
    const userId = options.userId || Math.ceil(Math.random() * 10);
    const apiKey = options.apiKey || '';
    const monitoredParameters = options.monitoredParameters || [];
    const previousReadings = options.previousReadings || [];
    const geoCoordinates = options.geoCoordinates || null;
    const endpoints = { ...DEFAULT_ENDPOINTS, ...(options.endpoints || {}) };
    const errors = [];

    // Stage 1 first — need city for Stage 3 OWM fallback
    const identity = await fetchIdentity(userId, endpoints.identity);
    if (identity._status === 'error') errors.push(identity._error);

    // Build readings URL from template + monitored params
    const readingsFields = monitoredParameters
        .slice(0, 10)
        .map((id) => `${id}=number`)
        .join('&');
    const readingsUrl = endpoints.readings ? endpoints.readings.replace('{fields}', readingsFields) : null;

    // Stage 3: Open-Meteo (default, sem key) ou OWM (com apiKey)
    const weatherPromise = geoCoordinates
        ? fetchOpenMeteo(geoCoordinates.latitude, geoCoordinates.longitude)
        : fetchWeather(identity.city, apiKey);

    // Stages 2 + 2B + 3 in parallel
    const [metaResult, readingsResult, weatherResult] = await Promise.allSettled([
        fetchMetadata(endpoints.metadata),
        fetchReadings(monitoredParameters, readingsUrl, previousReadings),
        weatherPromise,
    ]);

    const metadata =
        metaResult.status === 'fulfilled'
            ? metaResult.value
            : {
                  _status: 'error',
                  _error: 'Stage 2: Promise rejected',
                  uuid: crypto.randomUUID(),
                  serial: 'SN-0000',
                  fakeCoord: { lat: 0, lng: 0 },
              };

    const readings =
        readingsResult.status === 'fulfilled'
            ? readingsResult.value
            : { _status: 'error', _error: 'Stage 2B: Promise rejected', readings: [] };

    const weather =
        weatherResult.status === 'fulfilled'
            ? weatherResult.value
            : {
                  _status: 'error',
                  _error: 'Stage 3: Promise rejected',
                  temperature: null,
                  humidity: null,
                  pressure: null,
                  description: 'unavailable',
                  operationalStatus: false,
              };

    if (metadata._status === 'error' && metadata._error) errors.push(metadata._error);
    if (readings._status === 'error' && readings._error) errors.push(readings._error);
    if (weather._status === 'error' && weather._error) errors.push(weather._error);

    // Injetar dados reais do weather nos readings correspondentes
    // Evita contradição (weather=22°C, reading=15°C)
    const finalReadings = injectWeatherIntoReadings(readings.readings || [], weather);

    return { identity, metadata, readings: finalReadings, weather, errors, userId };
}

/**
 * Inject real weather values into matching readings.
 * Substitui valores sintéticos por dados reais do Open-Meteo/OWM
 * para parâmetros que têm equivalente meteorológico.
 *
 * @param {Array} readings - Leituras do Stage 2B
 * @param {Object} weather - Resultado do Stage 3
 * @returns {Array} Readings com valores reais onde disponível
 */
function injectWeatherIntoReadings(readings, weather) {
    if (!weather || weather._status !== 'ok' || !weather._rawCurrent) {
        return readings;
    }

    const raw = weather._rawCurrent;
    const now = new Date().toISOString();

    // Mapa de valores reais disponíveis
    const realValues = {};
    for (const [meteoKey, paramId] of Object.entries(WEATHER_PARAM_MAP)) {
        if (raw[meteoKey] != null) {
            realValues[paramId] = raw[meteoKey];
        }
    }

    // Substituir nos readings existentes
    const updated = readings.map((r) => {
        if (realValues[r.parameterId] != null) {
            const range = PARAM_RANGES[r.parameterId];
            return {
                ...r,
                value: parseFloat(realValues[r.parameterId].toFixed(range?.decimals ?? 1)),
                source: 'open-meteo',
                timestamp: now,
            };
        }
        return r;
    });

    // Adicionar readings para params weather que estão monitorados mas não tinham reading
    const existingIds = new Set(updated.map((r) => r.parameterId));
    for (const [paramId, value] of Object.entries(realValues)) {
        if (!existingIds.has(paramId)) continue; // Só injeta se param está monitorado
        // Já foi atualizado acima
    }

    return updated;
}
