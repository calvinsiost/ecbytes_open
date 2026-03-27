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
   GERENCIAMENTO DE MODAIS
   ================================================================

   Este modulo controla as janelas modais (dialogos) da aplicacao.

   O QUE E UM MODAL?
   Uma janela sobreposta que bloqueia a interacao com o resto da pagina.
   Usado para acoes importantes que precisam de atencao do usuario.

   MODAIS DA APLICACAO:
   - Export: Exibe chave e opcoes de exportacao
   - Import: Campo para colar chave ou selecionar arquivo
   - Family Manager: Gerenciar familias de elementos

   ================================================================ */

import { t } from '../i18n/translations.js';
import { canDo } from '../auth/permissions.js';
import {
    generateKey,
    buildModel,
    copyKeyToClipboard,
    copyShareURL,
    downloadKeyFile,
    downloadJSONFile,
    setBlockchainOptions,
} from '../../core/io/export.js';
import { exportXLSX } from '../../core/io/formats/xlsx.js';
import { importFromString, importFromFile, importIncremental, validateContent } from '../../core/io/import.js';
import { showToast } from './toast.js';
import { setOrigin } from '../../core/io/geo/coordinates.js';
import {
    getAllFamilies,
    getFamilyName,
    toggleFamily,
    deleteFamily as deleteFamilyFromRegistry,
    addCustomFamily as addFamilyToRegistry,
} from '../../core/elements/families.js';
import { removeElementsByFamily } from '../../core/elements/manager.js';
import { getIcon } from './icons.js';
import { isFieldLocked } from '../libraries/locks.js';
import { addFloatingResizeHandles } from './resizeHandles.js';
import { asyncPrompt, asyncConfirm } from './asyncDialogs.js';
import { escapeHtml } from '../helpers/html.js';

// ----------------------------------------------------------------
// ESTADO DO BLOCKCHAIN
// ----------------------------------------------------------------

let blockchainKeysLoaded = false;

// ----------------------------------------------------------------
// FUNCOES GERAIS DE MODAIS
// ----------------------------------------------------------------

/**
 * Abre um modal pelo ID.
 *
 * @param {string} modalId - ID do elemento modal
 *
 * COMO FUNCIONA:
 * - Adiciona classe 'active' ao overlay
 * - CSS faz o modal aparecer (display: flex)
 */
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');

        // Gap #4: ARIA attributes for screen readers
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        // Gap #4: Focus trap — keyboard Tab stays inside modal
        modal._cleanupFocusTrap = _trapFocus(modal);

        // Attach resize handles a modais resizaveis (se ainda nao feito)
        const modalBox = modal.querySelector('.modal.modal-resizable');
        if (modalBox && !modalBox._resizeAttached) {
            addFloatingResizeHandles(modalBox, {
                minWidth: 350,
                maxWidth: window.innerWidth * 0.9,
                minHeight: 250,
                maxHeight: window.innerHeight * 0.9,
            });
            modalBox._resizeAttached = true;
        }
    }
}

/**
 * Fecha um modal pelo ID.
 *
 * @param {string} modalId - ID do elemento modal
 */
export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        // Gap #4: Release focus trap
        if (modal._cleanupFocusTrap) {
            modal._cleanupFocusTrap();
            modal._cleanupFocusTrap = null;
        }
        modal.classList.remove('active');
    }
}

/**
 * Focus trap — keeps Tab/Shift+Tab inside a modal.
 * Gap #4: WCAG 2.1 SC 2.4.3 (Focus Order).
 *
 * @param {HTMLElement} modalEl
 * @returns {Function|null} Cleanup function to remove the trap
 */
