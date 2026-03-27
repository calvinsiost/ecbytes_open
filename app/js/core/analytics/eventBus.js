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
 * ecbyts Analytics - Event Bus
 * Sistema central de eventos para sincronização entre viewports
 */

// Tipos de eventos suportados
export const Events = {
    // Eventos de dados
    DATA_UPDATED: 'analytics:data:updated',
    DATA_FILTERED: 'analytics:data:filtered',

    // Eventos de planos de corte
    SLICE_MOVED: 'analytics:slice:moved',
    SLICE_SELECTED: 'analytics:slice:selected',

    // Eventos de histograma
    HISTOGRAM_FILTER: 'analytics:histogram:filter',
    HISTOGRAM_HOVER: 'analytics:histogram:hover',
    HISTOGRAM_UPDATED: 'analytics:histogram:updated',

    // Eventos de seleção
    ELEMENT_SELECTED: 'analytics:element:selected',
    ELEMENT_HIGHLIGHTED: 'analytics:element:highlighted',
    ELEMENTS_FILTERED: 'analytics:elements:filtered',

    // Eventos de viewport
    VIEWPORT_FOCUS: 'analytics:viewport:focus',
    VIEWPORT_RESIZE: 'analytics:viewport:resize',
    VIEWPORT_STATE_CHANGED: 'analytics:viewport:stateChanged',

    // Eventos de sincronização
    VIEW_SYNC: 'analytics:view:sync',
    SYNC_REQUEST: 'analytics:sync:request',

    // Eventos de workflows guiados
    WORKFLOW_STARTED: 'workflow:started',
    WORKFLOW_STEP_CHANGED: 'workflow:step:changed',
    WORKFLOW_COMPLETED: 'workflow:completed',
    WORKFLOW_FAILED: 'workflow:failed',

    // Eventos do agent loop LLM
    AGENT_THINKING: 'llm:agent:thinking',
    AGENT_QUERY: 'llm:agent:query',

    // Eventos de automação de pipelines
    PIPELINE_STARTED: 'pipeline:started',
    PIPELINE_NODE_STARTED: 'pipeline:node:started',
    PIPELINE_NODE_COMPLETED: 'pipeline:node:completed',
    PIPELINE_COMPLETED: 'pipeline:completed',
    PIPELINE_FAILED: 'pipeline:failed',

    // Eventos de issues 3D (BCF-like)
    ISSUE_CREATED: 'issue:created',
    ISSUE_UPDATED: 'issue:updated',
    ISSUE_DELETED: 'issue:deleted',
    ISSUE_FOCUSED: 'issue:focused',
};

/**
 * Event Bus central para comunicação entre componentes
 */
class AnalyticsEventBus {
    constructor() {
        this.listeners = new Map();
        this.history = [];
        this.maxHistorySize = 50;
        this.debugMode = false;
    }

    /**
     * Registra um listener para um evento
     * @param {string} event - Nome do evento
     * @param {Function} handler - Função callback
     * @param {Object} options - Opções adicionais
     * @returns {Function} Função para remover o listener
     */
    on(event, handler, options = {}) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }

        const listener = {
            handler,
            once: options.once || false,
            priority: options.priority || 0,
        };

        const handlers = this.listeners.get(event);
        handlers.push(listener);

        // Ordenar por prioridade (maior primeiro)
        handlers.sort((a, b) => b.priority - a.priority);

        // Retorna função para remover o listener
        return () => this.off(event, handler);
    }

    /**
     * Registra um listener que será executado apenas uma vez
     * @param {string} event - Nome do evento
     * @param {Function} handler - Função callback
     * @returns {Function} Função para remover o listener
     */
    once(event, handler) {
        return this.on(event, handler, { once: true });
    }

    /**
     * Remove um listener específico
     * @param {string} event - Nome do evento
     * @param {Function} handler - Função callback a remover
     */
    off(event, handler) {
        if (!this.listeners.has(event)) return;

        const handlers = this.listeners.get(event);
        const index = handlers.findIndex((l) => l.handler === handler);

        if (index !== -1) {
            handlers.splice(index, 1);
        }

        if (handlers.length === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Remove todos os listeners de um evento
     * @param {string} event - Nome do evento (opcional, remove todos se não especificado)
     */
    offAll(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Emite um evento para todos os listeners
     * @param {string} event - Nome do evento
     * @param {*} payload - Dados do evento
     */
    emit(event, payload) {
        if (this.debugMode) {
            console.log(`[EventBus] ${event}`, payload);
        }

        // Adiciona ao histórico
        this.addToHistory(event, payload);

        if (!this.listeners.has(event)) return;

        const handlers = this.listeners.get(event);
        const toRemove = [];

        handlers.forEach((listener, index) => {
            try {
                listener.handler(payload);

                if (listener.once) {
                    toRemove.push(index);
                }
            } catch (error) {
                console.error(`[EventBus] Error in handler for ${event}:`, error);
            }
        });

        // Remove listeners "once" em ordem reversa
        toRemove.reverse().forEach((index) => {
            handlers.splice(index, 1);
        });
    }

    /**
     * Emite evento com debounce
     * @param {string} event - Nome do evento
     * @param {*} payload - Dados do evento
     * @param {number} delay - Delay em ms (padrão: 50ms)
     */
    emitDebounced(event, payload, delay = 50) {
        if (!this._debounceTimers) {
            this._debounceTimers = new Map();
        }

        if (this._debounceTimers.has(event)) {
            clearTimeout(this._debounceTimers.get(event));
        }

        this._debounceTimers.set(
            event,
            setTimeout(() => {
                this.emit(event, payload);
                this._debounceTimers.delete(event);
            }, delay),
        );
    }

    /**
     * Adiciona evento ao histórico
     * @param {string} event - Nome do evento
     * @param {*} payload - Dados do evento
     */
    addToHistory(event, payload) {
        this.history.push({
            event,
            payload,
            timestamp: Date.now(),
        });

        // Limita tamanho do histórico
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    /**
     * Retorna histórico de eventos
     * @param {string} event - Filtrar por evento (opcional)
     * @returns {Array} Histórico de eventos
     */
    getHistory(event) {
        if (event) {
            return this.history.filter((h) => h.event === event);
        }
        return [...this.history];
    }

    /**
     * Limpa histórico de eventos
     */
    clearHistory() {
        this.history = [];
    }

    /**
     * Ativa/desativa modo debug
     * @param {boolean} enabled
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Verifica se há listeners para um evento
     * @param {string} event - Nome do evento
     * @returns {boolean}
     */
    hasListeners(event) {
        return this.listeners.has(event) && this.listeners.get(event).length > 0;
    }

    /**
     * Retorna contagem de listeners
     * @param {string} event - Nome do evento (opcional)
     * @returns {number}
     */
    listenerCount(event) {
        if (event) {
            return this.listeners.has(event) ? this.listeners.get(event).length : 0;
        }

        let count = 0;
        this.listeners.forEach((handlers) => {
            count += handlers.length;
        });
        return count;
    }
}

// Instância singleton do EventBus
const eventBus = new AnalyticsEventBus();

export { eventBus, AnalyticsEventBus };
export default eventBus;
