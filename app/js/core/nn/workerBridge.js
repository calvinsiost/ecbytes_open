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
   WORKER BRIDGE — Communication layer for inference Web Worker
   Ponte de comunicacao com o Web Worker de inferencia

   Lazy-loads o Worker na primeira requisicao. Fallback para
   inferencia na main thread se Worker nao estiver disponivel.

   Suporta formato v3.0 (layers/biases) e v2.0 (W1/b1/W2/b2).
   ================================================================ */

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let _worker = null;
let _messageId = 0;
const _pending = new Map();
let _workerFailed = false;

// ----------------------------------------------------------------
// INITIALIZATION — Lazy Worker creation
// ----------------------------------------------------------------

/**
 * Initialize the inference Web Worker.
 * Lazy-loaded: criado apenas na primeira inferencia.
 *
 * @returns {boolean} true if Worker is available
 */
export function initInferenceWorker() {
    if (_worker) return true;
    if (_workerFailed) return false;

    try {
        _worker = new Worker(new URL('./inferenceWorker.js', import.meta.url), { type: 'module' });

        _worker.onmessage = (e) => {
            const { id, output, confidence } = e.data;
            const resolver = _pending.get(id);
            if (resolver) {
                resolver.resolve({ output: new Float32Array(output), confidence });
                _pending.delete(id);
            }
        };

        _worker.onerror = (err) => {
            console.warn('Inference Worker error:', err.message);
            _workerFailed = true;
            _worker = null;
            // Reject all pending
            for (const [, resolver] of _pending) {
                resolver.reject(err);
            }
            _pending.clear();
        };

        return true;
    } catch (err) {
        console.warn('Inference Worker not supported:', err.message);
        _workerFailed = true;
        return false;
    }
}

// ----------------------------------------------------------------
// ASYNC INFERENCE — Promise-based Worker communication
// ----------------------------------------------------------------

/**
 * Run inference in Web Worker (or fallback to main thread).
 * Aceita formato v3.0 { layers, biases } ou v2.0 { W1, b1, W2, b2 }.
 *
 * @param {Object} weights - { layers, biases } or { W1, b1, W2, b2 }
 * @param {Float32Array} input - Normalized input vector
 * @param {string} mode - 'classification' or 'regression'
 * @returns {Promise<{ output: Float32Array, confidence: number }>}
 */
export function runInferenceAsync(weights, input, mode) {
    // Normalize to v3.0 format for Worker communication
    const layers = weights.layers || [weights.W1, weights.W2];
    const biases = weights.biases || [weights.b1, weights.b2];

    // Try Worker first
    if (initInferenceWorker() && _worker) {
        return new Promise((resolve, reject) => {
            const id = _messageId++;
            _pending.set(id, { resolve, reject });

            _worker.postMessage({
                id,
                layers,
                biases,
                input: Array.from(input),
                mode,
            });

            // Timeout: 5 seconds
            setTimeout(() => {
                if (_pending.has(id)) {
                    _pending.delete(id);
                    reject(new Error('Inference timeout'));
                }
            }, 5000);
        });
    }

    // Fallback: main-thread inference
    return _mainThreadInference(layers, biases, input, mode);
}

// ----------------------------------------------------------------
// FALLBACK — Main-thread N-layer forward pass
// Forward pass generico na main thread (mesmo algoritmo do Worker)
// ----------------------------------------------------------------

function _mainThreadInference(layers, biases, input, mode) {
    const numLayers = layers.length;
    let activation = input;

    for (let l = 0; l < numLayers; l++) {
        const W = layers[l];
        const b = biases[l];
        const size = W.length;
        const prevSize = W[0].length;
        const next = new Float32Array(size);

        for (let i = 0; i < size; i++) {
            let sum = b[i];
            for (let j = 0; j < prevSize; j++) {
                sum += W[i][j] * activation[j];
            }
            if (l < numLayers - 1) {
                next[i] = sum > 0 ? sum : 0; // ReLU
            } else {
                next[i] = sum; // Output logits
            }
        }
        activation = next;
    }

    const outputSize = activation.length;
    const output = new Float32Array(outputSize);

    if (mode === 'regression') {
        for (let i = 0; i < outputSize; i++) {
            output[i] = 1 / (1 + Math.exp(-activation[i]));
        }
    } else {
        let maxLogit = -Infinity;
        for (let i = 0; i < outputSize; i++) {
            if (activation[i] > maxLogit) maxLogit = activation[i];
        }
        let sumExp = 0;
        for (let i = 0; i < outputSize; i++) {
            output[i] = Math.exp(activation[i] - maxLogit);
            sumExp += output[i];
        }
        for (let i = 0; i < outputSize; i++) {
            output[i] /= sumExp;
        }
    }

    let confidence = 0;
    for (let i = 0; i < outputSize; i++) {
        confidence += Math.abs(output[i] - 0.5) * 2;
    }
    confidence = outputSize > 0 ? confidence / outputSize : 0;

    return Promise.resolve({ output, confidence });
}

/**
 * Terminate the Worker (cleanup).
 */
export function terminateWorker() {
    if (_worker) {
        _worker.terminate();
        _worker = null;
    }
    _pending.clear();
}
