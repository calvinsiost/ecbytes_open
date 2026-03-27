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
   HISTORY MANAGER — Undo/Redo via state snapshots
   Gerenciador de historico usando snapshots (mementos) do modelo.

   Cada acao significativa gera um snapshot que pode ser restaurado.
   Usa buildModel/applyModel do sistema de export/import existente.

   LIMITACOES:
   - Max 50 snapshots na memoria
   - Camera view nao e restaurada (navegacao e separada)
   - Apenas estado dos dados, nao estado da UI
   ================================================================ */

const MAX_HISTORY = 50;
const SNAPSHOT_DELAY = 400; // ms de pausa antes de capturar snapshot (debounce)
let undoStack = [];
let redoStack = [];
let _buildModel = null;
let _applyModel = null;
let _updateAllUI = null;
let _isPaused = false;
let _restoreGeneration = 0; // Incrementa a cada restore para ignorar pushes atrasados
let _snapshotTimer = null;

/**
 * Initialize history with serialization functions.
 * @param {Object} options
 * @param {Function} options.buildModel - Serializes current state to JSON
 * @param {Function} options.applyModel - Restores state from JSON
 * @param {Function} options.updateAllUI - Refreshes UI after restore
 */
export function initHistory({ buildModel, applyModel, updateAllUI }) {
    _buildModel = buildModel;
    _applyModel = applyModel;
    _updateAllUI = updateAllUI;
    undoStack = [];
    redoStack = [];
}

/**
 * Capture current state as a snapshot (debounced).
 * Chamada apos cada mutacao significativa nos dados.
 * Usa debounce para evitar serializacao repetida em acoes rapidas.
 * Ignora chamadas durante/apos restore (undo/redo) usando generation counter.
 */
export function pushSnapshot() {
    if (_isPaused || !_buildModel) return;
    if (_snapshotTimer) clearTimeout(_snapshotTimer);
    _snapshotTimer = setTimeout(_captureSnapshot, SNAPSHOT_DELAY);
}

/**
 * Force immediate snapshot capture (flush pending debounce).
 * Garante que o estado atual seja capturado antes de undo/redo.
 */
export function flushSnapshot() {
    if (_snapshotTimer) {
        clearTimeout(_snapshotTimer);
        _snapshotTimer = null;
    }
    _captureSnapshot();
}

/** Internal: serializa e armazena snapshot no undoStack. */
function _captureSnapshot() {
    _snapshotTimer = null;
    if (_isPaused || !_buildModel) return;

    const snapshot = _buildModel();
    delete snapshot.view; // Camera position nao faz parte do undo

    undoStack.push(JSON.stringify(snapshot));

    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }

    // Nova acao invalida historico de redo
    redoStack = [];
}

/**
 * Undo: restore previous state.
 * @returns {boolean} true if undo was performed
 */
export function undo() {
    // Captura estado pendente antes de desfazer
    flushSnapshot();
    if (undoStack.length < 2) return false;

    const current = undoStack.pop();
    redoStack.push(current);

    const previous = undoStack[undoStack.length - 1];
    restoreSnapshot(previous);
    return true;
}

/**
 * Redo: restore next state.
 * @returns {boolean} true if redo was performed
 */
export function redo() {
    // Captura estado pendente antes de refazer
    flushSnapshot();
    if (redoStack.length === 0) return false;

    const next = redoStack.pop();
    undoStack.push(next);
    restoreSnapshot(next);
    return true;
}

/**
 * Internal: restore from snapshot string.
 * IMPORTANTE: updateAllUI() usa requestAnimationFrame internamente, e cada
 * update pode disparar outro updateAllUI(). Cada rAF inclui pushSnapshot(),
 * que limparia o redoStack se executado. Usamos _restoreGeneration para
 * garantir que todos os pushSnapshot() disparados por esta restore sejam
 * ignorados, independente de quantos rAF cycles levem.
 */
function restoreSnapshot(snapshotStr) {
    _isPaused = true;
    _restoreGeneration++;
    const gen = _restoreGeneration;
    try {
        const snapshot = JSON.parse(snapshotStr);
        _applyModel(snapshot);
        if (_updateAllUI) _updateAllUI();
    } finally {
        // Unpause apos cadeia de rAFs completar (~200ms cobre ate 12 frames a 60fps)
        setTimeout(() => {
            if (_restoreGeneration === gen) _isPaused = false;
        }, 200);
    }
}

/** @returns {boolean} */
export function canUndo() {
    return undoStack.length >= 2;
}

/** @returns {boolean} */
export function canRedo() {
    return redoStack.length > 0;
}

/**
 * Push a named barrier snapshot (BS5).
 * Marca um ponto de restauracao nomeado no undoStack.
 * Util para operacoes compostas (merge, import) onde o usuario quer
 * "desfazer ate o ponto antes do import X" com um unico undo.
 *
 * @param {string} label — nome legivel (ex: 'Before merge: pocossiagas.xlsx')
 */
export function pushSnapshotBarrier(label) {
    if (!_buildModel) return;
    // Flush qualquer snapshot pendente antes de criar barreira
    flushSnapshot();
    const snapshot = _buildModel();
    delete snapshot.view;
    const entry = JSON.stringify(snapshot);
    // Marca como barreira adicionando metadata ao stack
    undoStack.push(entry);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    // Armazena label no indice para UI de undo
    if (!_barriers) _barriers = new Map();
    _barriers.set(undoStack.length - 1, label);
}

/** @returns {string|null} Barrier label for the last undo target, if any */
export function getUndoBarrierLabel() {
    if (!_barriers || undoStack.length < 2) return null;
    return _barriers.get(undoStack.length - 2) || null;
}

let _barriers = null;

/** Clear all history stacks. */
export function clearHistory() {
    undoStack = [];
    redoStack = [];
    _barriers = null;
}
