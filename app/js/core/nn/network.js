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
   SIMPLE NEURAL NETWORK — Generic N-layer feedforward network
   ================================================================

   Rede neural feedforward generica de N camadas, parametrizavel
   para qualquer combinacao de inputs/hidden layers/outputs. Pode
   ser usada por qualquer modulo do sistema para classificacao
   supervisionada ou regressao.

   Arquitetura: N inputs → H1 hidden → H2 hidden → ... → M outputs
   Ativacao: ReLU nas hidden layers, softmax/sigmoid na saida
   Treinamento: SGD com mini-batch, cross-entropy/MSE loss, LR decay
   Persistencia: toJSON()/fromJSON() para serializar pesos (v3.0)

   ================================================================ */

// ----------------------------------------------------------------
// CONSTANTS — Topology limits
// Limites para proteger memoria do navegador (~4MB max em Float32)
// ----------------------------------------------------------------

const MAX_HIDDEN_LAYERS = 5;
const MAX_NEURONS_PER_LAYER = 512;
const MAX_PARAMETERS = 500000;

// ----------------------------------------------------------------
// WEIGHT INITIALIZATION — He normal distribution
// Inicializacao He para convergencia rapida com ReLU
// ----------------------------------------------------------------

/**
 * Initialize weight matrix with He initialization.
 * @param {number} rows
 * @param {number} cols
 * @param {number} scale - He scale factor sqrt(2/fanIn)
 * @returns {Float32Array[]} Array of Float32Array rows
 */
function _initWeights(rows, cols, scale) {
    const mat = [];
    for (let i = 0; i < rows; i++) {
        const row = new Float32Array(cols);
        for (let j = 0; j < cols; j++) {
            // Box-Muller for normal distribution
            const u1 = Math.random() || 1e-10;
            const u2 = Math.random();
            row[j] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale;
        }
        mat.push(row);
    }
    return mat;
}

// ----------------------------------------------------------------
// SimpleNN CLASS — Configurable N-layer feedforward neural network
// Classe principal: aceita qualquer profundidade e dimensao
// ----------------------------------------------------------------

/**
 * Generic N-layer feedforward neural network.
 * Rede neural generica parametrizavel para classificacao/regressao.
 *
 * @example
 * // Single hidden layer (backward-compatible)
 * const nn = new SimpleNN({ inputSize: 6, hiddenSize: 16, outputSize: 7 });
 *
 * @example
 * // Multiple hidden layers
 * const nn = new SimpleNN({ inputSize: 6, hiddenLayerSizes: [32, 16, 8], outputSize: 3 });
 */
export class SimpleNN {
    /**
     * @param {Object} config
     * @param {number} config.inputSize - Number of input features
     * @param {number} [config.hiddenSize] - Number of hidden neurons (single layer, backward compat)
     * @param {number[]} [config.hiddenLayerSizes] - Neurons per hidden layer (overrides hiddenSize)
     * @param {number} config.outputSize - Number of output classes/values
     * @param {string[]} [config.classNames] - Optional names for output classes
     * @param {string} [config.mode='classification'] - 'classification' (softmax) or 'regression' (sigmoid)
     */
    constructor({ inputSize, hiddenSize, hiddenLayerSizes, outputSize, classNames = null, mode = 'classification' }) {
        this.inputSize = inputSize;
        this.outputSize = outputSize;
        this.classNames = classNames || null;
        this.mode = mode; // 'classification' or 'regression'

        // Resolve hidden topology: hiddenLayerSizes array takes priority
        // Se hiddenLayerSizes nao fornecido, usa hiddenSize (backward compat)
        if (Array.isArray(hiddenLayerSizes) && hiddenLayerSizes.length > 0) {
            this.hiddenLayerSizes = hiddenLayerSizes.slice();
        } else {
            this.hiddenLayerSizes = [hiddenSize || 16];
        }

        // Validate and clamp topology
        // Garante limites seguros de memoria
        this._validateTopology();

        // Backward-compat: hiddenSize = first hidden layer size
        this.hiddenSize = this.hiddenLayerSizes[0];

        // Full topology array: [input, h1, h2, ..., hN, output]
        this.layerSizes = [inputSize, ...this.hiddenLayerSizes, outputSize];

        // Weight arrays (initialized on reset)
        // _weights[l]: matrix layerSizes[l+1] × layerSizes[l]
        // _biases[l]: vector layerSizes[l+1]
        this._weights = null;
        this._biases = null;
        this._trained = false;

        this.reset();
    }

    // ----------------------------------------------------------------
    // BACKWARD-COMPAT GETTERS — _W1, _b1, _W2, _b2
    // Codigo externo (networkDiagram, workerBridge) usa estes nomes
    // ----------------------------------------------------------------