function _trapFocus(modalEl) {
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = modalEl.querySelectorAll(FOCUSABLE);
    if (!focusable.length) return null;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handler(e) {
        if (e.key !== 'Tab') return;
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    modalEl.addEventListener('keydown', handler);
    // Auto-focus first focusable element
    requestAnimationFrame(() => first.focus());

    return () => modalEl.removeEventListener('keydown', handler);
}

// ----------------------------------------------------------------
// SHARED MODAL SHELL (sym-* pattern)
// ----------------------------------------------------------------

/**
 * Build a standard modal shell using the sym-overlay/sym-dialog pattern.
 * Returns { overlay, dialog, header, body, footer, close } elements.
 *
 * Usage:
 *   const { overlay, body, footer, close } = buildModalShell({
 *       title: 'My Modal',
 *       width: '720px',
 *       onClose: () => myRoot.innerHTML = ''
 *   });
 *   body.appendChild(myContent);
 *   footer.appendChild(myButtons);
 *   myRoot.appendChild(overlay);
 *
 * @param {object} opts
 * @param {string} opts.title - Modal title text
 * @param {string} [opts.width='880px'] - Max width (CSS value)
 * @param {Function} [opts.onClose] - Called when user closes (X, Escape, overlay click)
 * @param {string} [opts.id] - Optional ID for the dialog element
 * @param {boolean} [opts.twoPane=false] - If true, body uses side-by-side layout
 * @returns {{ overlay: HTMLElement, dialog: HTMLElement, header: HTMLElement, body: HTMLElement, footer: HTMLElement, close: Function }}
 */
export function buildModalShell(opts = {}) {
    const { title = '', width = '880px', onClose, id, twoPane = false } = opts;

    const overlay = document.createElement('div');
    overlay.className = 'sym-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'sym-dialog';
    dialog.style.width = `min(${width}, 95vw)`;
    if (id) dialog.id = id;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // Header
    const header = document.createElement('div');
    header.className = 'sym-header';

    const titleEl = document.createElement('h2');
    titleEl.className = 'sym-title';
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sym-close-btn';
    closeBtn.innerHTML = '&#10005;';
    closeBtn.title = 'Close';

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'sym-body';
    if (!twoPane) {
        body.style.flexDirection = 'column';
        body.style.overflowY = 'auto';
        body.style.padding = '16px';
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'sym-footer';

    // Assemble
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    // Close handler
    function close() {
        if (overlay._cleanupFocusTrap) {
            overlay._cleanupFocusTrap();
            overlay._cleanupFocusTrap = null;
        }
        overlay.remove();
        if (typeof onClose === 'function') onClose();
    }

    closeBtn.onclick = close;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });

    // Focus trap
    overlay._cleanupFocusTrap = _trapFocus(dialog);

    return { overlay, dialog, header, body, footer, close };
}

/**
 * Fecha modal ao clicar fora dele (no overlay).
 * Deve ser adicionado como listener no overlay.
 *
 * @param {Event} event - Evento de clique
 */
export function closeOnOverlayClick(event) {
    // Verifica se clicou no overlay (e nao no conteudo do modal)
    if (event.target.classList.contains('modal-overlay')) {
        event.target.classList.remove('active');
    }
}

// ----------------------------------------------------------------
// MODAL DE EXPORTACAO
// ----------------------------------------------------------------

/**
 * Abre modal de exportacao.
 * Gera a chave e exibe no textarea.
 */
export async function openExportModal() {
    // Abre modal primeiro (feedback imediato)
    openModal('export-modal');

    // Carrega lista de chaves se ainda nao carregou
    await loadBlockchainKeys();

    // Atualiza label do formato
    updateFormatLabel();

    // Exibe loading
    const preview = document.getElementById('export-key-preview');
    if (preview) {
        preview.value = 'Gerando chave...';
    }

    // Gera chave do modelo atual (async)
    const key = await generateKey();

    // Exibe no textarea
    if (preview) {
        preview.value = key;
    }
}

/**
 * Carrega lista de chaves disponiveis para o select.
 */
