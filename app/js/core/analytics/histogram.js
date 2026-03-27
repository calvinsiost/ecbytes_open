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
 * ecbyts Analytics - Dynamic Histogram
 * Histogramas dinâmicos para análise de distribuição estatística
 * Usa Chart.js para renderização
 */

import { eventBus, Events } from './eventBus.js';

/**
 * Configurações padrão do histograma
 */
const DEFAULT_CONFIG = {
    binCount: 20,
    minBinCount: 5,
    maxBinCount: 50,
    colors: {
        default: 'rgba(59, 130, 246, 0.6)',
        selected: 'rgba(34, 197, 94, 0.8)',
        hover: 'rgba(251, 191, 36, 0.8)',
        border: 'rgba(59, 130, 246, 1)',
    },
    animation: {
        duration: 300,
    },
};

/**
 * Classe para histograma dinâmico
 */
class DynamicHistogram {
    constructor(container, options = {}) {
        this.container = container;
        this.options = { ...DEFAULT_CONFIG, ...options };

        // Estado
        this.data = [];
        this.bins = [];
        this.selectedBins = new Set();
        this.hoveredBin = null;
        this.parameterId = null;
        this.chart = null;

        // Estatísticas
        this.stats = {
            count: 0,
            min: null,
            max: null,
            mean: null,
            std: null,
        };

        // Inicialização
        this._createContainer();
        this._setupEventListeners();
    }

    /**
     * Cria estrutura do container
     */
    _createContainer() {
        // Header com estatísticas
        this.header = document.createElement('div');
        this.header.className = 'histogram-header';
        this.header.innerHTML = `
            <div class="histogram-title">Distribuição de Frequência</div>
            <div class="histogram-stats">
                <span class="stat-item">n: <span id="stat-count">0</span></span>
                <span class="stat-item">μ: <span id="stat-mean">-</span></span>
                <span class="stat-item">σ: <span id="stat-std">-</span></span>
            </div>
        `;
        this.container.appendChild(this.header);

        // Canvas para Chart.js
        this.canvasContainer = document.createElement('div');
        this.canvasContainer.className = 'histogram-canvas-container';
        this.canvasContainer.style.flex = '1';
        this.canvasContainer.style.position = 'relative';

        this.canvas = document.createElement('canvas');
        this.canvasContainer.appendChild(this.canvas);
        this.container.appendChild(this.canvasContainer);

        // Controles
        this.controls = document.createElement('div');
        this.controls.className = 'histogram-controls';
        this.controls.innerHTML = `
            <label class="histogram-control">
                <span>Bins:</span>
                <input type="range" id="bin-slider" min="${this.options.minBinCount}" max="${this.options.maxBinCount}" value="${this.options.binCount}">
                <span id="bin-count">${this.options.binCount}</span>
            </label>
            <button id="clear-selection" class="histogram-btn">Limpar Seleção</button>
        `;
        this.container.appendChild(this.controls);

        // Event listeners para controles
        const binSlider = this.controls.querySelector('#bin-slider');
        binSlider.addEventListener('input', (e) => {
            this.options.binCount = parseInt(e.target.value);
            this.controls.querySelector('#bin-count').textContent = this.options.binCount;
            this._recalculateBins();
            this._updateChart();
        });

        const clearBtn = this.controls.querySelector('#clear-selection');
        clearBtn.addEventListener('click', () => this.clearSelection());
    }

    /**
     * Configura event listeners
     */
    _setupEventListeners() {
        eventBus.on(Events.DATA_UPDATED, () => {
            this._recalculateBins();
            this._updateChart();
        });

        eventBus.on(Events.ELEMENT_SELECTED, (data) => {
            // Destacar bin do elemento selecionado
            this._highlightElementBin(data.elementId);
        });
    }