    /** @returns {Float32Array[]|null} First layer weights (input→hidden1) */
    get _W1() {
        return this._weights?.[0] ?? null;
    }
    /** @returns {Float32Array|null} First layer bias */
    get _b1() {
        return this._biases?.[0] ?? null;
    }
    /** @returns {Float32Array[]|null} Last layer weights (hiddenN→output) */
    get _W2() {
        return this._weights?.[this._weights.length - 1] ?? null;
    }
    /** @returns {Float32Array|null} Last layer bias */
    get _b2() {
        return this._biases?.[this._biases.length - 1] ?? null;
    }

    /**
     * Check if network has been trained.
     * @returns {boolean}
     */
    get trained() {
        return this._trained;
    }

    /**
     * Total parameter count (weights + biases).
     * @returns {number}
     */
    get totalParams() {
        let total = 0;
        for (let l = 0; l < this.layerSizes.length - 1; l++) {
            total += this.layerSizes[l] * this.layerSizes[l + 1] + this.layerSizes[l + 1];
        }
        return total;
    }

    // ----------------------------------------------------------------
    // TOPOLOGY VALIDATION
    // Clampa valores e avisa se exceder limite de parametros
    // ----------------------------------------------------------------

    _validateTopology() {
        if (this.hiddenLayerSizes.length > MAX_HIDDEN_LAYERS) {
            console.warn(
                `SimpleNN: clamping hidden layers from ${this.hiddenLayerSizes.length} to ${MAX_HIDDEN_LAYERS}`,
            );
            this.hiddenLayerSizes = this.hiddenLayerSizes.slice(0, MAX_HIDDEN_LAYERS);
        }
        for (let i = 0; i < this.hiddenLayerSizes.length; i++) {
            this.hiddenLayerSizes[i] = Math.min(
                Math.max(1, Math.round(this.hiddenLayerSizes[i]) || 16),
                MAX_NEURONS_PER_LAYER,
            );
        }
    }

    /**
     * Reset/initialize weights with He initialization.
     * Reinicializa pesos — necessario antes de novo treino.
     */
    reset() {
        const L = this.layerSizes.length;
        this._weights = [];
        this._biases = [];

        for (let l = 0; l < L - 1; l++) {
            const fanIn = this.layerSizes[l];
            const fanOut = this.layerSizes[l + 1];
            const scale = Math.sqrt(2 / fanIn); // He initialization (better for ReLU)
            this._weights.push(_initWeights(fanOut, fanIn, scale));
            this._biases.push(new Float32Array(fanOut));
        }
        this._trained = false;
    }

    /**
     * Forward pass through the network.
     * Passagem direta: input → H1 (ReLU) → H2 (ReLU) → ... → output.
     * Modo classification: softmax (soma=1, distribuicao de probabilidades)
     * Modo regression: sigmoid individual (cada saida [0,1] independente)
     *
     * @param {Float32Array} input - Input feature vector
     * @returns {{ activations: Float32Array[], output: Float32Array, hidden: Float32Array }}
     */
    forward(input) {
        const L = this.layerSizes.length;
        const activations = [input]; // activations[0] = input

        // Propagate through all layers
        // Propaga sinal camada por camada
        for (let l = 0; l < L - 1; l++) {
            const prevAct = activations[l];
            const W = this._weights[l];
            const b = this._biases[l];
            const size = this.layerSizes[l + 1];
            const prevSize = this.layerSizes[l];
            const act = new Float32Array(size);

            for (let i = 0; i < size; i++) {
                let sum = b[i];
                for (let j = 0; j < prevSize; j++) {
                    sum += W[i][j] * prevAct[j];
                }
                // ReLU for hidden layers, raw logits for output layer
                if (l < L - 2) {
                    act[i] = sum > 0 ? sum : 0; // ReLU
                } else {
                    act[i] = sum; // Output logits
                }
            }
            activations.push(act);
        }

        // Apply output activation
        // Aplica ativacao final: softmax ou sigmoid
        const logits = activations[L - 1];
        const output = new Float32Array(this.outputSize);

        if (this.mode === 'regression') {
            // Regression: sigmoid individual por saida (cada uma [0,1] independente)
            for (let i = 0; i < this.outputSize; i++) {
                output[i] = 1 / (1 + Math.exp(-logits[i]));
            }
        } else {
            // Classification: stable softmax (subtract max for numerical stability)
            let maxLogit = -Infinity;
            for (let i = 0; i < this.outputSize; i++) {
                if (logits[i] > maxLogit) maxLogit = logits[i];
            }
            let sumExp = 0;
            for (let i = 0; i < this.outputSize; i++) {
                output[i] = Math.exp(logits[i] - maxLogit);
                sumExp += output[i];
            }
            for (let i = 0; i < this.outputSize; i++) {
                output[i] /= sumExp;
            }
        }

        // Return activations + output, with backward-compat 'hidden' getter
        const result = { activations, output };
        Object.defineProperty(result, 'hidden', {
            get: () => activations[1],
            enumerable: true,
        });
        return result;
    }