async function loadBlockchainKeys() {
    const select = document.getElementById('export-key-select');
    if (!select) return;

    try {
        const { listKeys, isSupported } = await import('../../core/crypto/keyManager.js');

        if (!isSupported()) {
            select.innerHTML = '<option value="">Navegador nao suporta crypto</option>';
            return;
        }

        const keys = await listKeys();

        if (keys.length === 0) {
            select.innerHTML = '<option value="">Nenhuma chave - clique em "+ Nova"</option>';
        } else {
            select.innerHTML = keys
                .map((k) => `<option value="${k.id}">${k.name} (${k.id.toUpperCase()})</option>`)
                .join('');
        }

        blockchainKeysLoaded = true;
    } catch (err) {
        console.error('Erro ao carregar chaves:', err);
        select.innerHTML = '<option value="">Erro ao carregar chaves</option>';
    }
}

/**
 * Toggle das opcoes de blockchain.
 */
export async function toggleBlockchainOptions() {
    const checkbox = document.getElementById('export-blockchain-enabled');
    const options = document.getElementById('blockchain-options');
    const enabled = checkbox?.checked || false;

    if (options) {
        options.style.display = enabled ? 'block' : 'none';
    }

    // Atualiza opcoes de exportacao
    const keyId = enabled ? document.getElementById('export-key-select')?.value : null;
    setBlockchainOptions({ enabled, keyId });

    // Atualiza label e regenera chave
    updateFormatLabel();
    await regenerateKey();
}

/**
 * Quando seleciona uma chave diferente.
 */
export async function onKeySelectChange() {
    const keyId = document.getElementById('export-key-select')?.value || null;
    const enabled = document.getElementById('export-blockchain-enabled')?.checked || false;

    setBlockchainOptions({ enabled, keyId });
    await regenerateKey();
}

/**
 * Cria nova chave de assinatura.
 */
export async function createNewKey() {
    try {
        const { generateKeyPair } = await import('../../core/crypto/keyManager.js');

        const name = await asyncPrompt('Nome para a nova chave:', 'Minha Chave');
        if (!name) return;

        const { keyId } = await generateKeyPair(name);
        showToast(`Chave ${keyId.toUpperCase()} criada!`, 'success');

        // Recarrega lista e seleciona a nova
        await loadBlockchainKeys();
        const select = document.getElementById('export-key-select');
        if (select) {
            select.value = keyId;
            await onKeySelectChange();
        }
    } catch (err) {
        console.error('Erro ao criar chave:', err);
        showToast('Erro ao criar chave: ' + err.message, 'error');
    }
}

/**
 * Atualiza o label do formato (ECO1 simples ou ECO1 blockchain).
 * ECO1 blockchain so e usado quando blockchain esta habilitado E uma chave esta selecionada.
 */
function updateFormatLabel() {
    const label = document.getElementById('export-format-label');
    const enabled = document.getElementById('export-blockchain-enabled')?.checked || false;
    const keyId = document.getElementById('export-key-select')?.value || '';

    if (label) {
        if (enabled && keyId) {
            label.textContent = 'Model Key (ECO1 Format - Blockchain)';
        } else if (enabled && !keyId) {
            label.textContent = 'Model Key (ECO1 Format) - Selecione uma chave para blockchain';
        } else {
            label.textContent = 'Model Key (ECO1 Format)';
        }
    }
}

/**
 * Regenera a chave apos mudanca de opcoes.
 */
async function regenerateKey() {
    const preview = document.getElementById('export-key-preview');
    if (!preview) return;

    preview.value = 'Gerando chave...';
    try {
        const key = await generateKey();
        preview.value = key;
    } catch (err) {
        preview.value = 'Erro: ' + err.message;
    }
}

/**
 * Copia chave do modal de exportacao.
 */
export async function handleCopyKey() {
    if (!canDo('export')) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }
    const success = await copyKeyToClipboard();
    if (success) {
        showToast(t('keyCopied'), 'success');
    } else {
        showToast('Erro ao copiar', 'error');
    }
}

/**
 * Copia URL de compartilhamento.
 */
export async function handleCopyURL() {
    const success = await copyShareURL();
    if (success) {
        showToast(t('urlCopied'), 'success');
    } else {
        showToast('Erro ao copiar URL', 'error');
    }
}

/**
 * Faz download conforme formato selecionado.
 */
