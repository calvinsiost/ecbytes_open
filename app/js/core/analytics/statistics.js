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
   STATISTICS — Pure mathematical functions for trend analysis
   ================================================================

   Biblioteca de metodos estatisticos para analise ambiental.
   Todas as funcoes sao deterministicas (sem LLM).

   METODOS:
   - Regressao Linear (OLS) com R²
   - Teste de Mann-Kendall (tendencia monotonica nao-parametrica)
   - Estimador de Inclinacao de Sen (mediana robusta)
   - Analise de ordem de grandeza

   ================================================================ */

// ================================================================
// LINEAR REGRESSION — Ordinary Least Squares
// Regressao linear pelo metodo dos minimos quadrados
// ================================================================

/**
 * Compute linear regression (OLS) with R².
 * Calcula regressao linear com coeficiente de determinacao.
 *
 * @param {number[]} x - Independent variable (timestamps or indices)
 * @param {number[]} y - Dependent variable (observed values)
 * @returns {Object} { slope, intercept, r2, n }
 */
export function linearRegression(x, y) {
    const n = x.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0, n };

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((a, xi, i) => a + xi * y[i], 0);
    const sumXX = x.reduce((a, xi) => a + xi * xi, 0);

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) {
        return { slope: 0, intercept: sumY / n, r2: 0, n };
    }

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // R² calculation
    const meanY = sumY / n;
    const ssTotal = y.reduce((a, yi) => a + (yi - meanY) ** 2, 0);
    const ssResidual = y.reduce((a, yi, i) => {
        const predicted = slope * x[i] + intercept;
        return a + (yi - predicted) ** 2;
    }, 0);

    const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

    return { slope, intercept, r2, n };
}

/**
 * Calculate R² for observed vs predicted.
 * Calcula coeficiente de determinacao.
 *
 * @param {number[]} observed
 * @param {number[]} predicted
 * @returns {number} R² value (0-1)
 */
export function calculateR2(observed, predicted) {
    const n = observed.length;
    if (n < 2) return 0;

    const mean = observed.reduce((a, b) => a + b, 0) / n;
    const ssTotal = observed.reduce((a, y) => a + (y - mean) ** 2, 0);
    const ssResidual = observed.reduce((a, y, i) => a + (y - predicted[i]) ** 2, 0);

    return ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
}

// ================================================================
// MANN-KENDALL TREND TEST — Non-parametric monotonic trend
// Teste nao-parametrico para tendencia monotonica
// ================================================================

/**
 * Mann-Kendall trend test.
 * Teste de tendencia de Mann-Kendall com correcao para empates.
 *
 * Hipotese nula: nao ha tendencia monotonica na serie temporal.
 * Se |Z| > 1.96, rejeita H0 com 95% de confianca.
 *
 * @param {number[]} values - Time series values (in chronological order)
 * @returns {Object} { S, variance, Z, pValue, tau, trend, significant }
 */
export function mannKendall(values) {
    const n = values.length;
    if (n < 4) {
        return { S: 0, variance: 0, Z: 0, pValue: 1, tau: 0, trend: 'insufficient_data', significant: false };
    }

    // Calculate S statistic
    let S = 0;
    for (let k = 0; k < n - 1; k++) {
        for (let j = k + 1; j < n; j++) {
            const diff = values[j] - values[k];
            if (diff > 0) S++;
            else if (diff < 0) S--;
        }
    }

    // Count ties
    const tieGroups = countTieGroups(values);

    // Variance with tie correction
    // Var(S) = [n(n-1)(2n+5) - Σ tp(tp-1)(2tp+5)] / 18
    let variance = n * (n - 1) * (2 * n + 5);
    for (const tp of tieGroups) {
        variance -= tp * (tp - 1) * (2 * tp + 5);
    }
    variance /= 18;

    // Z statistic (continuity correction)
    let Z = 0;
    if (variance > 0) {
        if (S > 0) Z = (S - 1) / Math.sqrt(variance);
        else if (S < 0) Z = (S + 1) / Math.sqrt(variance);
    }

    // Kendall's tau
    const nPairs = (n * (n - 1)) / 2;
    const tau = nPairs > 0 ? S / nPairs : 0;

    // p-value (two-tailed, normal approximation)
    const pValue = 2 * (1 - normalCDF(Math.abs(Z)));

    // Trend determination
    let trend = 'stable';
    const significant = pValue < 0.05;
    if (significant) {
        trend = S > 0 ? 'increasing' : 'decreasing';
    }

    return { S, variance, Z, pValue, tau, trend, significant };
}

/**
 * Count tie groups in a series.
 * Conta grupos de empates numa serie.
 *
 * @param {number[]} values
 * @returns {number[]} Array of tie group sizes (only groups > 1)
 */
function countTieGroups(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const groups = [];
    let i = 0;

    while (i < sorted.length) {
        let count = 1;
        while (i + count < sorted.length && sorted[i + count] === sorted[i]) {
            count++;
        }
        if (count > 1) groups.push(count);
        i += count;
    }

    return groups;
}

/**
 * Standard normal CDF approximation.
 * Funcao de distribuicao acumulada normal padrao.
 * Abramowitz & Stegun approximation (max error 7.5e-8).
 *
 * @param {number} x
 * @returns {number}
 */
export function normalCDF(x) {
    if (x < -8) return 0;
    if (x > 8) return 1;

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
}

// ================================================================
// SEN'S SLOPE ESTIMATOR — Robust median slope
// Estimador de inclinacao de Sen (mediana robusta)
// ================================================================

/**
 * Sen's slope estimator.
 * Estimador de inclinacao robusto baseado na mediana.
 * Mais resistente a outliers que OLS.
 *
 * @param {number[]} x - Independent variable (timestamps or indices)
 * @param {number[]} y - Dependent variable (observed values)
 * @returns {Object} { slope, intercept, lowerCI, upperCI }
 */
export function sensSlope(x, y) {
    const n = x.length;
    if (n < 2) return { slope: 0, intercept: 0, lowerCI: 0, upperCI: 0 };

    // Calculate all pairwise slopes
    const slopes = [];
    for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
            if (x[j] !== x[i]) {
                slopes.push((y[j] - y[i]) / (x[j] - x[i]));
            }
        }
    }

    if (slopes.length === 0) {
        return { slope: 0, intercept: median(y), lowerCI: 0, upperCI: 0 };
    }

    slopes.sort((a, b) => a - b);
    const slope = median(slopes);

    // Intercept: median of (y_i - slope * x_i)
    const intercepts = y.map((yi, i) => yi - slope * x[i]);
    const intercept = median(intercepts);

    // 95% confidence interval for slope
    // Using normal approximation
    const N = slopes.length;
    const Zalpha = 1.96; // 95% CI
    const Calpha = Zalpha * Math.sqrt((n * (n - 1) * (2 * n + 5)) / 18);
    const lowerIdx = Math.max(0, Math.floor((N - Calpha) / 2));
    const upperIdx = Math.min(N - 1, Math.ceil((N + Calpha) / 2));

    return {
        slope,
        intercept,
        lowerCI: slopes[lowerIdx] || slope,
        upperCI: slopes[upperIdx] || slope,
    };
}

/**
 * Calculate median of an array.
 * @param {number[]} arr
 * @returns {number}
 */
function median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ================================================================
// ORDER OF MAGNITUDE — Anomaly detection
// Deteccao de anomalias por ordem de grandeza
// ================================================================

/**
 * Check if a value deviates by more than 1 order of magnitude.
 * Verifica se um valor difere mais de 1 ordem de grandeza do esperado.
 *
 * @param {number} value - Observed value
 * @param {Object} expectedRange - { min, max } expected range
 * @returns {Object} { magnitude, deviation, isAnomaly, direction }
 */
