// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   CLOUD HANDLERS — Cloud save, share, professional, subscription
   Handlers para salvar/carregar modelos na nuvem, compartilhar,
   registro profissional e assinatura.

   MODALS:
   - Cloud Panel: lista modelos salvos, salvar, carregar, deletar
   - Share Modal: compartilhar modelo por email ou codigo
   - Professional Modal: registro profissional + upload print
   - Subscription Modal: planos e pagamento
   ================================================================ */

import {
    saveModelToCloud,
    updateModelInCloud,
    loadModelsFromCloud,
    loadModelFromCloud,
    deleteModelFromCloud,
    shareModel,
    getSharedModels,
    loadModelByShareCode,
    getModelShares,
    revokeShare,
} from '../cloud/manager.js';
import { submitProfessionalRequest, getProfessionalStatus, getProfessionalProfile } from '../cloud/professional.js';
import { startCheckout, getSubscriptionInfo, cancelSubscription, checkPaymentReturn } from '../cloud/subscription.js';
import {
    validateElements,
    getValidationInfo,
    isElementValidated,
    setValidationCouncilId,
} from '../cloud/validation.js';
import { getCurrentUser, isLoggedIn } from '../auth/session.js';
import { getAllElements } from '../../core/elements/manager.js';
import { applyModel } from '../../core/io/import.js';
import { showToast } from '../ui/toast.js';
import { escapeHtml, escapeAttr } from '../helpers/html.js';
import { t } from '../i18n/translations.js';
import { clearModelData, setEphemeral } from '../storage/storageMonitor.js';
import { asyncConfirm } from '../ui/asyncDialogs.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let updateAllUIRef = null;
let currentCloudModelId = null; // tracks if current model was loaded from cloud

/**
 * Set the current cloud model ID (for init-time loads).
 * Sincroniza o ID do modelo carregado no init para que "Salvar" faca UPDATE.
 *
 * @param {string|null} id - UUID do modelo ou null para limpar
 */
export function setCurrentCloudModelId(id) {
    currentCloudModelId = id;
}

/**
 * Inject updateAllUI reference.
 * @param {Function} fn
 */
export function setCloudUpdateAllUI(fn) {
    updateAllUIRef = fn;
}

// ----------------------------------------------------------------
// CLOUD PANEL (Save / Load / Delete)
// ----------------------------------------------------------------

/**
 * Open cloud panel modal.
 * Abre o painel de modelos na nuvem.
 */
async function handleOpenCloudPanel() {
    if (!isLoggedIn()) {
        showToast('Faca login para usar o Cloud.', 'warning');
        if (window.handleOpenAuthModal) window.handleOpenAuthModal();
        return;
    }

    const overlay = getOrCreateOverlay('cloud-panel-overlay');
    overlay.innerHTML = renderCloudPanelLoading();
    overlay.classList.add('active');

    try {
        const [myModels, sharedModels] = await Promise.all([loadModelsFromCloud(), getSharedModels()]);
        overlay.innerHTML = renderCloudPanel(myModels, sharedModels);
        requestAnimationFrame(() => {
            if (window.hydrateIcons) window.hydrateIcons();
        });
    } catch (err) {
        overlay.innerHTML = renderCloudPanelError(err.message);
    }
}

/**
 * Close cloud panel.
 */
function handleCloseCloudPanel() {
    const overlay = document.getElementById('cloud-panel-overlay');
    if (overlay) overlay.classList.remove('active');
}

/**
 * Save current model to cloud.
 * Salva modelo atual na nuvem.
 */
async function handleSaveToCloud() {
    if (!isLoggedIn()) {
        showToast('Faca login para salvar.', 'warning');
        return;
    }

    const nameInput = document.getElementById('cloud-save-name');
    const descInput = document.getElementById('cloud-save-desc');
    const name = nameInput?.value?.trim();
    if (!name) {
        showToast('Informe um nome para o modelo.', 'warning');
        return;
    }

    const btn = document.getElementById('cloud-save-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Salvando...';
    }

    try {
        // Desativa modo efemero — usuario salvou explicitamente
        setEphemeral(false);

        if (currentCloudModelId) {
            await updateModelInCloud(currentCloudModelId);
            showToast('Modelo atualizado na nuvem!', 'success');
        } else {
            const result = await saveModelToCloud(name, descInput?.value?.trim() || '');
            currentCloudModelId = result.id;
            showToast('Modelo salvo na nuvem!', 'success');
        }
        handleOpenCloudPanel(); // refresh list
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Salvar';
        }
    }
}