export async function handleDownload() {
    if (!canDo('export')) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }
    const format = document.getElementById('export-format-select')?.value || 'ecokey';
    const projectName = document.getElementById('project-name')?.value || 'model';
    const safeName = projectName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') || 'model';

    try {
        // Formatos ECO Key e JSON usam os exportadores existentes
        if (format === 'ecokey') {
            await downloadKeyFile(projectName);
            showToast(t('fileDownloaded'), 'success');
            closeModal('export-modal');
            return;
        }

        if (format === 'json') {
            downloadJSONFile(projectName);
            showToast(t('fileDownloaded'), 'success');
            closeModal('export-modal');
            return;
        }

        if (format.startsWith('xlsx-')) {
            syncOriginFromUI();
            const template = format.replace('xlsx-', '');
            const blob = await exportXLSX(buildModel(), { template });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${safeName}.xlsx`;
            link.click();
            URL.revokeObjectURL(url);
            showToast(t('fileDownloaded'), 'success');
            closeModal('export-modal');
            return;
        }

        // Sincroniza origem UTM antes de exportar formatos georeferenciados
        syncOriginFromUI();

        const model = buildModel();
        let blob, ext;

        if (format === 'csv-observations' || format === 'csv-elements' || format === 'csv-campaigns') {
            const { exportCSV } = await import('../../core/io/formats/csv.js');
            const scope = format.replace('csv-', '');
            blob = exportCSV(model, { scope });
            ext = '.csv';
        } else if (format === 'geojson') {
            const { exportGeoJSON } = await import('../../core/io/formats/geojson.js');
            blob = exportGeoJSON(model);
            ext = '.geojson';
        } else if (format === 'gltf') {
            const { exportGLTF } = await import('../../core/io/formats/gltf.js');
            blob = await exportGLTF(model, { binary: true });
            ext = '.glb';
        } else if (format === 'kml') {
            const { exportKML } = await import('../../core/io/formats/kml.js');
            blob = exportKML(model);
            ext = '.kml';
        } else if (format === 'ngsild') {
            const { exportNGSILD } = await import('../../core/io/formats/ngsild.js');
            blob = exportNGSILD(model, { scope: 'full', format: 'normalized' });
            ext = '.jsonld';
        } else if (
            format === 'xlsx-edd-br' ||
            format === 'xlsx-edd-r2' ||
            format === 'xlsx-ohs-aiha' ||
            format === 'xlsx-ecbyts'
        ) {
            syncOriginFromUI();
            const { exportXLSX } = await import('../../core/io/formats/xlsx.js');
            const template = format.replace('xlsx-', '');
            blob = await exportXLSX(model, template);
            ext = '.xlsx';
        } else {
            showToast('Formato não suportado', 'error');
            return;
        }

        // Download
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${safeName}${ext}`;
        link.click();
        URL.revokeObjectURL(url);

        showToast(t('fileDownloaded'), 'success');
        closeModal('export-modal');
    } catch (err) {
        console.error('Erro ao exportar:', err);
        showToast(`Erro: ${err.message}`, 'error');
    }
}

/**
 * Handler para mudança de formato no modal de exportação.
 * Mostra/oculta seções relevantes para o formato selecionado.
 */
export function onExportFormatChange() {
    const format = document.getElementById('export-format-select')?.value || 'ecokey';

    const ecokeyOptions = document.getElementById('ecokey-options');
    const previewSection = document.getElementById('ecokey-preview-section');
    const formatInfo = document.getElementById('export-format-info');
    const formatDesc = document.getElementById('export-format-description');
    const btnCopyKey = document.getElementById('btn-copy-key');
    const btnCopyUrl = document.getElementById('btn-copy-url');

    const isKey = format === 'ecokey';
    const isJson = format === 'json';
    const isKeyOrJson = isKey || isJson;

    // Blockchain options: só para ECO Key
    if (ecokeyOptions) ecokeyOptions.style.display = isKey ? 'block' : 'none';

    // Preview textarea: só para ECO Key e JSON
    if (previewSection) previewSection.style.display = isKeyOrJson ? 'block' : 'none';

    // Botões de cópia: só para ECO Key
    if (btnCopyKey) btnCopyKey.style.display = isKey ? '' : 'none';
    if (btnCopyUrl) btnCopyUrl.style.display = isKey ? '' : 'none';

    // Info do formato: para formatos não-key
    if (formatInfo && formatDesc) {
        if (isKeyOrJson) {
            formatInfo.style.display = 'none';
        } else {
            formatInfo.style.display = 'block';
            formatDesc.textContent = FORMAT_DESCRIPTIONS[format] || '';
        }
    }
}