export function orderOfMagnitude(value, expectedRange) {
    if (!expectedRange || value === 0) {
        return { magnitude: 0, deviation: 0, isAnomaly: false, direction: 'normal' };
    }

    const absValue = Math.abs(value);
    const refValue = (expectedRange.min + expectedRange.max) / 2 || 1;
    const absRef = Math.abs(refValue);

    if (absRef === 0) {
        return { magnitude: 0, deviation: 0, isAnomaly: false, direction: 'normal' };
    }

    const ratio = absValue / absRef;
    const magnitude = Math.log10(ratio);

    const isAnomaly = Math.abs(magnitude) > 1; // >10x or <0.1x
    let direction = 'normal';
    if (isAnomaly) {
        direction = magnitude > 0 ? 'high' : 'low';
    }

    return { magnitude, deviation: ratio, isAnomaly, direction };
}

// ================================================================
// DESCRIPTIVE STATISTICS — Basic measures
// Estatisticas descritivas basicas
// ================================================================

/**
 * Calculate comprehensive descriptive statistics.
 * Calcula estatisticas descritivas completas.
 *
 * @param {number[]} values
 * @returns {Object}
 */
export function descriptiveStats(values) {
    const n = values.length;
    if (n === 0) return { n: 0, mean: 0, std: 0, min: 0, max: 0, median: 0, q1: 0, q3: 0 };

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / n;

    return {
        n,
        mean,
        std: Math.sqrt(variance),
        min: sorted[0],
        max: sorted[n - 1],
        median: median(sorted),
        q1: sorted[Math.floor(n * 0.25)] || sorted[0],
        q3: sorted[Math.floor(n * 0.75)] || sorted[n - 1],
    };
}

// ================================================================
// INVERSE NORMAL CDF — Quantile function (probit)
// Funcao quantil da distribuicao normal padrao
// ================================================================

/**
 * Inverse normal CDF (quantile / probit function).
 * Rational approximation by Peter Acklam (max error 1.15e-9).
 * Retorna z tal que P(Z <= z) = p para Z ~ N(0,1).
 *
 * @param {number} p - Probability (0 < p < 1)
 * @returns {number} z-quantile
 */
export function inverseNormalCDF(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p === 0.5) return 0;

    // Coefficients for rational approximation
    const a = [
        -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
        2.506628277459239,
    ];
    const b = [
        -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
    ];
    const c = [
        -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
        2.938163982698783,
    ];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q, r;

    if (p < pLow) {
        // Rational approximation for lower region
        q = Math.sqrt(-2 * Math.log(p));
        return (
            (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
        );
    } else if (p <= pHigh) {
        // Rational approximation for central region
        q = p - 0.5;
        r = q * q;
        return (
            ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
        );
    } else {
        // Rational approximation for upper region
        q = Math.sqrt(-2 * Math.log(1 - p));
        return (
            -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
        );
    }
}

// ================================================================
// STUDENT'S T-DISTRIBUTION CDF — Hill (1970) approximation
// CDF da distribuicao t de Student
// ================================================================

/**
 * Student's t-distribution CDF.
 * Hill (1970) approximation — compacta e precisa para df >= 1.
 * Retorna P(T <= t) para T com df graus de liberdade.
 *
 * @param {number} t - Test statistic
 * @param {number} df - Degrees of freedom (>= 1)
 * @returns {number} Probability P(T <= t)
 */
export function tCDF(t, df) {
    if (df < 1) return NaN;
    if (!isFinite(t)) return t > 0 ? 1 : 0;
    if (df >= 200) return normalCDF(t); // convergem para normal com df grande

    const x = df / (df + t * t);
    const p = 0.5 * incompleteBeta(x, df / 2, 0.5);
    return t >= 0 ? 1 - p : p;
}

/**
 * Regularized incomplete beta function I_x(a, b).
 * Continued fraction expansion (Lentz's method).
 * Usada internamente por tCDF.
 *
 * @param {number} x - Upper limit (0 <= x <= 1)
 * @param {number} a - Shape parameter a > 0
 * @param {number} b - Shape parameter b > 0
 * @returns {number}
 */
function incompleteBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    // Use symmetry relation when x > (a+1)/(a+b+2)
    if (x > (a + 1) / (a + b + 2)) {
        return 1 - incompleteBeta(1 - x, b, a);
    }

    const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

    // Lentz's continued fraction
    let f = 1,
        c = 1,
        d = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    f = d;

    for (let m = 1; m <= 200; m++) {
        // Even step
        let numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
        d = 1 + numerator * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + numerator / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d;
        f *= c * d;

        // Odd step
        numerator = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
        d = 1 + numerator * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + numerator / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d;
        const delta = c * d;
        f *= delta;

        if (Math.abs(delta - 1) < 1e-10) break;
    }

    return front * f;
}

/**
 * Log-gamma function (Lanczos approximation).
 * Usada internamente por incompleteBeta.
 *
 * @param {number} z
 * @returns {number}
 */
function lnGamma(z) {
    if (z <= 0) return Infinity;
    const g = 7;
    const coefs = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    let x = coefs[0];
    for (let i = 1; i < g + 2; i++) {
        x += coefs[i] / (z + i - 1);
    }
    const t = z + g - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z - 0.5) * Math.log(t) - t + Math.log(x);
}

// ================================================================
// BINOMIAL CDF — Exact for small n
// CDF binomial exata para amostras pequenas
// ================================================================

/**
 * Binomial CDF: P(X <= k) for X ~ Bin(n, p).
 * Somatoria direta — eficiente para n < 100 (comum em monitoramento).
 *
 * @param {number} k - Number of successes
 * @param {number} n - Number of trials
 * @param {number} p - Probability of success
 * @returns {number}
 */
export function binomialCDF(k, n, p) {
    if (k < 0) return 0;
    if (k >= n) return 1;
    if (p <= 0) return 1;
    if (p >= 1) return k >= n ? 1 : 0;

    let cdf = 0;
    let term = Math.pow(1 - p, n); // P(X=0)
    cdf += term;

    for (let i = 1; i <= k; i++) {
        term *= (p / (1 - p)) * ((n - i + 1) / i);
        cdf += term;
    }

    return Math.min(1, Math.max(0, cdf));
}

// ================================================================
// WILCOXON SIGNED-RANKS TEST — Paired non-parametric
// Teste nao-parametrico pareado para comparacao de campanhas
// ================================================================

/**
 * Wilcoxon critical values table (two-tailed).
 * Tabela de valores criticos — se T <= critical, rejeita H0.
 * Indexada por [n_eff][alpha]. Para n_eff = 5..30.
 * Fonte: EPA Unified Guidance / Wilcoxon-Signed-Ranks-Table.
 */
const WILCOXON_CRITICAL = {
    // n: { alpha_0.10, alpha_0.05, alpha_0.02, alpha_0.01 }
    5: { 0.1: 1, 0.05: 1, 0.02: 0, 0.01: 0 },
    6: { 0.1: 2, 0.05: 1, 0.02: 0, 0.01: 0 },
    7: { 0.1: 4, 0.05: 2, 0.02: 0, 0.01: 0 },
    8: { 0.1: 6, 0.05: 4, 0.02: 2, 0.01: 0 },
    9: { 0.1: 8, 0.05: 6, 0.02: 3, 0.01: 2 },
    10: { 0.1: 11, 0.05: 8, 0.02: 5, 0.01: 3 },
    11: { 0.1: 14, 0.05: 11, 0.02: 7, 0.01: 5 },
    12: { 0.1: 17, 0.05: 14, 0.02: 10, 0.01: 7 },
    13: { 0.1: 21, 0.05: 17, 0.02: 13, 0.01: 10 },
    14: { 0.1: 26, 0.05: 21, 0.02: 16, 0.01: 13 },
    15: { 0.1: 30, 0.05: 25, 0.02: 20, 0.01: 16 },
    16: { 0.1: 36, 0.05: 30, 0.02: 24, 0.01: 19 },
    17: { 0.1: 41, 0.05: 35, 0.02: 28, 0.01: 23 },
    18: { 0.1: 47, 0.05: 40, 0.02: 33, 0.01: 28 },
    19: { 0.1: 54, 0.05: 46, 0.02: 38, 0.01: 32 },
    20: { 0.1: 60, 0.05: 52, 0.02: 43, 0.01: 37 },
    21: { 0.1: 68, 0.05: 59, 0.02: 49, 0.01: 43 },
    22: { 0.1: 75, 0.05: 66, 0.02: 56, 0.01: 49 },
    23: { 0.1: 83, 0.05: 73, 0.02: 62, 0.01: 55 },
    24: { 0.1: 92, 0.05: 81, 0.02: 69, 0.01: 61 },
    25: { 0.1: 101, 0.05: 90, 0.02: 77, 0.01: 68 },
    26: { 0.1: 110, 0.05: 98, 0.02: 85, 0.01: 76 },
    27: { 0.1: 120, 0.05: 107, 0.02: 93, 0.01: 84 },
    28: { 0.1: 130, 0.05: 117, 0.02: 102, 0.01: 92 },
    29: { 0.1: 141, 0.05: 127, 0.02: 111, 0.01: 100 },
    30: { 0.1: 152, 0.05: 137, 0.02: 120, 0.01: 109 },
};

