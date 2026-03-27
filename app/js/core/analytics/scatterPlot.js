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
 * ecbyts Analytics - Scatter Plot (Dispersão Temporal)
 * Visualiza parâmetros ao longo do tempo
 * Permite identificar tendências e evolução de concentrações
 */

import { eventBus, Events } from './eventBus.js';
import { CONFIG } from '../../config.js';
import { getIcon } from '../../utils/ui/icons.js';
import { getThresholds } from '../validation/rules.js';

/**
 * Configurações padrão do scatter plot
 */
const DEFAULT_CONFIG = {
    colors: {
        plume: '#ff6b6b',
        well: '#4dabf7',
        marker: '#3b82f6',
        spring: '#00BFFF',
        lake: '#4dabf7',
        river: '#228be6',
        tank: '#8B4513',
        sample: '#9C27B0',
        default: '#888888',
    },
    pointRadius: 5,
    trendLine: true,
    animation: {
        duration: 300,
    },
};

/**
 * Classe para scatter plot temporal
 */
export class ScatterPlot {
    constructor(container, options = {}) {
        this.container = container;
        this.options = { ...DEFAULT_CONFIG, ...options };

        // Estado
        this.tensor = null;
        this.data = [];
        this.selectedParameter = '';
        this.selectedElements = new Set();
        this.hoveredPoint = null;

        // Estatísticas
        this.stats = {
            count: 0,
            minTime: null,
            maxTime: null,
            minValue: null,
            maxValue: null,
            slope: null,
        };

        // Inicialização
        this._createContainer();
        this._setupEventListeners();
    }

    /**
     * Cria estrutura do container
     */
    _createContainer() {
        this.container.innerHTML = '';
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.height = '100%';

        // Header com seletor de parâmetro
        this.header = document.createElement('div');
        this.header.className = 'scatter-header';
        this.header.innerHTML = `
            <div class="scatter-title">Dispersão Temporal</div>
            <div class="scatter-stats">
                <span class="stat-item">n: <span class="stat-count">0</span></span>
                <span class="stat-item">tendência: <span class="stat-trend">-</span></span>
            </div>
        `;
        this.container.appendChild(this.header);

        // Seletor de parâmetro
        this.selectorContainer = document.createElement('div');
        this.selectorContainer.className = 'scatter-selector';
        this.selectorContainer.innerHTML = `
            <label>
                <span>Parâmetro:</span>
                <select class="scatter-param-select">
                    <option value="">Todos</option>
                </select>
            </label>
        `;
        this.container.appendChild(this.selectorContainer);

        this.paramSelect = this.selectorContainer.querySelector('.scatter-param-select');
        this.paramSelect.addEventListener('change', () => {
            this.selectedParameter = this.paramSelect.value;
            this._render();
        });

        // Canvas para desenho
        this.canvasContainer = document.createElement('div');
        this.canvasContainer.className = 'scatter-canvas-container';
        this.canvasContainer.style.flex = '1';
        this.canvasContainer.style.position = 'relative';
        this.canvasContainer.style.minHeight = '200px';

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'scatter-canvas';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvasContainer.appendChild(this.canvas);
        this.container.appendChild(this.canvasContainer);

        // Tooltip
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'scatter-tooltip';
        this.tooltip.style.display = 'none';
        this.canvasContainer.appendChild(this.tooltip);

        // Setup canvas events
        this.canvas.addEventListener('mousemove', (e) => this._handleMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => this._hideTooltip());
        this.canvas.addEventListener('click', (e) => this._handleClick(e));

        // Resize observer
        this.resizeObserver = new ResizeObserver(() => this._render());
        this.resizeObserver.observe(this.canvasContainer);
    }

    /**
     * Setup event listeners
     */
    _setupEventListeners() {
        eventBus.on(Events.DATA_UPDATED, () => this._render());
        eventBus.on(Events.ELEMENTS_FILTERED, (data) => this._handleFilter(data));
        eventBus.on(Events.ELEMENT_SELECTED, (data) => this._handleElementSelected(data));
    }