/**
 * Sincroniza a origem UTM do formulário para o módulo de coordenadas.
 */
function syncOriginFromUI() {
    const easting = parseFloat(document.getElementById('utm-origin-easting')?.value) || 0;
    const northing = parseFloat(document.getElementById('utm-origin-northing')?.value) || 0;
    const elevation = parseFloat(document.getElementById('utm-origin-elevation')?.value) || 0;
    const zone = parseInt(document.getElementById('utm-zone')?.value) || 23;
    const hemisphere = document.getElementById('utm-hemisphere')?.value || 'S';

    setOrigin({ easting, northing, elevation, zone, hemisphere });
}

const FORMAT_DESCRIPTIONS = {
    'csv-observations':
        'Exporta todas as observações como tabela CSV. Abre no Excel, R, Python. Ideal para análise de dados e relatórios CONAMA/CETESB.',
    'csv-elements': 'Exporta lista de elementos com posição, família e contagem de observações.',
    'csv-campaigns': 'Exporta campanhas de amostragem (nome, data, cor).',
    geojson:
        'Exporta elementos como GeoJSON (RFC 7946). Abre no QGIS, geojson.io, Mapbox. Requer origem UTM configurada para coordenadas corretas.',
    gltf: 'Exporta a cena 3D como GLB (glTF Binary). Abre no Blender, Unity, visualizadores 3D.',
    kml: 'Exporta para Google Earth com folders, ícones, descrições HTML e extrusão 3D. Requer origem UTM configurada.',
    ngsild: 'Exporta entidades NGSI-LD (FIWARE/Smart Data Models) com contexto JSON-LD para interoperabilidade IoT.',
    'xlsx-edd-br': 'Exporta em formato XLSX estruturado conforme EDD Brasileiro.',
    'xlsx-edd-r2': 'Exporta em formato XLSX estruturado conforme EPA EDD R2.',
    'xlsx-ohs-aiha': 'Exporta em formato XLSX estruturado conforme OHS AIHA.',
    'xlsx-ecbyts': 'Exporta em formato XLSX nativo ecbyts.',
};

// ----------------------------------------------------------------
// MODAL DE IMPORTACAO
// ----------------------------------------------------------------

/**
 * Abre modal de importacao.
 * Limpa campos anteriores.
 */
export function openImportModal() {
    // Limpa textarea
    const keyInput = document.getElementById('import-key-input');
    if (keyInput) {
        keyInput.value = '';
    }

    // Limpa seletor de arquivo
    const fileInput = document.getElementById('import-file');
    if (fileInput) {
        fileInput.value = '';
    }

    // Limpa status
    const status = document.getElementById('import-status');
    if (status) {
        status.textContent = '';
    }

    openModal('import-modal');
}

/**
 * Executa importacao do modal.
 * Verifica se ha arquivo ou texto e importa.
 * Suporta formatos: .ecokey, .json, .key, .csv, .geojson
 *
 * @param {Function} onSuccess - Callback chamado apos importacao bem sucedida
 */