/**
 * Load model from cloud.
 * Carrega modelo da nuvem.
 *
 * @param {string} modelId - UUID do modelo
 */
async function handleLoadFromCloud(modelId) {
    try {
        showToast('Carregando modelo...', 'info');
        const modelData = await loadModelFromCloud(modelId);
        if (!modelData) throw new Error('Modelo vazio.');

        // Desativa modo efemero e limpa dados stale antes de carregar
        setEphemeral(false);
        clearModelData();

        await applyModel(modelData);
        currentCloudModelId = modelId;
        showToast('Modelo carregado da nuvem!', 'success');
        handleCloseCloudPanel();
        if (updateAllUIRef) updateAllUIRef();
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    }
}

/**
 * Delete model from cloud with confirmation.
 * Deleta modelo da nuvem com confirmacao.
 *
 * @param {string} modelId - UUID do modelo
 * @param {string} modelName - Nome do modelo (para confirmacao)
 */
async function handleDeleteFromCloud(modelId, modelName) {
    if (!(await asyncConfirm(`Deletar modelo "${modelName}" da nuvem? Esta acao nao pode ser desfeita.`))) return;

    try {
        await deleteModelFromCloud(modelId);
        if (currentCloudModelId === modelId) currentCloudModelId = null;
        showToast('Modelo deletado.', 'success');
        handleOpenCloudPanel(); // refresh list
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    }
}

// ----------------------------------------------------------------
// SHARING
// ----------------------------------------------------------------

/**
 * Open share modal for a specific model.
 * Abre modal de compartilhamento para um modelo.
 *
 * @param {string} modelId - UUID do modelo
 */
async function handleShareModel(modelId) {
    const overlay = getOrCreateOverlay('share-modal-overlay');

    try {
        const shares = await getModelShares(modelId);
        overlay.innerHTML = renderShareModal(modelId, shares);
        overlay.classList.add('active');
        requestAnimationFrame(() => {
            if (window.hydrateIcons) window.hydrateIcons();
        });
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    }
}

/**
 * Execute share action.
 * Executa compartilhamento.
 */
async function handleShareSubmit() {
    const modelId = document.getElementById('share-model-id')?.value;
    const email = document.getElementById('share-email')?.value?.trim();
    const permission = document.getElementById('share-permission')?.value || 'viewer';

    if (!email) {
        showToast('Informe o email.', 'warning');
        return;
    }
    if (!modelId) {
        showToast('Modelo nao selecionado.', 'error');
        return;
    }

    try {
        const result = await shareModel(modelId, email, permission);
        showToast(`Compartilhado! Codigo: ${result.share_code}`, 'success');
        handleShareModel(modelId); // refresh
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    }
}

/**
 * Load a shared model by code.
 * Carrega modelo compartilhado pelo codigo.
 */
async function handleLoadSharedModel() {
    const codeInput = document.getElementById('share-code-input');
    const code = codeInput?.value?.trim();
    if (!code) {
        showToast('Informe o codigo.', 'warning');
        return;
    }

    try {
        showToast('Carregando modelo compartilhado...', 'info');
        const modelData = await loadModelByShareCode(code);
        if (!modelData) throw new Error('Modelo nao encontrado.');

        await applyModel(modelData);
        showToast('Modelo compartilhado carregado!', 'success');
        handleCloseCloudPanel();
        if (updateAllUIRef) updateAllUIRef();
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    }
}

/**
 * Revoke a share.
 * @param {string} shareId
 * @param {string} modelId - to refresh the modal
 */
async function handleRevokeShare(shareId, modelId) {
    try {
        await revokeShare(shareId);
        showToast('Compartilhamento revogado.', 'success');
        handleShareModel(modelId); // refresh
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    }
}

function handleCloseShareModal() {
    const overlay = document.getElementById('share-modal-overlay');
    if (overlay) overlay.classList.remove('active');
}

// ----------------------------------------------------------------
// PROFESSIONAL REGISTRATION
// ----------------------------------------------------------------

/**
 * Open professional registration modal.
 * Abre modal de registro profissional.
 */
