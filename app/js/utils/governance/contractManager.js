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
   CONTRACT MANAGER — CRUD and financial calculations for contracts
   Gerenciador de contratos com calculos financeiros

   ENTIDADES:
   - Contrato: Partes, termos financeiros, cronograma, KPIs
   - Desembolso: Pagamento programado vinculado a marco
   - Bonus/Malus: Incentivo vinculado a desempenho de KPI

   TIPOS DE CONTRATO:
   - remediation: Remediacao ambiental (CONAMA/CETESB)
   - monitoring: Monitoramento periodico
   - investigation: Investigacao ambiental
   - insurance: Seguro vinculado a compra de library (ambiental ou garantia)
   - custom: Contrato generico definido pelo usuario
   ================================================================ */

import { generateId } from '../helpers/id.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

/** @type {Array<Object>} */
let contracts = [];

// ----------------------------------------------------------------
// INSURANCE CATALOG — Catalogo de seguros disponiveis no marketplace
// v1: 3 subtipos. Extensivel adicionando entries ao catalogo.
// ----------------------------------------------------------------

const INSURANCE_CATALOG = {
    environmental: {
        garantia_remediacao: { pctOfPrice: 12, months: 24, i18nKey: 'insGarantiaRemediacao' },
    },
    warranty: {
        extended_support: { pctOfPrice: 10, months: 12, i18nKey: 'insExtendedSupport' },
        refund_guarantee: { pctOfPrice: 5, months: 6, i18nKey: 'insRefundGuarantee' },
    },
};

/** Minimum premium per policy in cents */
const INSURANCE_FLOOR_CENTS = 199;

// ----------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------

/**
 * Add a new contract.
 * Adiciona novo contrato ao sistema.
 *
 * @param {Object} data - Contract data
 * @returns {Object} - Created contract
 */
export function addContract(data = {}) {
    const contract = {
        id: data.id || generateId('contract'),
        name: data.name || 'New Contract',
        type: data.type || 'custom',
        status: data.status || 'draft',
        parties: data.parties || [],
        financial: {
            totalValue: data.financial?.totalValue || 0,
            currency: data.financial?.currency || 'BRL',
            disbursements: data.financial?.disbursements || [],
            bonusMalus: data.financial?.bonusMalus || [],
        },
        dates: {
            effectiveDate: data.dates?.effectiveDate || '',
            expirationDate: data.dates?.expirationDate || '',
            renewalDate: data.dates?.renewalDate || '',
        },
        linkedElements: data.linkedElements || [],
        linkedWbsItems: data.linkedWbsItems || [],
        notes: data.notes || '',
        insurance:
            data.type === 'insurance'
                ? {
                      category: data.insurance?.category || 'warranty',
                      subtype: data.insurance?.subtype || '',
                      linkedOrderId: data.insurance?.linkedOrderId || '',
                      linkedLibraryId: data.insurance?.linkedLibraryId || '',
                      premiumCents: data.insurance?.premiumCents || 0,
                      coverageValueCents: data.insurance?.coverageValueCents || 0,
                      coveragePeriodMonths: data.insurance?.coveragePeriodMonths || 12,
                      policyNumber: data.insurance?.policyNumber || '',
                      claimStatus: data.insurance?.claimStatus || 'none',
                      claimDate: data.insurance?.claimDate || null,
                      claimNotes: data.insurance?.claimNotes || '',
                  }
                : data.insurance || null,
        costCenterId: data.costCenterId || null,
        createdAt: data.createdAt || new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
    };

    contracts.push(contract);
    return contract;
}

/**
 * Update an existing contract.
 * Atualiza contrato existente.
 *
 * @param {string} id - Contract ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} - Updated contract or null
 */
export function updateContract(id, updates) {
    const contract = contracts.find((c) => c.id === id);
    if (!contract) return null;

    // Merge top-level fields
    for (const [key, value] of Object.entries(updates)) {
        if (key === 'financial') {
            Object.assign(contract.financial, value);
        } else if (key === 'dates') {
            Object.assign(contract.dates, value);
        } else if (key === 'insurance' && contract.insurance) {
            Object.assign(contract.insurance, value);
        } else if (key !== 'id' && key !== 'createdAt') {
            contract[key] = value;
        }
    }

    contract.modifiedAt = new Date().toISOString();
    return contract;
}

