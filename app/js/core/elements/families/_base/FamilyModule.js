// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: FamilyModule Base Class
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   FAMILY MODULE — Classe base para modulos plugaveis de familia.

   Define contrato de ciclo de vida que todo modulo de familia
   deve seguir. Garante limpeza de DOM e listeners no unmount().

   CONTRATO:
   - mount(container, element, options)  → renderiza UI no DOM
   - update(element)                     → atualiza com novos dados
   - unmount()                           → destroi tudo, limpa memoria

   REGRAS:
   - Toda criacao de DOM deve usar this._container
   - Todo addEventListener deve usar this._listen() (AbortController)
   - unmount() e chamado automaticamente pelo registry
   - CSS isolado via prefixo .ecbt-fm-{familyId}

   HOOKS OPCIONAIS:
   - getSchema()        → JSON Schema dos dados do profile
   - validate(data)     → validacao de regras de negocio
   - getDefaultData()   → dados padrao para elemento novo
   - exportSVG()        → exporta conteudo como SVG string
   - migrateData(old)   → migra dados legados para formato profile
   ================================================================ */

/**
 * Classe base abstrata para modulos de familia de elementos.
 * Subclasses devem sobrescrever mount(), update(), unmount(),
 * _getFamilyId() e getStyles().
 */
export class FamilyModule {
    constructor() {
        /** @type {HTMLElement|null} Container DOM fornecido pelo mount() */
        this._container = null;

        /** @type {AbortController|null} Controller para cleanup de listeners */
        this._abortController = null;

        /** @type {Object|null} Dados do elemento atual */
        this._element = null;

        /** @type {boolean} Se o modulo esta montado */
        this._mounted = false;
    }

    // ----------------------------------------------------------------
    // LIFECYCLE — Overridden by subclasses
    // ----------------------------------------------------------------

    /**
     * Monta o modulo no container DOM.
     * Subclasses DEVEM chamar super.mount() primeiro.
     *
     * @param {HTMLElement} container - Container DOM para renderizar
     * @param {Object} element - Dados do elemento
     * @param {Object} [options] - Opcoes (editable, language, etc.)
     */
    async mount(container, element, options = {}) {
        if (this._mounted) {
            this.unmount();
        }

        this._container = container;
        this._element = element;
        this._abortController = new AbortController();
        this._mounted = true;

        // Injeta CSS do modulo (idempotente — nao duplica)
        this._injectStyles();
    }

    /**
     * Atualiza o modulo com novos dados do elemento.
     * Chamado quando element.data muda (ex: edicao no inspector).
     *
     * @param {Object} element - Elemento com dados atualizados
     */
    update(element) {
        this._element = element;
    }

    /**
     * Desmonta o modulo: limpa DOM, listeners, referencias.
     * Subclasses DEVEM chamar super.unmount() no final do seu unmount().
     */
    unmount() {
        // Aborta todos os listeners registrados via signal
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }

        // Limpa container DOM
        if (this._container) {
            this._container.innerHTML = '';
            this._container = null;
        }

        this._element = null;
        this._mounted = false;
    }

    // ----------------------------------------------------------------
    // OPTIONAL HOOKS — Override as needed
    // ----------------------------------------------------------------

    /**
     * Retorna schema JSON do profile data desta familia.
     * Usado pelo inspector para renderizar campos tipados.
     *
     * @returns {Object|null} JSON Schema ou null
     */
    getSchema() {
        return null;
    }

    /**
     * Valida dados do profile.
     *
     * @param {Object} profileData - Dados do profile a validar
     * @returns {{ valid: boolean, errors: string[] }}
     */
    validate(profileData) {
        return { valid: true, errors: [] };
    }

    /**
     * Retorna dados padrao do profile para um novo elemento.
     *
     * @returns {Object} Profile data default
     */
    getDefaultData() {
        return {};
    }

    /**
     * Exporta conteudo do modulo como SVG string.
     * Usado para PDF export e clipboard.
     *
     * @returns {string|null} SVG markup ou null
     */
    exportSVG() {
        return null;
    }

    /**
     * Migra dados legados para o formato profile atual.
     * Chamado na primeira vez que um elemento antigo e aberto.
     *
     * @param {Object} oldData - element.data completo (formato antigo)
     * @returns {Object|null} Profile data migrado, ou null se nada a migrar
     */
    migrateData(oldData) {
        return null;
    }

    // ----------------------------------------------------------------
    // PROTECTED HELPERS — For subclass use
    // ----------------------------------------------------------------

    /**
     * Registra event listener com cleanup automatico via AbortController.
     * Subclasses DEVEM usar este metodo em vez de addEventListener direto.
     *
     * @param {EventTarget} target - Alvo do evento (DOM element, window, etc.)
     * @param {string} event - Nome do evento ('click', 'input', etc.)
     * @param {Function} handler - Callback
     * @param {Object} [options] - Opcoes extras do addEventListener
     */
    _listen(target, event, handler, options = {}) {
        if (!this._abortController) {
            console.warn('[FamilyModule] Cannot add listener: module not mounted');
            return;
        }
        target.addEventListener(event, handler, {
            ...options,
            signal: this._abortController.signal,
        });
    }

    /**
     * Cria elemento DOM com namespace opcional (para SVG).
     *
     * @param {string} tag - Tag name ('div', 'svg', 'rect', etc.)
     * @param {Object} [attrs] - Atributos a definir
     * @param {string} [ns] - Namespace URI (null para HTML, SVG_NS para SVG)
     * @returns {Element}
     */
    _createElement(tag, attrs = {}, ns = null) {
        const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
        for (const [key, val] of Object.entries(attrs)) {
            el.setAttribute(key, val);
        }
        return el;
    }

    /**
     * Injeta <style> no <head> para CSS do modulo.
     * Idempotente: verifica se ja existe pelo ID antes de criar.
     * Subclasses definem getStyles() para retornar CSS string.
     */
    _injectStyles() {
        const css = this.getStyles();
        if (!css) return;

        const id = `ecbt-fm-${this._getFamilyId()}-styles`;
        if (document.getElementById(id)) return;

        const style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        document.head.appendChild(style);
    }

    /**
     * Retorna CSS string do modulo.
     * Subclasses devem sobrescrever para retornar CSS com prefixo
     * .ecbt-fm-{familyId}.
     *
     * @returns {string|null}
     */
    getStyles() {
        return null;
    }

    /**
     * Retorna o familyId deste modulo.
     * DEVE ser sobrescrito por subclasses.
     *
     * @returns {string}
     */
    _getFamilyId() {
        return 'base';
    }
}

/** SVG namespace URI — util para subclasses que renderizam SVG */
export const SVG_NS = 'http://www.w3.org/2000/svg';
