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

/**
 * ecbyts Analytics - Data Tensor
 * Tensor de dados unificado para integração de observações quantitativas e qualitativas
 */

import { eventBus, Events } from './eventBus.js';

/**
 * Representa um ponto de dados no tensor
 */
class DataPoint {
    constructor(data) {
        this.elementId = data.elementId;
        this.family = data.family;
        this.timestamp = data.timestamp;
        this.parameterId = data.parameterId;
        this.value = data.value;
        this.unit = data.unit;
        this.position = { ...data.position }; // {x, y, z}
        this.campaign = data.campaign || null;
        this.qualFields = new Map(Object.entries(data.qualFields || {}));
        // Variaveis de contexto (matrix flags, fraction, sample_type, etc.)
        this.variables = data.variables || {};
    }

    /**
     * Clona o ponto de dados
     */
    clone() {
        return new DataPoint({
            elementId: this.elementId,
            family: this.family,
            timestamp: this.timestamp,
            parameterId: this.parameterId,
            value: this.value,
            unit: this.unit,
            position: { ...this.position },
            campaign: this.campaign,
            qualFields: Object.fromEntries(this.qualFields),
            variables: { ...this.variables },
        });
    }

    /**
     * Converte para objeto simples
     */
    toObject() {
        return {
            elementId: this.elementId,
            family: this.family,
            timestamp: this.timestamp,
            parameterId: this.parameterId,
            value: this.value,
            unit: this.unit,
            position: { ...this.position },
            campaign: this.campaign,
            qualFields: Object.fromEntries(this.qualFields),
            variables: { ...this.variables },
        };
    }
}

/**
 * Tensor de dados multidimensional
 * Dimensões: [element, time, parameter, space]
 */
class DataTensor {
    constructor() {
        this.data = [];
        this.indices = {
            byElement: new Map(),
            byTime: new Map(),
            byParameter: new Map(),
            byFamily: new Map(),
            byCampaign: new Map(),
        };
        this.bounds = {
            x: { min: Infinity, max: -Infinity },
            y: { min: Infinity, max: -Infinity },
            z: { min: Infinity, max: -Infinity },
            value: { min: Infinity, max: -Infinity },
            time: { min: null, max: null },
        };
    }

    /**
     * Constrói tensor a partir de elementos do manager
     * @param {Array} elements - Array de elementos do elements/manager.js
     * @returns {DataTensor}
     */
    static fromElements(elements) {
        const tensor = new DataTensor();

        elements.forEach((element) => {
            if (!element.data || !element.data.observations) return;

            element.data.observations.forEach((obs) => {
                // Observação principal
                const dataPoint = new DataPoint({
                    elementId: element.id,
                    family: element.family,
                    timestamp: obs.date ? new Date(obs.date).getTime() : Date.now(),
                    parameterId: obs.parameterId,
                    value: obs.value,
                    unit: obs.unitId,
                    position: {
                        x: obs.x || element.data.position?.x || 0,
                        y: obs.y || element.data.position?.y || 0,
                        z: obs.z || element.data.position?.z || 0,
                    },
                    campaign: obs.campaignId,
                    qualFields: obs.qualFields || {},
                    variables: obs.variables || {},
                });

                tensor.add(dataPoint);

                // Leituras adicionais
                if (obs.additionalReadings) {
                    obs.additionalReadings.forEach((reading) => {
                        const additionalPoint = new DataPoint({
                            elementId: element.id,
                            family: element.family,
                            timestamp: obs.date ? new Date(obs.date).getTime() : Date.now(),
                            parameterId: reading.parameterId,
                            value: reading.value,
                            unit: reading.unitId,
                            position: {
                                x: obs.x || element.data.position?.x || 0,
                                y: obs.y || element.data.position?.y || 0,
                                z: obs.z || element.data.position?.z || 0,
                            },
                            campaign: obs.campaignId,
                            qualFields: {},
                            variables: obs.variables || {},
                        });

                        tensor.add(additionalPoint);
                    });
                }
            });
        });

        return tensor;
    }

    /**
     * Adiciona um ponto de dados ao tensor
     * @param {DataPoint} dataPoint
     */
    add(dataPoint) {
        const index = this.data.length;
        this.data.push(dataPoint);

        // Atualiza índices
        this._addToIndex('byElement', dataPoint.elementId, index);
        this._addToIndex('byParameter', dataPoint.parameterId, index);
        this._addToIndex('byFamily', dataPoint.family, index);

        if (dataPoint.campaign) {
            this._addToIndex('byCampaign', dataPoint.campaign, index);
        }

        // Índice temporal (por dia)
        const dayKey = this._getDayKey(dataPoint.timestamp);
        this._addToIndex('byTime', dayKey, index);

        // Atualiza bounds
        this._updateBounds(dataPoint);
    }