/**
 * Remove a contract.
 * Remove contrato do sistema.
 *
 * @param {string} id - Contract ID
 * @returns {boolean} - true if removed
 */
export function removeContract(id) {
    const idx = contracts.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    contracts.splice(idx, 1);
    return true;
}

/**
 * Clear all contracts.
 * Remove todos os contratos do sistema.
 */
export function clearContracts() {
    contracts = [];
}

/**
 * Get all contracts.
 * @returns {Array<Object>}
 */
export function getContracts() {
    return contracts;
}

/**
 * Get a contract by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getContract(id) {
    return contracts.find((c) => c.id === id) || null;
}

// ----------------------------------------------------------------
// PARTY MANAGEMENT
// ----------------------------------------------------------------

/**
 * Add a party to a contract.
 * Adiciona parte (pessoa/empresa) a um contrato.
 *
 * @param {string} contractId - Contract ID
 * @param {Object} party - { role, name, registry, signedAt }
 * @returns {Object|null} - Updated contract
 */
export function addParty(contractId, party) {
    const contract = getContract(contractId);
    if (!contract) return null;

    contract.parties.push({
        role: party.role || 'contractor',
        name: party.name || '',
        registry: party.registry || '',
        signedAt: party.signedAt || '',
    });

    contract.modifiedAt = new Date().toISOString();
    return contract;
}

/**
 * Remove a party from a contract.
 * @param {string} contractId
 * @param {number} index
 */
export function removeParty(contractId, index) {
    const contract = getContract(contractId);
    if (!contract || index < 0 || index >= contract.parties.length) return;
    contract.parties.splice(index, 1);
    contract.modifiedAt = new Date().toISOString();
}

// ----------------------------------------------------------------
// DISBURSEMENT MANAGEMENT
// ----------------------------------------------------------------

/**
 * Add a disbursement to a contract.
 * Adiciona desembolso programado.
 *
 * @param {string} contractId
 * @param {Object} disbursement - { date, amount, description, status }
 */
export function addDisbursement(contractId, disbursement) {
    const contract = getContract(contractId);
    if (!contract) return null;

    contract.financial.disbursements.push({
        id: generateId('disb'),
        date: disbursement.date || '',
        amount: disbursement.amount || 0,
        description: disbursement.description || '',
        status: disbursement.status || 'scheduled',
        linkedLibrary: disbursement.linkedLibrary || null,
    });

    contract.modifiedAt = new Date().toISOString();
    return contract;
}

/**
 * Update a disbursement by ID.
 * Atualiza campos de um desembolso especifico.
 *
 * @param {string} contractId
 * @param {string} disbursementId
 * @param {Object} updates - Fields to merge
 * @returns {Object|null} - Updated contract or null
 */
export function updateDisbursement(contractId, disbursementId, updates) {
    const contract = getContract(contractId);
    if (!contract) return null;
    const disb = contract.financial.disbursements.find((d) => d.id === disbursementId);
    if (!disb) return null;
    for (const [k, v] of Object.entries(updates)) {
        if (k !== 'id') disb[k] = v;
    }
    contract.modifiedAt = new Date().toISOString();
    return contract;
}

/**
 * Remove a disbursement by ID.
 * Remove desembolso de um contrato.
 *
 * @param {string} contractId
 * @param {string} disbursementId
 * @returns {boolean}
 */
export function removeDisbursement(contractId, disbursementId) {
    const contract = getContract(contractId);
    if (!contract) return false;
    const idx = contract.financial.disbursements.findIndex((d) => d.id === disbursementId);
    if (idx === -1) return false;
    contract.financial.disbursements.splice(idx, 1);
    contract.modifiedAt = new Date().toISOString();
    return true;
}

/**
 * Link a library to a disbursement as evidence.
 * Vincula library como evidencia de entregavel do desembolso.
 *
 * @param {string} contractId
 * @param {string} disbursementId
 * @param {Object} libraryInfo - { libraryId, libraryName, evidenceStatus }
 * @returns {Object|null}
 */