async function handleOpenProfessionalModal() {
    if (!isLoggedIn()) {
        showToast('Faca login primeiro.', 'warning');
        return;
    }

    const overlay = getOrCreateOverlay('professional-modal-overlay');
    const profile = await getProfessionalProfile();
    overlay.innerHTML = renderProfessionalModal(profile);
    overlay.classList.add('active');
    requestAnimationFrame(() => {
        if (window.hydrateIcons) window.hydrateIcons();
    });
}

/**
 * Submit professional verification request.
 * Submete pedido de verificacao profissional.
 */
async function handleSubmitProfessional() {
    const councilId = document.getElementById('prof-council-id')?.value?.trim();
    const fileInput = document.getElementById('prof-proof-file');
    const file = fileInput?.files?.[0];

    if (!councilId) {
        showToast('Informe o numero do conselho.', 'warning');
        return;
    }
    if (!file) {
        showToast('Selecione o arquivo comprobatorio.', 'warning');
        return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
        showToast('Arquivo muito grande (max 5MB).', 'warning');
        return;
    }

    const btn = document.getElementById('prof-submit-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verificando...';
    }

    try {
        const result = await submitProfessionalRequest(councilId, file);
        if (result.approved) {
            showToast('Verificacao aprovada! Voce e um profissional verificado.', 'success');
        } else {
            showToast(`Verificacao rejeitada: ${result.reason}`, 'warning');
        }
        handleOpenProfessionalModal(); // refresh
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Enviar para Verificacao';
        }
    }
}

function handleCloseProfessionalModal() {
    const overlay = document.getElementById('professional-modal-overlay');
    if (overlay) overlay.classList.remove('active');
}

// ----------------------------------------------------------------
// SUBSCRIPTION
// ----------------------------------------------------------------

/**
 * Open subscription modal.
 * Abre modal de assinatura.
 */
function handleOpenSubscription() {
    if (!isLoggedIn()) {
        showToast('Faca login primeiro.', 'warning');
        return;
    }

    const overlay = getOrCreateOverlay('subscription-modal-overlay');
    const info = getSubscriptionInfo();
    const profStatus = getProfessionalStatus();
    overlay.innerHTML = renderSubscriptionModal(info, profStatus);
    overlay.classList.add('active');
    requestAnimationFrame(() => {
        if (window.hydrateIcons) window.hydrateIcons();
    });
}

/**
 * Start checkout with selected provider.
 * Inicia checkout com o provider selecionado.
 *
 * @param {'stripe'|'paypal'} provider
 */
async function handleStartCheckout(provider) {
    try {
        showToast('Redirecionando para pagamento...', 'info');
        const url = await startCheckout(provider);
        window.location.href = url;
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    }
}

/**
 * Cancel subscription with confirmation.
 */
async function handleCancelSubscription() {
    if (!(await asyncConfirm('Tem certeza que deseja cancelar sua assinatura? Voce perdera o selo profissional.')))
        return;

    try {
        await cancelSubscription();
        showToast('Assinatura cancelada.', 'info');
        handleOpenSubscription(); // refresh
    } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
    }
}

function handleCloseSubscriptionModal() {
    const overlay = document.getElementById('subscription-modal-overlay');
    if (overlay) overlay.classList.remove('active');
}

async function handleGoToProfessionalVerification() {
    handleCloseSubscriptionModal();
    await handleOpenProfessionalModal();
}

// ----------------------------------------------------------------
// PROFESSIONAL VALIDATION (on elements)
// ----------------------------------------------------------------

/**
 * Validate all elements in current model.
 * Valida todos os elementos do modelo atual.
 */
async function handleValidateAllElements() {
    const user = getCurrentUser();
    if (!user || user.professionalStatus !== 'approved' || user.subscriptionStatus !== 'active') {
        showToast('Necessario ser profissional verificado com assinatura ativa.', 'warning');
        return;
    }

    const elements = getAllElements();
    const ids = elements.map((el) => el.id);

    // Fetch council_id from profile for the validation tag
    const profile = await getProfessionalProfile();
    if (profile?.council_id) {
        setValidationCouncilId(profile.council_id);
    }

    const success = validateElements(ids);
    if (success) {
        showToast(`${ids.length} elementos validados com selo profissional!`, 'success');
        if (updateAllUIRef) updateAllUIRef();
    } else {
        showToast('Erro ao validar elementos.', 'error');
    }
}