/**
 * Wilcoxon Signed-Ranks test for paired samples.
 * Teste pareado nao-parametrico — compara duas campanhas (ex: antes/depois de remediacao).
 *
 * H0: A distribuicao das diferencas e simetrica em torno de zero.
 * H1: Houve mudanca significativa entre as campanhas.
 *
 * @param {Array<{x: number, y: number}>} pairs - Pares (campanha A, campanha B) por elemento
 * @param {number} [alpha=0.05] - Nivel de significancia (two-tailed)
 * @returns {{ T: number, W_plus: number, W_minus: number, n_eff: number,
 *             critical: number|null, zStat: number|null, pValue: number|null,
 *             reject: boolean, conclusion: string }}
 */
export function wilcoxonSignedRanks(pairs, alpha = 0.05) {
    if (!pairs || pairs.length < 2) {
        return {
            T: 0,
            W_plus: 0,
            W_minus: 0,
            n_eff: 0,
            critical: null,
            zStat: null,
            pValue: null,
            reject: false,
            conclusion: 'insufficient_data',
        };
    }

    // 1. Calcular diferencas, remover zeros
    const diffs = [];
    for (const { x, y } of pairs) {
        const d = y - x;
        if (Math.abs(d) > 1e-15) diffs.push(d);
    }
    const n_eff = diffs.length;

    if (n_eff < 5) {
        return {
            T: 0,
            W_plus: 0,
            W_minus: 0,
            n_eff,
            critical: null,
            zStat: null,
            pValue: null,
            reject: false,
            conclusion: 'insufficient_data',
        };
    }

    // 2. Ranquear |d_i|, resolver empates pela media
    const absDiffs = diffs.map((d, i) => ({ idx: i, abs: Math.abs(d), sign: Math.sign(d) }));
    absDiffs.sort((a, b) => a.abs - b.abs);

    // Assign ranks with tied average
    const ranks = new Array(n_eff);
    let i = 0;
    while (i < n_eff) {
        let j = i;
        while (j < n_eff && absDiffs[j].abs === absDiffs[i].abs) j++;
        const avgRank = (i + 1 + j) / 2; // ranks sao 1-based
        for (let k = i; k < j; k++) {
            ranks[absDiffs[k].idx] = avgRank;
        }
        i = j;
    }

    // 3. Somar ranks positivos e negativos
    let W_plus = 0,
        W_minus = 0;
    for (let idx = 0; idx < n_eff; idx++) {
        if (diffs[idx] > 0) W_plus += ranks[idx];
        else W_minus += ranks[idx];
    }
    const T = Math.min(W_plus, W_minus);

    // 4. Determinar rejeicao
    let critical = null,
        zStat = null,
        pValue = null,
        reject = false;

    if (n_eff <= 30 && WILCOXON_CRITICAL[n_eff]) {
        // Usar tabela de valores criticos
        const alphaKey = alpha <= 0.01 ? 0.01 : alpha <= 0.02 ? 0.02 : alpha <= 0.05 ? 0.05 : 0.1;
        critical = WILCOXON_CRITICAL[n_eff][alphaKey];
        reject = critical != null && T <= critical;
    }

    if (n_eff >= 10) {
        // Aproximacao normal (tambem calculada para n<=30 como complemento)
        const mean = (n_eff * (n_eff + 1)) / 4;
        const variance = (n_eff * (n_eff + 1) * (2 * n_eff + 1)) / 24;
        zStat = (T - mean) / Math.sqrt(variance);
        pValue = 2 * normalCDF(zStat); // two-tailed (T e sempre <= mean)
        if (n_eff > 30) {
            // Sem tabela — usar z
            const zCritical = inverseNormalCDF(alpha / 2);
            reject = zStat <= zCritical;
            critical = Math.round(mean + zCritical * Math.sqrt(variance));
        }
    }

    const conclusion = reject ? 'significant_change' : 'no_significant_change';
    return { T, W_plus, W_minus, n_eff, critical, zStat, pValue, reject, conclusion };
}

// ================================================================
// PAIRED T-TEST — Parametric paired comparison
// Teste t pareado parametrico
// ================================================================

/**
 * Paired t-test for two related samples.
 * Teste parametrico pareado — assume diferencas normalmente distribuidas.
 *
 * H0: Media das diferencas = 0.
 * H1: Media das diferencas != 0 (two-tailed).
 *
 * @param {Array<{x: number, y: number}>} pairs - Pares por elemento
 * @param {number} [alpha=0.05] - Nivel de significancia
 * @returns {{ tStat: number, df: number, pValue: number, reject: boolean,
 *             meanDiff: number, stdDiff: number, n: number, conclusion: string }}
 */
export function pairedTTest(pairs, alpha = 0.05) {
    if (!pairs || pairs.length < 2) {
        return {
            tStat: 0,
            df: 0,
            pValue: 1,
            reject: false,
            meanDiff: 0,
            stdDiff: 0,
            n: 0,
            conclusion: 'insufficient_data',
        };
    }

    const diffs = pairs.map(({ x, y }) => y - x);
    const n = diffs.length;
    const df = n - 1;

    const sum = diffs.reduce((a, b) => a + b, 0);
    const meanDiff = sum / n;
    const variance = diffs.reduce((a, d) => a + (d - meanDiff) ** 2, 0) / df; // sample variance
    const stdDiff = Math.sqrt(variance);

    if (stdDiff < 1e-15) {
        // Todas as diferencas iguais
        const reject = Math.abs(meanDiff) > 1e-15;
        return {
            tStat: reject ? Infinity : 0,
            df,
            pValue: reject ? 0 : 1,
            reject,
            meanDiff,
            stdDiff,
            n,
            conclusion: reject ? 'significant_change' : 'no_significant_change',
        };
    }

    const tStat = meanDiff / (stdDiff / Math.sqrt(n));
    const pValue = 2 * (1 - tCDF(Math.abs(tStat), df)); // two-tailed

    const reject = pValue < alpha;
    const conclusion = reject ? 'significant_change' : 'no_significant_change';

    return { tStat, df, pValue, reject, meanDiff, stdDiff, n, conclusion };
}

// ================================================================
// SIGN TEST — Simplest non-parametric paired test
// Teste de sinais — o mais simples dos testes pareados
// ================================================================

/**
 * Sign test for paired samples.
 * Conta sinais positivos/negativos das diferencas.
 *
 * H0: P(d > 0) = P(d < 0) = 0.5 (sem tendencia direcional).
 * H1: Tendencia significativa para aumento ou diminuicao.
 *
 * @param {Array<{x: number, y: number}>} pairs - Pares por elemento
 * @param {number} [alpha=0.05] - Nivel de significancia
 * @returns {{ nPlus: number, nMinus: number, nZero: number, nEff: number,
 *             stat: number, pValue: number, reject: boolean, conclusion: string }}
 */