export function linkLibraryToDisbursement(contractId, disbursementId, libraryInfo) {
    const contract = getContract(contractId);
    if (!contract) return null;
    const disb = contract.financial.disbursements.find((d) => d.id === disbursementId);
    if (!disb) return null;
    disb.linkedLibrary = {
        libraryId: libraryInfo.libraryId,
        libraryName: libraryInfo.libraryName,
        evidenceStatus: libraryInfo.evidenceStatus || 'pending',
    };
    contract.modifiedAt = new Date().toISOString();
    return contract;
}

/**
 * Unlink a library from a disbursement.
 * Remove vinculacao de library do desembolso.
 *
 * @param {string} contractId
 * @param {string} disbursementId
 * @returns {Object|null}
 */
export function unlinkLibraryFromDisbursement(contractId, disbursementId) {
    const contract = getContract(contractId);
    if (!contract) return null;
    const disb = contract.financial.disbursements.find((d) => d.id === disbursementId);
    if (!disb) return null;
    disb.linkedLibrary = null;
    contract.modifiedAt = new Date().toISOString();
    return contract;
}

/**
 * Sync evidence status with installed libraries.
 * Sincroniza evidenceStatus com base nas libraries ativas.
 * Recebe funcao para evitar import circular (governance ← libraries).
 *
 * @param {Function} isActiveFn - (libraryId) => boolean
 */
export function syncLibraryEvidence(isActiveFn) {
    for (const contract of contracts) {
        for (const disb of contract.financial.disbursements) {
            if (disb.linkedLibrary) {
                const active = isActiveFn(disb.linkedLibrary.libraryId);
                disb.linkedLibrary.evidenceStatus = active ? 'delivered' : 'pending';
            }
        }
    }
}

/**
 * Get evidence summary for a contract.
 * Resumo de evidencias vinculadas aos desembolsos.
 *
 * @param {string} contractId
 * @returns {Object|null} - { total, delivered, pending }
 */
export function getEvidenceSummary(contractId) {
    const contract = getContract(contractId);
    if (!contract) return null;
    let total = 0,
        delivered = 0,
        pending = 0;
    for (const d of contract.financial.disbursements) {
        if (d.linkedLibrary) {
            total++;
            if (d.linkedLibrary.evidenceStatus === 'delivered') delivered++;
            else pending++;
        }
    }
    return { total, delivered, pending };
}

// ----------------------------------------------------------------
// FINANCIAL CALCULATIONS
// ----------------------------------------------------------------

/**
 * Calculate financial summary for a contract.
 * Calcula resumo financeiro — total pago, restante, vencido.
 *
 * @param {string} contractId
 * @returns {Object} - { totalValue, totalPaid, totalScheduled, totalOverdue, remaining }
 */
export function getContractFinancialSummary(contractId) {
    const contract = getContract(contractId);
    if (!contract) return null;

    const now = new Date().toISOString().split('T')[0];
    let totalPaid = 0;
    let totalScheduled = 0;
    let totalOverdue = 0;

    for (const d of contract.financial.disbursements) {
        if (d.status === 'paid') {
            totalPaid += d.amount;
        } else if (d.status === 'scheduled') {
            totalScheduled += d.amount;
            if (d.date && d.date < now) {
                totalOverdue += d.amount;
            }
        }
    }

    return {
        totalValue: contract.financial.totalValue,
        totalPaid,
        totalScheduled,
        totalOverdue,
        remaining: contract.financial.totalValue - totalPaid,
    };
}

/**
 * Evaluate KPIs and calculate bonus/malus for a contract.
 * Avalia KPIs e calcula bonus/malus vinculados ao desempenho.
 *
 * @param {string} contractId
 * @param {Array<Object>} wbsItems - WBS items linked to this contract
 * @returns {Object} - { bonusTotal, malusTotal, details: [] }
 */