    /**
     * Adiciona índice a um map
     */
    _addToIndex(indexName, key, dataIndex) {
        if (!this.indices[indexName].has(key)) {
            this.indices[indexName].set(key, []);
        }
        this.indices[indexName].get(key).push(dataIndex);
    }

    /**
     * Retorna chave do dia para timestamp
     */
    _getDayKey(timestamp) {
        const date = new Date(timestamp);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /**
     * Atualiza limites espaciais e de valor
     */
    _updateBounds(dataPoint) {
        const { position, value, timestamp } = dataPoint;

        this.bounds.x.min = Math.min(this.bounds.x.min, position.x);
        this.bounds.x.max = Math.max(this.bounds.x.max, position.x);
        this.bounds.y.min = Math.min(this.bounds.y.min, position.y);
        this.bounds.y.max = Math.max(this.bounds.y.max, position.y);
        this.bounds.z.min = Math.min(this.bounds.z.min, position.z);
        this.bounds.z.max = Math.max(this.bounds.z.max, position.z);

        if (typeof value === 'number' && !isNaN(value)) {
            this.bounds.value.min = Math.min(this.bounds.value.min, value);
            this.bounds.value.max = Math.max(this.bounds.value.max, value);
        }

        if (!this.bounds.time.min || timestamp < this.bounds.time.min) {
            this.bounds.time.min = timestamp;
        }
        if (!this.bounds.time.max || timestamp > this.bounds.time.max) {
            this.bounds.time.max = timestamp;
        }
    }

    /**
     * Retorna todos os dados
     * @returns {Array<DataPoint>}
     */
    getAll() {
        return [...this.data];
    }

    /**
     * Retorna dados filtrados por predicado
     * @param {Function} predicate - Função de filtro
     * @returns {Array<DataPoint>}
     */
    filter(predicate) {
        return this.data.filter(predicate);
    }

    /**
     * Filtra por elemento
     * @param {string} elementId
     * @returns {Array<DataPoint>}
     */
    byElement(elementId) {
        const indices = this.indices.byElement.get(elementId) || [];
        return indices.map((i) => this.data[i]);
    }

    /**
     * Filtra por parâmetro
     * @param {string} parameterId
     * @returns {Array<DataPoint>}
     */
    byParameter(parameterId) {
        const indices = this.indices.byParameter.get(parameterId) || [];
        return indices.map((i) => this.data[i]);
    }

    /**
     * Filtra por família
     * @param {string} family
     * @returns {Array<DataPoint>}
     */
    byFamily(family) {
        const indices = this.indices.byFamily.get(family) || [];
        return indices.map((i) => this.data[i]);
    }

    /**
     * Filtra por campanha
     * @param {string} campaignId
     * @returns {Array<DataPoint>}
     */
    byCampaign(campaignId) {
        const indices = this.indices.byCampaign.get(campaignId) || [];
        return indices.map((i) => this.data[i]);
    }

    /**
     * Extrai fatia espacial
     * @param {string} axis - 'x', 'y' ou 'z'
     * @param {number} value - Valor da posição do corte
     * @param {number} thickness - Espessura da fatia
     * @returns {Array<DataPoint>}
     */
    sliceAt(axis, value, thickness = 5) {
        const halfThickness = thickness / 2;
        return this.data.filter((point) => {
            const pos = point.position[axis];
            return pos >= value - halfThickness && pos <= value + halfThickness;
        });
    }

    /**
     * Extrai fatia temporal
     * @param {number} startTime - Timestamp inicial
     * @param {number} endTime - Timestamp final
     * @returns {Array<DataPoint>}
     */
    sliceTime(startTime, endTime) {
        return this.data.filter((point) => point.timestamp >= startTime && point.timestamp <= endTime);
    }

    /**
     * Extrai fatia por range de valor
     * @param {number} minValue
     * @param {number} maxValue
     * @returns {Array<DataPoint>}
     */
    sliceValue(minValue, maxValue) {
        return this.data.filter((point) => point.value >= minValue && point.value <= maxValue);
    }

    /**
     * Projeta dados em plano 2D
     * @param {string} plane - 'XY', 'XZ' ou 'YZ'
     * @param {Array<DataPoint>} data - Dados a projetar (padrão: todos)
     * @returns {Array<Object>} Pontos projetados com coordenadas 2D
     */
    projectToPlane(plane, data = null) {
        const sourceData = data || this.data;

        return sourceData.map((point) => {
            let x2d, y2d;

            switch (plane) {
                case 'XY':
                    x2d = point.position.x;
                    y2d = point.position.y;
                    break;
                case 'XZ':
                    x2d = point.position.x;
                    y2d = point.position.z;
                    break;
                case 'YZ':
                    x2d = point.position.y;
                    y2d = point.position.z;
                    break;
                default:
                    x2d = point.position.x;
                    y2d = point.position.y;
            }

            return {
                x: x2d,
                y: y2d,
                dataPoint: point,
            };
        });
    }

    /**
     * Retorna valores únicos de uma dimensão
     * @param {string} dimension - 'elementId', 'parameterId', 'family', 'campaign'
     * @returns {Array}
     */
    uniqueValues(dimension) {
        const indexMap = {
            elementId: 'byElement',
            parameterId: 'byParameter',
            family: 'byFamily',
            campaign: 'byCampaign',
        };

        const indexName = indexMap[dimension];
        if (indexName && this.indices[indexName]) {
            return Array.from(this.indices[indexName].keys());
        }

        // Fallback para extração manual
        const values = new Set();
        this.data.forEach((point) => {
            if (point[dimension] !== undefined) {
                values.add(point[dimension]);
            }
        });
        return Array.from(values);
    }

    /**
     * Retorna estatísticas básicas dos valores
     * @param {Array<DataPoint>} data - Dados a analisar (padrão: todos)
     * @returns {Object}
     */
    statistics(data = null) {
        const sourceData = data || this.data;
        const values = sourceData.map((p) => p.value).filter((v) => typeof v === 'number' && !isNaN(v));

        if (values.length === 0) {
            return { count: 0, min: null, max: null, mean: null, std: null };
        }

        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;

        return {
            count: values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            mean: mean,
            std: Math.sqrt(variance),
            sum: sum,
        };
    }

    /**
     * Calcula histograma dos valores
     * @param {number} bins - Número de bins
     * @param {Array<DataPoint>} data - Dados a analisar (padrão: todos)
     * @returns {Object}
     */
    histogram(bins = 20, data = null) {
        const sourceData = data || this.data;
        const values = sourceData.map((p) => p.value).filter((v) => typeof v === 'number' && !isNaN(v));

        if (values.length === 0) {
            return { bins: [], labels: [], counts: [] };
        }

        const min = Math.min(...values);
        const max = Math.max(...values);
        const binWidth = (max - min) / bins || 1;

        const counts = new Array(bins).fill(0);
        const binEdges = [];

        for (let i = 0; i <= bins; i++) {
            binEdges.push(min + i * binWidth);
        }

        values.forEach((v) => {
            let binIndex = Math.floor((v - min) / binWidth);
            if (binIndex >= bins) binIndex = bins - 1;
            if (binIndex < 0) binIndex = 0;
            counts[binIndex]++;
        });

        const labels = [];
        for (let i = 0; i < bins; i++) {
            labels.push(`${binEdges[i].toFixed(2)} - ${binEdges[i + 1].toFixed(2)}`);
        }

        return {
            bins: binEdges,
            labels,
            counts,
            binWidth,
            total: values.length,
        };
    }

    /**
     * Retorna bounds do tensor
     * @returns {Object}
     */
    getBounds() {
        return { ...this.bounds };
    }

    /**
     * Retorna tamanho do tensor
     * @returns {number}
     */
    size() {
        return this.data.length;
    }

    /**
     * Limpa todos os dados
     */
    clear() {
        this.data = [];
        Object.keys(this.indices).forEach((key) => {
            this.indices[key].clear();
        });
        this.bounds = {
            x: { min: Infinity, max: -Infinity },
            y: { min: Infinity, max: -Infinity },
            z: { min: Infinity, max: -Infinity },
            value: { min: Infinity, max: -Infinity },
            time: { min: null, max: null },
        };
    }

    /**
     * Atualiza tensor com novos elementos e emite evento
     * @param {Array} elements
     */
    update(elements) {
        this.clear();
        const newTensor = DataTensor.fromElements(elements);

        this.data = newTensor.data;
        this.indices = newTensor.indices;
        this.bounds = newTensor.bounds;

        eventBus.emit(Events.DATA_UPDATED, {
            size: this.size(),
            bounds: this.getBounds(),
        });
    }
}

export { DataTensor, DataPoint };
export default DataTensor;