    /**
     * Define o tensor de dados
     */
    setTensor(tensor) {
        this.tensor = tensor;
        this._updateParameterOptions();
        this._render();
    }

    /**
     * Atualiza opções de parâmetro
     */
    _updateParameterOptions() {
        if (!this.tensor) return;

        const parameters = new Set();
        this.tensor.data.forEach((d) => {
            if (d.parameterId) parameters.add(d.parameterId);
        });

        const currentValue = this.paramSelect.value;
        this.paramSelect.innerHTML = '<option value="">Todos</option>';

        Array.from(parameters)
            .sort()
            .forEach((p) => {
                const option = document.createElement('option');
                option.value = p;
                option.textContent = this._getParameterName(p);
                this.paramSelect.appendChild(option);
            });

        // Restore previous selection if available
        if (parameters.has(currentValue)) {
            this.paramSelect.value = currentValue;
            this.selectedParameter = currentValue;
        }
    }

    /**
     * Resolve parameter ID to friendly display name
     */
    _getParameterName(parameterId) {
        if (!parameterId) return '';
        const param = CONFIG.PARAMETERS.find((p) => p.id === parameterId);
        return param ? param.name : parameterId;
    }

    /**
     * Renderiza o gráfico
     */
    _render() {
        if (!this.canvas) return;

        const ctx = this.canvas.getContext('2d');
        const rect = this.canvasContainer.getBoundingClientRect();

        // Ajusta tamanho do canvas para DPI
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        // Limpar canvas
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, rect.width, rect.height);

        // Filtrar dados
        let data = this.tensor?.data || [];
        if (this.selectedParameter) {
            data = data.filter((d) => d.parameterId === this.selectedParameter);
        }

        // Guardar dados filtrados para interação
        this.data = data;

        // Atualizar estatísticas
        this._updateStats(data);

        if (data.length === 0) {
            ctx.fillStyle = '#888';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Sem dados para exibir', rect.width / 2, rect.height / 2);
            return;
        }