export function evaluateKPIs(contractId, wbsItems = []) {
    const contract = getContract(contractId);
    if (!contract) return { bonusTotal: 0, malusTotal: 0, details: [] };

    let bonusTotal = 0;
    let malusTotal = 0;
    const details = [];

    for (const bm of contract.financial.bonusMalus) {
        // Find the linked WBS item for this KPI
        const wbsItem = wbsItems.find((w) => w.id === bm.kpiId);
        if (!wbsItem) continue;

        const actual = wbsItem.actual?.percentComplete || 0;
        const threshold = bm.threshold || 100;

        if (actual >= threshold) {
            const bonus = (contract.financial.totalValue * (bm.bonusPercent || 0)) / 100;
            bonusTotal += bonus;
            details.push({
                kpiId: bm.kpiId,
                type: 'bonus',
                amount: bonus,
                actual,
                threshold,
            });
        } else {
            const malus = (contract.financial.totalValue * (bm.malusPercent || 0)) / 100;
            malusTotal += malus;
            details.push({
                kpiId: bm.kpiId,
                type: 'malus',
                amount: malus,
                actual,
                threshold,
            });
        }
    }

    return { bonusTotal, malusTotal, details };
}

// ----------------------------------------------------------------
// ELEMENT LINKING
// ----------------------------------------------------------------

/**
 * Link an element to a contract.
 * @param {string} contractId
 * @param {string} elementId
 */
export function linkElement(contractId, elementId) {
    const contract = getContract(contractId);
    if (!contract) return;
    if (!contract.linkedElements.includes(elementId)) {
        contract.linkedElements.push(elementId);
        contract.modifiedAt = new Date().toISOString();
    }
}

/**
 * Unlink an element from a contract.
 * @param {string} contractId
 * @param {string} elementId
 */
export function unlinkElement(contractId, elementId) {
    const contract = getContract(contractId);
    if (!contract) return;
    const idx = contract.linkedElements.indexOf(elementId);
    if (idx !== -1) {
        contract.linkedElements.splice(idx, 1);
        contract.modifiedAt = new Date().toISOString();
    }
}

// ----------------------------------------------------------------
// INSURANCE — Seguros vinculados a compras do marketplace
// ----------------------------------------------------------------

/**
 * Get the insurance catalog.
 * Retorna catalogo de seguros disponiveis para UI.
 * @returns {Object}
 */
export function getInsuranceCatalog() {
    return INSURANCE_CATALOG;
}

/**
 * Calculate insurance premium in cents.
 * Calcula premio do seguro baseado no preco da library.
 *
 * @param {number} libraryPriceCents - Preco da library em centavos
 * @param {string} subtype - Subtipo do seguro (key do catalogo)
 * @returns {number} Premium em centavos
 */
export function calculatePremium(libraryPriceCents, subtype) {
    for (const cat of Object.values(INSURANCE_CATALOG)) {
        if (cat[subtype]) {
            return Math.max(INSURANCE_FLOOR_CENTS, Math.round((libraryPriceCents * cat[subtype].pctOfPrice) / 100));
        }
    }
    return INSURANCE_FLOOR_CENTS;
}

/**
 * Find catalog entry for a subtype.
 * Busca entry do catalogo pelo subtipo.
 * @param {string} subtype
 * @returns {{ category: string, entry: Object }|null}
 */
function _findCatalogEntry(subtype) {
    for (const [category, entries] of Object.entries(INSURANCE_CATALOG)) {
        if (entries[subtype]) return { category, entry: entries[subtype] };
    }
    return null;
}

/**
 * Add an insurance contract from purchase data.
 * Cria contrato de seguro a partir de dados da compra.
 *
 * @param {Object} data - { subtype, linkedOrderId, linkedLibraryId, premiumCents, coverageValueCents, userName }
 * @returns {Object} Created insurance contract
 */
export function addInsuranceContract(data) {
    const catalogInfo = _findCatalogEntry(data.subtype);
    const months = catalogInfo?.entry?.months || 12;
    const category = catalogInfo?.category || 'warranty';

    const now = new Date();
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + months);

    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const policyNumber = `INS-${dateStr}-${rand}`;

    return addContract({
        name: `${policyNumber}`,
        type: 'insurance',
        status: 'active',
        parties: [
            { role: 'insured', name: data.userName || '', registry: '', signedAt: now.toISOString() },
            { role: 'insurer', name: 'ecbyts Platform', registry: '', signedAt: now.toISOString() },
        ],
        financial: {
            totalValue: (data.premiumCents || 0) / 100,
            currency: data.currency || 'USD',
        },
        dates: {
            effectiveDate: now.toISOString().split('T')[0],
            expirationDate: expires.toISOString().split('T')[0],
        },
        insurance: {
            category,
            subtype: data.subtype,
            linkedOrderId: data.linkedOrderId || '',
            linkedLibraryId: data.linkedLibraryId || '',
            premiumCents: data.premiumCents || 0,
            coverageValueCents: data.coverageValueCents || 0,
            coveragePeriodMonths: months,
            policyNumber,
            claimStatus: 'none',
            claimDate: null,
            claimNotes: '',
        },
    });
}

