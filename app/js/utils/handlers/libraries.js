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

// Libraries handler V2: Marketplace-first UX with buy/sell journeys.

import {
    installLibrary,
    uninstallLibrary,
    activateLibrary,
    deactivateLibrary,
    getInstalledLibraries,
    getLibraryById,
    rateLibrary,
} from '../libraries/manager.js';
import { getLibraryDetails, getMarketplaceCatalog } from '../libraries/marketplace.js';
import { createLibraryCheckout, downloadLibraryManifest, verifyPurchases } from '../libraries/supabaseMarketplace.js';
import { openModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { escapeHtml } from '../helpers/html.js';
import { getIcon } from '../ui/icons.js';
import { isLoggedIn } from '../auth/session.js';
import { getInsuranceCatalog, calculatePremium } from '../governance/contractManager.js';
import {
    createListingDraft,
    patchListingDraft,
    recordListingConsent,
    publishListing,
    createListingVersion,
    publishListingVersion,
    searchListings,
    buyListing,
    createRfqThread,
    addRfqProposal,
    acceptRfqProposal,
    deliverOrder,
    acceptOrderDelivery,
    openOrderDispute,
    addDisputeMessage,
    fetchNotifications,
    markNotificationRead,
    fetchMarketDashboard,
    fetchAdminModerationQueue,
    moderateListing,
    fetchAdminDisputesQueue,
    resolveDispute,
    fetchWebhookDlq,
    replayWebhook,
    renewListing,
    fetchInstitutions,
    suggestInstitution,
    setListingAccess,
} from '../libraries/marketV2Client.js';
import { calculateSplit, validateInstitutionSplit, validatePayloadLimits } from '../libraries/marketV2Rules.js';

let _updateAllUI = null;
export function setLibrariesUpdateAllUI(fn) {
    _updateAllUI = fn;
}
function updateAllUI() {
    if (_updateAllUI) _updateAllUI();
}

const PREFS_KEY = 'ecbyts-market-v2-prefs';
const WIZARD_DONE_KEY = 'ecbyts-market-v2-wizard-done';
const CONSENT_TEXT =
    'Declaro que os dados enviados respeitam direitos de uso, compliance e podem ser negociados conforme regras da plataforma.';
const MARKET_MESSAGE_MAP = {
    eco1_key_required: 'Informe a chave ECO1 para continuar.',
    title_and_description_required: 'Preencha titulo e descricao para continuar.',
    payload_too_large: 'Os dados tecnicos estao muito grandes. Reduza e tente novamente.',
    invalid_payload_json: 'Os dados tecnicos estao em formato invalido. Revise o JSON.',
    main_file_required: 'Preencha os dados obrigatorios do arquivo principal.',
    fixed_price_required: 'Informe um preco fixo valido para continuar.',
    access_list_required: 'Informe ao menos um usuario permitido para visibilidade restrita.',
    institution_pct_requires_institution: 'Escolha uma instituicao para usar percentual de apoio.',
    institution_pct_out_of_range: 'O percentual de apoio deve ficar entre 1 e 50.',
    consent_required: 'Marque o consentimento para publicar o anuncio.',
    search_failed: 'Nao foi possivel carregar os anuncios agora.',
    notifications_error: 'Nao foi possivel carregar as notificacoes agora.',
    dashboard_error: 'Nao foi possivel carregar o painel agora.',
    buy_failed: 'Nao foi possivel concluir a compra agora.',
    rfq_failed: 'Nao foi possivel enviar a proposta agora.',
    publish_failed: 'Nao foi possivel publicar o anuncio agora.',
    listing_create_failed: 'Nao foi possivel criar o anuncio agora.',
    notification_update_failed: 'Nao foi possivel atualizar a notificacao agora.',
    moderation_failed: 'Nao foi possivel registrar a moderacao agora.',
    resolve_dispute_failed: 'Nao foi possivel resolver a disputa agora.',
    webhook_replay_failed: 'Nao foi possivel reenviar o webhook agora.',
    renew_failed: 'Nao foi possivel renovar o anuncio agora.',
    invalid_library_file: 'Arquivo de biblioteca invalido.',
    install_failed: 'Nao foi possivel instalar a biblioteca.',
    uninstall_failed: 'Nao foi possivel remover a biblioteca.',
    activate_failed: 'Nao foi possivel ativar a biblioteca.',
    deactivate_failed: 'Nao foi possivel desativar a biblioteca.',
    Failed_to_fetch: 'Nao foi possivel conectar ao servidor. Tente novamente.',
};

function marketMessage(message, fallback = 'Nao foi possivel concluir a acao agora.') {
    const raw = String(message || '').trim();
    const normalized = raw.replace(/^Error:\s*/i, '');
    if (!normalized) return fallback;
    const key = normalized.replace(/\s+/g, '_');
    return MARKET_MESSAGE_MAP[key] || MARKET_MESSAGE_MAP[normalized] || normalized;
}

const state = {
    tab: 'home',
    loading: false,
    search: {
        q: '',
        category: '',
        currency: 'BRL',
        mode: '',
        min_price_cents: '',
        max_price_cents: '',
        seller_min_score: '',
        page_size: 12,
    },
    searchItems: [],
    searchNextCursor: null,
    searchHasMore: false,
    wizard: {
        step: 1,
        profile: 'comprador-vendedor',
        categories: 'project,waste',
        currency: 'BRL',
        region: 'BR',
        notifications: 'in_app',
    },
    sell: freshSellDraft(),
    dashboard: null,
    notifications: [],
    notificationsNextCursor: null,
    admin: {
        moderation: [],
        versionModeration: [],
        disputes: [],
        webhooks: [],
    },
    institutions: [],
};

const MARKET_CATEGORY_OPTIONS = [
    { value: 'project', label: 'Projetos ambientais' },
    { value: 'waste', label: 'Residuos' },
    { value: 'carbon_credit', label: 'Creditos de carbono' },
    { value: 'environmental_valuation', label: 'Valoracao ambiental' },
    { value: 'library_data', label: 'Dados de biblioteca' },
];

const MARKET_MODE_OPTIONS = [
    { value: 'fixed', label: 'Preco fixo' },
    { value: 'rfq', label: 'Receber propostas' },
    { value: 'both', label: 'Preco fixo + propostas' },
];

const MARKET_VISIBILITY_LABELS = {
    public: 'Publico para todos',
    restricted: 'Somente usuarios autorizados',
};

function marketCategoryLabel(value) {
    const found = MARKET_CATEGORY_OPTIONS.find((item) => item.value === value);
    return found?.label || value || '-';
}

function marketModeLabel(value) {
    const found = MARKET_MODE_OPTIONS.find((item) => item.value === value);
    return found?.label || value || '-';
}

function marketVisibilityLabel(value) {
    return MARKET_VISIBILITY_LABELS[value] || value || '-';
}

function marketCategoriesSummary(rawValue) {
    const list = String(rawValue || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    if (list.length === 0) return 'nao definido';
    return list.map((item) => marketCategoryLabel(item)).join(', ');
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '-';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${Math.round(value)} B`;
}

function normalizeListingPreview(item) {
    const version = item?.active_version_data || {};
    return {
        preview_file_path: String(item?.preview_file_path || version.preview_file_path || '').trim(),
        preview_file_mime: String(item?.preview_file_mime || version.preview_file_mime || '')
            .trim()
            .toLowerCase(),
        preview_file_size_bytes: Number(item?.preview_file_size_bytes || version.preview_file_size_bytes || 0),
        main_file_mime: String(item?.main_file_mime || version.main_file_mime || '')
            .trim()
            .toLowerCase(),
        main_file_size_bytes: Number(item?.main_file_size_bytes || version.main_file_size_bytes || 0),
    };
}

function marketPreviewKind(mime, path) {
    const safeMime = String(mime || '').toLowerCase();
    const safePath = String(path || '').toLowerCase();
    if (safeMime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/.test(safePath)) {
        return { icon: 'image', label: 'Imagem' };
    }
    if (safeMime.includes('pdf') || safePath.endsWith('.pdf')) {
        return { icon: 'file-text', label: 'PDF' };
    }
    if (safeMime.includes('csv') || safePath.endsWith('.csv')) {
        return { icon: 'table', label: 'CSV' };
    }
    if (safeMime.includes('json') || safePath.endsWith('.json')) {
        return { icon: 'braces', label: 'JSON' };
    }
    if (safeMime.includes('zip') || safePath.endsWith('.zip')) {
        return { icon: 'package', label: 'ZIP' };
    }
    return { icon: 'file-text', label: 'Arquivo' };
}

function marketImagePreviewSrc(path, mime) {
    const safePath = String(path || '').trim();
    const safeMime = String(mime || '').toLowerCase();
    if (!safePath) return '';
    if (/^data:image\//i.test(safePath)) return safePath;
    if (!/^https?:\/\//i.test(safePath)) return '';
    if (safeMime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(safePath)) return safePath;
    return '';
}

function renderListingPreview(preview, options = {}) {
    const title = String(options.title || 'Preview do recurso').trim();
    const path = String(preview?.preview_file_path || '').trim();
    const previewMime = String(preview?.preview_file_mime || '')
        .trim()
        .toLowerCase();
    const mainMime = String(preview?.main_file_mime || '')
        .trim()
        .toLowerCase();
    const mime = previewMime || mainMime;
    const size = Number(preview?.preview_file_size_bytes || preview?.main_file_size_bytes || 0);
    const hasAny = Boolean(path || mime || size);
    const showEmpty = Boolean(options.showEmpty);

    if (!hasAny && !showEmpty) return '';

    const kind = marketPreviewKind(mime, path);
    const src = marketImagePreviewSrc(path, mime);
    const sizeText = formatBytes(size);
    const pathText = path || String(options.emptyText || 'Sem preview cadastrado');
    const details = [kind.label];
    if (mime) details.push(mime);
    if (sizeText !== '-') details.push(sizeText);

    return `
        <div class="marketv2-product-preview">
            <div class="marketv2-product-preview-thumb ${src ? '' : 'placeholder'}">
                ${
                    src
                        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer">`
                        : getIcon(kind.icon, { size: '18px' })
                }
            </div>
            <div class="marketv2-product-preview-info">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(details.join(' • '))}</span>
                <code title="${escapeHtml(pathText)}">${escapeHtml(pathText)}</code>
            </div>
        </div>
    `;
}

function freshSellDraft() {
    return {
        step: 1,
        listingId: null,
        eco1_key: '',
        asset_category: 'project',
        title: '',
        description: '',
        payloadText: '{\n  "summary": ""\n}',
        payload_hash: '',
        main_file_path: '',
        main_file_mime: 'application/json',
        main_file_size_bytes: '',
        preview_file_path: '',
        preview_file_mime: 'application/pdf',
        preview_file_size_bytes: '',
        checksum_sha256: '',
        mode: 'fixed',
        currency: 'BRL',
        fixed_price_cents: 1000,
        visibility: 'public',
        access_user_ids: '',
        institution_id: '',
        institution_pct: 0,
        institution_suggestion_name: '',
        institution_suggestion_url: '',
        institution_suggestion_note: '',
        consent_checked: false,
    };
}

function getPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    } catch {
        return {};
    }
}

function setPrefs(next) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next || {}));
}

function wizardDone() {
    return localStorage.getItem(WIZARD_DONE_KEY) === '1';
}

function setWizardDone(done) {
    localStorage.setItem(WIZARD_DONE_KEY, done ? '1' : '0');
}

function modalBody() {
    return document.getElementById('library-modal-body');
}

function modalWrap(content) {
    return `${renderTabHeader()}<div class="marketv2-content">${content}</div>`;
}

function renderTabHeader() {
    const tabs = [
        { id: 'home', icon: 'home', label: 'Inicio' },
        { id: 'modules', icon: 'package', label: 'Módulos' },
        { id: 'buy', icon: 'shopping-bag', label: 'Comprar' },
        { id: 'sell', icon: 'upload', label: 'Vender' },
        { id: 'services', icon: 'clipboard', label: 'Servicos' },
        { id: 'dashboard', icon: 'bar-chart', label: 'Painel' },
        { id: 'notifications', icon: 'bell', label: 'Notificacoes' },
        { id: 'admin', icon: 'shield', label: 'Admin' },
    ];

    return `
        <div class="marketv2-tabs">
            ${tabs
                .map(
                    (tb) => `
                <button class="marketv2-tab ${state.tab === tb.id ? 'active' : ''}" onclick="handleLibraryTabSwitch('${tb.id}')">
                    ${getIcon(tb.icon, { size: '13px' })} ${tb.label}
                </button>
            `,
                )
                .join('')}
        </div>
    `;
}

async function rerender() {
    const body = modalBody();
    if (!body) return;

    if (state.tab === 'modules') {
        await renderModulesTab();
        return;
    }

    if (state.tab === 'home') {
        body.innerHTML = modalWrap(renderHome());
        return;
    }

    if (state.tab === 'wizard') {
        body.innerHTML = modalWrap(renderWizard());
        return;
    }

    if (state.tab === 'buy') {
        body.innerHTML = modalWrap(renderBuy());
        return;
    }

    if (state.tab === 'sell') {
        if (!state.institutions.length) {
            try {
                state.institutions = await fetchInstitutions();
            } catch {}
        }
        body.innerHTML = modalWrap(renderSell());
        return;
    }

    if (state.tab === 'services') {
        body.innerHTML = modalWrap(renderServicesTab());
        // Async load products after rendering skeleton
        _loadServiceProducts();
        return;
    }

    if (state.tab === 'dashboard') {
        body.innerHTML = modalWrap('<div class="marketv2-loading">Carregando dashboard...</div>');
        try {
            state.dashboard = await fetchMarketDashboard();
        } catch (err) {
            state.dashboard = { error: err?.message || 'dashboard_error' };
        }
        body.innerHTML = modalWrap(renderDashboard());
        return;
    }

    if (state.tab === 'notifications') {
        body.innerHTML = modalWrap('<div class="marketv2-loading">Carregando notificacoes...</div>');
        await loadNotifications(true);
        body.innerHTML = modalWrap(renderNotifications());
        return;
    }

    if (state.tab === 'admin') {
        body.innerHTML = modalWrap('<div class="marketv2-loading">Carregando filas admin...</div>');
        await loadAdminQueues();
        body.innerHTML = modalWrap(renderAdmin());
        return;
    }
}

// ── Módulos — catálogo de biblioteca com compra e download ──────────────────

/**
 * Carrega e renderiza o catálogo de módulos de biblioteca disponíveis.
 * Mostra botão "Instalar" (gratuito), "Comprar" (pago + não-possuído)
 * ou "Baixar" (pago + já comprado).
 */
async function renderModulesTab() {
    const body = modalBody();
    if (!body) return;
    body.innerHTML = modalWrap('<div class="marketv2-loading">&#8635; Carregando módulos...</div>');

    let items = [];
    let isOffline = false;
    try {
        const result = await getMarketplaceCatalog();
        items = result.items || [];
        isOffline = !!result.isOffline;
    } catch {
        isOffline = true;
    }

    // Verificação bulk de ownership para bibliotecas pagas
    const paidItems = items.filter((it) => it.is_paid && it.id);
    const ownedIds = new Set();
    if (paidItems.length && isLoggedIn()) {
        try {
            const notOwned = await verifyPurchases(paidItems.map((i) => i.id));
            const notOwnedSet = new Set(notOwned);
            paidItems.forEach((i) => {
                if (!notOwnedSet.has(i.id)) ownedIds.add(i.id);
            });
        } catch {}
    }

    const cards = items.map((item) => _renderModuleCard(item, ownedIds)).join('');
    const offlineBanner = isOffline
        ? '<div class="marketv2-alert">Modo offline — mostrando módulos integrados</div>'
        : '';

    body.innerHTML = modalWrap(`
        ${offlineBanner}
        <div class="marketv2-modules-grid">
            ${cards || '<p class="marketv2-empty">Nenhum módulo disponível.</p>'}
        </div>
    `);
}

/**
 * Renderiza card de um item do catálogo com botão de ação adequado.
 * @param {object} item — item do catálogo (campos: id, library_id, name, is_paid, price_cents…)
 * @param {Set<string>} ownedIds — UUIDs de bibliotecas já compradas pelo usuário
 * @returns {string} HTML do card
 */
function _renderModuleCard(item, ownedIds) {
    const installed = getInstalledLibraries().some((l) => l.manifest?.id === item.library_id);
    const isPaid = !!(item.is_paid && item.id);
    const owned = isPaid && ownedIds.has(item.id);

    let actionBtn;
    if (installed) {
        actionBtn = `<button class="marketv2-ghost" onclick="handleUninstallLibrary('${escapeHtml(item.library_id)}')">Remover</button>`;
    } else if (!isPaid) {
        actionBtn = `<button class="marketv2-primary" onclick="handleInstallLibrary('${escapeHtml(item.library_id)}')">&#43; Instalar</button>`;
    } else if (owned) {
        actionBtn = `<button class="marketv2-primary" onclick="handleDownloadPurchasedLibrary('${escapeHtml(item.id)}','${escapeHtml(item.library_id)}')">&#8659; Baixar</button>`;
    } else {
        const price = item.price_cents ? ` R$ ${(item.price_cents / 100).toFixed(2).replace('.', ',')}` : '';
        actionBtn = `<button class="marketv2-primary" onclick="handleBuyLibrary('${escapeHtml(item.id)}')">&#128722; Comprar${escapeHtml(price)}</button>`;
    }

    const rating = item.avg_rating_overall ? `&#9733; ${Number(item.avg_rating_overall).toFixed(1)}` : '';
    const installedBadge = installed ? '<span class="marketv2-badge installed">Instalado</span>' : '';
    const paidBadge = isPaid && !installed ? '<span class="marketv2-badge paid">Pago</span>' : '';

    return `
        <article class="marketv2-module-card">
            <header class="marketv2-module-header">
                <span class="marketv2-module-icon">${getIcon(item.icon || 'package', { size: '18px' })}</span>
                <div class="marketv2-module-title">
                    <strong>${escapeHtml(item.name || item.library_id)}</strong>
                    ${installedBadge}${paidBadge}
                </div>
            </header>
            <p class="marketv2-module-desc">${escapeHtml(item.description || '')}</p>
            <footer class="marketv2-module-footer">
                <span class="marketv2-module-meta">
                    ${rating ? `<span>${rating}</span>` : ''}
                    <span>v${escapeHtml(item.version || '1.0.0')}</span>
                </span>
                ${actionBtn}
            </footer>
        </article>
    `;
}

