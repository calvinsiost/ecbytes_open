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
   SENSOR TRANSFORMER — Profile builder and identity evaluation
   Construtor de perfil e avaliação de identidade do sensor

   Responsabilidades:
   - Merge (spread) dos dados de identidade + metadados → Perfil
   - Normalização de unidades: temperatura como string Celsius
   - Status operacional como flag de sucesso
   - Avaliação do triplet: id_modelo + quantitativo + chave

   ================================================================ */

// ----------------------------------------------------------------
// HASH UTILITY
// Função de hash para gerar a chave de avaliação
// ----------------------------------------------------------------

/**
 * Generate SHA-256 hash of a string using SubtleCrypto.
 * Gera hash SHA-256 usando a API nativa do navegador.
 * Falls back to simple hash if SubtleCrypto unavailable.
 *
 * @param {string} str - Input string
 * @returns {Promise<string>} Hex hash string
 */
async function sha256(str) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const buffer = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback: simple numeric hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

// ----------------------------------------------------------------
// ANONYMIZATION UTILITY
// Gera identificadores genéricos a partir de strings
// ----------------------------------------------------------------

/**
 * Generate a deterministic numeric tag from a string.
 * Converte uma string em um número de 2 dígitos (01-99)
 * para usar como sufixo anônimo.
 *
 * @param {string} str - Input string
 * @returns {string} Two-digit tag like "05", "42"
 */
function anonymousTag(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (h << 5) - h + str.charCodeAt(i);
        h |= 0;
    }
    return String(Math.abs(h % 99) + 1).padStart(2, '0');
}

// ----------------------------------------------------------------
// PROFILE BUILDER
// Merge dos dados brutos em perfil unificado do sensor
// ----------------------------------------------------------------

/**
 * Transform raw API responses into a unified Sensor Profile.
 * Realiza o spread de identidade + metadados para criar o perfil.
 * Nomes são anonimizados para evitar uso de dados que pareçam reais.
 *
 * @param {Object} rawData - Output from fetchSensorData()
 * @param {Object} rawData.identity - Stage 1 identity data
 * @param {Object} rawData.metadata - Stage 2 metadata
 * @param {Object} rawData.weather - Stage 3 weather data
 * @returns {Object} Normalized sensor profile
 */
export function transformSensorData(rawData) {
    const { identity, metadata, weather } = rawData;

    // Anonymize: convert real-sounding names to generic IDs
    const nameTag = anonymousTag(identity.ownerName || 'Unknown');
    const cityTag = anonymousTag(identity.city || 'London');

    // Spread: Identity + Metadata = Sensor Profile (anonymized)
    const profile = {
        ownerName: `Owner-${nameTag}`,
        ownerUsername: `user-${nameTag}`,
        ownerEmail: `sensor-${nameTag}@ecbyts.local`,
        city: `City-${cityTag}`,
        geo: { ...identity.geo },
        uuid: metadata.uuid,
        serial: metadata.serial,
        fakeCoord: { ...metadata.fakeCoord },
    };

    // Unit normalization: thermal output as Celsius string
    // Preserva _status, source e _rawCurrent para weather→readings injection
    const normalizedWeather = {
        _status: weather._status,
        temperature: weather.temperature,
        temperatureRaw: weather.temperatureRaw ?? null,
        humidity: weather.humidity,
        pressure: weather.pressure,
        windSpeed: weather.windSpeed ?? null,
        precipitation: weather.precipitation ?? null,
        description: weather.description,
        operationalStatus: weather.operationalStatus === true,
        source: weather.source || null,
        fetchedAt: weather.fetchedAt || null,
        _rawCurrent: weather._rawCurrent || null,
    };

    return { profile, weather: normalizedWeather };
}

// ----------------------------------------------------------------
// IDENTITY EVALUATION
// Avaliação do triplet: id_modelo + quantitativo + chave
// ----------------------------------------------------------------

/**
 * Evaluate the id_modelo + quantitativo + chave identity triplet.
 * Gera identificador único do modelo de sensor composto por:
 * - modelId: identificador composto (família-userId-uuid8)
 * - quantitative: métrica numérica primária (temperatura ou 0)
 * - key: hash determinístico de (modelId + quantitative + timestamp)
 *
 * @param {Object} profile - Sensor profile from transformSensorData
 * @param {Object} weather - Normalized weather from transformSensorData
 * @param {number} userId - Original user ID seed
 * @returns {Promise<Object>} Evaluation triplet { modelId, quantitative, key, timestamp }
 */
export async function evaluateIdentity(profile, weather, userId) {
    // id_modelo: composite sensor model identifier
    const uuidShort = (profile.uuid || '').slice(0, 8);
    const modelId = `sensor-${userId || 0}-${uuidShort}`;

    // quantitativo: primary numeric metric (temperature or 0)
    const quantitative = weather.temperatureRaw != null ? parseFloat(weather.temperatureRaw) : 0;

    // chave: deterministic key from model + quantitative + timestamp
    const timestamp = Date.now();
    const raw = `${modelId}|${quantitative}|${timestamp}`;
    const key = await sha256(raw);

    return { modelId, quantitative, key, timestamp };
}