export function signTest(pairs, alpha = 0.05) {
    if (!pairs || pairs.length < 2) {
        return {
            nPlus: 0,
            nMinus: 0,
            nZero: 0,
            nEff: 0,
            stat: 0,
            pValue: 1,
            reject: false,
            conclusion: 'insufficient_data',
        };
    }

    let nPlus = 0,
        nMinus = 0,
        nZero = 0;
    for (const { x, y } of pairs) {
        const d = y - x;
        if (d > 1e-15) nPlus++;
        else if (d < -1e-15) nMinus++;
        else nZero++;
    }

    const nEff = nPlus + nMinus;
    if (nEff < 1) {
        return { nPlus, nMinus, nZero, nEff, stat: 0, pValue: 1, reject: false, conclusion: 'insufficient_data' };
    }

    const stat = Math.min(nPlus, nMinus);

    // p-value: exact binomial for small n, normal approximation for large n
    let pValue;
    if (nEff <= 50) {
        // Exact: P(X <= stat) under Bin(nEff, 0.5), two-tailed
        pValue = 2 * binomialCDF(stat, nEff, 0.5);
        pValue = Math.min(1, pValue);
    } else {
        // Normal approximation with continuity correction
        const z = (stat - nEff / 2 + 0.5) / Math.sqrt(nEff / 4);
        pValue = 2 * normalCDF(z);
    }

    const reject = pValue < alpha;
    const conclusion = reject ? 'significant_change' : 'no_significant_change';

    return { nPlus, nMinus, nZero, nEff, stat, pValue, reject, conclusion };
}

// ================================================================
// BACKGROUND COMPARISON — EPA Unified Guidance approach
// Comparacao de background vs compliance points
// ================================================================

/**
 * Background comparison test (nonparametric).
 * Baseado no EPA Unified Guidance — compara dados de compliance
 * contra dados de referencia (background/montante).
 *
 * Metodo: conta exceedances dos pontos de compliance acima do
 * limite superior do background (percentil). Usa distribuicao
 * binomial/normal para testar se o numero de exceedances e
 * significativamente maior que o esperado.
 *
 * H0: Dados de compliance sao consistentes com background.
 * H1: Evidencia de contaminacao (compliance > background).
 *
 * @param {number[]} compliance - Valores nos pontos de compliance (jusante)
 * @param {number[]} background - Valores nos pontos de background (montante)
 * @param {number} [alpha=0.05] - Nivel de significancia
 * @returns {{ n_c: number, n_b: number, exceedances: number,
 *             threshold: number, expected: number, zStat: number,
 *             pValue: number, reject: boolean, conclusion: string }}
 */
export function backgroundComparison(compliance, background, alpha = 0.05) {
    if (!compliance || !background || compliance.length < 1 || background.length < 4) {
        return {
            n_c: compliance?.length || 0,
            n_b: background?.length || 0,
            exceedances: 0,
            threshold: 0,
            expected: 0,
            zStat: 0,
            pValue: 1,
            reject: false,
            conclusion: 'insufficient_data',
        };
    }

    const n_c = compliance.length;
    const n_b = background.length;

    // Calcular limite superior do background: percentil 95 (nao-parametrico)
    const sortedBg = [...background].sort((a, b) => a - b);
    const p95idx = Math.ceil(0.95 * n_b) - 1;
    const threshold = sortedBg[Math.min(p95idx, n_b - 1)];

    // Contar exceedances: quantos compliance ultrapassam o threshold
    const exceedances = compliance.filter((v) => v > threshold).length;

    // Sob H0: probabilidade de exceder o P95 do background e ~0.05
    const p0 = 0.05;
    const expected = n_c * p0;

    // Teste exato (binomial) ou normal approximation
    let pValue;
    if (n_c <= 50) {
        // Exact: P(X >= exceedances) = 1 - P(X <= exceedances-1)
        pValue = 1 - binomialCDF(exceedances - 1, n_c, p0);
    } else {
        // Normal approximation
        const mean = n_c * p0;
        const std = Math.sqrt(n_c * p0 * (1 - p0));
        const zStat = (exceedances - mean - 0.5) / std; // continuity correction
        pValue = 1 - normalCDF(zStat); // one-tailed (excedencia e unidirecional)
    }

    const variance = n_c * p0 * (1 - p0);
    const zStat = variance > 0 ? (exceedances - expected) / Math.sqrt(variance) : 0;

    const reject = pValue < alpha;
    const conclusion = reject ? 'evidence_contamination' : 'consistent_background';

    return { n_c, n_b, exceedances, threshold, expected, zStat, pValue, reject, conclusion };
}

// ================================================================
// D2 EXPANSÃO ESTATÍSTICA — Temporal KPI Analysis
// Adicionado em 2026-03-09 — ciclo D2
// Requer jStat (carregado via loadScriptCDN quando necessário)
// ================================================================

/** @returns {Object} jStat global — lança se não carregado */
function getJStat() {
    if (typeof window !== 'undefined' && window.jStat) return window.jStat;
    throw new Error('jStat não carregado. Use loadScriptCDN antes de chamar funções D2.');
}

// ================================================================
// NORMALIDADE — Shapiro-Wilk e Kolmogorov-Smirnov
// ================================================================

/**
 * Shapiro-Wilk normality test — valid for n = 3..50
 * Teste de normalidade de Shapiro-Wilk (1965) com aproximação de Royston (1992)
 * @param {number[]} values
 * @param {number} [alpha=0.05]
 * @returns {{ W: number, pValue: number, normal: boolean, n: number, method: string }}
 */
