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
 * ecbyts Analytics - BI Abstraction Layer
 * Camada de Business Intelligence com operadores de agregação e agrupamento
 */

/**
 * Operadores de agregação
 */
export const Aggregators = {
    SUM: (values) => {
        const nums = values.filter((v) => typeof v === 'number' && !isNaN(v));
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
    },

    AVERAGE: (values) => {
        const nums = values.filter((v) => typeof v === 'number' && !isNaN(v));
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    },

    FIRST: (values) => {
        return values.length > 0 ? values[0] : null;
    },

    LAST: (values) => {
        return values.length > 0 ? values[values.length - 1] : null;
    },

    MIN: (values) => {
        const nums = values.filter((v) => typeof v === 'number' && !isNaN(v));
        return nums.length > 0 ? Math.min(...nums) : null;
    },

    MAX: (values) => {
        const nums = values.filter((v) => typeof v === 'number' && !isNaN(v));
        return nums.length > 0 ? Math.max(...nums) : null;
    },

    COUNT: (values) => {
        return values.length;
    },

    COUNT_DISTINCT: (values) => {
        return new Set(values).size;
    },

    MEDIAN: (values) => {
        const nums = values.filter((v) => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
        if (nums.length === 0) return null;
        const mid = Math.floor(nums.length / 2);
        return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    },

    STD_DEV: (values) => {
        const nums = values.filter((v) => typeof v === 'number' && !isNaN(v));
        if (nums.length === 0) return null;
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const squaredDiffs = nums.map((v) => Math.pow(v - mean, 2));
        return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / nums.length);
    },

    VARIANCE: (values) => {
        const nums = values.filter((v) => typeof v === 'number' && !isNaN(v));
        if (nums.length === 0) return null;
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const squaredDiffs = nums.map((v) => Math.pow(v - mean, 2));
        return squaredDiffs.reduce((a, b) => a + b, 0) / nums.length;
    },
};

/**
 * Funções utilitárias para agrupamento
 */
const Utils = {
    /**
     * Agrupa array por função de chave
     */
    groupBy(array, keyFn) {
        const groups = new Map();
        array.forEach((item) => {
            const key = keyFn(item);
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        });
        return groups;
    },

    /**
     * Trunca timestamp para unidade temporal
     */
    truncateTime(timestamp, unit) {
        const date = new Date(timestamp);

        switch (unit) {
            case 'year':
                return new Date(date.getFullYear(), 0, 1).getTime();
            case 'month':
                return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
            case 'week':
                const day = date.getDay();
                const diff = date.getDate() - day + (day === 0 ? -6 : 1);
                return new Date(date.getFullYear(), date.getMonth(), diff).getTime();
            case 'day':
                return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
            case 'hour':
                return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime();
            default:
                return timestamp;
        }
    },

    /**
     * Formata timestamp para label legível
     */
    formatTimeLabel(timestamp, unit) {
        const date = new Date(timestamp);
        const pad = (n) => String(n).padStart(2, '0');

        switch (unit) {
            case 'year':
                return String(date.getFullYear());
            case 'month':
                return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
            case 'week':
                return `${date.getFullYear()}-W${this.getWeekNumber(date)}`;
            case 'day':
                return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
            case 'hour':
                return `${pad(date.getHours())}:00`;
            default:
                return date.toISOString();
        }
    },

    /**
     * Retorna número da semana no ano
     */
    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    },

    /**
     * Agrupa valor em bins
     */
    binValue(value, bins) {
        const { min, max, count } = bins;
        const binWidth = (max - min) / count;
        let binIndex = Math.floor((value - min) / binWidth);
        if (binIndex >= count) binIndex = count - 1;
        if (binIndex < 0) binIndex = 0;
        return binIndex;
    },
};

/**
 * Agrupadores por dimensão
 */
export const Groupers = {
    /**
     * Agrupa por campo categórico
     */
    byCategory(data, field) {
        return Utils.groupBy(data, (item) => {
            if (field === 'qualField') {
                // Acesso a campo qualitativo específico
                return item.qualFields?.get(field) || 'N/A';
            }
            return item[field] || 'N/A';
        });
    },

    /**
     * Agrupa por unidade temporal
     */
    byTime(data, unit = 'day') {
        return Utils.groupBy(data, (item) => {
            return Utils.truncateTime(item.timestamp, unit);
        });
    },

    /**
     * Agrupa por eixo espacial em bins
     */
    bySpatial(data, axis, binCount = 10) {
        if (data.length === 0) return new Map();

        const values = data.map((d) => d.position[axis]);
        const min = Math.min(...values);
        const max = Math.max(...values);

        return Utils.groupBy(data, (item) => {
            return Utils.binValue(item.position[axis], { min, max, count: binCount });
        });
    },

    /**
     * Agrupa por range de valor
     */
    byValueRange(data, binCount = 10) {
        if (data.length === 0) return new Map();

        const values = data.map((d) => d.value).filter((v) => typeof v === 'number' && !isNaN(v));
        if (values.length === 0) return new Map();

        const min = Math.min(...values);
        const max = Math.max(...values);

        return Utils.groupBy(data, (item) => {
            if (typeof item.value !== 'number' || isNaN(item.value)) return 'N/A';
            return Utils.binValue(item.value, { min, max, count: binCount });
        });
    },
};

/**
 * Query Builder para consultas fluentes
 */
class QueryBuilder {
    constructor(data) {
        this.data = [...data];
        this.groupedData = null;
        this.aggregations = [];
        this.sortConfig = null;
        this.limitConfig = null;
    }