export async function executeImport(onSuccess) {
    if (!canDo('edit')) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }
    const keyInput = document.getElementById('import-key-input');
    const fileInput = document.getElementById('import-file');

    try {
        // Prioridade para arquivo selecionado
        if (fileInput?.files?.length > 0) {
            const file = fileInput.files[0];
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

            // CSV: importa observações
            if (ext === '.csv') {
                syncOriginFromUI();
                const text = await readFileAsText(file);
                const { importCSV } = await import('../../core/io/formats/csv.js');
                const result = importCSV(text);
                closeModal('import-modal');
                showToast(
                    `Imported ${result.observations.length} observations from ${result.elementIds.length} elements`,
                    'success',
                );
                if (onSuccess) onSuccess();
                return;
            }

            // GeoJSON: importa elementos
            if (ext === '.geojson') {
                syncOriginFromUI();
                const text = await readFileAsText(file);
                const { importGeoJSON } = await import('../../core/io/formats/geojson.js');
                const result = importGeoJSON(text);
                if (result.warnings.length > 0) {
                    console.warn('GeoJSON import warnings:', result.warnings);
                }
                closeModal('import-modal');
                showToast(`Imported ${result.elements.length} elements from GeoJSON`, 'success');
                if (onSuccess) onSuccess();
                return;
            }

            // Shapefile (.shp ou .zip contendo shapefile)
            if (ext === '.shp' || (ext === '.zip' && file.name.toLowerCase().includes('shp'))) {
                syncOriginFromUI();
                const { showProgressOverlay } = await import('./progressOverlay.js');
                const progress = showProgressOverlay(t('importingShapefile') || 'Importing shapefile...');
                try {
                    const { importShapefile } = await import('../../core/io/formats/shapefile.js');
                    progress.update('Loading shpjs library', 0, 3);
                    const result = await importShapefile(file);
                    progress.update('Creating elements', 1, 3);
                    // Adicionar elementos ao modelo
                    const { addElement } = await import('../../core/elements/manager.js');
                    let added = 0;
                    for (const el of result.elements) {
                        try {
                            addElement(el.family, el.id, el.name, el.data, {
                                iconClass: `icon-${el.family}`,
                                color: el.color || '',
                                label: el.name,
                            });
                            added++;
                        } catch (e) {
                            progress.addWarning(`${el.name}: ${e.message}`);
                        }
                    }
                    for (const w of result.warnings) progress.addWarning(w);
                    progress.finish({ elements: added, warnings: result.warnings.length });
                    setTimeout(() => {
                        progress.dismiss();
                        closeModal('import-modal');
                    }, 2000);
                    showToast(`Shapefile: ${added} elements imported`, 'success');
                    if (onSuccess) onSuccess();
                } catch (err) {
                    progress.addError(err.message);
                    progress.finish({ errors: 1 });
                    showToast(`Shapefile: ${err.message}`, 'error');
                }
                return;
            }

            // ZIP generico (tenta shapefile primeiro)
            if (ext === '.zip') {
                syncOriginFromUI();
                try {
                    const { importShapefile } = await import('../../core/io/formats/shapefile.js');
                    const result = await importShapefile(file);
                    const { addElement } = await import('../../core/elements/manager.js');
                    let added = 0;
                    for (const el of result.elements) {
                        try {
                            addElement(el.family, el.id, el.name, el.data, {
                                iconClass: `icon-${el.family}`,
                                label: el.name,
                            });
                            added++;
                        } catch {
                            /* skip */
                        }
                    }
                    closeModal('import-modal');
                    showToast(`Shapefile (ZIP): ${added} elements imported`, 'success');
                    if (onSuccess) onSuccess();
                    return;
                } catch {
                    // Nao e shapefile — tenta como ECO key file
                }
            }

            // Default: ECO key ou JSON
            const mergeToggle = document.getElementById('import-merge-toggle');
            const isMerge = mergeToggle?.checked || false;

            if (isMerge) {
                await _importWithMerge(file, null, onSuccess);
            } else {
                await importFromFile(file);
                closeModal('import-modal');
                showToast(t('modelImported'), 'success');
                if (onSuccess) onSuccess();
            }
            return;
        }

        // Tenta texto colado
        const keyValue = keyInput?.value?.trim();
        if (keyValue) {
            const mergeToggle = document.getElementById('import-merge-toggle');
            const isMerge = mergeToggle?.checked || false;

            if (isMerge) {
                await _importWithMerge(null, keyValue, onSuccess);
            } else {
                await importFromString(keyValue);
                closeModal('import-modal');
                showToast(t('modelImported'), 'success');
                if (onSuccess) onSuccess();
            }
            return;
        }

        // Nenhum input fornecido
        showToast(t('provideKeyOrFile'), 'error');
    } catch (error) {
        showToast(`${t('importFailed')}: ${error.message}`, 'error');
    }
}