        // Calcular bounds
        const times = data.map((d) => d.timestamp);
        const values = data.map((d) => d.value);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);

        // Padding para valores iguais
        const timePadding = maxTime === minTime ? 86400000 : 0; // 1 dia
        const valPadding = maxVal === minVal ? 1 : (maxVal - minVal) * 0.1;

        // Margens
        const margin = { top: 20, right: 30, bottom: 50, left: 70 };
        const plotWidth = rect.width - margin.left - margin.right;
        const plotHeight = rect.height - margin.top - margin.bottom;

        // Escalas
        const scaleX = (t) => margin.left + ((t - minTime) / (maxTime - minTime + timePadding || 1)) * plotWidth;
        const scaleY = (v) =>
            margin.top +
            plotHeight -
            ((v - minVal + valPadding / 2) / (maxVal - minVal + valPadding || 1)) * plotHeight;

        // Guardar escalas para interação
        this.scales = { scaleX, scaleY, minTime, maxTime, minVal, maxVal, margin, plotWidth, plotHeight };

        // Desenhar área do gráfico
        ctx.fillStyle = 'rgba(30, 30, 50, 0.5)';
        ctx.fillRect(margin.left, margin.top, plotWidth, plotHeight);

        // Desenhar grid
        this._drawGrid(ctx, margin, plotWidth, plotHeight, minTime, maxTime, minVal, maxVal, scaleX, scaleY);

        // Desenhar eixos
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + plotHeight);
        ctx.lineTo(margin.left + plotWidth, margin.top + plotHeight);
        ctx.stroke();

        // Labels dos eixos
        ctx.fillStyle = '#aaa';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Tempo', margin.left + plotWidth / 2, rect.height - 5);

        ctx.save();
        ctx.translate(15, margin.top + plotHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(this._getParameterName(this.selectedParameter) || 'Valor', 0, 0);
        ctx.restore();

        // Desenhar linha de tendência
        if (this.options.trendLine && data.length > 2) {
            this._drawTrendLine(ctx, data, scaleX, scaleY);
        }

        // Regulatory limit line
        // Regulatory limit lines — VI (vermelho) e VP (amarelo)
        const regThresholds = this.selectedParameter ? getThresholds(this.selectedParameter) : [];
        const vi = regThresholds.find((t) => t.type === 'vi' || t.type === 'cma');
        const vp = regThresholds.find((t) => t.type === 'vp');
        for (const [threshold, color, label] of [
            [vi, '#ef4444', 'VI'],
            [vp, '#fbbf24', 'VP'],
        ]) {
            if (!threshold || threshold.value == null) continue;
            const yLimit = scaleY(threshold.value);
            if (yLimit >= margin.top && yLimit <= margin.top + plotHeight) {
                ctx.strokeStyle = color;
                ctx.lineWidth = label === 'VI' ? 1.5 : 1;
                ctx.setLineDash(label === 'VI' ? [8, 4] : [4, 4]);
                ctx.beginPath();
                ctx.moveTo(margin.left, yLimit);
                ctx.lineTo(margin.left + plotWidth, yLimit);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = color;
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(
                    `${label}: ${threshold.value} ${threshold.unit} (${threshold.source})`,
                    margin.left + plotWidth - 4,
                    yLimit - 5,
                );
            }
        }

        // Desenhar pontos (coloridos por compliance quando limite existe)
        data.forEach((d, i) => {
            const x = scaleX(d.timestamp);
            const y = scaleY(d.value);
            const isSelected = this.selectedElements.has(d.elementId);
            const isHovered = this.hoveredPoint === i;

            // Color by compliance if limit exists, otherwise by family
            let color;
            if (regLimit && regLimit.max != null) {
                color = d.value > regLimit.max ? '#ef4444' : d.value > regLimit.max * 0.8 ? '#fbbf24' : '#22c55e';
            } else {
                color = this.options.colors[d.family] || this.options.colors.default;
            }

            ctx.beginPath();
            ctx.arc(x, y, isHovered ? 7 : isSelected ? 6 : this.options.pointRadius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            if (isSelected || isHovered) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });

        // Desenhar labels de tempo no eixo X
        this._drawTimeLabels(ctx, minTime, maxTime, margin, plotWidth, plotHeight, scaleX);
    }

    /**
     * Desenha grid
     */
    _drawGrid(ctx, margin, plotWidth, plotHeight, minTime, maxTime, minVal, maxVal, scaleX, scaleY) {
        ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
        ctx.lineWidth = 0.5;

        // Grid horizontal (valores)
        const numYLines = 5;
        const valStep = (maxVal - minVal) / numYLines || 1;
        for (let i = 0; i <= numYLines; i++) {
            const val = minVal + i * valStep;
            const y = scaleY(val);
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + plotWidth, y);
            ctx.stroke();

            // Label
            ctx.fillStyle = '#888';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(val.toFixed(2), margin.left - 5, y + 3);
        }
    }

    /**
     * Desenha labels de tempo
     */
    _drawTimeLabels(ctx, minTime, maxTime, margin, plotWidth, plotHeight, scaleX) {
        const numLabels = Math.min(5, Math.ceil(plotWidth / 100));
        const timeStep = (maxTime - minTime) / numLabels || 1;

        ctx.fillStyle = '#888';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';

        for (let i = 0; i <= numLabels; i++) {
            const time = minTime + i * timeStep;
            const x = scaleX(time);
            const date = new Date(time);
            const label = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear().toString().slice(2)}`;
            ctx.fillText(label, x, margin.top + plotHeight + 20);
        }
    }

    /**
     * Desenha linha de tendência (regressão linear)
     */
    _drawTrendLine(ctx, data, scaleX, scaleY) {
        const n = data.length;
        const times = data.map((d) => d.timestamp);
        const values = data.map((d) => d.value);

        const sumX = times.reduce((a, b) => a + b, 0);
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = data.reduce((a, d) => a + d.timestamp * d.value, 0);
        const sumXX = times.reduce((a, t) => a + t * t, 0);

        const denominator = n * sumXX - sumX * sumX;
        if (Math.abs(denominator) < 1e-10) return;

        const slope = (n * sumXY - sumX * sumY) / denominator;
        const intercept = (sumY - slope * sumX) / n;

        this.stats.slope = slope;

        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(scaleX(minTime), scaleY(slope * minTime + intercept));
        ctx.lineTo(scaleX(maxTime), scaleY(slope * maxTime + intercept));
        ctx.stroke();
        ctx.setLineDash([]);

        // Atualizar indicador de tendência
        const trendEl = this.header.querySelector('.stat-trend');
        if (trendEl) {
            if (slope > 0) {
                trendEl.innerHTML = getIcon('trending-up', { size: '12px' }) + ' crescente';
                trendEl.style.color = '#ef4444';
            } else if (slope < 0) {
                trendEl.innerHTML = getIcon('trending-down', { size: '12px' }) + ' decrescente';
                trendEl.style.color = '#22c55e';
            } else {
                trendEl.innerHTML = getIcon('minus', { size: '12px' }) + ' estável';
                trendEl.style.color = '#888';
            }
        }
    }

    /**
     * Atualiza estatísticas
     */
    _updateStats(data) {
        this.stats.count = data.length;

        const countEl = this.header.querySelector('.stat-count');
        if (countEl) countEl.textContent = data.length;

        if (data.length === 0) {
            const trendEl = this.header.querySelector('.stat-trend');
            if (trendEl) {
                trendEl.textContent = '-';
                trendEl.style.color = '#888';
            }
        }
    }

    /**
     * Encontra ponto mais próximo do mouse
     */
    _findNearestPoint(mouseX, mouseY) {
        if (!this.scales || this.data.length === 0) return null;

        const { scaleX, scaleY } = this.scales;
        let nearestIndex = null;
        let nearestDist = Infinity;

        this.data.forEach((d, i) => {
            const x = scaleX(d.timestamp);
            const y = scaleY(d.value);
            const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);

            if (dist < nearestDist && dist < 20) {
                nearestDist = dist;
                nearestIndex = i;
            }
        });

        return nearestIndex;
    }

    /**
     * Handle mouse move
     */
    _handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const nearestIndex = this._findNearestPoint(mouseX, mouseY);

        if (nearestIndex !== this.hoveredPoint) {
            this.hoveredPoint = nearestIndex;
            this._render();

            if (nearestIndex !== null) {
                this._showTooltip(nearestIndex, mouseX, mouseY);
            } else {
                this._hideTooltip();
            }
        }
    }

    /**
     * Show tooltip
     */
    _showTooltip(index, x, y) {
        const d = this.data[index];
        if (!d) return;

        const date = new Date(d.timestamp);
        const dateStr = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;

        this.tooltip.innerHTML = `
            <strong>${d.elementId}</strong><br>
            ${this._getParameterName(d.parameterId)}: ${d.value.toFixed(3)}<br>
            Data: ${dateStr}
        `;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = `${x + 10}px`;
        this.tooltip.style.top = `${y - 10}px`;

        // Emit highlight event
        eventBus.emit(Events.ELEMENT_HIGHLIGHTED, { elementId: d.elementId });
    }

    /**
     * Hide tooltip
     */
    _hideTooltip() {
        this.tooltip.style.display = 'none';
        eventBus.emit(Events.ELEMENT_HIGHLIGHTED, { elementId: null });
    }

    /**
     * Handle click
     */
    _handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const nearestIndex = this._findNearestPoint(mouseX, mouseY);

        if (nearestIndex !== null) {
            const d = this.data[nearestIndex];
            eventBus.emit(Events.ELEMENT_SELECTED, { elementId: d.elementId });
        }
    }

    /**
     * Handle filter event
     */
    _handleFilter(data) {
        if (data && data.elementIds) {
            this.selectedElements = new Set(data.elementIds);
        } else {
            this.selectedElements.clear();
        }
        this._render();
    }

    /**
     * Handle element selected
     */
    _handleElementSelected(data) {
        if (data && data.elementId) {
            this.selectedElements.clear();
            this.selectedElements.add(data.elementId);
        } else {
            this.selectedElements.clear();
        }
        this._render();
    }

    /**
     * Dispose
     */
    dispose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }
}

export default ScatterPlot;