    /**
     * Predict class for a single input vector.
     * Retorna indice da classe, confianca, probabilidades e nome.
     *
     * @param {Float32Array} input - Input feature vector
     * @returns {{ classIndex: number, confidence: number, probabilities: Float32Array, className: string|null }}
     */
    predict(input) {
        const { output } = this.forward(input);
        let maxIdx = 0,
            maxVal = output[0];
        for (let i = 1; i < this.outputSize; i++) {
            if (output[i] > maxVal) {
                maxVal = output[i];
                maxIdx = i;
            }
        }
        return {
            classIndex: maxIdx,
            confidence: maxVal,
            probabilities: output,
            className: this.classNames ? this.classNames[maxIdx] : null,
        };
    }

    /**
     * Train the neural network on labeled data.
     * SGD com mini-batch, learning rate decay, N-layer backpropagation.
     * Classification: cross-entropy loss, target = class index (number)
     * Regression: MSE loss, target = Float32Array of output values [0,1]
     *
     * @param {Array<{input: Float32Array, target: number|Float32Array}>} data
     * @param {Object} [options]
     * @param {number} [options.epochs=80] - Number of training epochs
     * @param {number} [options.lr=0.02] - Initial learning rate
     * @param {number} [options.batchSize=32] - Mini-batch size
     * @param {Function} [options.onProgress] - Callback: { epoch, loss, accuracy, total }
     * @returns {{ finalLoss: number, accuracy: number }}
     */
    train(data, options = {}) {
        const epochs = options.epochs || 80;
        const lr = options.lr || 0.02;
        const batchSize = options.batchSize || 32;
        const onProgress = options.onProgress || null;
        const isRegression = this.mode === 'regression';
        const L = this.layerSizes.length; // total layers incl input

        if (data.length < 5) return { finalLoss: 999, accuracy: 0 };

        let currentLr = lr;
        let finalLoss = 0;
        let accuracy = 0;

        for (let epoch = 0; epoch < epochs; epoch++) {
            // Learning rate decay
            currentLr = lr * (1 - (epoch / epochs) * 0.7);

            // Shuffle training data
            const shuffled = [...data];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            let totalLoss = 0;
            let correct = 0;

            // Mini-batch SGD
            for (let bStart = 0; bStart < shuffled.length; bStart += batchSize) {
                const batch = shuffled.slice(bStart, bStart + batchSize);

                for (const sample of batch) {
                    // Forward pass — retorna todas as ativacoes para backprop
                    const { activations, output } = this.forward(sample.input);

                    // Compute output error
                    const dOutput = new Float32Array(this.outputSize);

                    if (isRegression) {
                        // MSE loss + sigmoid derivative backprop
                        let sampleLoss = 0;
                        for (let i = 0; i < this.outputSize; i++) {
                            const t = sample.target[i];
                            const diff = output[i] - t;
                            sampleLoss += diff * diff;
                            // dL/dLogits = (output - target) * sigmoid'(logit) = diff * output * (1 - output)
                            dOutput[i] = diff * output[i] * (1 - output[i]);
                        }
                        totalLoss += sampleLoss / this.outputSize;

                        // "Accuracy" for regression: fraction of outputs within 10% tolerance
                        let closeCount = 0;
                        for (let i = 0; i < this.outputSize; i++) {
                            if (Math.abs(output[i] - sample.target[i]) < 0.1) closeCount++;
                        }
                        if (closeCount === this.outputSize) correct++;
                    } else {
                        // Cross-entropy loss (classification)
                        totalLoss -= Math.log(Math.max(1e-7, output[sample.target]));

                        // Check accuracy
                        let maxIdx = 0;
                        for (let i = 1; i < this.outputSize; i++) {
                            if (output[i] > output[maxIdx]) maxIdx = i;
                        }
                        if (maxIdx === sample.target) correct++;

                        // dL/dLogits = output - oneHot(target)
                        for (let i = 0; i < this.outputSize; i++) {
                            dOutput[i] = output[i] - (i === sample.target ? 1 : 0);
                        }
                    }

                    // ---- N-LAYER BACKPROPAGATION ----
                    // Propaga gradiente da saida ate a entrada, camada por camada
                    let dCurrent = dOutput;

                    for (let l = L - 2; l >= 0; l--) {
                        const prevAct = activations[l];
                        const currentSize = this.layerSizes[l + 1];
                        const prevSize = this.layerSizes[l];

                        // Apply ReLU derivative for hidden layers (not output)
                        if (l < L - 2) {
                            const hiddenAct = activations[l + 1];
                            for (let i = 0; i < currentSize; i++) {
                                if (hiddenAct[i] <= 0) dCurrent[i] = 0; // ReLU gradient gate
                            }
                        }

                        // Compute gradient for previous layer (skip for input layer)
                        let dPrev = null;
                        if (l > 0) {
                            dPrev = new Float32Array(prevSize);
                            for (let i = 0; i < currentSize; i++) {
                                if (dCurrent[i] === 0) continue; // Skip zero gradients
                                for (let j = 0; j < prevSize; j++) {
                                    dPrev[j] += this._weights[l][i][j] * dCurrent[i];
                                }
                            }
                        }

                        // Update weights and biases for this layer
                        for (let i = 0; i < currentSize; i++) {
                            if (dCurrent[i] === 0) continue; // Skip zero gradients
                            const grad = currentLr * dCurrent[i];
                            for (let j = 0; j < prevSize; j++) {
                                this._weights[l][i][j] -= grad * prevAct[j];
                            }
                            this._biases[l][i] -= grad;
                        }

                        dCurrent = dPrev;
                    }
                }
            }

            finalLoss = totalLoss / data.length;
            accuracy = correct / data.length;

            if (onProgress && (epoch % 5 === 0 || epoch === epochs - 1)) {
                onProgress({ epoch, loss: finalLoss, accuracy, total: epochs });
            }
        }

        this._trained = true;
        return { finalLoss, accuracy };
    }