function renderHome() {
    const prefs = getPrefs();
    const wizardBanner = wizardDone()
        ? `<button class="marketv2-ghost" onclick="handleMarketOpenWizard()">Reconfigurar wizard</button>`
        : `<button class="marketv2-primary" onclick="handleMarketOpenWizard()">Iniciar wizard</button>`;

    return `
        <section class="marketv2-hero">
            <div class="marketv2-hero-copy">
                <h2>Marketplace Ambiental</h2>
                <p>Compre, venda e negocie projetos, residuos, creditos de carbono e ativos com chave ECO1.</p>
                <div class="marketv2-cta-row">
                    <button class="marketv2-primary" onclick="handleLibraryTabSwitch('buy')">${getIcon('shopping-bag', { size: '14px' })} Comprar</button>
                    <button class="marketv2-primary alt" onclick="handleLibraryTabSwitch('sell')">${getIcon('upload', { size: '14px' })} Vender</button>
                    ${wizardBanner}
                </div>
            </div>
            <div class="marketv2-hero-metrics">
                <div><strong>Moedas aceitas</strong><span>BRL, USD, EUR</span></div>
                <div><strong>Duracao do anuncio</strong><span>90 dias + 3 renovacoes</span></div>
                <div><strong>Link de download seguro</strong><span>Valido por 15 min e ate 3 downloads</span></div>
            </div>
        </section>

        <section class="marketv2-prefbar">
            <strong>Preferencias atuais:</strong>
            <span>Perfil: ${escapeHtml(prefs.profile || 'nao definido')}</span>
            <span>Categorias: ${escapeHtml(marketCategoriesSummary(prefs.categories || ''))}</span>
            <span>Moeda: ${escapeHtml(prefs.currency || 'BRL')}</span>
            <span>Regiao: ${escapeHtml(prefs.region || 'BR')}</span>
        </section>

        <section class="marketv2-cards">
            <article>
                <h3>${getIcon('target', { size: '14px' })} Jornada de compra</h3>
                <p>Filtros salvos, proposta e contraproposta, e fechamento da compra em um fluxo simples.</p>
                <button class="marketv2-ghost" onclick="handleLibraryTabSwitch('buy')">Abrir busca</button>
            </article>
            <article>
                <h3>${getIcon('trending-up', { size: '14px' })} Jornada de venda</h3>
                <p>Cadastro guiado em 7 passos com consentimento e apoio opcional para instituicoes.</p>
                <button class="marketv2-ghost" onclick="handleLibraryTabSwitch('sell')">Criar anuncio</button>
            </article>
            <article>
                <h3>${getIcon('trophy', { size: '14px' })} Reputacao e conquistas</h3>
                <p>Reputacao atualizada com o tempo, metas semanais e conquistas para destacar bons vendedores.</p>
                <button class="marketv2-ghost" onclick="handleLibraryTabSwitch('dashboard')">Ver reputacao</button>
            </article>
        </section>
    `;
}
function renderWizard() {
    const s = state.wizard;
    const step = s.step;
    return `
        <section class="marketv2-wizard">
            <header>
                <h3>Wizard inicial (${step}/4)</h3>
                <p>Defina interesses para acelerar compra e venda.</p>
            </header>
            ${
                step === 1
                    ? `
                <div class="marketv2-form-grid">
                    <label>Perfil
                        <select id="wizard-profile">
                            <option value="comprador-vendedor" ${s.profile === 'comprador-vendedor' ? 'selected' : ''}>Comprador + Vendedor</option>
                            <option value="comprador" ${s.profile === 'comprador' ? 'selected' : ''}>Somente comprador</option>
                            <option value="vendedor" ${s.profile === 'vendedor' ? 'selected' : ''}>Somente vendedor</option>
                        </select>
                    </label>
                </div>
            `
                    : ''
            }
            ${
                step === 2
                    ? `
                <div class="marketv2-form-grid">
                    <label>Categorias (csv)
                        <input id="wizard-categories" value="${escapeHtml(s.categories)}" placeholder="project,waste,carbon_credit">
                    </label>
                </div>
            `
                    : ''
            }
            ${
                step === 3
                    ? `
                <div class="marketv2-form-grid">
                    <label>Regiao
                        <input id="wizard-region" value="${escapeHtml(s.region)}" placeholder="BR">
                    </label>
                    <label>Moeda
                        <select id="wizard-currency">
                            ${['BRL', 'USD', 'EUR'].map((c) => `<option value="${c}" ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </label>
                </div>
            `
                    : ''
            }
            ${
                step === 4
                    ? `
                <div class="marketv2-form-grid">
                    <label>Notificacoes
                        <select id="wizard-notifications">
                            <option value="in_app" ${s.notifications === 'in_app' ? 'selected' : ''}>In-app</option>
                            <option value="in_app_email" ${s.notifications === 'in_app_email' ? 'selected' : ''}>In-app + Email</option>
                            <option value="email" ${s.notifications === 'email' ? 'selected' : ''}>Email</option>
                        </select>
                    </label>
                </div>
            `
                    : ''
            }

            <footer class="marketv2-stepper-actions">
                <button class="marketv2-ghost" onclick="handleMarketWizardBack()" ${step === 1 ? 'disabled' : ''}>Voltar</button>
                ${
                    step < 4
                        ? `<button class="marketv2-primary" onclick="handleMarketWizardNext()">Proximo</button>`
                        : `<button class="marketv2-primary" onclick="handleMarketWizardFinish()">Concluir</button>`
                }
            </footer>
        </section>
    `;
}

function renderBuy() {
    return `
        <section class="marketv2-filters">
            <label>Busca<input id="market-filter-q" value="${escapeHtml(state.search.q)}" placeholder="projeto, credito, residuo"></label>
            <label>Categoria
                <select id="market-filter-category">
                    <option value="">Todas</option>
                    ${MARKET_CATEGORY_OPTIONS.map(
                        (c) =>
                            `<option value="${c.value}" ${state.search.category === c.value ? 'selected' : ''}>${c.label}</option>`,
                    ).join('')}
                </select>
            </label>
            <label>Tipo de negociacao
                <select id="market-filter-mode">
                    <option value="">Todos</option>
                    ${MARKET_MODE_OPTIONS.map((m) => `<option value="${m.value}" ${state.search.mode === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
                </select>
            </label>
            <label>Moeda
                <select id="market-filter-currency">
                    ${['BRL', 'USD', 'EUR'].map((c) => `<option value="${c}" ${state.search.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </label>
            <label>Preco minimo (em centavos)<input id="market-filter-min" type="number" value="${escapeHtml(String(state.search.min_price_cents || ''))}"></label>
            <label>Preco maximo (em centavos)<input id="market-filter-max" type="number" value="${escapeHtml(String(state.search.max_price_cents || ''))}"></label>
            <label>Reputacao minima do vendedor<input id="market-filter-score" type="number" min="0" max="100" value="${escapeHtml(String(state.search.seller_min_score || ''))}"></label>
            <div class="marketv2-filter-actions">
                <button class="marketv2-primary" onclick="handleMarketSearch(true)">${getIcon('search', { size: '13px' })} Buscar</button>
                <button class="marketv2-ghost" onclick="handleMarketResetFilters()">Resetar</button>
            </div>
        </section>

        <section id="market-results" class="marketv2-results">
            ${
                state.searchItems.length === 0
                    ? '<p class="marketv2-empty">Nenhum resultado ainda. Clique em Buscar.</p>'
                    : state.searchItems.map((item) => renderListingCard(item)).join('')
            }
        </section>

        ${state.searchHasMore ? `<div class="marketv2-load-more"><button class="marketv2-ghost" onclick="handleMarketSearch(false)">Carregar mais</button></div>` : ''}
    `;
}

function renderListingCard(item) {
    const rep = item.seller_reputation || { score: 50, level: 'Seed' };
    const canBuy = ['fixed', 'both'].includes(item.mode);
    const canRfq = ['rfq', 'both'].includes(item.mode);
    const fixedPrice = Number(item.fixed_price_cents || 0);
    const preview = normalizeListingPreview(item);
    const previewHtml = renderListingPreview(preview, { title: item.title || 'Preview do recurso' });
    return `
        <article class="marketv2-card">
            <header>
                <h4>${escapeHtml(item.title || 'Sem titulo')}</h4>
                <span class="marketv2-pill">${escapeHtml(marketCategoryLabel(item.asset_category || 'project'))}</span>
            </header>
            ${previewHtml}
            <p>${escapeHtml(item.description || '')}</p>
            <div class="marketv2-meta">
                <span>${getIcon('key-round', { size: '12px' })} ECO1: ${escapeHtml(item.eco1_key || '-')}</span>
                <span>${getIcon('coins', { size: '12px' })} ${escapeHtml(item.currency || 'BRL')} ${fixedPrice / 100}</span>
                <span>${getIcon('lock', { size: '12px' })} ${marketVisibilityLabel(item.visibility)}</span>
                <span>${getIcon('award', { size: '12px' })} Reputacao ${Number(rep.score || 50).toFixed(1)} (${escapeHtml(rep.level || 'Seed')})</span>
            </div>
            ${canBuy && fixedPrice > 0 ? _renderInsuranceAddon(item.id, fixedPrice, item.currency || 'BRL') : ''}
            <footer>
                ${canBuy && fixedPrice > 0 ? `<button class="marketv2-ghost" onclick="handleToggleInsurance('${item.id}')">&#9741; ${t('insuranceOptions') || 'Insurance Options'}</button>` : ''}
                ${canBuy ? `<button class="marketv2-primary" onclick="handleMarketBuyListing('${item.id}')">Comprar</button>` : ''}
                ${canRfq ? `<button class="marketv2-ghost" onclick="handleMarketOpenRfqPrompt('${item.id}', '${escapeHtml(item.currency || 'BRL')}')">Pedir proposta</button>` : ''}
                <button class="marketv2-ghost" onclick="handleMarketCopyListingId('${item.id}')">Copiar codigo</button>
            </footer>
        </article>
    `;
}

function renderSell() {
    const s = state.sell;
    const split = calculateSplit(s.fixed_price_cents, s.institution_pct || 0, 12);
    const step = s.step;

    return `
        <section class="marketv2-sell">
            <header>
                <h3>Fluxo de venda (${step}/7)</h3>
                <p>Itens com chave ECO1 podem ser vendidos ou enviados para proposta.</p>
            </header>

            ${step === 1 ? renderSellStepType(s) : ''}
            ${step === 2 ? renderSellStepDetails(s) : ''}
            ${step === 3 ? renderSellStepFiles(s) : ''}
            ${step === 4 ? renderSellStepPricing(s) : ''}
            ${step === 5 ? renderSellStepVisibility(s) : ''}
            ${step === 6 ? renderSellStepInstitution(s, split) : ''}
            ${step === 7 ? renderSellStepConsent(s, split) : ''}

            <footer class="marketv2-stepper-actions">
                <button class="marketv2-ghost" onclick="handleMarketSellBack()" ${step === 1 ? 'disabled' : ''}>Voltar</button>
                ${
                    step < 7
                        ? `<button class="marketv2-primary" onclick="handleMarketSellNext()">Proximo</button>`
                        : `<button class="marketv2-primary" onclick="handleMarketPublishListing()">Publicar anuncio</button>`
                }
            </footer>
        </section>
    `;
}

function renderSellStepType(s) {
    return `
        <div class="marketv2-form-grid">
            <label>Categoria
                <select id="sell-asset-category">
                    ${MARKET_CATEGORY_OPTIONS.map(
                        (c) =>
                            `<option value="${c.value}" ${s.asset_category === c.value ? 'selected' : ''}>${c.label}</option>`,
                    ).join('')}
                </select>
            </label>
            <label>Chave ECO1
                <input id="sell-eco1-key" value="${escapeHtml(s.eco1_key)}" placeholder="eco1-..." required>
            </label>
        </div>
    `;
}

function renderSellStepDetails(s) {
    return `
        <div class="marketv2-form-grid">
            <label>Titulo
                <input id="sell-title" value="${escapeHtml(s.title)}" maxlength="160">
            </label>
            <label>Descricao
                <textarea id="sell-description" rows="4" maxlength="5000">${escapeHtml(s.description)}</textarea>
            </label>
            <label>Dados tecnicos (JSON, max 64KB)
                <textarea id="sell-payload" rows="8">${escapeHtml(s.payloadText)}</textarea>
            </label>
        </div>
    `;
}

function renderSellStepFiles(s) {
    const preview = normalizeListingPreview({
        preview_file_path: s.preview_file_path,
        preview_file_mime: s.preview_file_mime,
        preview_file_size_bytes: s.preview_file_size_bytes,
        main_file_mime: s.main_file_mime,
        main_file_size_bytes: s.main_file_size_bytes,
    });
    return `
        <div class="marketv2-form-grid">
            <label>Caminho do arquivo principal<input id="sell-main-path" value="${escapeHtml(s.main_file_path)}" placeholder="market/listing/file.json"></label>
            <label>Tipo do arquivo principal
                <select id="sell-main-mime">
                    ${['application/json', 'text/csv', 'application/zip', 'application/pdf'].map((m) => `<option value="${m}" ${s.main_file_mime === m ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
            </label>
            <label>Tamanho do arquivo principal (bytes)<input id="sell-main-size" type="number" value="${escapeHtml(String(s.main_file_size_bytes || ''))}"></label>
            <label>Codigo de seguranca do arquivo (SHA-256)<input id="sell-checksum" value="${escapeHtml(s.checksum_sha256)}" maxlength="64"></label>
            <label>Caminho do arquivo de visualizacao<input id="sell-preview-path" value="${escapeHtml(s.preview_file_path)}"></label>
            <label>Tipo do arquivo de visualizacao
                <select id="sell-preview-mime">
                    ${['application/json', 'text/csv', 'application/zip', 'application/pdf'].map((m) => `<option value="${m}" ${s.preview_file_mime === m ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
            </label>
            <label>Tamanho da visualizacao (bytes)<input id="sell-preview-size" type="number" value="${escapeHtml(String(s.preview_file_size_bytes || ''))}"></label>
        </div>
        <div class="marketv2-inline-preview">
            <h4>${getIcon('image', { size: '14px' })} Preview para compradores</h4>
            ${renderListingPreview(preview, {
                title: s.title || 'Anuncio em preparacao',
                showEmpty: true,
                emptyText: 'Preencha caminho, tipo e tamanho da visualizacao para exibir o preview.',
            })}
        </div>
    `;
}

function renderSellStepPricing(s) {
    return `
        <div class="marketv2-form-grid">
            <label>Tipo de negociacao
                <select id="sell-mode">
                    ${MARKET_MODE_OPTIONS.map((m) => `<option value="${m.value}" ${s.mode === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
                </select>
            </label>
            <label>Moeda
                <select id="sell-currency">
                    ${['BRL', 'USD', 'EUR'].map((c) => `<option value="${c}" ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </label>
            <label>Preco fixo (em centavos)
                <input id="sell-fixed-price" type="number" value="${escapeHtml(String(s.fixed_price_cents || 0))}">
            </label>
        </div>
    `;
}
function renderSellStepVisibility(s) {
    return `
        <div class="marketv2-form-grid">
            <label>Visibilidade
                <select id="sell-visibility">
                    <option value="public" ${s.visibility === 'public' ? 'selected' : ''}>Publico para todos</option>
                    <option value="restricted" ${s.visibility === 'restricted' ? 'selected' : ''}>Somente usuarios autorizados</option>
                </select>
            </label>
            <label>Usuarios permitidos (separe por virgula)
                <textarea id="sell-access-users" rows="4" placeholder="uuid1,uuid2">${escapeHtml(s.access_user_ids)}</textarea>
            </label>
        </div>
    `;
}

function renderSellStepInstitution(s, split) {
    return `
        <div class="marketv2-form-grid">
            <label>Instituicao parceira
                <select id="sell-institution-id">
                    <option value="">Sem instituicao</option>
                    ${state.institutions.map((i) => `<option value="${i.id}" ${s.institution_id === i.id ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
                </select>
            </label>
            <label>Percentual para instituicao (1-50)
                <input id="sell-institution-pct" type="number" min="0" max="50" value="${escapeHtml(String(s.institution_pct || 0))}">
            </label>
            <div class="marketv2-split-preview">
                <span>Instituicao: ${split.institution_amount_cents}</span>
                <span>Plataforma: ${split.platform_fee_cents}</span>
                <span>Liquido vendedor: ${split.seller_net_cents}</span>
            </div>
            <label>Sugerir nova instituicao (nome)
                <input id="sell-suggest-name" value="${escapeHtml(s.institution_suggestion_name)}" placeholder="Nome da ONG/instituicao">
            </label>
            <label>Website<input id="sell-suggest-url" value="${escapeHtml(s.institution_suggestion_url)}"></label>
            <label>Observacao<textarea id="sell-suggest-note" rows="3">${escapeHtml(s.institution_suggestion_note)}</textarea></label>
        </div>
    `;
}

function renderSellStepConsent(s, split) {
    return `
        <div class="marketv2-consent">
            <h4>Tela de consentimento</h4>
            <p>${escapeHtml(CONSENT_TEXT)}</p>
            <label class="marketv2-checkbox-row">
                <input id="sell-consent" type="checkbox" ${s.consent_checked ? 'checked' : ''}>
                Concordo que os dados serao enviados para compra/venda/cotacao.
            </label>
            <ul>
                <li>Categoria: ${escapeHtml(marketCategoryLabel(s.asset_category))}</li>
                <li>ECO1: ${escapeHtml(s.eco1_key || '-')}</li>
                <li>Tipo de negociacao: ${escapeHtml(marketModeLabel(s.mode))}</li>
                <li>Preco (centavos): ${escapeHtml(String(s.fixed_price_cents || 0))}</li>
                <li>Visibilidade: ${escapeHtml(marketVisibilityLabel(s.visibility))}</li>
                <li>Apoio para instituicao: ${escapeHtml(String(s.institution_pct || 0))}%</li>
                <li>Distribuicao vendedor/plataforma/instituicao: ${split.seller_net_cents}/${split.platform_fee_cents}/${split.institution_amount_cents}</li>
            </ul>
        </div>
    `;
}

async function _loadServiceProducts() {
    const listEl = document.getElementById('services-product-list');
    if (!listEl) return;

    try {
        const { getSupabaseClient } = await import('../auth/session.js');
        const supabase = getSupabaseClient();
        if (!supabase) {
            listEl.innerHTML =
                '<div style="text-align:center;color:var(--neutral-400);padding:20px;font-size:13px;">Faca login para gerenciar servicos.</div>';
            return;
        }

        const {
            data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
            listEl.innerHTML =
                '<div style="text-align:center;color:var(--neutral-400);padding:20px;font-size:13px;">Sessao expirada. Faca login novamente.</div>';
            return;
        }

        const url = `${supabase.supabaseUrl}/functions/v1/service-products?mine=true`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
                apikey: supabase.supabaseKey,
            },
        });
        const json = await res.json();

        if (!res.ok || !json.products) {
            listEl.innerHTML =
                '<div style="text-align:center;color:var(--neutral-400);padding:20px;font-size:13px;">Erro ao carregar servicos.</div>';
            return;
        }

        if (json.products.length === 0) {
            listEl.innerHTML =
                '<div style="text-align:center;color:var(--neutral-400);padding:20px;font-size:13px;">Nenhum servico criado ainda. Clique em "+ Novo Servico" para comecar.</div>';
            return;
        }

        const statusColors = { draft: '#94a3b8', published: '#22c55e', archived: '#f59e0b', deleted: '#ef4444' };
        const statusLabels = { draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado', deleted: 'Removido' };

        listEl.innerHTML = json.products
            .map(
                (p) => `
            <div style="padding:12px;border:1px solid var(--neutral-200);border-radius:var(--radius-sm);background:var(--neutral-50);display:flex;align-items:center;gap:12px;">
                <div style="flex:1;">
                    <div style="font-size:14px;font-weight:500;">${escapeHtml(p.name)}</div>
                    <div style="font-size:12px;color:var(--neutral-500);margin-top:2px;">
                        ${escapeHtml(p.category)} &#183;
                        <span style="color:${statusColors[p.status] || '#94a3b8'};">&#9679; ${statusLabels[p.status] || p.status}</span>
                        ${p.version ? ' &#183; v' + escapeHtml(p.version) : ''}
                    </div>
                </div>
                <button class="btn btn-secondary" style="font-size:11px;" onclick="handleEditProductWizard('${p.id}')">
                    Editar
                </button>
            </div>
        `,
            )
            .join('');
    } catch (err) {
        console.error('[ecbyts] Failed to load service products:', err);
        listEl.innerHTML =
            '<div style="text-align:center;color:#dc2626;padding:20px;font-size:13px;">Erro: ' +
            escapeHtml(err.message) +
            '</div>';
    }
}

function renderServicesTab() {
    return `
        <div style="padding:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                <h3 style="margin:0;font-size:15px;">Servicos Produtizados</h3>
                <button class="btn btn-primary" style="font-size:12px;" onclick="handleOpenProductWizard()">
                    &#10010; Novo Servico
                </button>
            </div>
            <div style="padding:10px 12px;background:var(--neutral-100);border-radius:var(--radius-sm);font-size:12px;color:var(--neutral-600);margin-bottom:16px;">
                &#9432; Os documentos gerados sao propostas de escopo e termos sugeridos. Requerem revisao juridica para validade contratual.
            </div>
            <div id="services-product-list" style="display:flex;flex-direction:column;gap:8px;">
                <div style="text-align:center;color:var(--neutral-400);padding:20px;font-size:13px;">
                    Carregando servicos...
                </div>
            </div>
        </div>
    `;
}

function renderDashboard() {
    if (state.dashboard?.error) {
        return `<p class="marketv2-empty">Erro ao carregar painel: ${escapeHtml(marketMessage(state.dashboard.error, 'Nao foi possivel carregar o painel.'))}</p>`;
    }
    const rep = state.dashboard?.reputation || { score: 50, level: 'Seed' };
    const listings = state.dashboard?.listings || [];
    const openOrders = state.dashboard?.open_orders || [];

    return `
        <section class="marketv2-dash-grid">
            <article>
                <h3>${getIcon('trophy', { size: '14px' })} Reputacao</h3>
                <p class="marketv2-score">${Number(rep.score || 50).toFixed(1)} - ${escapeHtml(rep.level || 'Seed')}</p>
                <p>A reputacao considera mais os resultados recentes dos ultimos 90 dias.</p>
            </article>
            <article>
                <h3>${getIcon('list', { size: '14px' })} Anuncios recentes</h3>
                ${listings.length ? listings.map((l) => `<div class="marketv2-row"><span>${escapeHtml(l.title || '')}</span><span>${escapeHtml(l.status || '')}</span></div>`).join('') : '<p>Nenhum anuncio.</p>'}
            </article>
            <article>
                <h3>${getIcon('shopping-bag', { size: '14px' })} Ordens abertas</h3>
                ${openOrders.length ? openOrders.map((o) => `<div class="marketv2-row"><span>${escapeHtml(o.id)}</span><span>${escapeHtml(o.status)}</span></div>`).join('') : '<p>Nenhuma ordem ativa.</p>'}
            </article>
            <article>
                <h3>${getIcon('bell', { size: '14px' })} Notificacoes</h3>
                <p>Nao lidas: ${Number(state.dashboard?.unread_notifications || 0)}</p>
                <button class="marketv2-ghost" onclick="handleLibraryTabSwitch('notifications')">Abrir centro</button>
            </article>
        </section>
    `;
}

function renderNotifications() {
    return `
        <section class="marketv2-notifications">
            <div class="marketv2-filter-actions">
                <button class="marketv2-ghost" onclick="handleMarketRefreshNotifications()">Atualizar</button>
            </div>
            ${state.notifications.length === 0 ? '<p class="marketv2-empty">Sem notificacoes.</p>' : ''}
            ${state.notifications
                .map(
                    (n) => `
                <article class="marketv2-notification ${n.is_read ? '' : 'unread'}">
                    <header>
                        <strong>${escapeHtml(n.title || n.type || 'Notificacao')}</strong>
                        <span>${escapeHtml(String(n.priority || 'medium'))}</span>
                    </header>
                    <p>${escapeHtml(n.body || '')}</p>
                    <footer>
                        <small>${escapeHtml(String(n.created_at || ''))}</small>
                        ${n.is_read ? '' : `<button class="marketv2-ghost" onclick="handleMarketMarkNotificationRead('${n.id}')">Marcar lida</button>`}
                    </footer>
                </article>
            `,
                )
                .join('')}
            ${state.notificationsNextCursor ? '<button class="marketv2-ghost" onclick="handleMarketLoadMoreNotifications()">Carregar mais</button>' : ''}
        </section>
    `;
}

function renderAdmin() {
    const hasAny =
        state.admin.moderation.length ||
        state.admin.versionModeration.length ||
        state.admin.disputes.length ||
        state.admin.webhooks.length;
    return `
        <section class="marketv2-admin">
            <div class="marketv2-filter-actions">
                <button class="marketv2-ghost" onclick="handleMarketRefreshAdmin()">Atualizar filas</button>
            </div>
            ${!hasAny ? '<p class="marketv2-empty">Sem itens admin pendentes ou acesso negado.</p>' : ''}

            <h4>Moderacao de anuncios</h4>
            ${state.admin.moderation
                .map(
                    (l) => `
                <div class="marketv2-admin-row">
                    <span>${escapeHtml(l.title || '')}</span>
                    <span>${escapeHtml(l.status || '')}</span>
                    <button class="marketv2-ghost" onclick="handleMarketAdminModerate('${l.id}','approve')">Aprovar</button>
                    <button class="marketv2-ghost" onclick="handleMarketAdminModerate('${l.id}','reject')">Rejeitar</button>
                    <button class="marketv2-ghost" onclick="handleMarketAdminModerate('${l.id}','auto_hold')">Auto-hold</button>
                </div>
            `,
                )
                .join('')}

            <h4>Disputas abertas</h4>
            ${state.admin.disputes
                .map(
                    (d) => `
                <div class="marketv2-admin-row">
                    <span>${escapeHtml(d.id)}</span>
                    <span>${escapeHtml(d.status)}</span>
                    <button class="marketv2-ghost" onclick="handleMarketAdminResolveDispute('${d.id}','seller_won')">Seller won</button>
                    <button class="marketv2-ghost" onclick="handleMarketAdminResolveDispute('${d.id}','buyer_won')">Buyer won</button>
                    <button class="marketv2-ghost" onclick="handleMarketAdminResolveDispute('${d.id}','partial_refund')">Partial refund</button>
                </div>
            `,
                )
                .join('')}

            <h4>DLQ webhooks</h4>
            ${state.admin.webhooks
                .map(
                    (w) => `
                <div class="marketv2-admin-row">
                    <span>${escapeHtml(w.provider_event_id || w.id)}</span>
                    <span>${escapeHtml(w.status)}</span>
                    <button class="marketv2-ghost" onclick="handleMarketAdminReplayWebhook('${w.id}')">Replay</button>
                </div>
            `,
                )
                .join('')}
        </section>
    `;
}

async function loadNotifications(reset = false) {
    try {
        const params = { page_size: 20 };
        if (!reset && state.notificationsNextCursor) params.cursor = state.notificationsNextCursor;
        const res = await fetchNotifications(params);
        state.notifications = reset ? res.items || [] : [...state.notifications, ...(res.items || [])];
        state.notificationsNextCursor = res.next_cursor || null;
    } catch (err) {
        showToast(marketMessage(err?.message || 'notifications_error'), 'error');
    }
}

async function loadAdminQueues() {
    state.admin = { moderation: [], versionModeration: [], disputes: [], webhooks: [] };
    try {
        const [moderation, disputes, webhooks] = await Promise.all([
            fetchAdminModerationQueue(),
            fetchAdminDisputesQueue(),
            fetchWebhookDlq(),
        ]);
        state.admin.moderation = moderation?.listings || [];
        state.admin.versionModeration = moderation?.versions || [];
        state.admin.disputes = disputes?.disputes || [];
        state.admin.webhooks = webhooks?.events || [];
    } catch {
        // likely forbidden for non-admin users
    }
}
function readWizardStepFields() {
    if (state.wizard.step === 1) {
        state.wizard.profile = document.getElementById('wizard-profile')?.value || state.wizard.profile;
    }
    if (state.wizard.step === 2) {
        state.wizard.categories = document.getElementById('wizard-categories')?.value || state.wizard.categories;
    }
    if (state.wizard.step === 3) {
        state.wizard.region = document.getElementById('wizard-region')?.value || state.wizard.region;
        state.wizard.currency = document.getElementById('wizard-currency')?.value || state.wizard.currency;
    }
    if (state.wizard.step === 4) {
        state.wizard.notifications =
            document.getElementById('wizard-notifications')?.value || state.wizard.notifications;
    }
}

function readBuyFilters() {
    state.search.q = document.getElementById('market-filter-q')?.value?.trim() || '';
    state.search.category = document.getElementById('market-filter-category')?.value || '';
    state.search.mode = document.getElementById('market-filter-mode')?.value || '';
    state.search.currency = document.getElementById('market-filter-currency')?.value || 'BRL';
    state.search.min_price_cents = document.getElementById('market-filter-min')?.value || '';
    state.search.max_price_cents = document.getElementById('market-filter-max')?.value || '';
    state.search.seller_min_score = document.getElementById('market-filter-score')?.value || '';
}

function readSellStepFields() {
    const s = state.sell;
    if (s.step === 1) {
        s.asset_category = document.getElementById('sell-asset-category')?.value || s.asset_category;
        s.eco1_key = document.getElementById('sell-eco1-key')?.value?.trim() || '';
    }
    if (s.step === 2) {
        s.title = document.getElementById('sell-title')?.value?.trim() || '';
        s.description = document.getElementById('sell-description')?.value?.trim() || '';
        s.payloadText = document.getElementById('sell-payload')?.value || s.payloadText;
    }
    if (s.step === 3) {
        s.main_file_path = document.getElementById('sell-main-path')?.value?.trim() || '';
        s.main_file_mime = document.getElementById('sell-main-mime')?.value || s.main_file_mime;
        s.main_file_size_bytes = document.getElementById('sell-main-size')?.value || '';
        s.preview_file_path = document.getElementById('sell-preview-path')?.value?.trim() || '';
        s.preview_file_mime = document.getElementById('sell-preview-mime')?.value || s.preview_file_mime;
        s.preview_file_size_bytes = document.getElementById('sell-preview-size')?.value || '';
        s.checksum_sha256 = document.getElementById('sell-checksum')?.value?.trim() || '';
    }
    if (s.step === 4) {
        s.mode = document.getElementById('sell-mode')?.value || s.mode;
        s.currency = document.getElementById('sell-currency')?.value || s.currency;
        s.fixed_price_cents = Number(document.getElementById('sell-fixed-price')?.value || 0);
    }
    if (s.step === 5) {
        s.visibility = document.getElementById('sell-visibility')?.value || s.visibility;
        s.access_user_ids = document.getElementById('sell-access-users')?.value || '';
    }
    if (s.step === 6) {
        s.institution_id = document.getElementById('sell-institution-id')?.value || '';
        s.institution_pct = Number(document.getElementById('sell-institution-pct')?.value || 0);
        s.institution_suggestion_name = document.getElementById('sell-suggest-name')?.value || '';
        s.institution_suggestion_url = document.getElementById('sell-suggest-url')?.value || '';
        s.institution_suggestion_note = document.getElementById('sell-suggest-note')?.value || '';
    }
    if (s.step === 7) {
        s.consent_checked = Boolean(document.getElementById('sell-consent')?.checked);
    }
}

function validateSellStep(step) {
    const s = state.sell;
    if (step === 1 && !s.eco1_key) return 'eco1_key_required';
    if (step === 2) {
        if (!s.title || !s.description) return 'title_and_description_required';
        try {
            const parsed = JSON.parse(s.payloadText || '{}');
            const payloadCheck = validatePayloadLimits(parsed);
            if (!payloadCheck.valid) return 'payload_too_large';
        } catch {
            return 'invalid_payload_json';
        }
    }
    if (step === 3) {
        if (!s.main_file_path || !s.main_file_mime || !s.main_file_size_bytes || !s.checksum_sha256)
            return 'main_file_required';
    }
    if (step === 4) {
        if (
            (s.mode === 'fixed' || s.mode === 'both') &&
            (!Number.isFinite(s.fixed_price_cents) || s.fixed_price_cents <= 0)
        ) {
            return 'fixed_price_required';
        }
        if (s.mode === 'rfq') s.fixed_price_cents = 0;
    }
    if (step === 5 && s.visibility === 'restricted' && !s.access_user_ids.trim()) return 'access_list_required';
    if (step === 6) {
        const splitCheck = validateInstitutionSplit(s.institution_id || null, s.institution_pct);
        if (!splitCheck.valid) return splitCheck.error;
    }
    if (step === 7 && !s.consent_checked) return 'consent_required';
    return null;
}

async function sha256Hex(input) {
    const bytes = new TextEncoder().encode(String(input || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const arr = Array.from(new Uint8Array(digest));
    return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function doSearch(reset) {
    readBuyFilters();
    if (reset) {
        state.searchItems = [];
        state.searchNextCursor = null;
        state.searchHasMore = false;
    }

    const params = {
        q: state.search.q,
        category: state.search.category,
        mode: state.search.mode,
        currency: state.search.currency,
        min_price_cents: state.search.min_price_cents,
        max_price_cents: state.search.max_price_cents,
        page_size: state.search.page_size,
        cursor: reset ? '' : state.searchNextCursor,
    };

    const res = await searchListings(params);
    let items = res.items || [];
    const minScore = Number(state.search.seller_min_score || 0);
    if (Number.isFinite(minScore) && minScore > 0) {
        items = items.filter((i) => Number(i?.seller_reputation?.score || 0) >= minScore);
    }

    state.searchItems = reset ? items : [...state.searchItems, ...items];
    state.searchNextCursor = res.next_cursor || null;
    state.searchHasMore = Boolean(res.has_more && res.next_cursor);
}

async function doPublishListing() {
    readSellStepFields();
    const err = validateSellStep(7);
    if (err) throw new Error(err);

    const s = state.sell;
    const payload = JSON.parse(s.payloadText || '{}');
    const payloadHash = await sha256Hex(JSON.stringify(payload));

    const draft = await createListingDraft({
        eco1_key: s.eco1_key,
        asset_category: s.asset_category,
        title: s.title,
        description: s.description,
        payload,
        payload_hash: payloadHash,
        main_file_path: s.main_file_path,
        main_file_mime: s.main_file_mime,
        main_file_size_bytes: Number(s.main_file_size_bytes || 0),
        preview_file_path: s.preview_file_path || null,
        preview_file_mime: s.preview_file_mime || null,
        preview_file_size_bytes: s.preview_file_size_bytes ? Number(s.preview_file_size_bytes) : null,
        checksum_sha256: s.checksum_sha256,
        mode: s.mode,
        visibility: s.visibility,
        currency: s.currency,
        fixed_price_cents: Number(s.fixed_price_cents || 0),
        institution_id: s.institution_id || null,
        institution_pct: Number(s.institution_pct || 0),
        metadata: {
            source: 'libraries_module_v2',
            submitted_at: new Date().toISOString(),
        },
    });

    const listingId = draft.listing_id;
    if (!listingId) throw new Error('listing_create_failed');
    s.listingId = listingId;

    if (s.visibility === 'restricted') {
        const access = s.access_user_ids
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
        await setListingAccess(listingId, access);
    }

    if (s.institution_suggestion_name.trim()) {
        await suggestInstitution({
            name: s.institution_suggestion_name.trim(),
            website_url: s.institution_suggestion_url.trim() || null,
            note: s.institution_suggestion_note.trim() || null,
        });
    }

    await recordListingConsent(listingId, {
        consent_version: 'v1.0.0',
        consent_hash: await sha256Hex(CONSENT_TEXT),
        ip_hash: null,
        metadata: {
            accepted_from: 'libraries_modal_v2',
        },
    });

    await publishListing(listingId);
}

function maybeOpenWizardOnStart() {
    if (!wizardDone()) {
        state.tab = 'wizard';
        state.wizard.step = 1;
    }
}

function handleOpenLibraryManager() {
    state.tab = 'home';
    maybeOpenWizardOnStart();
    rerender();
    openModal('library-modal');
}

async function handleOpenMarketplace() {
    state.tab = 'buy';
    openModal('library-modal');
    await rerender();
    await handleMarketSearch(true);
}

async function handleLibraryTabSwitch(tab) {
    state.tab = tab;
    await rerender();
}
async function handleMarketOpenWizard() {
    state.tab = 'wizard';
    state.wizard.step = 1;
    await rerender();
}

async function handleMarketWizardBack() {
    readWizardStepFields();
    state.wizard.step = Math.max(1, state.wizard.step - 1);
    await rerender();
}

async function handleMarketWizardNext() {
    readWizardStepFields();
    state.wizard.step = Math.min(4, state.wizard.step + 1);
    await rerender();
}

async function handleMarketWizardFinish() {
    readWizardStepFields();
    setPrefs({ ...state.wizard });
    setWizardDone(true);
    showToast('Wizard salvo com sucesso', 'success');
    state.tab = 'home';
    await rerender();
}

async function handleMarketSearch(reset = true) {
    try {
        await doSearch(Boolean(reset));
    } catch (err) {
        showToast(marketMessage(err?.message || 'search_failed'), 'error');
    }
    await rerender();
}

async function handleMarketResetFilters() {
    state.search = {
        q: '',
        category: '',
        currency: 'BRL',
        mode: '',
        min_price_cents: '',
        max_price_cents: '',
        seller_min_score: '',
        page_size: 12,
    };
    state.searchItems = [];
    state.searchNextCursor = null;
    state.searchHasMore = false;
    await rerender();
}

// ----------------------------------------------------------------
// INSURANCE ADD-ON — Secao de seguro no card de listing
// ----------------------------------------------------------------

/**
 * Render insurance add-on section (hidden by default).
 * Renderiza secao colapsavel de opcoes de seguro.
 */
function _renderInsuranceAddon(listingId, priceCents, currency) {
    const catalog = getInsuranceCatalog();
    const eid = escapeHtml(listingId);
    let html = `<div class="insurance-addon" id="ins-${eid}" style="display:none">`;

    // Environmental
    const envEntries = Object.entries(catalog.environmental || {});
    if (envEntries.length) {
        html += `<div class="ins-group-label">${t('envInsurance') || 'Environmental Insurance'}</div>`;
        for (const [key, entry] of envEntries) {
            const prem = calculatePremium(priceCents, key);
            html += `<label class="ins-option"><input type="checkbox" data-ins-cat="environmental" data-ins-sub="${key}" data-ins-prem="${prem}" onchange="handleInsuranceCheckChange('${eid}', '${currency}')"> ${t(entry.i18nKey) || key} (${entry.pctOfPrice}% &mdash; ${currency} ${(prem / 100).toFixed(2)})</label>`;
        }
    }

    // Warranty
    const warEntries = Object.entries(catalog.warranty || {});
    if (warEntries.length) {
        html += `<div class="ins-group-label">${t('productWarranty') || 'Product Warranty'}</div>`;
        for (const [key, entry] of warEntries) {
            const prem = calculatePremium(priceCents, key);
            html += `<label class="ins-option"><input type="checkbox" data-ins-cat="warranty" data-ins-sub="${key}" data-ins-prem="${prem}" onchange="handleInsuranceCheckChange('${eid}', '${currency}')"> ${t(entry.i18nKey) || key} (${entry.pctOfPrice}% &mdash; ${currency} ${(prem / 100).toFixed(2)})</label>`;
        }
    }

    html += `<div class="ins-summary" id="ins-total-${eid}"></div></div>`;
    return html;
}

/**
 * Toggle insurance section visibility.
 */
function handleToggleInsurance(listingId) {
    const el = document.getElementById(`ins-${listingId}`);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

/**
 * Recalculate insurance total when checkbox changes.
 * Recalcula total de premios selecionados.
 */
function handleInsuranceCheckChange(listingId, currency) {
    const section = document.getElementById(`ins-${listingId}`);
    if (!section) return;
    const checks = section.querySelectorAll('input[type="checkbox"]:checked');
    let total = 0;
    checks.forEach((cb) => {
        total += Number(cb.dataset.insPrem || 0);
    });
    const summary = document.getElementById(`ins-total-${listingId}`);
    if (summary) {
        summary.textContent = total > 0 ? `${t('premium') || 'Premium'}: ${currency} ${(total / 100).toFixed(2)}` : '';
    }
}

/**
 * Collect selected insurance options from a listing card.
 * Coleta opcoes de seguro marcadas pelo usuario.
 * @param {string} listingId
 * @returns {Array<{category: string, subtype: string}>}
 */
function _collectInsuranceOptions(listingId) {
    const section = document.getElementById(`ins-${listingId}`);
    if (!section) return [];
    const checks = section.querySelectorAll('input[type="checkbox"]:checked');
    const opts = [];
    checks.forEach((cb) => {
        opts.push({ category: cb.dataset.insCat, subtype: cb.dataset.insSub });
    });
    return opts;
}

async function handleMarketBuyListing(listingId) {
    if (!isLoggedIn()) {
        showToast(t('login') || 'Login required', 'warning');
        return;
    }
    try {
        const insuranceOptions = _collectInsuranceOptions(listingId);
        const res = await buyListing(listingId, { insuranceOptions });
        showToast(`Ordem criada: ${res?.order?.id || ''}`, 'success');
        if (insuranceOptions.length) {
            showToast(t('insAddedToOrder') || 'Insurance added to order', 'info');
        }
        updateAllUI();
    } catch (err) {
        showToast(marketMessage(err?.message || 'buy_failed'), 'error');
    }
}

async function handleMarketOpenRfqPrompt(listingId, currency = 'BRL') {
    if (!isLoggedIn()) {
        showToast(t('login') || 'Login required', 'warning');
        return;
    }
    const raw = prompt(`Valor inicial da proposta em centavos (${currency}):`, '1000');
    if (raw == null) return;
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) {
        showToast('Valor invalido', 'error');
        return;
    }
    try {
        const thread = await createRfqThread(listingId, { price_cents: price, currency });
        showToast(`Proposta enviada: ${thread?.thread?.id || ''}`, 'success');
        updateAllUI();
    } catch (err) {
        showToast(marketMessage(err?.message || 'rfq_failed'), 'error');
    }
}

function handleMarketCopyListingId(listingId) {
    navigator.clipboard
        .writeText(String(listingId || ''))
        .then(() => {
            showToast('Codigo copiado', 'success');
        })
        .catch(() => {});
}

async function handleMarketSellBack() {
    readSellStepFields();
    state.sell.step = Math.max(1, state.sell.step - 1);
    await rerender();
}

async function handleMarketSellNext() {
    readSellStepFields();
    const err = validateSellStep(state.sell.step);
    if (err) {
        showToast(marketMessage(err), 'error');
        return;
    }
    state.sell.step = Math.min(7, state.sell.step + 1);
    await rerender();
}

async function handleMarketPublishListing() {
    if (!isLoggedIn()) {
        showToast(t('login') || 'Login required', 'warning');
        return;
    }
    try {
        await doPublishListing();
        showToast('Anuncio publicado com sucesso', 'success');
        state.sell = freshSellDraft();
        state.tab = 'dashboard';
        updateAllUI();
    } catch (err) {
        showToast(marketMessage(err?.message || 'publish_failed'), 'error');
    }
    await rerender();
}

async function handleMarketRefreshNotifications() {
    await loadNotifications(true);
    await rerender();
}

async function handleMarketLoadMoreNotifications() {
    await loadNotifications(false);
    await rerender();
}

async function handleMarketMarkNotificationRead(notificationId) {
    try {
        await markNotificationRead(notificationId);
    } catch (err) {
        showToast(marketMessage(err?.message || 'notification_update_failed'), 'error');
    }
    await loadNotifications(true);
    await rerender();
}

async function handleMarketRefreshAdmin() {
    await loadAdminQueues();
    await rerender();
}

async function handleMarketAdminModerate(listingId, decision) {
    const reason = prompt('Motivo da decisao (10-500 chars):', 'Moderacao manual V2');
    if (!reason) return;
    try {
        await moderateListing(listingId, { decision, reason });
        showToast(`Moderacao: ${decision}`, 'success');
        await loadAdminQueues();
    } catch (err) {
        showToast(marketMessage(err?.message || 'moderation_failed'), 'error');
    }
    await rerender();
}

async function handleMarketAdminResolveDispute(disputeId, resolution) {
    const reason = prompt('Motivo da resolucao (10-500 chars):', 'Resolucao manual de disputa');
    if (!reason) return;
    try {
        await resolveDispute(disputeId, { resolution, reason });
        showToast(`Disputa resolvida: ${resolution}`, 'success');
        await loadAdminQueues();
    } catch (err) {
        showToast(marketMessage(err?.message || 'resolve_dispute_failed'), 'error');
    }
    await rerender();
}

async function handleMarketAdminReplayWebhook(eventId) {
    try {
        await replayWebhook(eventId);
        showToast('Webhook reenfileirado', 'success');
        await loadAdminQueues();
    } catch (err) {
        showToast(marketMessage(err?.message || 'webhook_replay_failed'), 'error');
    }
    await rerender();
}

async function handleMarketRenewListing(listingId) {
    try {
        const result = await renewListing(listingId);
        if (result?.ok === false) throw new Error(result?.error || 'renew_failed');
        showToast('Anuncio renovado por 30 dias', 'success');
        await rerender();
    } catch (err) {
        showToast(marketMessage(err?.message || 'renew_failed'), 'error');
    }
}

function handleImportLibraryFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        try {
            const manifest = JSON.parse(text);
            const result = installLibrary(manifest);
            if (!result.success) throw new Error(result.error || 'install_failed');
            showToast(`Library instalada: ${manifest?.name || manifest?.id || ''}`, 'success');
            updateAllUI();
        } catch (err) {
            showToast(marketMessage(err?.message || 'invalid_library_file'), 'error');
        }
    };
    input.click();
}

function handleExportLibrary(libraryId) {
    const lib = getLibraryById(libraryId);
    if (!lib) {
        showToast('Library nao encontrada', 'error');
        return;
    }
    const blob = new Blob([JSON.stringify(lib.manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lib.manifest.id || 'library'}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function handleInstallLibrary(libraryId) {
    const manifest = getLibraryDetails(libraryId);
    if (!manifest) {
        showToast(`Library ${libraryId} nao encontrada`, 'error');
        return;
    }
    const result = installLibrary(manifest);
    if (result.success) {
        showToast(`Library instalada: ${manifest.name || manifest.id}`, 'success');
        updateAllUI();
    } else {
        showToast(marketMessage(result.error || 'install_failed'), 'error');
    }
}

function handleUninstallLibrary(libraryId) {
    const result = uninstallLibrary(libraryId);
    if (result.success) {
        showToast('Library removida', 'success');
        updateAllUI();
    } else {
        showToast(marketMessage(result.error || 'uninstall_failed'), 'error');
    }
}

function handleActivateLibrary(libraryId) {
    const result = activateLibrary(libraryId);
    if (result.success) {
        showToast('Library ativada', 'success');
        updateAllUI();
    } else {
        showToast(marketMessage(result.error || 'activate_failed'), 'error');
    }
}

function handleDeactivateLibrary(libraryId) {
    const result = deactivateLibrary(libraryId);
    if (result.success) {
        showToast('Library desativada', 'success');
        updateAllUI();
    } else {
        showToast(marketMessage(result.error || 'deactivate_failed'), 'error');
    }
}

function handleSearchMarketplace() {
    return handleMarketSearch(true);
}
function handleSortMarketplace() {
    return handleMarketSearch(true);
}
function handleRateLibrary(libraryId, rating) {
    rateLibrary(libraryId, rating);
    showToast('Rating salvo localmente', 'success');
}
function handleUpdateLibrary() {
    showToast('V2: use versionamento de listing publicado', 'info');
}
function handleUpdateAllLibraries() {
    showToast('V2: atualizacao em lote de libraries nao se aplica ao marketplace', 'info');
}

function legacyNotUsed() {
    showToast('Fluxo legado substituido pelo Marketplace V2', 'info');
}

const handleToggleLike = legacyNotUsed;
const handlePostComment = legacyNotUsed;
const handleDeleteComment = legacyNotUsed;
const handleViewLibraryDetail = legacyNotUsed;
const handlePublishLibrary = legacyNotUsed;
const handleUnpublishLibrary = legacyNotUsed;
const handleToggleFollow = legacyNotUsed;
const handleSelectRating = legacyNotUsed;
const handleQuickFillRating = legacyNotUsed;
const handlePublishTypeChange = legacyNotUsed;
const handleCharitySliderChange = legacyNotUsed;
const handlePublishPriceChange = legacyNotUsed;
const handleVerifyCharity = legacyNotUsed;
const handleConfirmPublish = legacyNotUsed;
const handleToggleContentsDetail = legacyNotUsed;
const handleTagFilter = legacyNotUsed;
const handleRefreshRecommendations = legacyNotUsed;

/**
 * Inicia checkout Stripe para biblioteca paga não-possuída.
 * @param {string} libraryDbId — UUID da biblioteca em `libraries.id`
 */
async function handleBuyLibrary(libraryDbId) {
    if (!isLoggedIn()) {
        showToast(t('loginRequired') || 'Login necessário', 'warning');
        return;
    }
    const { url, error } = await createLibraryCheckout(libraryDbId);
    if (error || !url) {
        showToast(t('checkoutError') || 'Erro ao iniciar checkout', 'error');
        return;
    }
    window.location.href = url;
}

/**
 * Baixa manifest de biblioteca já comprada e instala.
 * @param {string} libraryDbId — UUID da biblioteca
 * @param {string} libraryId — ID string do manifest (para refresh de UI)
 */
async function handleDownloadPurchasedLibrary(libraryDbId, libraryId) {
    const { manifest, error } = await downloadLibraryManifest(libraryDbId);
    if (error || !manifest) {
        showToast(t('downloadError') || 'Erro ao baixar módulo', 'error');
        return;
    }
    const result = installLibrary(manifest);
    if (result.success) {
        showToast(`${manifest.name || manifest.id} instalado!`, 'success');
        updateAllUI();
        if (state.tab === 'modules') await renderModulesTab();
    } else {
        showToast(result.error || t('installFailed') || 'Erro ao instalar', 'error');
    }
}

export const libraryHandlers = {
    handleOpenLibraryManager,
    handleOpenMarketplace,
    handleLibraryTabSwitch,
    handleImportLibraryFile,
    handleExportLibrary,
    handleInstallLibrary,
    handleUninstallLibrary,
    handleActivateLibrary,
    handleDeactivateLibrary,
    handleSearchMarketplace,
    handleSortMarketplace,
    handleRateLibrary,
    handleUpdateLibrary,
    handleUpdateAllLibraries,

    handleMarketOpenWizard,
    handleMarketWizardBack,
    handleMarketWizardNext,
    handleMarketWizardFinish,
    handleMarketSearch,
    handleMarketResetFilters,
    handleMarketBuyListing,
    handleMarketOpenRfqPrompt,
    handleMarketCopyListingId,
    handleMarketSellBack,
    handleMarketSellNext,
    handleMarketPublishListing,
    handleMarketRefreshNotifications,
    handleMarketLoadMoreNotifications,
    handleMarketMarkNotificationRead,
    handleMarketRefreshAdmin,
    handleMarketAdminModerate,
    handleMarketAdminResolveDispute,
    handleMarketAdminReplayWebhook,
    handleMarketRenewListing,

    handleToggleInsurance,
    handleInsuranceCheckChange,

    handleToggleLike,
    handlePostComment,
    handleDeleteComment,
    handleViewLibraryDetail,
    handlePublishLibrary,
    handleUnpublishLibrary,
    handleToggleFollow,
    handleSelectRating,
    handleQuickFillRating,
    handlePublishTypeChange,
    handleCharitySliderChange,
    handlePublishPriceChange,
    handleVerifyCharity,
    handleConfirmPublish,
    handleToggleContentsDetail,
    handleBuyLibrary,
    handleDownloadPurchasedLibrary,
    handleTagFilter,
    handleRefreshRecommendations,
};