export function shapiroWilk(values, alpha = 0.05) {
    const x = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const n = x.length;
    if (n < 3 || n > 50) {
        return { W: NaN, pValue: NaN, normal: null, n, method: 'shapiro-wilk', error: `n=${n} fora do intervalo 3–50` };
    }

    const A_TABLE = {
        3: [0.7071],
        4: [0.6872, 0.1677],
        5: [0.6646, 0.2413],
        6: [0.6431, 0.2806, 0.0875],
        7: [0.6233, 0.3031, 0.1401],
        8: [0.6052, 0.3164, 0.1743, 0.0561],
        9: [0.5888, 0.3244, 0.1976, 0.0947],
        10: [0.5739, 0.3291, 0.2141, 0.1224, 0.0399],
        11: [0.5601, 0.3315, 0.226, 0.1429, 0.0695],
        12: [0.5475, 0.3325, 0.2347, 0.1586, 0.0922, 0.0303],
        13: [0.5359, 0.3325, 0.2412, 0.1707, 0.1099, 0.0539],
        14: [0.5251, 0.3318, 0.246, 0.1802, 0.124, 0.0727, 0.024],
        15: [0.515, 0.3306, 0.2495, 0.1878, 0.1353, 0.088, 0.0433],
        16: [0.5056, 0.329, 0.2521, 0.1939, 0.1447, 0.1013, 0.061, 0.0202],
        17: [0.4968, 0.3273, 0.254, 0.1988, 0.1524, 0.1128, 0.0764, 0.0381],
        18: [0.4886, 0.3253, 0.2553, 0.2027, 0.1587, 0.1231, 0.0899, 0.053, 0.0177],
        19: [0.4808, 0.3232, 0.2561, 0.2059, 0.1641, 0.1323, 0.102, 0.0663, 0.0333],
        20: [0.4734, 0.3211, 0.2565, 0.2085, 0.1686, 0.1404, 0.1128, 0.0782, 0.048, 0.0163],
        21: [0.4643, 0.3185, 0.2578, 0.2119, 0.1736, 0.1475, 0.1228, 0.0909, 0.0638, 0.0326],
        22: [0.459, 0.3156, 0.2571, 0.2131, 0.1764, 0.1499, 0.1285, 0.1009, 0.076, 0.0497, 0.0163],
        23: [0.4542, 0.3126, 0.2563, 0.2139, 0.1787, 0.1526, 0.133, 0.1099, 0.0879, 0.0619, 0.0321],
        24: [0.4493, 0.3098, 0.2554, 0.2145, 0.1807, 0.1547, 0.1365, 0.1168, 0.098, 0.071, 0.0464, 0.015],
        25: [0.445, 0.3069, 0.2543, 0.2148, 0.1822, 0.1568, 0.1395, 0.1228, 0.1066, 0.0804, 0.0563, 0.0307],
        26: [0.4407, 0.3043, 0.2533, 0.2151, 0.1836, 0.1586, 0.142, 0.1279, 0.1141, 0.0887, 0.0653, 0.0435, 0.0145],
        27: [0.4366, 0.3018, 0.2522, 0.2152, 0.1848, 0.1603, 0.144, 0.1321, 0.1201, 0.096, 0.0737, 0.0522, 0.0299],
        28: [
            0.4328, 0.2992, 0.251, 0.2151, 0.1857, 0.1618, 0.146, 0.1353, 0.1252, 0.1024, 0.0812, 0.0608, 0.0368,
            0.0122,
        ],
        29: [
            0.4291, 0.2968, 0.2499, 0.215, 0.1864, 0.163, 0.1477, 0.138, 0.1295, 0.108, 0.0878, 0.0684, 0.0424, 0.0228,
        ],
        30: [
            0.4254, 0.2944, 0.2487, 0.2148, 0.187, 0.1641, 0.1492, 0.1405, 0.1331, 0.1128, 0.0934, 0.0751, 0.0502,
            0.0263, 0.0088,
        ],
        31: [
            0.422, 0.2921, 0.2475, 0.2145, 0.1874, 0.1651, 0.1505, 0.1427, 0.1361, 0.117, 0.0985, 0.0808, 0.0563,
            0.0324, 0.014,
        ],
        32: [
            0.4188, 0.2898, 0.2463, 0.2141, 0.1878, 0.1659, 0.1517, 0.1447, 0.1388, 0.1207, 0.1031, 0.0862, 0.0618,
            0.0386, 0.0185,
        ],
        33: [
            0.4156, 0.2876, 0.2451, 0.2137, 0.188, 0.1667, 0.1527, 0.1465, 0.1413, 0.1239, 0.1073, 0.0912, 0.0668,
            0.0444, 0.0228, 0.0076,
        ],
        34: [
            0.4127, 0.2854, 0.2439, 0.2132, 0.1882, 0.1673, 0.1537, 0.1481, 0.1436, 0.1269, 0.111, 0.0958, 0.0714,
            0.0497, 0.0284, 0.0094,
        ],
        35: [
            0.4096, 0.2834, 0.2427, 0.2127, 0.1883, 0.1678, 0.1546, 0.1496, 0.1456, 0.1296, 0.1145, 0.1, 0.0757, 0.0548,
            0.0336, 0.016,
        ],
        36: [
            0.4068, 0.2813, 0.2415, 0.2121, 0.1883, 0.1683, 0.1554, 0.151, 0.1475, 0.1321, 0.1177, 0.1039, 0.0797,
            0.0595, 0.0388, 0.021, 0.0071,
        ],
        37: [
            0.404, 0.2794, 0.2403, 0.2116, 0.1883, 0.1687, 0.1561, 0.1523, 0.1492, 0.1344, 0.1206, 0.1075, 0.0834,
            0.0639, 0.0435, 0.0254, 0.014,
        ],
        38: [
            0.4015, 0.2774, 0.2391, 0.211, 0.1881, 0.169, 0.1567, 0.1535, 0.1509, 0.1365, 0.1232, 0.1109, 0.0869,
            0.0681, 0.0479, 0.0298, 0.0178, 0.0061,
        ],
        39: [
            0.3989, 0.2755, 0.238, 0.2104, 0.188, 0.1693, 0.1573, 0.1547, 0.1524, 0.1385, 0.1257, 0.114, 0.0901, 0.072,
            0.0521, 0.034, 0.0209, 0.0119,
        ],
        40: [
            0.3964, 0.2737, 0.2368, 0.2098, 0.1878, 0.1695, 0.1578, 0.1557, 0.1539, 0.1403, 0.128, 0.1169, 0.0932,
            0.0757, 0.056, 0.0381, 0.0242, 0.0139, 0.0048,
        ],
        41: [
            0.394, 0.2719, 0.2357, 0.2091, 0.1876, 0.1697, 0.1583, 0.1567, 0.1553, 0.142, 0.1302, 0.1197, 0.0961,
            0.0792, 0.0598, 0.0419, 0.0274, 0.0162, 0.0082,
        ],
        42: [
            0.3917, 0.2701, 0.2345, 0.2085, 0.1874, 0.1699, 0.1587, 0.1577, 0.1566, 0.1436, 0.1323, 0.1222, 0.0988,
            0.0826, 0.0634, 0.0456, 0.0304, 0.0185, 0.0118, 0.004,
        ],
        43: [
            0.3894, 0.2684, 0.2334, 0.2078, 0.1871, 0.17, 0.1591, 0.1586, 0.1579, 0.1451, 0.1342, 0.1245, 0.1014,
            0.0857, 0.0668, 0.0491, 0.0332, 0.0209, 0.014, 0.0062,
        ],
        44: [
            0.3872, 0.2667, 0.2323, 0.2072, 0.1868, 0.1701, 0.1595, 0.1594, 0.159, 0.1465, 0.136, 0.1267, 0.1039,
            0.0888, 0.07, 0.0524, 0.036, 0.0232, 0.0163, 0.0075,
        ],
        45: [
            0.385, 0.2651, 0.2313, 0.2065, 0.1865, 0.1702, 0.1598, 0.1602, 0.1601, 0.1478, 0.1377, 0.1289, 0.1063,
            0.0916, 0.0731, 0.0557, 0.0388, 0.0255, 0.0186, 0.0107, 0.0036,
        ],
        46: [
            0.383, 0.2635, 0.2302, 0.2058, 0.1862, 0.1702, 0.1601, 0.1609, 0.1612, 0.149, 0.1393, 0.1309, 0.1085,
            0.0944, 0.0761, 0.0589, 0.0415, 0.0278, 0.0208, 0.0123, 0.0042,
        ],
        47: [
            0.3808, 0.262, 0.2291, 0.2052, 0.1859, 0.1702, 0.1604, 0.1616, 0.1622, 0.1501, 0.1409, 0.1328, 0.1107,
            0.0971, 0.079, 0.062, 0.0441, 0.03, 0.023, 0.0138, 0.0067,
        ],
        48: [
            0.3789, 0.2604, 0.2281, 0.2045, 0.1855, 0.1702, 0.1606, 0.1623, 0.1631, 0.1512, 0.1424, 0.1346, 0.1128,
            0.0997, 0.0818, 0.0649, 0.0466, 0.0322, 0.0251, 0.0153, 0.0091,
        ],
        49: [
            0.377, 0.2589, 0.2271, 0.2038, 0.1851, 0.1701, 0.1609, 0.1629, 0.164, 0.1523, 0.1438, 0.1364, 0.1148,
            0.1022, 0.0844, 0.0678, 0.049, 0.0344, 0.0271, 0.017, 0.0105, 0.0035,
        ],
        50: [
            0.3751, 0.2574, 0.226, 0.2032, 0.1847, 0.17, 0.161, 0.1635, 0.1649, 0.1533, 0.1451, 0.138, 0.1167, 0.1047,
            0.087, 0.0706, 0.0513, 0.0365, 0.0291, 0.0186, 0.0118, 0.004,
        ],
    };

    const a = A_TABLE[n];
    if (!a)
        return {
            W: NaN,
            pValue: NaN,
            normal: null,
            n,
            method: 'shapiro-wilk',
            error: `Coeficientes não disponíveis para n=${n}`,
        };

    const mean = x.reduce((s, v) => s + v, 0) / n;
    const ss = x.reduce((s, v) => s + (v - mean) ** 2, 0);
    if (ss === 0) return { W: 1, pValue: 1, normal: true, n, method: 'shapiro-wilk' };

    let numerator = 0;
    const k = Math.floor(n / 2);
    for (let i = 0; i < k; i++) {
        numerator += a[i] * (x[n - 1 - i] - x[i]);
    }

    const W = numerator ** 2 / ss;
    const Wc = Math.max(0.0001, Math.min(0.9999, W));

    // Valores críticos tabelados W para alpha=0.05 (Shapiro & Wilk 1965, Table 2)
    const W_CRIT_05 = {
        3: 0.767,
        4: 0.748,
        5: 0.762,
        6: 0.788,
        7: 0.803,
        8: 0.818,
        9: 0.829,
        10: 0.842,
        11: 0.85,
        12: 0.859,
        13: 0.866,
        14: 0.874,
        15: 0.881,
        16: 0.887,
        17: 0.892,
        18: 0.897,
        19: 0.901,
        20: 0.905,
        25: 0.918,
        30: 0.927,
        35: 0.934,
        40: 0.94,
        45: 0.945,
        50: 0.947,
    };
    const ns2 = Object.keys(W_CRIT_05)
        .map(Number)
        .sort((a, b) => a - b);
    const nc = ns2.reduce((p, c) => (Math.abs(c - n) < Math.abs(p - n) ? c : p));
    const Wcrit = W_CRIT_05[nc];
    const normal = Wc >= Wcrit;

    // p-value aproximado via Royston (1992) — mais confiável para n > 11
    // Para n ≤ 11: estimativa baseada na distância normalizada ao valor crítico
    let pValue;
    try {
        const jStat = getJStat();
        if (n <= 11) {
            const z = (Wc - Wcrit) / (0.02 + 0.003 * n);
            pValue = Math.max(0.001, Math.min(0.999, jStat.normal.cdf(z, 0, 1)));
        } else {
            const y = Math.log(1 - Wc);
            const mu = -1.2725 + 1.0521 * Math.log(n);
            const sigma = Math.exp(-0.6714 + 0.8861 * Math.log(n));
            const z = (y - mu) / sigma;
            pValue = 1 - jStat.normal.cdf(z, 0, 1);
        }
    } catch {
        pValue = normal ? 0.5 : 0.01;
    }

    return { W: +W.toFixed(6), pValue: +pValue.toFixed(6), normal, n, method: 'shapiro-wilk' };
}