/**
 * File an insurance claim.
 * Registra sinistro em um contrato de seguro.
 *
 * @param {string} contractId
 * @param {string} notes - Descricao do sinistro
 * @returns {Object|null}
 */
export function fileInsuranceClaim(contractId, notes) {
    const contract = getContract(contractId);
    if (!contract || contract.type !== 'insurance' || !contract.insurance) return null;
    if (contract.insurance.claimStatus !== 'none') return null;

    contract.insurance.claimStatus = 'filed';
    contract.insurance.claimDate = new Date().toISOString();
    contract.insurance.claimNotes = notes || '';
    contract.modifiedAt = new Date().toISOString();
    return contract;
}

/**
 * Get all insurance contracts.
 * Retorna apenas contratos do tipo seguro.
 * @returns {Array<Object>}
 */
export function getInsuranceContracts() {
    return contracts.filter((c) => c.type === 'insurance');
}

/**
 * Get insurance contracts linked to a specific order/purchase.
 * Busca seguros vinculados a uma compra especifica.
 *
 * @param {string} orderId - Order or purchase UUID
 * @returns {Array<Object>}
 */
export function getInsuranceByPurchase(orderId) {
    return contracts.filter((c) => c.type === 'insurance' && c.insurance && c.insurance.linkedOrderId === orderId);
}

/**
 * Check and update expired insurance contracts.
 * Avaliacao lazy de expiracao — chamada ao renderizar.
 */
export function checkInsuranceExpiry() {
    const now = new Date().toISOString().split('T')[0];
    for (const c of contracts) {
        if (c.type === 'insurance' && c.status === 'active' && c.dates.expirationDate && c.dates.expirationDate < now) {
            c.status = 'completed';
            if (c.insurance)
                c.insurance.claimStatus = c.insurance.claimStatus === 'none' ? 'none' : c.insurance.claimStatus;
            c.modifiedAt = new Date().toISOString();
        }
    }
}

// ----------------------------------------------------------------
// SERIALIZATION
// ----------------------------------------------------------------

/**
 * Export contracts for model serialization.
 * Exporta contratos para serializacao do modelo.
 *
 * @returns {Array<Object>}
 */
export function exportContracts() {
    return contracts.map((c) => ({ ...c }));
}

/**
 * Import contracts from model data.
 * Importa contratos de dados do modelo.
 *
 * @param {Array<Object>} data
 */
export function importContracts(data) {
    contracts = [];
    if (!Array.isArray(data)) return;
    for (const item of data) {
        contracts.push({
            id: item.id || `contract-${Date.now()}`,
            name: item.name || '',
            type: item.type || 'custom',
            status: item.status || 'draft',
            parties: item.parties || [],
            financial: {
                totalValue: item.financial?.totalValue || 0,
                currency: item.financial?.currency || 'BRL',
                disbursements: (item.financial?.disbursements || []).map((d) => ({
                    id: d.id || generateId('disb'),
                    date: d.date || '',
                    amount: d.amount || 0,
                    description: d.description || '',
                    status: d.status || 'scheduled',
                    linkedLibrary: d.linkedLibrary || null,
                })),
                bonusMalus: item.financial?.bonusMalus || [],
            },
            dates: item.dates || {},
            linkedElements: item.linkedElements || [],
            linkedWbsItems: item.linkedWbsItems || [],
            notes: item.notes || '',
            insurance: item.insurance || null,
            createdAt: item.createdAt || new Date().toISOString(),
            modifiedAt: item.modifiedAt || new Date().toISOString(),
        });
    }
}