// ----------------------------------------------------------------
// INIT — Check payment return on page load
// ----------------------------------------------------------------

/**
 * Check if returning from payment redirect.
 * Deve ser chamado no init da aplicacao.
 */
async function handleCheckPaymentReturn() {
    const result = await checkPaymentReturn();
    if (result && result.reason === 'processing_pending') {
        // Mercado Pago: webhook ainda nao chegou
        showToast('Pagamento em processamento. Pode levar alguns minutos.', 'info');
    } else if (result === true || result?.confirmed) {
        showToast('Pagamento confirmado! Assinatura ativa.', 'success');
        handleOpenSubscription(); // atualizar modal se aberto
    }
}

// ----------------------------------------------------------------
// RENDER FUNCTIONS
// ----------------------------------------------------------------

function renderCloudPanelLoading() {
    return `
    <div class="cloud-modal-content" style="padding:40px;text-align:center;">
        <p>Carregando modelos...</p>
    </div>`;
}

function renderCloudPanelError(msg) {
    return `
    <div class="cloud-modal-content" style="padding:40px;text-align:center;">
        <p style="color:var(--danger);">Erro: ${escapeHtml(msg)}</p>
        <button class="btn btn-sm" onclick="window.handleCloseCloudPanel()">Fechar</button>
    </div>`;
}

function renderCloudPanel(myModels, sharedModels) {
    const user = getCurrentUser();
    const modelRows = myModels
        .map((m) => {
            const date = new Date(m.updated_at).toLocaleDateString('pt-BR');
            const profBadge = m.professional_validation
                ? ' <span class="prof-badge" title="Validado profissionalmente">&#9989;</span>'
                : '';
            return `
        <div class="cloud-model-row">
            <div class="cloud-model-info">
                <strong>${escapeHtml(m.name)}</strong>${profBadge}
                <small>${m.element_count} elementos · ${m.campaign_count} campanhas · ${date}</small>
            </div>
            <div class="cloud-model-actions">
                <button class="btn btn-xs" onclick="window.handleLoadFromCloud('${m.id}')">Carregar</button>
                <button class="btn btn-xs" onclick="window.handleShareModel('${m.id}')">Compartilhar</button>
                <button class="btn btn-xs btn-danger" onclick="window.handleDeleteFromCloud('${m.id}', '${escapeAttr(m.name)}')">Deletar</button>
            </div>
        </div>`;
        })
        .join('');

    const sharedRows = sharedModels
        .map((s) => {
            const m = s.models;
            if (!m) return '';
            const date = new Date(m.updated_at).toLocaleDateString('pt-BR');
            return `
        <div class="cloud-model-row">
            <div class="cloud-model-info">
                <strong>${escapeHtml(m.name)}</strong>
                <small>${m.element_count} elem · ${s.permission} · ${date}</small>
            </div>
            <div class="cloud-model-actions">
                <button class="btn btn-xs" onclick="window.handleLoadFromCloud('${m.id}')">Carregar</button>
            </div>
        </div>`;
        })
        .join('');

    return `
    <div class="cloud-modal-content">
        <div class="cloud-modal-header">
            <h3>Modelos na Nuvem</h3>
            <button class="btn-close" onclick="window.handleCloseCloudPanel()">&times;</button>
        </div>

        <div class="cloud-save-section">
            <h4>Salvar Modelo Atual</h4>
            <input type="text" id="cloud-save-name" placeholder="Nome do modelo" class="input-field"
                   value="${escapeAttr(currentCloudModelId ? 'Atualizar modelo existente' : '')}" />
            <input type="text" id="cloud-save-desc" placeholder="Descricao (opcional)" class="input-field" />
            <button id="cloud-save-btn" class="btn btn-primary" onclick="window.handleSaveToCloud()">
                ${currentCloudModelId ? 'Atualizar' : 'Salvar'}
            </button>
        </div>

        <div class="cloud-share-code-section">
            <h4>Abrir por Codigo</h4>
            <div style="display:flex;gap:8px;">
                <input type="text" id="share-code-input" placeholder="Codigo de 6 caracteres" class="input-field" maxlength="6"
                       style="text-transform:uppercase;letter-spacing:2px;font-family:monospace;" />
                <button class="btn btn-sm" onclick="window.handleLoadSharedModel()">Abrir</button>
            </div>
        </div>

        <div class="cloud-models-section">
            <h4>Meus Modelos (${myModels.length})</h4>
            ${modelRows || '<p class="cloud-empty">Nenhum modelo salvo.</p>'}
        </div>

        ${
            sharedModels.length > 0
                ? `
        <div class="cloud-models-section">
            <h4>Compartilhados Comigo (${sharedModels.length})</h4>
            ${sharedRows}
        </div>`
                : ''
        }

        <div class="cloud-footer">
            <button class="btn btn-sm" onclick="window.handleOpenProfessionalModal()">Perfil Profissional</button>
            <button class="btn btn-sm" onclick="window.handleOpenSubscription()">Assinatura</button>
            ${user ? '<button class="btn btn-sm" onclick="window.handleOpenApiKeys()">API Keys</button>' : ''}
        </div>
    </div>`;
}