/**
 * Kolmogorov-Smirnov test against normal distribution — n > 50
 * Teste KS para normalidade (recomendado para n > 50)
 * @param {number[]} values
 * @param {number} [alpha=0.05]
 * @returns {{ D: number, pValue: number, normal: boolean, n: number, method: string }}
 */
export function kolmogorovSmirnov(values, alpha = 0.05) {
    const x = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const n = x.length;
    if (n < 3) return { D: NaN, pValue: NaN, normal: null, n, method: 'ks', error: 'n < 3' };

    const mean = x.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    if (std === 0) return { D: 0, pValue: 1, normal: true, n, method: 'ks' };

    let D = 0;
    try {
        const jStat = getJStat();
        for (let i = 0; i < n; i++) {
            const F = jStat.normal.cdf(x[i], mean, std);
            const d1 = Math.abs(F - (i + 1) / n);
            const d2 = Math.abs(F - i / n);
            D = Math.max(D, d1, d2);
        }
    } catch {
        for (let i = 0; i < n; i++) {
            const z = (x[i] - mean) / std;
            const F = normalCDF(z);
            D = Math.max(D, Math.abs(F - (i + 1) / n), Math.abs(F - i / n));
        }
    }

    const Dcrit = 0.886 / Math.sqrt(n);
    const pValue = Math.min(1, 2 * Math.exp(-2 * n * D * D));

    return {
        D: +D.toFixed(6),
        pValue: +pValue.toFixed(6),
        normal: pValue > alpha,
        n,
        method: 'ks',
        Dcrit: +Dcrit.toFixed(4),
    };
}

// ================================================================
// HOMOGENEIDADE DE VARIÂNCIAS — Levene
// ================================================================

/**
 * Levene's test for equality of variances across groups
 * Teste de Levene — pré-condição para ANOVA quando normalidade é assumida
 * @param {number[][]} groups
 * @param {number} [alpha=0.05]
 * @returns {{ W: number, pValue: number, homogeneous: boolean, dfBetween: number, dfWithin: number }}
 */
export function leveneTest(groups, alpha = 0.05) {
    const k = groups.length;
    const N = groups.reduce((s, g) => s + g.length, 0);

    const Z = groups.map((g) => {
        const sorted = [...g].sort((a, b) => a - b);
        const m =
            sorted.length % 2 === 0
                ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                : sorted[Math.floor(sorted.length / 2)];
        return g.map((v) => Math.abs(v - m));
    });

    const groupMeans = Z.map((z) => z.reduce((s, v) => s + v, 0) / z.length);
    const grandMean = Z.flat().reduce((s, v) => s + v, 0) / N;

    const SSB = Z.reduce((s, z, i) => s + z.length * (groupMeans[i] - grandMean) ** 2, 0);
    const SSW = Z.reduce((s, z, i) => s + z.reduce((ss, v) => ss + (v - groupMeans[i]) ** 2, 0), 0);

    const dfB = k - 1;
    const dfW = N - k;
    const W = SSB / dfB / (SSW / dfW);

    let pValue = 0.5;
    try {
        const jStat = getJStat();
        pValue = 1 - jStat.centralF.cdf(W, dfB, dfW);
    } catch {
        /* sem jStat */
    }

    return { W: +W.toFixed(4), pValue: +pValue.toFixed(6), homogeneous: pValue > alpha, dfBetween: dfB, dfWithin: dfW };
}

// ================================================================
// COMPARAÇÃO DE GRUPOS — ANOVA e Kruskal-Wallis
// ================================================================

/**
 * One-way ANOVA — parametric, requires normality + homogeneity
 * ANOVA de um fator — comparação de médias entre grupos
 * @param {number[][]} groups
 * @param {number} [alpha=0.05]
 * @returns {{ F: number, dfBetween: number, dfWithin: number, pValue: number, reject: boolean, means: number[], grandMean: number }}
 */
export function anovaOneWay(groups, alpha = 0.05) {
    const k = groups.length;
    const N = groups.reduce((s, g) => s + g.length, 0);
    const means = groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
    const grandMean = groups.flat().reduce((s, v) => s + v, 0) / N;

    const SSB = groups.reduce((s, g, i) => s + g.length * (means[i] - grandMean) ** 2, 0);
    const SSW = groups.reduce((s, g, i) => s + g.reduce((ss, v) => ss + (v - means[i]) ** 2, 0), 0);

    const dfB = k - 1;
    const dfW = N - k;
    const F = SSB / dfB / (SSW / dfW);

    let pValue = 0.5;
    try {
        const jStat = getJStat();
        pValue = 1 - jStat.centralF.cdf(F, dfB, dfW);
    } catch {
        /* sem jStat */
    }

    return {
        F: +F.toFixed(4),
        dfBetween: dfB,
        dfWithin: dfW,
        pValue: +pValue.toFixed(6),
        reject: pValue < alpha,
        means: means.map((m) => +m.toFixed(4)),
        grandMean: +grandMean.toFixed(4),
    };
}

/**
 * Kruskal-Wallis test — non-parametric alternative to ANOVA
 * Kruskal-Wallis — alternativa não-paramétrica à ANOVA de um fator
 * @param {number[][]} groups
 * @param {number} [alpha=0.05]
 * @returns {{ H: number, df: number, pValue: number, reject: boolean }}
 */
export function kruskalWallis(groups, alpha = 0.05) {
    const all = groups.flatMap((g, i) => g.map((v) => ({ v, g: i })));
    const N = all.length;
    all.sort((a, b) => a.v - b.v);

    let i = 0;
    while (i < N) {
        let j = i;
        while (j < N - 1 && all[j + 1].v === all[j].v) j++;
        const rank = (i + j) / 2 + 1;
        for (let kk = i; kk <= j; kk++) all[kk].rank = rank;
        i = j + 1;
    }

    let tieCorr = 0;
    let ti = 0;
    while (ti < N) {
        let tj = ti;
        while (tj < N - 1 && all[tj + 1].v === all[tj].v) tj++;
        const t = tj - ti + 1;
        if (t > 1) tieCorr += t ** 3 - t;
        ti = tj + 1;
    }

    const rankSums = groups.map((_, gi) => all.filter((a) => a.g === gi).reduce((s, a) => s + a.rank, 0));
    const ns = groups.map((g) => g.length);

    let H = (12 / (N * (N + 1))) * rankSums.reduce((s, R, i) => s + R ** 2 / ns[i], 0) - 3 * (N + 1);

    const C = 1 - tieCorr / (N ** 3 - N);
    if (C > 0) H /= C;

    const df = groups.length - 1;
    let pValue = 0.5;
    try {
        const jStat = getJStat();
        pValue = 1 - jStat.chisquare.cdf(H, df);
    } catch {
        /* sem jStat */
    }

    return { H: +H.toFixed(4), df, pValue: +pValue.toFixed(6), reject: pValue < alpha };
}

