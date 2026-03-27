# ADR 9: Neural Network Engine

**Project**: ECBT -- Environmental & Occupational Core Byte Tools
**Title**: Feedforward Neural Network with He Initialization, SGD Training, and What-If Inference
**Author**: Calvin Stefan Iost
**Date**: 2026
**Atualizado:** 2026-03-26
**Status**: Accepted

## Context

Environmental digital twins require predictive capability to simulate contaminant
plume evolution based on monitoring well observations. The system needs a neural
network engine that runs entirely in the browser without server-side inference,
supports variable-depth architectures, and integrates with the 3D plume geometry
for real-time What-If scenario simulation.

## Decision

### 1. N-Layer Feedforward Architecture (network.js)

The `SimpleNN` class implements a configurable feedforward neural network with
arbitrary depth. Topology is defined as `[inputSize, ...hiddenLayerSizes, outputSize]`
with safety limits: max 5 hidden layers, 512 neurons per layer, 500k total parameters.
This prevents memory exhaustion in browser environments (~4 MB cap in Float32).

### 2. He Weight Initialization

Weights are initialized using He normal distribution (`scale = sqrt(2/fanIn)`)
via Box-Muller transform for Gaussian sampling. He initialization is chosen over
Xavier because all hidden layers use ReLU activation, where He initialization
preserves gradient variance through deep networks and prevents dead neurons.

### 3. Dual-Mode Output Activation

- **Classification**: Numerically stable softmax (subtract max logit before
  exponentiation) producing probability distributions over output classes.
- **Regression**: Independent sigmoid per output, mapping each to [0, 1] for
  min-max denormalization back to physical units.

### 4. SGD Mini-Batch Training with Linear LR Decay (network.js)

Training uses stochastic gradient descent with Fisher-Yates shuffling per epoch,
configurable mini-batch size (default 32), and linear learning rate decay
(`lr * (1 - epoch/epochs * 0.7)`). N-layer backpropagation computes gradients
layer by layer with ReLU gradient gating (zero gradient for inactive neurons).
Cross-entropy loss for classification; MSE loss for regression.

### 5. Min-Max Normalization Pipeline (normalization.js)

Physical values are scaled to [0, 1] using configurable min/max bounds per variable.
The variable catalog (variableCatalog.js) provides default bounds from
`PARAMETER_RANGES` for environmental parameters, geometric defaults for plume
pseudo-variables (radiusX/Y/Z, centerX/Y/Z), and auto-computed bounds for
calculator-derived variables by evaluating all model elements.

### 6. What-If Inference Engine (whatIfEngine.js)

The inference pipeline follows: slider physical values -> normalize -> forward pass
-> denormalize -> physical outputs. Training data is collected in two modes:

- **Same-element**: inputs and outputs from the same element's observations per campaign.
- **Cross-element**: well observations (inputs) linked to plume geometry snapshots
  (outputs) via `shapeTimeline`, enabling prediction of plume shape from well chemistry.

### 7. Web Worker Offloading (workerBridge.js, inferenceWorker.js)

Inference is offloaded to a dedicated Web Worker via lazy initialization to keep the
main thread responsive during real-time slider interaction. The worker is a standalone
module (no imports) that performs the full N-layer forward pass. A fallback main-thread
path activates if Worker creation fails. Promise-based communication with 5-second
timeout and pending request tracking ensures reliability.

### 8. Real-Time Plume Visualization (plumeConnector.js)

Neural network predictions are applied directly to the 3D plume mesh via a
remove-and-re-add rebuild pattern. Rate limiting at 10 fps (100 ms minimum interval)
using `requestAnimationFrame` gating prevents excessive mesh reconstruction.
Prediction confidence is visualized through outer shell opacity modulation:
inner shells maintain full opacity while outer shells scale by confidence factor.

### 9. Network Manager Registry (manager.js)

A centralized registry (`Map<string, {nn, metadata}>`) manages named network instances
with CRUD operations. Networks are persisted to localStorage and exported/imported
with the ECO model format. Serialization supports three format versions (v1.0 legacy,
v2.0 single hidden, v3.0 N-layer) for backward compatibility.

## Consequences

- Full client-side ML eliminates server dependency and data privacy concerns.
- Variable-depth architecture supports both simple classifiers and deeper regression models.
- The Worker bridge prevents UI jank during continuous inference from slider interaction.
- Cross-element training enables the key use case: predicting plume geometry from well data.