function renderShareModal(modelId, shares) {
    const shareRows = shares
        .map(
            (s) => `
        <div class="share-row">
            <span>${escapeHtml(s.shared_with_email)} (${s.permission})</span>
            <span class="share-code">${s.share_code || ''}</span>
            <button class="btn btn-xs btn-danger" onclick="window.handleRevokeShare('${s.id}', '${modelId}')">Revogar</button>
        </div>
    `,
        )
        .join('');

    return `
    <div class="cloud-modal-content">
        <div class="cloud-modal-header">
            <h3>Compartilhar Modelo</h3>
            <button class="btn-close" onclick="window.handleCloseShareModal()">&times;</button>
        </div>

        <input type="hidden" id="share-model-id" value="${modelId}" />

        <div style="display:flex;gap:8px;margin-bottom:16px;">
            <input type="email" id="share-email" placeholder="Email do destinatario" class="input-field" style="flex:1;" />
            <select id="share-permission" class="input-field" style="width:auto;">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
            </select>
            <button class="btn btn-primary btn-sm" onclick="window.handleShareSubmit()">Compartilhar</button>
        </div>

        ${
            shares.length > 0
                ? `
        <h4>Compartilhamentos Ativos</h4>
        ${shareRows}`
                : '<p class="cloud-empty">Nenhum compartilhamento ativo.</p>'
        }
    </div>`;
}

function renderProfessionalModal(profile) {
    const status = profile?.professional_status || 'none';
    const councilId = profile?.council_id || '';
    const rejectionReason = profile?.rejection_reason || '';

    const statusLabel =
        {
            none: 'Nao solicitado',
            pending: 'Em analise...',
            approved: 'Aprovado',
            rejected: 'Rejeitado',
        }[status] || status;

    const statusColor =
        {
            none: 'var(--text-secondary)',
            pending: '#f59e0b',
            approved: '#22c55e',
            rejected: '#ef4444',
        }[status] || 'inherit';

    const isApproved = status === 'approved';
    const subInfo = getSubscriptionInfo();

    return `
    <div class="cloud-modal-content">
        <div class="cloud-modal-header">
            <h3>Perfil Profissional</h3>
            <button class="btn-close" onclick="window.handleCloseProfessionalModal()">&times;</button>
        </div>

        <div class="prof-status" style="margin-bottom:20px;">
            <p>Status: <strong style="color:${statusColor};">${statusLabel}</strong></p>
            ${councilId ? `<p>Conselho: <strong>${escapeHtml(councilId)}</strong></p>` : ''}
            ${rejectionReason ? `<p style="color:#ef4444;font-size:0.9em;">Motivo: ${escapeHtml(rejectionReason)}</p>` : ''}
            ${isApproved && subInfo.isActive ? '<p style="color:#22c55e;">&#9989; Profissional Verificado com Assinatura Ativa</p>' : ''}
            ${isApproved && !subInfo.isActive ? '<p style="color:#f59e0b;">Aprovado, mas assinatura inativa. <a href="#" onclick="window.handleOpenSubscription();return false;">Assinar</a></p>' : ''}
        </div>

        ${
            !isApproved
                ? `
        <div class="prof-form">
            <h4>${status === 'rejected' ? 'Tentar Novamente' : 'Solicitar Verificacao'}</h4>
            <label>Numero do Conselho Profissional</label>
            <input type="text" id="prof-council-id" placeholder="Ex: CREA-SP 123456, CRQ-IV 12345678"
                   class="input-field" value="${escapeAttr(councilId)}" />
            <label>Print Comprobatorio (foto da carteirinha, certificado, etc.)</label>
            <input type="file" id="prof-proof-file" accept="image/*,.pdf" class="input-field" />
            <small>Aceita imagens (JPG, PNG) e PDF. Maximo 5MB.</small>
            <button id="prof-submit-btn" class="btn btn-primary" onclick="window.handleSubmitProfessional()" style="margin-top:12px;">
                Enviar para Verificacao
            </button>
        </div>`
                : ''
        }

        ${
            isApproved && subInfo.isActive
                ? `
        <div class="prof-actions" style="margin-top:20px;">
            <h4>Validar Elementos</h4>
            <p>Aplique seu selo profissional a todos os elementos do modelo atual.</p>
            <button class="btn btn-primary" onclick="window.handleValidateAllElements()">
                Validar Todos os Elementos
            </button>
        </div>`
                : ''
        }
    </div>`;
}

