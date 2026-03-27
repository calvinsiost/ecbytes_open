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
 * ecbyts Analytics - Viewport Manager
 * Gerenciador de múltiplos viewports no workspace
 */

import { eventBus, Events } from './eventBus.js';
import { ViewportContainer, ContainerState } from './workspaceContainer.js';
import SlicePlane, { PLANE_CONFIG } from './slicePlane.js';
import DynamicHistogram from './histogram.js';
import { ScatterPlot } from './scatterPlot.js';
import { CrossTabTable } from './crossTab.js';
import { ViolationsTimeline } from './violationsTimeline.js';
import { CalculatorViewport } from './calculatorViewport.js';

const ViewportType = {
    SLICE_XY: 'slice_xy',
    SLICE_XZ: 'slice_xz',
    SLICE_YZ: 'slice_yz',
    HISTOGRAM: 'histogram',
    SCATTER_TIME: 'scatter_time',
    CROSSTAB: 'crosstab',
    VIOLATIONS: 'violations_timeline',
    CALCULATOR: 'calculator',
};

const VIEWPORT_CONFIGS = {
    [ViewportType.SLICE_XY]: { title: 'Planta (XY)', icon: 'cube', plane: 'XY' },
    [ViewportType.SLICE_XZ]: { title: 'Perfil Transversal (XZ)', icon: 'bar-chart', plane: 'XZ' },
    [ViewportType.SLICE_YZ]: { title: 'Perfil Longitudinal (YZ)', icon: 'bar-chart', plane: 'YZ' },
    [ViewportType.HISTOGRAM]: { title: 'Histograma', icon: 'bar-chart' },
    [ViewportType.SCATTER_TIME]: { title: 'Dispersão Temporal', icon: 'bar-chart' },
    [ViewportType.CROSSTAB]: { title: 'Compliance Matrix', icon: 'shield' },
    [ViewportType.VIOLATIONS]: { title: 'Violations Timeline', icon: 'alert-triangle' },
    [ViewportType.CALCULATOR]: { title: 'Calculator', icon: 'calculator' },
};

class ViewportManager {
    constructor(workspaceElement) {
        this.workspace = workspaceElement;
        this.viewports = new Map();
        this.slicePlanes = new Map();
        this.histogram = null;
        this.scatterPlot = null;
        this.tensor = null;
        this._setupWorkspace();
        this._setupEventListeners();
    }

    _setupWorkspace() {
        this.workspace.className = 'analytics-workspace';

        // Empty state overlay — exibido quando nao ha dados
        this.emptyOverlay = document.createElement('div');
        this.emptyOverlay.className = 'analytics-empty-state';
        this.emptyOverlay.innerHTML = `
            <div class="analytics-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/></svg></div>
            <div class="analytics-empty-title">No data to display</div>
            <div class="analytics-empty-desc">Add observations to elements to visualize data in the analytics workspace.</div>
        `;
        this.workspace.appendChild(this.emptyOverlay);

        this.pinnedContainer = document.createElement('div');
        this.pinnedContainer.className = 'viewport-pinned-container';
        this.workspace.appendChild(this.pinnedContainer);

        this.sliderContainer = document.createElement('div');
        this.sliderContainer.className = 'slice-sliders-container';
        this.workspace.appendChild(this.sliderContainer);
    }

    _setupEventListeners() {
        eventBus.on(Events.DATA_UPDATED, () => this._onDataUpdated());
        eventBus.on(Events.VIEWPORT_STATE_CHANGED, (d) => this._onViewportStateChanged(d));
    }

    initializeDefaultViewports() {
        this.createViewport(ViewportType.SLICE_XY);
        this.createViewport(ViewportType.SLICE_XZ);
        this.createViewport(ViewportType.SLICE_YZ);
        this.createViewport(ViewportType.HISTOGRAM);
        this.createViewport(ViewportType.SCATTER_TIME);
        this.createViewport(ViewportType.CROSSTAB);
        this.createViewport(ViewportType.VIOLATIONS);
        this.createViewport(ViewportType.CALCULATOR);
        this._createSliceSliders();
    }