    /**
     * Inicializa Chart.js
     */
    async _initChart() {
        // Verifica se Chart.js está disponível
        if (typeof Chart === 'undefined') {
            console.warn('Chart.js not loaded. Histogram will not render.');
            return;
        }

        const ctx = this.canvas.getContext('2d');

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Frequência',
                        data: [],
                        backgroundColor: [],
                        borderColor: this.options.colors.border,
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: this.options.animation.duration,
                },
                plugins: {
                    legend: {
                        display: false,
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (items.length === 0) return '';
                                const bin = this.bins[items[0].dataIndex];
                                return `${bin.min.toFixed(2)} - ${bin.max.toFixed(2)}`;
                            },
                            label: (item) => {
                                const count = item.raw;
                                const percentage = ((count / this.stats.count) * 100).toFixed(1);
                                return `Frequência: ${count} (${percentage}%)`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Valor',
                            color: '#888888',
                        },
                        ticks: {
                            color: '#888888',
                            maxRotation: 45,
                            minRotation: 45,
                        },
                        grid: {
                            color: '#333333',
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Frequência',
                            color: '#888888',
                        },
                        ticks: {
                            color: '#888888',
                            stepSize: 1,
                        },
                        grid: {
                            color: '#333333',
                        },
                        beginAtZero: true,
                    },
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const binIndex = elements[0].index;
                        this._onBinClick(binIndex);
                    }
                },
                onHover: (event, elements) => {
                    if (elements.length > 0) {
                        this.hoveredBin = elements[0].index;
                        this.canvas.style.cursor = 'pointer';
                    } else {
                        this.hoveredBin = null;
                        this.canvas.style.cursor = 'default';
                    }
                },
            },
        });
    }

    /**
     * Atualiza dados do histograma
     * @param {Array} dataPoints - Array de DataPoints
     * @param {string} parameterId - ID do parâmetro (opcional)
     */
    update(dataPoints, parameterId = null) {
        this.data = dataPoints;
        this.parameterId = parameterId;

        // Extrai valores numéricos
        const values = dataPoints.map((p) => p.value).filter((v) => typeof v === 'number' && !isNaN(v));

        if (values.length === 0) {
            this._clearChart();
            return;
        }

        // Calcula estatísticas
        this._calculateStats(values);

        // Recalcula bins
        this._recalculateBins();

        // Atualiza chart
        if (!this.chart) {
            this._initChart().then(() => this._updateChart());
        } else {
            this._updateChart();
        }

        // Atualiza UI de estatísticas
        this._updateStatsUI();
    }

    /**
     * Calcula estatísticas descritivas
     */
    _calculateStats(values) {
        const n = values.length;
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / n;
        const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / n;

        this.stats = {
            count: n,
            min: Math.min(...values),
            max: Math.max(...values),
            mean: mean,
            std: Math.sqrt(variance),
            sum: sum,
        };
    }

    /**
     * Recalcula bins do histograma
     */
    _recalculateBins() {
        const values = this.data.map((p) => p.value).filter((v) => typeof v === 'number' && !isNaN(v));

        if (values.length === 0) {
            this.bins = [];
            return;
        }

        const { min, max } = this.stats;
        const binCount = this.options.binCount;
        const binWidth = (max - min) / binCount || 1;

        this.bins = [];
        for (let i = 0; i < binCount; i++) {
            this.bins.push({
                index: i,
                min: min + i * binWidth,
                max: min + (i + 1) * binWidth,
                count: 0,
                dataPoints: [],
            });
        }

        // Distribui valores nos bins
        this.data.forEach((point) => {
            const value = point.value;
            if (typeof value !== 'number' || isNaN(value)) return;

            let binIndex = Math.floor((value - min) / binWidth);
            if (binIndex >= binCount) binIndex = binCount - 1;
            if (binIndex < 0) binIndex = 0;

            this.bins[binIndex].count++;
            this.bins[binIndex].dataPoints.push(point);
        });
    }

    /**
     * Atualiza o gráfico Chart.js
     */
    _updateChart() {
        if (!this.chart) return;

        const labels = this.bins.map((bin) => `${bin.min.toFixed(1)}`);

        const counts = this.bins.map((bin) => bin.count);

        const colors = this.bins.map((bin, index) => {
            if (this.selectedBins.has(index)) {
                return this.options.colors.selected;
            }
            return this.options.colors.default;
        });

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = counts;
        this.chart.data.datasets[0].backgroundColor = colors;

        this.chart.update('none');
    }

    /**
     * Atualiza UI de estatísticas
     */
    _updateStatsUI() {
        const countEl = this.header.querySelector('#stat-count');
        const meanEl = this.header.querySelector('#stat-mean');
        const stdEl = this.header.querySelector('#stat-std');

        if (countEl) countEl.textContent = this.stats.count;
        if (meanEl) meanEl.textContent = this.stats.mean?.toFixed(2) || '-';
        if (stdEl) stdEl.textContent = this.stats.std?.toFixed(2) || '-';
    }

    /**
     * Limpa o gráfico
     */
    _clearChart() {
        if (this.chart) {
            this.chart.data.labels = [];
            this.chart.data.datasets[0].data = [];
            this.chart.update();
        }

        this.stats = { count: 0, min: null, max: null, mean: null, std: null };
        this._updateStatsUI();
    }

    /**
     * Handler de click em bin
     */
    _onBinClick(binIndex) {
        // Toggle seleção
        if (this.selectedBins.has(binIndex)) {
            this.selectedBins.delete(binIndex);
        } else {
            this.selectedBins.add(binIndex);
        }

        // Atualiza cores
        this._updateChart();

        // Emite evento de filtro
        this._emitFilterEvent();
    }

    /**
     * Emite evento de filtro baseado em bins selecionados
     */
    _emitFilterEvent() {
        if (this.selectedBins.size === 0) {
            eventBus.emit(Events.HISTOGRAM_FILTER, {
                active: false,
                elementIds: [],
                binRanges: [],
            });
            return;
        }

        // Coleta elementos dos bins selecionados
        const elementIds = new Set();
        const binRanges = [];

        this.selectedBins.forEach((binIndex) => {
            const bin = this.bins[binIndex];
            if (bin) {
                binRanges.push({ min: bin.min, max: bin.max });
                bin.dataPoints.forEach((point) => {
                    elementIds.add(point.elementId);
                });
            }
        });

        eventBus.emit(Events.HISTOGRAM_FILTER, {
            active: true,
            elementIds: Array.from(elementIds),
            binRanges,
            parameterId: this.parameterId,
        });

        // Também emite elementos filtrados
        eventBus.emit(Events.ELEMENTS_FILTERED, {
            elementIds: Array.from(elementIds),
            source: 'histogram',
        });
    }

    /**
     * Destaca bin que contém um elemento específico
     */
    _highlightElementBin(elementId) {
        // Encontra bin do elemento
        for (let i = 0; i < this.bins.length; i++) {
            const bin = this.bins[i];
            const found = bin.dataPoints.some((p) => p.elementId === elementId);
            if (found) {
                // Não seleciona, apenas destaca temporariamente
                // Poderia usar tooltip ou animação
                break;
            }
        }
    }

    /**
     * Destaca um valor específico
     */
    highlight(value) {
        if (typeof value !== 'number' || isNaN(value)) return;

        // Encontra bin do valor
        const binWidth = (this.stats.max - this.stats.min) / this.options.binCount;
        let binIndex = Math.floor((value - this.stats.min) / binWidth);
        if (binIndex >= this.options.binCount) binIndex = this.options.binCount - 1;
        if (binIndex < 0) binIndex = 0;

        // Destaca temporariamente (poderia animar)
        this.hoveredBin = binIndex;
    }

    /**
     * Limpa seleção de bins
     */
    clearSelection() {
        this.selectedBins.clear();
        this._updateChart();

        eventBus.emit(Events.HISTOGRAM_FILTER, {
            active: false,
            elementIds: [],
            binRanges: [],
        });
    }

    /**
     * Define bins selecionados
     */
    setSelectedBins(binIndices) {
        this.selectedBins = new Set(binIndices);
        this._updateChart();
    }

    /**
     * Retorna bins selecionados
     */
    getSelectedBins() {
        return Array.from(this.selectedBins);
    }

    /**
     * Retorna elementos nos bins selecionados
     */
    getSelectedElements() {
        const elements = [];
        this.selectedBins.forEach((binIndex) => {
            const bin = this.bins[binIndex];
            if (bin) {
                elements.push(...bin.dataPoints);
            }
        });
        return elements;
    }

    /**
     * Retorna estatísticas
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Destrói o histograma
     */
    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }

        this.container.innerHTML = '';
        eventBus.off(Events.DATA_UPDATED);
        eventBus.off(Events.ELEMENT_SELECTED);
    }
}

export { DynamicHistogram, DEFAULT_CONFIG as HISTOGRAM_CONFIG };
export default DynamicHistogram;