function renderSubscriptionModal(subInfo, profStatus) {
    const isActive = subInfo.isActive;

    return `
    <div class="cloud-modal-content">
        <div class="cloud-modal-header">
            <h3>Plano Profissional</h3>
            <button class="btn-close" onclick="window.handleCloseSubscriptionModal()">&times;</button>
        </div>

        ${
            isActive
                ? `
        <div class="sub-active" style="text-align:center;padding:20px;">
            <p style="color:#22c55e;font-size:1.2em;">&#9989; Assinatura Ativa</p>
            <p>Voce tem acesso ao selo de validacao profissional.</p>
            <button class="btn btn-sm btn-danger" onclick="window.handleCancelSubscription()" style="margin-top:16px;">
                Cancelar Assinatura
            </button>
        </div>`
                : `
        <div class="sub-plan" style="text-align:center;padding:20px;">
            <div class="sub-price" style="font-size:2em;font-weight:bold;margin:20px 0;">US$ 5<span style="font-size:0.5em;font-weight:normal;">/mes</span></div>
            <ul style="text-align:left;max-width:300px;margin:0 auto 24px;list-style:none;padding:0;">
                <li>&#10003; Selo de validacao profissional nos modelos</li>
                <li>&#10003; IA reconhece dados validados por voce</li>
                <li>&#10003; Tag visivel para outros usuarios</li>
                <li>&#10003; Prioridade em compartilhamentos</li>
            </ul>

            ${
                !profStatus.isProfessional
                    ? `
            <div style="background:rgba(245,158,11,0.12);border:1px solid #f59e0b;border-radius:8px;padding:16px;max-width:320px;margin:0 auto 20px;text-align:left;">
                <p style="margin:0 0 4px;font-weight:600;color:#f59e0b;">Verificacao profissional necessaria</p>
                <p style="margin:0 0 12px;font-size:0.85em;color:var(--neutral-300);">Para assinar o plano profissional, voce precisa primeiro verificar seu registro (CRQ, CREA, CRBio etc.).</p>
                <button type="button" style="background:#f59e0b;color:#000;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-weight:600;width:100%;"
                        onclick="window.handleGoToProfessionalVerification()">
                    Verificar registro profissional
                </button>
            </div>`
                    : ''
            }

            <div style="display:flex;flex-direction:column;gap:12px;max-width:280px;margin:0 auto;">
                <button class="btn btn-primary" onclick="window.handleStartCheckout('stripe')"
                        ${!profStatus.isProfessional ? 'disabled' : ''}>
                    Pagar com Cartao de Credito
                </button>
                <button class="btn btn-mp" onclick="window.handleStartCheckout('mercadopago')"
                        ${!profStatus.isProfessional ? 'disabled' : ''}>
                    Pagar com Mercado Pago
                </button>
            </div>
        </div>`
        }
    </div>`;
}

// ----------------------------------------------------------------
// OVERLAY HELPER
// ----------------------------------------------------------------

function getOrCreateOverlay(id) {
    let overlay = document.getElementById(id);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'cloud-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
        document.body.appendChild(overlay);
    }
    return overlay;
}