    createViewport(type, options = {}) {
        const config = VIEWPORT_CONFIGS[type];
        if (!config) return null;

        const id = `${type}_${Date.now()}`;
        const container = new ViewportContainer(id, { title: config.title, icon: config.icon, ...options });
        container.appendTo(this.pinnedContainer);

        if (type.startsWith('slice_')) {
            this._initSlicePlane(container, config.plane);
        } else if (type === ViewportType.HISTOGRAM) {
            this._initHistogram(container);
        } else if (type === ViewportType.SCATTER_TIME) {
            this._initScatterPlot(container);
        } else if (type === ViewportType.CROSSTAB) {
            this._initCrossTab(container);
        } else if (type === ViewportType.VIOLATIONS) {
            this._initViolationsTimeline(container);
        } else if (type === ViewportType.CALCULATOR) {
            this._initCalculator(container);
        }

        this.viewports.set(id, { type, container, config });
        return container;
    }

    _initSlicePlane(container, plane) {
        const contentEl = container.getContentElement();
        contentEl.style.padding = '0';
        const slicePlane = new SlicePlane(plane, contentEl);
        this.slicePlanes.set(container.id, slicePlane);

        if (this.tensor) {
            slicePlane.setBounds(this.tensor.getBounds());
            slicePlane.updateData(this.tensor.getAll());
        }
    }

    _initHistogram(container) {
        const contentEl = container.getContentElement();
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        this.histogram = new DynamicHistogram(contentEl);

        if (this.tensor) {
            this.histogram.update(this.tensor.getAll());
        }
    }

    _initScatterPlot(container) {
        const contentEl = container.getContentElement();
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        this.scatterPlot = new ScatterPlot(contentEl);

        if (this.tensor) {
            this.scatterPlot.setTensor(this.tensor);
        }
    }

    _initCrossTab(container) {
        const contentEl = container.getContentElement();
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        this.crossTab = new CrossTabTable(contentEl);

        if (this.tensor) {
            this.crossTab.setTensor(this.tensor);
        }
    }

    _initViolationsTimeline(container) {
        const contentEl = container.getContentElement();
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        this.violationsTimeline = new ViolationsTimeline(contentEl);

        if (this.tensor) {
            this.violationsTimeline.setTensor(this.tensor);
        }
    }

    _initCalculator(container) {
        const contentEl = container.getContentElement();
        this.calculatorViewport = new CalculatorViewport(contentEl);

        if (this.tensor) {
            this.calculatorViewport.setTensor(this.tensor);
        }
    }