    // ----------------------------------------------------------------
    // SERIALIZATION — JSON export/import of network state
    // Serializa/restaura pesos para persistencia no modelo
    // ----------------------------------------------------------------

    /**
     * Serialize network state to a plain JSON object.
     * Formato v3.0 com topologia variavel e array de pesos.
     *
     * @returns {Object} Serializable network state
     */
    toJSON() {
        return {
            version: '3.0',
            inputSize: this.inputSize,
            hiddenLayerSizes: this.hiddenLayerSizes,
            hiddenSize: this.hiddenLayerSizes[0], // backward compat
            outputSize: this.outputSize,
            classNames: this.classNames,
            mode: this.mode,
            trained: this._trained,
            weights: this._trained
                ? {
                      layers: this._weights.map((W) => W.map((row) => Array.from(row))),
                      biases: this._biases.map((b) => Array.from(b)),
                  }
                : null,
        };
    }

    /**
     * Restore network state from a JSON object.
     * Suporta formato v1.0 (legado), v2.0 (single hidden) e v3.0 (N hidden).
     *
     * @param {Object} data - Serialized network state
     * @returns {SimpleNN} this (for chaining)
     */
    fromJSON(data) {
        if (!data) return this;

        // v1.0 format (legacy from userClassifier.js)
        if (data.version === '1.0') {
            if (data.weights && data.trained) {
                this._weights = [
                    data.weights.W1.map((row) => new Float32Array(row)),
                    data.weights.W2.map((row) => new Float32Array(row)),
                ];
                this._biases = [new Float32Array(data.weights.b1), new Float32Array(data.weights.b2)];
                this._trained = true;
            }
            return this;
        }

        // v3.0 format (N hidden layers)
        if (data.version === '3.0') {
            if (data.weights && data.trained) {
                // Validate topology matches
                const dataSizes = [
                    data.inputSize,
                    ...(data.hiddenLayerSizes || [data.hiddenSize || 16]),
                    data.outputSize,
                ];
                if (JSON.stringify(dataSizes) !== JSON.stringify(this.layerSizes)) {
                    console.warn('SimpleNN.fromJSON: v3.0 topology mismatch, resetting');
                    this.reset();
                    return this;
                }
                this._weights = data.weights.layers.map((W) => W.map((row) => new Float32Array(row)));
                this._biases = data.weights.biases.map((b) => new Float32Array(b));
                this._trained = true;
            }
            if (data.classNames) this.classNames = data.classNames;
            if (data.mode) this.mode = data.mode;
            return this;
        }

        // v2.0 format (single hidden layer, W1/b1/W2/b2)
        if (data.weights && data.trained) {
            // Validate dimensions match for single hidden layer
            if (
                data.inputSize !== this.inputSize ||
                data.hiddenSize !== this.hiddenLayerSizes[0] ||
                data.outputSize !== this.outputSize
            ) {
                console.warn('SimpleNN.fromJSON: v2.0 dimension mismatch, resetting weights');
                this.reset();
                return this;
            }
            this._weights = [
                data.weights.W1.map((row) => new Float32Array(row)),
                data.weights.W2.map((row) => new Float32Array(row)),
            ];
            this._biases = [new Float32Array(data.weights.b1), new Float32Array(data.weights.b2)];
            this._trained = true;
        }

        if (data.classNames) {
            this.classNames = data.classNames;
        }

        // Restore mode (default 'classification' for backward compat)
        if (data.mode) {
            this.mode = data.mode;
        }

        return this;
    }
}