// ----------------------------------------------------------------
// CSS INJECTION
// ----------------------------------------------------------------

function injectCloudStyles() {
    if (document.getElementById('cloud-styles')) return;
    const style = document.createElement('style');
    style.id = 'cloud-styles';
    style.textContent = `
        .cloud-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(4px);
            z-index: 10000;
            justify-content: center;
            align-items: center;
        }
        .cloud-overlay.active { display: flex; }
        .cloud-modal-content {
            background: var(--bg-primary, #1a1a2e);
            border: 1px solid var(--border-color, #333);
            border-radius: 12px;
            padding: 24px;
            max-width: 560px;
            width: 90vw;
            max-height: 80vh;
            overflow-y: auto;
            color: var(--text-primary, #e0e0e0);
        }
        .cloud-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .cloud-modal-header h3 { margin: 0; font-size: 1.2em; }
        .cloud-modal-header .btn-close {
            background: none; border: none; color: var(--text-secondary, #888);
            font-size: 1.5em; cursor: pointer; padding: 0 4px; line-height: 1;
        }
        .cloud-save-section, .cloud-share-code-section, .cloud-models-section, .cloud-footer {
            margin-bottom: 20px;
        }
        .cloud-save-section h4, .cloud-share-code-section h4, .cloud-models-section h4 { margin: 0 0 8px; font-size: 0.95em; }
        .cloud-model-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            background: var(--bg-secondary, #16213e);
            border-radius: 8px;
            margin-bottom: 8px;
        }
        .cloud-model-info { display: flex; flex-direction: column; gap: 2px; }
        .cloud-model-info strong { font-size: 0.95em; }
        .cloud-model-info small { color: var(--text-secondary, #888); font-size: 0.8em; }
        .cloud-model-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .cloud-empty { color: var(--text-secondary, #888); font-style: italic; font-size: 0.9em; }
        .cloud-footer { display: flex; gap: 8px; justify-content: center; border-top: 1px solid var(--border-color, #333); padding-top: 16px; }
        .share-row { display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--bg-secondary, #16213e); border-radius: 6px; margin-bottom: 6px; }
        .share-code { font-family: monospace; letter-spacing: 2px; color: var(--accent, #00d4ff); }
        .prof-badge { font-size: 0.8em; }
        .prof-form label { display: block; margin: 12px 0 4px; font-size: 0.9em; color: var(--text-secondary, #888); }
        .prof-form small { display: block; color: var(--text-secondary, #888); font-size: 0.8em; margin-top: 4px; }
        .input-field {
            width: 100%; padding: 8px 12px; border: 1px solid var(--border-color, #333);
            border-radius: 6px; background: var(--bg-tertiary, #0f3460); color: var(--text-primary, #e0e0e0);
            font-size: 0.9em; box-sizing: border-box;
        }
        .input-field:focus { outline: none; border-color: var(--accent, #00d4ff); }
        .btn-xs { padding: 4px 8px; font-size: 0.75em; }
        .btn-danger { background: #ef4444; color: #fff; }
        .btn-danger:hover { background: #dc2626; }
        .btn-secondary { background: var(--bg-tertiary, #0f3460); color: var(--text-primary, #e0e0e0); border: 1px solid var(--border-color, #333); }
        .btn-mp { background: #009EE3; color: #fff; border: none; border-radius: 6px; padding: 10px 20px; cursor: pointer; font-size: 0.9em; transition: background 0.2s; }
        .btn-mp:hover { background: #007BBF; }
        .btn-mp:disabled { background: #4a9ab8; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
}

// Inject styles on module load
injectCloudStyles();

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const cloudHandlers = {
    handleOpenCloudPanel,
    handleCloseCloudPanel,
    handleSaveToCloud,
    handleLoadFromCloud,
    handleDeleteFromCloud,
    handleShareModel,
    handleShareSubmit,
    handleLoadSharedModel,
    handleRevokeShare,
    handleCloseShareModal,
    handleOpenProfessionalModal,
    handleSubmitProfessional,
    handleCloseProfessionalModal,
    handleOpenSubscription,
    handleStartCheckout,
    handleCancelSubscription,
    handleCloseSubscriptionModal,
    handleGoToProfessionalVerification,
    handleValidateAllElements,
    handleCheckPaymentReturn,
    setCurrentCloudModelId,
};