    /**
     * Filtra dados por condições
     * @param {Object|Function} conditions
     */
    filter(conditions) {
        if (typeof conditions === 'function') {
            this.data = this.data.filter(conditions);
        } else {
            this.data = this.data.filter((item) => {
                return Object.entries(conditions).every(([key, value]) => {
                    if (Array.isArray(value)) {
                        return value.includes(item[key]);
                    }
                    if (typeof value === 'object' && value !== null) {
                        // Range filter: { min: x, max: y }
                        if ('min' in value && 'max' in value) {
                            return item[key] >= value.min && item[key] <= value.max;
                        }
                        // Comparison operators: { $gt: x, $lt: y, $gte: x, $lte: y }
                        let passes = true;
                        if ('$gt' in value) passes = passes && item[key] > value.$gt;
                        if ('$lt' in value) passes = passes && item[key] < value.$lt;
                        if ('$gte' in value) passes = passes && item[key] >= value.$gte;
                        if ('$lte' in value) passes = passes && item[key] <= value.$lte;
                        if ('$ne' in value) passes = passes && item[key] !== value.$ne;
                        return passes;
                    }
                    return item[key] === value;
                });
            });
        }
        return this;
    }

    /**
     * Filtra por bounds espaciais
     */
    filterSpatial(bounds) {
        this.data = this.data.filter((item) => {
            const { x, y, z } = item.position;
            let passes = true;

            if (bounds.x) {
                passes = passes && x >= bounds.x.min && x <= bounds.x.max;
            }
            if (bounds.y) {
                passes = passes && y >= bounds.y.min && y <= bounds.y.max;
            }
            if (bounds.z) {
                passes = passes && z >= bounds.z.min && z <= bounds.z.max;
            }

            return passes;
        });
        return this;
    }

    /**
     * Filtra por range temporal
     */
    filterTime(startTime, endTime) {
        this.data = this.data.filter((item) => item.timestamp >= startTime && item.timestamp <= endTime);
        return this;
    }

    /**
     * Agrupa dados por campo ou função
     * @param {string|Function} grouper
     * @param {Object} options
     */
    groupBy(grouper, options = {}) {
        if (typeof grouper === 'string') {
            // Campo simples
            if (grouper === 'time') {
                this.groupedData = Groupers.byTime(this.data, options.unit || 'day');
            } else if (['x', 'y', 'z'].includes(grouper)) {
                this.groupedData = Groupers.bySpatial(this.data, grouper, options.bins || 10);
            } else {
                this.groupedData = Groupers.byCategory(this.data, grouper);
            }
        } else if (typeof grouper === 'function') {
            this.groupedData = Utils.groupBy(this.data, grouper);
        }
        return this;
    }

    /**
     * Aplica agregação aos grupos
     * @param {string} field - Campo a agregar
     * @param {string|Function} aggregator - Nome do agregador ou função
     * @param {string} alias - Nome do resultado (opcional)
     */
    aggregate(field, aggregator, alias = null) {
        const aggFn = typeof aggregator === 'function' ? aggregator : Aggregators[aggregator.toUpperCase()];

        if (!aggFn) {
            throw new Error(`Unknown aggregator: ${aggregator}`);
        }

        this.aggregations.push({
            field,
            aggregator: aggFn,
            alias: alias || `${field}_${aggregator}`,
        });

        return this;
    }

    /**
     * Ordena resultados
     * @param {string} field
     * @param {string} order - 'ASC' ou 'DESC'
     */
    sortBy(field, order = 'ASC') {
        this.sortConfig = { field, order };
        return this;
    }

    /**
     * Limita número de resultados
     * @param {number} n
     */
    limit(n) {
        this.limitConfig = n;
        return this;
    }

    /**
     * Executa a query e retorna resultados
     * @returns {Array|Map}
     */
    execute() {
        // Se não houver agrupamento, retorna dados filtrados
        if (!this.groupedData) {
            let result = [...this.data];

            if (this.sortConfig) {
                const { field, order } = this.sortConfig;
                result.sort((a, b) => {
                    const aVal = this._getFieldValue(a, field);
                    const bVal = this._getFieldValue(b, field);
                    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                    return order === 'DESC' ? -comparison : comparison;
                });
            }

            if (this.limitConfig) {
                result = result.slice(0, this.limitConfig);
            }

            return result;
        }

        // Com agrupamento, aplica agregações
        const results = [];

        this.groupedData.forEach((items, key) => {
            const result = {
                group: key,
                count: items.length,
            };

            // Aplica cada agregação
            this.aggregations.forEach(({ field, aggregator, alias }) => {
                const values = items.map((item) => this._getFieldValue(item, field));
                result[alias] = aggregator(values);
            });

            results.push(result);
        });

        // Ordenação
        if (this.sortConfig) {
            const { field, order } = this.sortConfig;
            results.sort((a, b) => {
                const aVal = a[field] ?? a.group;
                const bVal = b[field] ?? b.group;
                const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                return order === 'DESC' ? -comparison : comparison;
            });
        }

        // Limite
        if (this.limitConfig) {
            return results.slice(0, this.limitConfig);
        }

        return results;
    }

    /**
     * Extrai valor de campo (suporta nested)
     */
    _getFieldValue(item, field) {
        if (field.includes('.')) {
            return field.split('.').reduce((obj, key) => obj?.[key], item);
        }
        return item[field];
    }
}

/**
 * Cria nova query a partir de dados
 * @param {Array|DataTensor} source
 * @returns {QueryBuilder}
 */
export function query(source) {
    const data = Array.isArray(source) ? source : source.getAll();
    return new QueryBuilder(data);
}

/**
 * Funções utilitárias exportadas
 */
export const BIUtils = {
    truncateTime: Utils.truncateTime,
    formatTimeLabel: Utils.formatTimeLabel,
    getWeekNumber: Utils.getWeekNumber,
    groupBy: Utils.groupBy,
};

export { QueryBuilder };