/**
 * Tukey HSD post-hoc test for ANOVA
 * Teste de Tukey — comparações par-a-par após ANOVA significativa
 * @param {number[][]} groups
 * @param {number} [alpha=0.05]
 * @returns {Array<{i: number, j: number, diff: number, q: number, significant: boolean}>}
 */
export function tukeyHSD(groups, alpha = 0.05) {
    const k = groups.length;
    const N = groups.reduce((s, g) => s + g.length, 0);
    const means = groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
    const MSW = groups.reduce((s, g, i) => s + g.reduce((ss, v) => ss + (v - means[i]) ** 2, 0), 0) / (N - k);
    const results = [];
    for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) {
            const diff = Math.abs(means[i] - means[j]);
            const se = Math.sqrt((MSW * (1 / groups[i].length + 1 / groups[j].length)) / 2);
            const q = se > 0 ? diff / se : Infinity;
            results.push({ i, j, diff: +diff.toFixed(4), q: +q.toFixed(3), significant: q > 3.5 });
        }
    }
    return results;
}

/**
 * Dunn test post-hoc for Kruskal-Wallis — Bonferroni correction
 * Teste de Dunn com correção de Bonferroni
 * @param {number[][]} groups
 * @param {number} [alpha=0.05]
 * @returns {Array<{i: number, j: number, Z: number, pAdjusted: number, significant: boolean}>}
 */
export function dunnTest(groups, alpha = 0.05) {
    const all = groups.flatMap((g, gi) => g.map((v) => ({ v, g: gi })));
    const N = all.length;
    all.sort((a, b) => a.v - b.v);
    let ti = 0;
    let tieCorr = 0;
    while (ti < N) {
        let tj = ti;
        while (tj < N - 1 && all[tj + 1].v === all[tj].v) tj++;
        const t = tj - ti + 1;
        if (t > 1) tieCorr += t ** 3 - t;
        const rank = (ti + tj) / 2 + 1;
        for (let kk = ti; kk <= tj; kk++) all[kk].rank = rank;
        ti = tj + 1;
    }

    const rankMeans = groups.map((g, gi) => all.filter((a) => a.g === gi).reduce((s, a) => s + a.rank, 0) / g.length);
    const ns = groups.map((g) => g.length);
    const k = groups.length;
    const m = (k * (k - 1)) / 2;
    const results = [];

    for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) {
            const se = Math.sqrt(((N * (N + 1)) / 12 - tieCorr / (12 * (N - 1))) * (1 / ns[i] + 1 / ns[j]));
            const Z = se > 0 ? Math.abs(rankMeans[i] - rankMeans[j]) / se : 0;
            let pRaw = 1;
            try {
                const jStat = getJStat();
                pRaw = 2 * (1 - jStat.normal.cdf(Z, 0, 1));
            } catch {
                pRaw = Z > 2.576 ? 0.01 : Z > 1.96 ? 0.05 : 0.5;
            }
            const pAdjusted = Math.min(1, pRaw * m);
            results.push({ i, j, Z: +Z.toFixed(3), pAdjusted: +pAdjusted.toFixed(6), significant: pAdjusted < alpha });
        }
    }
    return results;
}

// ================================================================
// DETECÇÃO DE MUDANÇA TEMPORAL — Pettitt e CUSUM
// ================================================================

/**
 * Pettitt test for change-point detection
 * Teste de Pettitt — detecta ponto de ruptura em série temporal
 * @param {number[]} values
 * @param {number} [alpha=0.05]
 * @returns {{ K: number, changeIndex: number, pValue: number, significant: boolean }}
 */
export function pettittTest(values, alpha = 0.05) {
    const n = values.length;
    if (n < 4) return { K: NaN, changeIndex: -1, pValue: NaN, significant: false, error: 'n < 4' };

    let maxK = 0;
    let changeIndex = 0;
    const U = new Array(n).fill(0);

    for (let t = 1; t < n; t++) {
        U[t] = U[t - 1];
        for (let j = 0; j < t; j++) {
            U[t] += Math.sign(values[t] - values[j]);
        }
        if (Math.abs(U[t]) > maxK) {
            maxK = Math.abs(U[t]);
            changeIndex = t;
        }
    }

    const pValue = Math.min(1, 2 * Math.exp((-6 * maxK ** 2) / (n ** 3 + n ** 2)));
    return { K: maxK, changeIndex, pValue: +pValue.toFixed(6), significant: pValue < alpha };
}

/**
 * CUSUM control chart
 * Gráfico de controle CUSUM — detecta desvios cumulativos da média alvo
 * @param {number[]} values
 * @param {number} [target] - média alvo (default: média amostral)
 * @param {number} [k] - slack parameter (default: 0.5 * std)
 * @returns {{ upperCSUM: number[], lowerCSUM: number[], alarms: number[], mean: number, std: number, controlLimit: number }}
 */
export function cusum(values, target, k) {
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
    const mu = target !== undefined ? target : mean;
    const slack = k !== undefined ? k : 0.5 * std;
    const h = 5 * std;

    const upper = new Array(n).fill(0);
    const lower = new Array(n).fill(0);
    const alarms = [];

    for (let i = 1; i < n; i++) {
        upper[i] = Math.max(0, upper[i - 1] + (values[i] - mu) - slack);
        lower[i] = Math.max(0, lower[i - 1] - (values[i] - mu) - slack);
        if (upper[i] > h || lower[i] > h) alarms.push(i);
    }

    return {
        upperCSUM: upper.map((v) => +v.toFixed(4)),
        lowerCSUM: lower.map((v) => +v.toFixed(4)),
        alarms,
        mean: +mean.toFixed(4),
        std: +std.toFixed(4),
        controlLimit: +h.toFixed(4),
    };
}

/**
 * Seasonal Mann-Kendall test (EPA Guidance)
 * Mann-Kendall com decomposição sazonal — detecta tendência em dados periódicos
 * @param {number[]} values
 * @param {number} [period=12]
 * @param {number} [alpha=0.05]
 * @returns {{ S: number, varS: number, Z: number, pValue: number, trend: string, method: string }}
 */
export function seasonalMannKendall(values, period = 12, alpha = 0.05) {
    const seasons = [];
    for (let s = 0; s < period; s++) {
        seasons.push(values.filter((_, i) => i % period === s));
    }

    let S_total = 0;
    let Var_total = 0;

    for (const season of seasons) {
        const n = season.length;
        if (n < 2) continue;
        let S = 0;
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) S += Math.sign(season[j] - season[i]);
        }
        S_total += S;
        Var_total += (n * (n - 1) * (2 * n + 5)) / 18;
    }

    if (Var_total <= 0)
        return { S: S_total, varS: 0, Z: 0, pValue: 1, trend: 'no trend', method: 'seasonal-mann-kendall' };

    const Z =
        S_total === 0 ? 0 : S_total > 0 ? (S_total - 1) / Math.sqrt(Var_total) : (S_total + 1) / Math.sqrt(Var_total);

    let pValue = 0.5;
    try {
        const jStat = getJStat();
        pValue = 2 * (1 - jStat.normal.cdf(Math.abs(Z), 0, 1));
    } catch {
        pValue = Math.abs(Z) > 1.96 ? 0.04 : 0.5;
    }

    const trend = pValue >= alpha ? 'no trend' : Z > 0 ? 'increasing' : 'decreasing';
    return {
        S: S_total,
        varS: +Var_total.toFixed(2),
        Z: +Z.toFixed(4),
        pValue: +pValue.toFixed(6),
        trend,
        method: 'seasonal-mann-kendall',
    };
}

// ================================================================
// CORRELAÇÃO — Spearman e Pearson
// ================================================================