/**
 * Lê conteúdo de um File como texto.
 */
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
        reader.readAsText(file);
    });
}

/**
 * Importa modelo com merge incremental.
 * Decodifica a partir de arquivo ou string, depois chama importIncremental().
 * Trata CRS mismatch com dialog bloqueante.
 *
 * @param {File|null} file — arquivo .ecokey/.json
 * @param {string|null} keyString — texto colado
 * @param {Function} onSuccess — callback pos-import
 */
async function _importWithMerge(file, keyString, onSuccess) {
    const { parseInput, parseInputAsync, decodeKeyUniversal, detectKeyVersion } =
        await import('../../core/io/import.js').then(() => import('../../core/io/decoder.js'));
    const { showProgressOverlay } = await import('./progressOverlay.js');
    const { pushSnapshot } = await import('../history/manager.js');
    const { asyncConfirm } = await import('./asyncDialogs.js');

    let input;
    if (file) {
        input = await readFileAsText(file);
    } else {
        input = keyString;
    }

    // Decode
    const version = detectKeyVersion(input.trim());
    let model;
    if (version === 4) {
        model = await decodeKeyUniversal(input.trim());
    } else {
        model = parseInput(input.trim());
    }

    // Tenta merge
    const progress = showProgressOverlay(t('merging') || 'Merging data...');
    try {
        const result = await importIncremental(model, { duplicateStrategy: 'skip' });
        progress.finish({
            elements: result.stats.elementsAdded,
            campaigns: result.stats.campaignsAdded,
            observations: result.stats.observationsAdded,
        });
        if (result.stats.elementsSkipped > 0) {
            progress.addInfo(`${result.stats.elementsSkipped} existing element(s) preserved`);
        }
        pushSnapshot();
        closeModal('import-modal');
        showToast(
            `Merged: +${result.stats.elementsAdded} elements, +${result.stats.campaignsAdded} campaigns, +${result.stats.observationsAdded} obs`,
            'success',
        );
        if (onSuccess) onSuccess();
        setTimeout(() => progress.dismiss(), 3000);
    } catch (err) {
        if (err.message.startsWith('CRS_MISMATCH:')) {
            const [, current, imported] = err.message.split(':');
            progress.dismiss();
            const proceed = await asyncConfirm(
                `UTM zone mismatch: current model is Zone ${current}, import is Zone ${imported}. Coordinates may be wrong. Proceed anyway?`,
            );
            if (proceed) {
                // Retry sem check de CRS (patch temporario no modelo)
                model.coordinate = model.coordinate || {};
                model.coordinate.zone = parseInt(current);
                try {
                    const result = await importIncremental(model, { duplicateStrategy: 'skip' });
                    pushSnapshot();
                    closeModal('import-modal');
                    showToast(`Merged (CRS overridden): +${result.stats.elementsAdded} elements`, 'success');
                    if (onSuccess) onSuccess();
                } catch (e2) {
                    showToast(`${t('importFailed')}: ${e2.message}`, 'error');
                }
            }
        } else {
            progress.addError(err.message);
            progress.finish({ errors: 1 });
        }
    }
}

/**
 * Handler para mudanca no input de arquivo.
 * Exibe nome do arquivo selecionado.
 *
 * @param {Event} event - Evento change
 */
export function handleFileInputChange(event) {
    const status = document.getElementById('import-status');
    if (!status) return;

    if (event.target.files.length > 0) {
        const fileName = event.target.files[0].name;
        status.innerHTML = `<span style="color: var(--success);">${t('fileSelected')}: ${escapeHtml(fileName)}</span>`;
    }
}