    _createSliceSliders() {
        const sliders = [
            { axis: 'z', label: 'Profundidade (Z)', plane: 'XY', color: PLANE_CONFIG.XY.color },
            { axis: 'y', label: 'Norte-Sul (Y)', plane: 'XZ', color: PLANE_CONFIG.XZ.color },
            { axis: 'x', label: 'Leste-Oeste (X)', plane: 'YZ', color: PLANE_CONFIG.YZ.color },
        ];

        sliders.forEach(({ axis, label, plane, color }) => {
            const div = document.createElement('div');
            div.className = 'slice-slider-group';
            div.innerHTML = `
                <label class="slice-slider-label" style="color: ${color}">
                    <span>${label}</span>
                    <span class="slice-slider-value" id="slider-value-${axis}">0</span>
                </label>
                <input type="range" class="slice-slider" id="slice-slider-${axis}"
                       data-axis="${axis}" data-plane="${plane}" min="-100" max="100" value="0" step="1">
            `;
            this.sliderContainer.appendChild(div);

            div.querySelector(`#slice-slider-${axis}`).addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                div.querySelector(`#slider-value-${axis}`).textContent = value.toFixed(1);
                this.setSlicePosition(plane, value);
            });
        });
    }

    _updateSliderBounds() {
        if (!this.tensor) return;
        const bounds = this.tensor.getBounds();

        ['x', 'y', 'z'].forEach((axis) => {
            const slider = this.sliderContainer.querySelector(`#slice-slider-${axis}`);
            if (slider && bounds[axis]) {
                slider.min = bounds[axis].min;
                slider.max = bounds[axis].max;
                slider.value = (bounds[axis].min + bounds[axis].max) / 2;
                const valueEl = this.sliderContainer.querySelector(`#slider-value-${axis}`);
                if (valueEl) valueEl.textContent = slider.value;
            }
        });
    }

    setSlicePosition(plane, position) {
        this.slicePlanes.forEach((sp) => {
            if (sp.plane === plane) {
                sp.setPosition(position);
                if (this.tensor) sp.updateData(this.tensor.getAll());
            }
        });
    }

    setTensor(tensor) {
        this.tensor = tensor;
        const bounds = tensor.getBounds();
        const data = tensor.getAll();

        // Mostrar/esconder empty state
        const hasData = data && data.length > 0;
        if (this.emptyOverlay) {
            this.emptyOverlay.style.display = hasData ? 'none' : '';
        }

        this.slicePlanes.forEach((sp) => {
            sp.setBounds(bounds);
            sp.updateData(data);
        });

        if (this.histogram) this.histogram.update(data);
        if (this.scatterPlot) this.scatterPlot.setTensor(tensor);
        if (this.crossTab) this.crossTab.setTensor(tensor);
        if (this.violationsTimeline) this.violationsTimeline.setTensor(tensor);
        if (this.calculatorViewport) this.calculatorViewport.setTensor(tensor);
        this._updateSliderBounds();
    }

    _onDataUpdated() {
        if (!this.tensor) return;
        const data = this.tensor.getAll();
        this.slicePlanes.forEach((sp) => sp.updateData(data));
        if (this.histogram) this.histogram.update(data);
        if (this.scatterPlot) this.scatterPlot.setTensor(this.tensor);
        if (this.crossTab) this.crossTab.setTensor(this.tensor);
        if (this.violationsTimeline) this.violationsTimeline.setTensor(this.tensor);
        if (this.calculatorViewport) this.calculatorViewport.setTensor(this.tensor);
    }

    _onViewportStateChanged(data) {
        if (data.action === 'closed') {
            this.viewports.delete(data.id);
            this.slicePlanes.delete(data.id);
        }
    }

    destroy() {
        this.viewports.forEach((v) => v.container.destroy());
        this.viewports.clear();
        this.slicePlanes.clear();
        if (this.histogram) {
            this.histogram.destroy();
            this.histogram = null;
        }
        if (this.scatterPlot) {
            this.scatterPlot.dispose();
            this.scatterPlot = null;
        }
        if (this.crossTab) {
            this.crossTab.destroy();
            this.crossTab = null;
        }
        if (this.violationsTimeline) {
            this.violationsTimeline.destroy();
            this.violationsTimeline = null;
        }
        this.workspace.innerHTML = '';
    }

    /**
     * Reseta o layout recriando todos os viewports padrão.
     * Chamado pelo botão "Resetar" na toolbar do analytics.
     */
    resetLayout() {
        // Limpar viewports existentes
        this.viewports.forEach((v) => v.container.destroy());
        this.viewports.clear();
        this.slicePlanes.clear();
        if (this.histogram) {
            this.histogram.destroy();
            this.histogram = null;
        }
        if (this.scatterPlot) {
            this.scatterPlot.dispose();
            this.scatterPlot = null;
        }

        // Limpar containers
        this.pinnedContainer.innerHTML = '';
        this.sliderContainer.innerHTML = '';

        // Recriar todos os viewports padrão
        this.initializeDefaultViewports();

        // Atualizar dados se tensor existir
        if (this.tensor) {
            this.setTensor(this.tensor);
        }
    }
}

export { ViewportManager, ViewportType, VIEWPORT_CONFIGS };
export default ViewportManager;