/**
 * Spearman rank correlation
 * Correlação de Spearman — não-paramétrica, robusta a outliers
 * @param {number[]} x @param {number[]} y @param {number} [alpha=0.05]
 * @returns {{ rs: number, pValue: number, significant: boolean, n: number }}
 */
export function spearmanCorrelation(x, y, alpha = 0.05) {
    const n = Math.min(x.length, y.length);
    if (n < 3) return { rs: NaN, pValue: NaN, significant: false, n };

    const rank = (arr) => {
        const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const ranks = new Array(arr.length);
        let i = 0;
        while (i < n) {
            let j = i;
            while (j < n - 1 && sorted[j + 1].v === sorted[j].v) j++;
            const r = (i + j) / 2 + 1;
            for (let kk = i; kk <= j; kk++) ranks[sorted[kk].i] = r;
            i = j + 1;
        }
        return ranks;
    };

    const rx = rank(x.slice(0, n));
    const ry = rank(y.slice(0, n));
    const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
    const rs = 1 - (6 * d2) / (n * (n ** 2 - 1));
    const t = rs * Math.sqrt((n - 2) / Math.max(1e-10, 1 - rs ** 2));

    let pValue = 0.5;
    try {
        const jStat = getJStat();
        pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(t), n - 2));
    } catch {
        pValue = Math.abs(t) > 2 ? 0.04 : 0.5;
    }

    return { rs: +rs.toFixed(4), pValue: +pValue.toFixed(6), significant: pValue < alpha, n };
}

/**
 * Pearson correlation coefficient
 * Correlação de Pearson — paramétrica, assume normalidade bivariada
 * @param {number[]} x @param {number[]} y @param {number} [alpha=0.05]
 * @returns {{ r: number, pValue: number, significant: boolean, n: number }}
 */
export function pearsonCorrelation(x, y, alpha = 0.05) {
    const n = Math.min(x.length, y.length);
    if (n < 3) return { r: NaN, pValue: NaN, significant: false, n };

    const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let num = 0,
        dx2 = 0,
        dy2 = 0;
    for (let i = 0; i < n; i++) {
        num += (x[i] - mx) * (y[i] - my);
        dx2 += (x[i] - mx) ** 2;
        dy2 += (y[i] - my) ** 2;
    }
    const r = dx2 * dy2 > 0 ? num / Math.sqrt(dx2 * dy2) : 0;
    const t = r * Math.sqrt((n - 2) / Math.max(1e-10, 1 - r ** 2));

    let pValue = 0.5;
    try {
        const jStat = getJStat();
        pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(t), n - 2));
    } catch {
        pValue = Math.abs(t) > 2 ? 0.04 : 0.5;
    }

    return { r: +r.toFixed(4), pValue: +pValue.toFixed(6), significant: pValue < alpha, n };
}

/**
 * Correlation matrix for multiple parameter series
 * Matriz de correlação entre múltiplos parâmetros
 * @param {Array<{name: string, values: number[]}>} paramSeries
 * @param {'spearman'|'pearson'} [method='spearman']
 * @returns {{ names: string[], matrix: number[][], pValues: number[][] }}
 */
export function correlationMatrix(paramSeries, method = 'spearman') {
    const names = paramSeries.map((p) => p.name);
    const k = names.length;
    const corrFn = method === 'pearson' ? pearsonCorrelation : spearmanCorrelation;
    const matrix = Array.from({ length: k }, () => new Array(k).fill(0));
    const pValues = Array.from({ length: k }, () => new Array(k).fill(1));

    for (let i = 0; i < k; i++) {
        matrix[i][i] = 1;
        pValues[i][i] = 0;
        for (let j = i + 1; j < k; j++) {
            const res = corrFn(paramSeries[i].values, paramSeries[j].values);
            const r = res.rs ?? res.r;
            matrix[i][j] = r;
            matrix[j][i] = r;
            pValues[i][j] = res.pValue;
            pValues[j][i] = res.pValue;
        }
    }

    return { names, matrix, pValues };
}

// ================================================================
// OUTLIERS — Grubbs e Dixon Q
// ================================================================

/**
 * Grubbs test for outliers (EPA standard method)
 * Teste de Grubbs — padrão EPA para detecção de outlier único
 * @param {number[]} values @param {number} [alpha=0.05]
 * @returns {{ G: number, Gcritical: number, outlierIndex: number, outlierValue: number, reject: boolean }}
 */
export function grubbsTest(values, alpha = 0.05) {
    const x = values.filter((v) => Number.isFinite(v));
    const n = x.length;
    if (n < 3) return { G: NaN, Gcritical: NaN, outlierIndex: -1, outlierValue: NaN, reject: false };

    const mean = x.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    if (std === 0) return { G: 0, Gcritical: Infinity, outlierIndex: -1, outlierValue: NaN, reject: false };

    const deviations = x.map((v) => Math.abs(v - mean));
    const maxDev = Math.max(...deviations);
    const outlierIndex = deviations.indexOf(maxDev);
    const G = maxDev / std;

    let Gcritical = 2.5;
    try {
        const jStat = getJStat();
        const t = jStat.studentt.inv(alpha / (2 * n), n - 2);
        Gcritical = ((n - 1) / Math.sqrt(n)) * Math.sqrt(t ** 2 / (n - 2 + t ** 2));
    } catch {
        /* fallback */
    }

    return {
        G: +G.toFixed(4),
        Gcritical: +Gcritical.toFixed(4),
        outlierIndex,
        outlierValue: x[outlierIndex],
        reject: G > Gcritical,
    };
}

/**
 * Dixon Q test for outliers — small samples n = 3..30
 * Teste de Dixon Q — outliers em amostras pequenas
 * @param {number[]} values @param {number} [alpha=0.05]
 * @returns {{ Q: number, Qcritical: number, reject: boolean, outlierValue: number }}
 */
export function dixonQTest(values, alpha = 0.05) {
    const x = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const n = x.length;
    if (n < 3 || n > 30)
        return { Q: NaN, Qcritical: NaN, reject: false, outlierValue: NaN, error: `n=${n} fora de 3–30` };

    const range = x[n - 1] - x[0];
    if (range === 0) return { Q: 0, Qcritical: 1, reject: false, outlierValue: NaN };

    const Qlow = (x[1] - x[0]) / range;
    const Qhigh = (x[n - 1] - x[n - 2]) / range;
    const Q = Math.max(Qlow, Qhigh);
    const outlierValue = Qhigh >= Qlow ? x[n - 1] : x[0];

    const QCRIT = {
        3: 0.941,
        4: 0.765,
        5: 0.642,
        6: 0.56,
        7: 0.507,
        8: 0.468,
        9: 0.437,
        10: 0.412,
        11: 0.392,
        12: 0.376,
        13: 0.361,
        14: 0.349,
        15: 0.338,
        16: 0.329,
        17: 0.32,
        18: 0.313,
        19: 0.306,
        20: 0.3,
        25: 0.277,
        30: 0.26,
    };
    const ns = Object.keys(QCRIT)
        .map(Number)
        .sort((a, b) => a - b);
    const closest = ns.reduce((prev, curr) => (Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev));

    return { Q: +Q.toFixed(4), Qcritical: QCRIT[closest], reject: Q > QCRIT[closest], outlierValue };
}

/**
 * Autocorrelation function (ACF)
 * Função de autocorrelação — detecta sazonalidade e padrões cíclicos
 * @param {number[]} values @param {number} [maxLag=20]
 * @returns {{ lags: number[], correlations: number[], confidenceInterval: number }}
 */
export function acf(values, maxLag = 20) {
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    if (variance === 0) return { lags: [], correlations: [], confidenceInterval: 0 };

    const lags = [];
    const correlations = [];
    const L = Math.min(maxLag, n - 1);

    for (let lag = 0; lag <= L; lag++) {
        let cov = 0;
        for (let i = lag; i < n; i++) cov += (values[i] - mean) * (values[i - lag] - mean);
        lags.push(lag);
        correlations.push(+(cov / (n * variance)).toFixed(4));
    }

    return { lags, correlations, confidenceInterval: +(1.96 / Math.sqrt(n)).toFixed(4) };
}