/**
 * Handler para digitacao no textarea de importacao.
 * Valida formato enquanto usuario digita.
 *
 * @param {Event} event - Evento input
 */
export function handleKeyInputChange(event) {
    const status = document.getElementById('import-status');
    if (!status) return;

    const value = event.target.value.trim();

    if (!value) {
        status.textContent = '';
        return;
    }

    const validation = validateContent(value);

    if (validation.valid) {
        status.innerHTML = `<span style="color: var(--success);">${t('validFormat')}</span>`;
    } else {
        status.innerHTML = `<span style="color: var(--warning);">${t('enterEcoKey')}</span>`;
    }
}

// ----------------------------------------------------------------
// MODAL DE GERENCIAMENTO DE FAMILIAS
// ----------------------------------------------------------------

/**
 * Abre modal de gerenciamento de familias.
 * Atualiza lista de familias.
 */
export function openFamilyManager() {
    updateFamilyManagerList();
    openModal('family-modal');
}

/**
 * Atualiza lista de familias no modal.
 */
export function updateFamilyManagerList() {
    const container = document.getElementById('family-manager-list');
    if (!container) return;

    const families = getAllFamilies();

    container.innerHTML = Object.values(families)
        .map((f) => {
            const locked = isFieldLocked(f.id);
            return `
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--neutral-200);">
            <span style="font-size: 18px;">${getIcon(f.icon, { size: '20px' })}</span>
            <span style="flex: 1; font-size: 12px;">${getFamilyName(f)}${locked ? ` <span class="locked-indicator">${getIcon('lock', { size: '10px' })} ${t('lockedField')}</span>` : ''}</span>
            <input type="checkbox" ${f.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''}
                   onchange="window.handleFamilyToggle('${f.id}')">
            ${
                f.custom && !locked
                    ? `
                <button type="button" class="btn btn-secondary"
                        style="padding: 4px 8px; font-size: 10px;"
                        onclick="window.handleFamilyDelete('${f.id}')">
                    ${t('delete')}
                </button>
            `
                    : ''
            }
        </div>
    `;
        })
        .join('');
}

/**
 * Handler para toggle de familia.
 *
 * @param {string} familyId - ID da familia
 */
export function handleFamilyToggle(familyId) {
    toggleFamily(familyId);
    // Dispara evento para atualizar UI principal
    window.dispatchEvent(new CustomEvent('familiesChanged'));
}

/**
 * Handler para deletar familia.
 *
 * @param {string} familyId - ID da familia
 */
export async function handleFamilyDelete(familyId) {
    const family = getAllFamilies()[familyId];
    if (!family) return;

    const confirmMessage = `${t('deleteFamilyConfirm')} "${getFamilyName(family)}"?`;

    if (await asyncConfirm(confirmMessage)) {
        // Remove elementos da familia
        removeElementsByFamily(familyId);

        // Remove familia do registro
        deleteFamilyFromRegistry(familyId);

        // Atualiza lista no modal
        updateFamilyManagerList();

        showToast(t('familyDeleted'), 'info');

        // Dispara evento para atualizar UI principal
        window.dispatchEvent(new CustomEvent('familiesChanged'));
    }
}

/**
 * Adiciona familia personalizada.
 */
export function handleAddCustomFamily() {
    const idInput = document.getElementById('new-family-id');
    const nameInput = document.getElementById('new-family-name');

    const id = idInput?.value?.trim()?.toLowerCase()?.replace(/\s+/g, '_');
    const name = nameInput?.value?.trim();

    if (!id || !name) {
        showToast(t('enterIdAndName'), 'error');
        return;
    }

    const result = addFamilyToRegistry(id, name);

    if (result) {
        // Limpa inputs
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';

        // Atualiza lista
        updateFamilyManagerList();

        showToast(`${t('familyAdded')}: "${name}"`, 'success');

        // Dispara evento para atualizar UI principal
        window.dispatchEvent(new CustomEvent('familiesChanged'));
    } else {
        showToast(t('familyExists'), 'error');
    }
}
