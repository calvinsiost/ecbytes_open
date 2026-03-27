// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   SEQUENCER RENDERER — UI for Action Bar + Timeline
   Renderiza a barra de acao (clusters + scenes) e a timeline
   com controles de playback (play/pause/seek/speed).

   Layout:
   ┌──────────────────────────────────────────────────┐
   │  ▶ ■  0:00 ━━━●━━━━━━━━━━━━━ 0:30   1x ▼  🎬  │ timeline
   │       ◇────◇────────◇───────◇                   │ keyframes
   ├──────────────────────────────────────────────────┤
   │  [A+] [B+] [C+] [Scene1+]                       │ action bar
   └──────────────────────────────────────────────────┘
   ================================================================ */

import {
    getItems,
    getKeyframes,
    getPlayback,
    addKeyframe,
    removeKeyframe,
    moveKeyframe,
    updateKeyframe,
    setPlaybackSpeed,
    setPlaybackLoop,
    onChange,
} from './manager.js';
import { play, pause, stop, seek, flyToItem, flyToKeyframe, onTick } from './engine.js';
import { getIcon } from '../../utils/ui/icons.js';
import { setCameraState, getCameraState } from '../../utils/scene/controls.js';
import { getRenderer, requestRender } from '../../utils/scene/setup.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

const CONTAINER_ID = 'storyboard';
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let _container = null;
let _activeItemId = null;
let _isDraggingScrubber = false;
let _unsubscribeTick = null;
let _unsubscribeChange = null;
let _thumbnails = {}; // itemId → dataURL
let _isCapturing = false; // lock para evitar captura concorrente
let _thumbDebounce = null; // debounce para recaptura
let _videoBotMode = false; // modo Bot IA inline
const THUMB_SIZE = 80; // pixels (square crop)

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Inicializa o renderer do storyboard.
 * Cria o container HTML e registra listeners.
 */
export function initStoryboardUI() {
    _container = document.getElementById(CONTAINER_ID);
    if (!_container) return; // Container deve existir no HTML (constellation view)

    // Evitar dupla inicializacao
    if (_container.dataset.initialized) {
        render();
        return;
    }
    _container.dataset.initialized = 'true';
    _container.className = 'storyboard';

    // Delegated events
    _container.addEventListener('click', _handleClick);
    _container.addEventListener('mousedown', _handleMouseDown);
    _container.addEventListener('dblclick', _handleDblClick);
    _container.addEventListener('contextmenu', _handleContextMenu);
    _container.addEventListener('keydown', _handleKeyDown);

    // Listen for state changes (debounced thumbnail refresh)
    _unsubscribeChange = onChange(() => {
        render();
        clearTimeout(_thumbDebounce);
        _thumbDebounce = setTimeout(() => _captureThumbnails(), 1000);
    });
    _unsubscribeTick = onTick((info) => _updatePlaybackUI(info));

    render();

    // Capturar thumbnails apos primeiro render (delay para cena estar pronta)
    setTimeout(() => _captureThumbnails(), 500);
}

/**
 * Remove o renderer e limpa listeners.
 */
export function destroyStoryboardUI() {
    if (_unsubscribeChange) _unsubscribeChange();
    if (_unsubscribeTick) _unsubscribeTick();
    _dismissPopover();
    if (_container) {
        _container.removeEventListener('click', _handleClick);
        _container.removeEventListener('mousedown', _handleMouseDown);
        _container.removeEventListener('dblclick', _handleDblClick);
        _container.removeEventListener('contextmenu', _handleContextMenu);
        _container.removeEventListener('keydown', _handleKeyDown);
        _container.innerHTML = '';
    }
}

// ----------------------------------------------------------------
// RENDER
// ----------------------------------------------------------------

/**
 * Renderiza o storyboard completo (action bar + timeline).
 */
export function render() {
    if (!_container) return;

    const items = getItems();
    const keyframes = getKeyframes();
    const playback = getPlayback();

    // Empty state — mostrar botao de refresh para o usuario
    if (items.length === 0) {
        _container.classList.add('visible');
        _container.innerHTML = `<div class="sb-empty-state">
            <span class="sb-empty-msg">No scenes — generate a model or refresh</span>
            <button class="sb-btn" data-action="refresh-items" aria-label="Refresh storyboard">
                ${getIcon('refresh-cw', { size: '14px' })} Refresh
            </button>
        </div>`;
        return;
    }

    _container.classList.add('visible');

    const hasKeyframes = keyframes.length > 0;

    if (_videoBotMode) {
        _container.innerHTML = _renderVideoBotUI(keyframes, playback);
    } else {
        _container.innerHTML = `
            ${hasKeyframes ? _renderTimeline(keyframes, playback) : ''}
            ${_renderActionBar(items)}
        `;
    }
}

// ----------------------------------------------------------------
// ACTION BAR — Clusters + Scenes
// ----------------------------------------------------------------

function _renderActionBar(items) {
    const cards = items
        .map((item) => {
            const isActive = item.id === _activeItemId;
            const icon = getIcon(item.icon || 'map-pin', { size: '16px' });
            const count = item.elementIds ? item.elementIds.length : '';
            const badge = count ? `<span class="sb-badge">${count}</span>` : '';
            const itemIdAttr = _escapeAttr(item.id);
            const itemNameText = _escapeHtml(item.name || '');
            const itemNameAttr = _escapeAttr(item.name || '');
            const thumb = _thumbnails[item.id]
                ? `<img class="sb-card-thumb" src="${_thumbnails[item.id]}" alt="" draggable="false">`
                : `<div class="sb-card-thumb sb-card-thumb-placeholder" style="background:${item.color}20;">
                   ${icon}
               </div>`;

            return `
            <div class="sb-card${isActive ? ' active' : ''}"
                 data-action="fly-to-item" data-item-id="${itemIdAttr}"
                 style="border-color:${item.color};" title="${itemNameAttr}">
                ${thumb}
                <div class="sb-card-info">
                    <div class="sb-card-name">${itemNameText}</div>
                    ${badge}
                </div>
                <button class="sb-card-add" data-action="add-keyframe"
                        data-item-id="${itemIdAttr}" title="Add to timeline"
                        aria-label="Add ${itemNameAttr} to timeline">
                    ${getIcon('plus', { size: '12px' })}
                </button>
            </div>
        `;
        })
        .join('');

    return `<div class="sb-action-bar">${cards}</div>`;
}

// ----------------------------------------------------------------
// TIMELINE — Playback controls + scrubber + keyframe markers
// ----------------------------------------------------------------

function _renderTimeline(keyframes, playback) {
    const pos = playback.position;
    const pct = (pos * 100).toFixed(1);
    const totalDuration =
        Number.isFinite(playback.totalDuration) && playback.totalDuration >= 0 ? playback.totalDuration : 0;
    const elapsed = _formatTime((pos * totalDuration) / 1000);
    const total = _formatTime(totalDuration / 1000);
    const playIcon = playback.playing ? 'pause' : 'play';
    const speed = Number.isFinite(playback.speed) ? playback.speed : 1;
    const speedLabel = speed === 1 ? '1x' : `${speed}x`;

    // Keyframe markers com botao delete
    const markers = keyframes
        .map((kf) => {
            const item = getItems().find((it) => it.id === kf.itemId);
            const color = item ? item.color : '#666';
            const isActive = _activeItemId && kf.itemId === _activeItemId;
            const left = (kf.position * 100).toFixed(1);
            const markerIdAttr = _escapeAttr(kf.id);
            const markerTitle = _escapeAttr(item ? item.name : kf.id);
            const kfIndex = keyframes.indexOf(kf) + 1;
            const ariaKf = _escapeAttr(`Keyframe ${kfIndex} - ${item ? item.name : kf.id}`);
            return `<div class="sb-kf-marker${isActive ? ' active' : ''}"
                     style="left:${left}%;background:${color};"
                     data-action="seek-keyframe" data-kf-id="${markerIdAttr}"
                     title="${markerTitle}" tabindex="0" role="button"
                     aria-label="${ariaKf}">
                    <button class="sb-kf-delete" data-action="remove-keyframe"
                            data-kf-id="${markerIdAttr}" title="Remove"
                            aria-label="Remove keyframe ${kfIndex}">
                        ${getIcon('x', { size: '8px' })}
                    </button>
                </div>`;
        })
        .join('');

    // Bot IA button (video generation)
    const _generating = _isVideoGenerating();
    const videoBtnClass = _generating ? ' active' : '';

    return `
        <div class="sb-timeline">
            <div class="sb-controls">
                <button class="sb-btn" data-action="play" title="Play/Pause" aria-label="${playback.playing ? 'Pause' : 'Play'}">
                    ${getIcon(playIcon, { size: '14px' })}
                </button>
                <button class="sb-btn" data-action="stop" title="Stop" aria-label="Stop">
                    ${getIcon('square', { size: '14px' })}
                </button>
                <span class="sb-time">${elapsed} / ${total}</span>
                <div class="sb-scrubber-wrap" data-action="scrub">
                    <div class="sb-scrubber-track">
                        <div class="sb-scrubber-fill" style="width:${pct}%"></div>
                        <div class="sb-scrubber-thumb" style="left:${pct}%"></div>
                        ${markers}
                    </div>
                </div>
                <button class="sb-btn sb-speed" data-action="cycle-speed" title="Velocidade" aria-label="Speed ${speedLabel}">
                    ${speedLabel}
                </button>
                <button class="sb-btn sb-loop${playback.loop ? ' active' : ''}"
                        data-action="toggle-loop" title="Loop" aria-label="Loop ${playback.loop ? 'on' : 'off'}">
                    ${getIcon('repeat', { size: '14px' })}
                </button>
                <button class="sb-btn sb-video-btn${videoBtnClass}"
                        data-action="open-video-bot" title="Bot IA — Generate video" aria-label="Generate video">
                    ${getIcon('film', { size: '14px' })}
                </button>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// VIDEO BOT — Inline UI (substituiu o painel flutuante)
// ----------------------------------------------------------------

function _renderVideoBotUI(keyframes, playback) {
    const kfCount = keyframes.length;
    const totalSec = Math.max(1, Math.round(playback.totalDuration / 1000));
    const estFrames = Math.max(totalSec, 2);
    const estTime = Math.ceil(estFrames * 1.5);
    const isGen = !!window._ecbytsVideoGenerating;

    if (kfCount < 2) {
        return `
            <div class="sb-videobot">
                <div class="sb-videobot-row">
                    <button class="sb-btn" data-action="close-video-bot">
                        ${getIcon('arrow-left', { size: '14px' })}
                    </button>
                    <span class="sb-videobot-msg">
                        Adicione pelo menos 2 keyframes (botao + nos cards) para gerar video.
                    </span>
                </div>
            </div>`;
    }

    if (isGen) {
        return `
            <div class="sb-videobot">
                <div class="sb-videobot-row">
                    <button class="sb-btn" data-action="cancel-video-gen">
                        ${getIcon('x', { size: '14px' })}
                    </button>
                    <div class="sb-videobot-progress-wrap">
                        <div class="sb-video-progress"><div class="sb-video-progress-fill" id="sb-vb-progress"></div></div>
                        <span class="sb-videobot-status" id="sb-vb-status">Iniciando...</span>
                    </div>
                </div>
            </div>`;
    }

    // Le key Runway salva na sessao para pre-preencher
    const savedRunwayKey = _escapeAttr(sessionStorage.getItem('ecbyts_video_key') || '');

    return `
        <div class="sb-videobot">
            <div class="sb-videobot-row">
                <button class="sb-btn" data-action="close-video-bot" title="Voltar">
                    ${getIcon('arrow-left', { size: '14px' })}
                </button>
                <textarea class="sb-videobot-prompt" id="sb-vb-prompt" rows="2"
                          placeholder="Descreva o video (opcional)... Ex: voo cinematico com luz dourada"></textarea>
                <select id="sb-vb-style" class="sb-videobot-select">
                    <option value="photorealistic">Fotorrealista</option>
                    <option value="technical">Tecnico</option>
                    <option value="artistic">Artistico</option>
                </select>
                <select id="sb-vb-vidprovider" class="sb-videobot-select"
                        onchange="(()=>{const rk=document.getElementById('sb-vb-runway-key');if(rk)rk.style.display=this.value==='runway'?'':'none';})()">
                    <option value="veo2">Google Veo 2</option>
                    <option value="runway">Runway Gen-3</option>
                </select>
                <button class="sb-btn sb-videobot-gen" data-action="start-video-gen">
                    ${getIcon('play', { size: '12px' })} Gerar
                </button>
            </div>
            <input id="sb-vb-runway-key" type="password" class="sb-videobot-prompt"
                   placeholder="Runway key (rw-...)" value="${savedRunwayKey}"
                   style="display:none;font-size:11px;padding:3px 6px;"
                   oninput="sessionStorage.setItem('ecbyts_video_key', this.value)">
            <div class="sb-videobot-meta">${kfCount} keyframes &middot; ${totalSec}s &middot; 720p 12fps &middot; ~${estTime}s estimado</div>
        </div>`;
}

// ----------------------------------------------------------------
// EVENT HANDLING — Delegated
// ----------------------------------------------------------------

function _handleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
        case 'fly-to-item': {
            const itemId = target.dataset.itemId;
            _activeItemId = itemId;
            flyToItem(itemId).then(() => {
                // Recaptura thumbnail apos camera estabilizar
                setTimeout(() => _captureThumbnails(), 300);
            });
            render();
            break;
        }
        case 'add-keyframe': {
            e.stopPropagation(); // previne fly-to-item do card pai
            const itemId = target.dataset.itemId;
            addKeyframe(itemId);
            render();
            break;
        }
        case 'remove-keyframe': {
            e.stopPropagation(); // previne seek-keyframe do marker pai
            const kfId = target.dataset.kfId;
            removeKeyframe(kfId);
            render();
            break;
        }
        case 'play':
            getPlayback().playing ? pause() : play();
            render();
            break;
        case 'stop':
            stop();
            render();
            break;
        case 'seek-keyframe': {
            const kfId = target.dataset.kfId;
            flyToKeyframe(kfId);
            render();
            break;
        }
        case 'cycle-speed': {
            const current = getPlayback().speed;
            const idx = SPEED_OPTIONS.indexOf(current);
            const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
            setPlaybackSpeed(next);
            render();
            break;
        }
        case 'toggle-loop': {
            setPlaybackLoop(!getPlayback().loop);
            render();
            break;
        }
        case 'open-video-bot':
            _videoBotMode = true;
            _dismissPopover();
            render();
            break;
        case 'close-video-bot':
            _videoBotMode = false;
            render();
            break;
        case 'start-video-gen':
            _startVideoGeneration();
            break;
        case 'cancel-video-gen':
            _cancelVideoGeneration();
            break;
        case 'refresh-items':
            window.handleRefreshStoryboard?.();
            break;
    }
}

function _handleMouseDown(e) {
    // Keyframe drag-to-reorder
    const kfMarker = e.target.closest('.sb-kf-marker');
    if (kfMarker && !e.target.closest('.sb-kf-delete')) {
        const kfId = kfMarker.dataset.kfId;
        const scrubWrap = _container.querySelector('[data-action="scrub"]');
        if (!scrubWrap) return;

        // Delay para distinguir click de drag
        let hasMoved = false;
        const onMove = (ev) => {
            hasMoved = true;
            const rect = scrubWrap.getBoundingClientRect();
            const newPos = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            moveKeyframe(kfId, newPos);
            kfMarker.style.left = (newPos * 100).toFixed(1) + '%';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (hasMoved) render();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
    }

    // Scrubber drag
    const scrubWrap = e.target.closest('[data-action="scrub"]');
    if (!scrubWrap) return;

    _isDraggingScrubber = true;
    _scrubToEvent(e, scrubWrap);

    const onMove = (ev) => {
        if (_isDraggingScrubber) _scrubToEvent(ev, scrubWrap);
    };
    const onUp = () => {
        _isDraggingScrubber = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function _handleDblClick(e) {
    // Double-click on keyframe marker = edit popover (consistent with right-click)
    const marker = e.target.closest('.sb-kf-marker');
    if (marker) {
        e.preventDefault();
        const kfId = marker.dataset.kfId;
        const rect = marker.getBoundingClientRect();
        _showKeyframePopover(kfId, rect);
        return;
    }
    // Double-click on action bar card = add keyframe for this item
    const card = e.target.closest('[data-action="fly-to-item"]');
    if (!card) return;

    const itemId = card.dataset.itemId;
    addKeyframe(itemId);
    render();
}

function _handleContextMenu(e) {
    // Right-click on keyframe marker = edit popover
    const marker = e.target.closest('.sb-kf-marker');
    if (!marker) return;

    e.preventDefault();
    const kfId = marker.dataset.kfId;
    const rect = marker.getBoundingClientRect();
    _showKeyframePopover(kfId, rect);
}

function _handleKeyDown(e) {
    // Enter/Space on focused keyframe marker = open edit popover
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const marker = e.target.closest('.sb-kf-marker');
    if (!marker) return;

    e.preventDefault();
    const kfId = marker.dataset.kfId;
    const rect = marker.getBoundingClientRect();
    _showKeyframePopover(kfId, rect);
}

function _scrubToEvent(e, wrap) {
    const rect = wrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(x);
}

// ----------------------------------------------------------------
// KEYFRAME EDIT POPOVER
// ----------------------------------------------------------------

function _showKeyframePopover(kfId, anchorRect) {
    _dismissPopover();
    const kf = getKeyframes().find((k) => k.id === kfId);
    if (!kf) return;

    const popover = document.createElement('div');
    popover.className = 'sb-kf-popover';
    popover.style.left = `${anchorRect.left}px`;
    popover.style.bottom = `${window.innerHeight - anchorRect.top + 8}px`;

    const easings = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
    const durationValue = Number.isFinite(kf.duration) ? kf.duration : 3000;
    const transitionValue = Number.isFinite(kf.transition) ? kf.transition : 1000;
    const annotationValue = _escapeAttr(kf.annotation || '');
    const keyframeIdAttr = _escapeAttr(kf.id);
    popover.innerHTML = `
        <div class="sb-kf-popover-title">Keyframe</div>
        <label class="sb-kf-popover-field">
            Duration (ms)
            <input type="number" data-field="duration" value="${durationValue}" min="500" step="500">
        </label>
        <label class="sb-kf-popover-field">
            Transition (ms)
            <input type="number" data-field="transition" value="${transitionValue}" min="200" step="200">
        </label>
        <label class="sb-kf-popover-field">
            Easing
            <select data-field="easing">
                ${easings.map((e) => `<option value="${e}"${kf.easing === e ? ' selected' : ''}>${e}</option>`).join('')}
            </select>
        </label>
        <label class="sb-kf-popover-field">
            Annotation
            <input type="text" data-field="annotation" value="${annotationValue}" maxlength="100"
                   placeholder="Optional note...">
        </label>
        <div class="sb-kf-popover-actions">
            <button class="sb-btn" data-action="apply-kf-edit" data-kf-id="${keyframeIdAttr}">Apply</button>
        </div>
    `;
    document.body.appendChild(popover);

    // Direct click handler for Apply (outside _container delegation scope)
    const applyBtn = popover.querySelector('[data-action="apply-kf-edit"]');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => _applyKeyframeEdit(kfId));
    }

    // Click-outside dismissal
    setTimeout(() => {
        document.addEventListener('mousedown', _dismissPopoverOnOutside);
    }, 0);
}

function _applyKeyframeEdit(kfId) {
    const popover = document.querySelector('.sb-kf-popover');
    if (!popover) return;

    const updates = {};
    popover.querySelectorAll('[data-field]').forEach((input) => {
        const field = input.dataset.field;
        updates[field] = input.type === 'number' ? Number(input.value) : input.value;
    });

    updateKeyframe(kfId, updates);
    _dismissPopover();
    render();
}

function _dismissPopover() {
    const existing = document.querySelector('.sb-kf-popover');
    if (existing) existing.remove();
    document.removeEventListener('mousedown', _dismissPopoverOnOutside);
}

function _dismissPopoverOnOutside(e) {
    const popover = document.querySelector('.sb-kf-popover');
    if (popover && !popover.contains(e.target)) {
        _dismissPopover();
    }
}

// ----------------------------------------------------------------
// VIDEO BOT — Start / Cancel (inline, sem painel flutuante)
// ----------------------------------------------------------------

async function _startVideoGeneration() {
    const style = _container?.querySelector('#sb-vb-style')?.value || 'photorealistic';
    const customPrompt = _container?.querySelector('#sb-vb-prompt')?.value || '';
    const videoProvider = _container?.querySelector('#sb-vb-vidprovider')?.value || 'veo2';
    const videoKey = sessionStorage.getItem('ecbyts_video_key') || undefined;

    window._ecbytsVideoGenerating = true;
    render(); // mostra UI de progresso inline

    try {
        const { generateTimelineVideo, onProgress } = await import('./videoBot.js');

        const unsub = onProgress((info) => {
            const fill = _container?.querySelector('#sb-vb-progress');
            const status = _container?.querySelector('#sb-vb-status');
            if (fill) fill.style.width = `${info.percent || 0}%`;
            if (status) status.textContent = info.message || `${info.stage}...`;
        });

        const result = await generateTimelineVideo({
            style,
            resolution: '720p',
            fps: 12,
            customPrompt,
            interpolated: true,
            videoProvider,
            videoKey,
        });

        unsub();

        // Download do video MP4 gerado pela IA
        if (result?.videoBlob) {
            const url = URL.createObjectURL(result.videoBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ecbyts-video-${Date.now()}.${result.videoExt || 'mp4'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        const { showToast } = await import('../../utils/ui/toast.js');
        const providerLabel = videoProvider === 'runway' ? 'Runway Gen-3' : 'Google Veo 2';
        showToast(`Video gerado por ${providerLabel} e baixado!`, 'success');
    } catch (err) {
        try {
            const { showToast } = await import('../../utils/ui/toast.js');
            showToast(`Erro: ${err.message}`, 'error');
        } catch {
            /* ignore */
        }
    } finally {
        window._ecbytsVideoGenerating = false;
        _videoBotMode = false;
        render();
    }
}

function _cancelVideoGeneration() {
    import('./videoBot.js')
        .then(({ cancelGeneration }) => {
            cancelGeneration();
        })
        .catch(() => {});
    window._ecbytsVideoGenerating = false;
    _videoBotMode = false;
    render();
}

// ----------------------------------------------------------------
// UI UPDATE — Called by engine tick (lightweight, no re-render)
// ----------------------------------------------------------------

function _updatePlaybackUI(info) {
    if (!_container) return;

    // Update scrubber position
    const fill = _container.querySelector('.sb-scrubber-fill');
    const thumb = _container.querySelector('.sb-scrubber-thumb');
    const timeEl = _container.querySelector('.sb-time');

    if (fill && thumb) {
        const pct = (info.position * 100).toFixed(1) + '%';
        fill.style.width = pct;
        thumb.style.left = pct;
    }

    if (timeEl) {
        const playback = getPlayback();
        const elapsed = _formatTime((info.position * playback.totalDuration) / 1000);
        const total = _formatTime(playback.totalDuration / 1000);
        timeEl.textContent = `${elapsed} / ${total}`;
    }

    // Update active card highlight
    if (info.activeKeyframe) {
        const newActiveId = info.activeKeyframe.itemId;
        if (newActiveId !== _activeItemId) {
            _activeItemId = newActiveId;
            _updateActiveCard();
        }
    }
}

function _updateActiveCard() {
    if (!_container) return;
    const cards = _container.querySelectorAll('.sb-card');
    cards.forEach((card) => {
        card.classList.toggle('active', card.dataset.itemId === _activeItemId);
    });
}

// ----------------------------------------------------------------
// THUMBNAIL CAPTURE — Screenshot de cada item
// ----------------------------------------------------------------

async function _captureThumbnails() {
    if (_isCapturing) return;
    const items = getItems();
    if (items.length === 0) return;

    const renderer = getRenderer();
    if (!renderer || !renderer.domElement) return;

    _isCapturing = true;
    const originalCamera = getCameraState();

    const offscreen = document.createElement('canvas');
    offscreen.width = THUMB_SIZE;
    offscreen.height = THUMB_SIZE;
    const ctx = offscreen.getContext('2d');

    for (const item of items) {
        if (_thumbnails[item.id]) continue; // ja capturado
        if (!item.cameraState) continue;

        // Posicionar camera na vista do item
        setCameraState(item.cameraState);
        requestRender();

        // Esperar um frame para o render completar
        await new Promise((r) => requestAnimationFrame(r));

        // Crop quadrado do centro do canvas
        const src = renderer.domElement;
        const size = Math.min(src.width, src.height);
        const sx = (src.width - size) / 2;
        const sy = (src.height - size) / 2;

        ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
        ctx.drawImage(src, sx, sy, size, size, 0, 0, THUMB_SIZE, THUMB_SIZE);

        _thumbnails[item.id] = offscreen.toDataURL('image/jpeg', 0.65);
    }

    // Restaurar camera original
    setCameraState(originalCamera);
    requestRender();
    _isCapturing = false;

    // Re-render para mostrar thumbnails
    render();
}

/**
 * Forca recaptura de thumbnails (chamado apos mudanca de cena).
 */
export function refreshThumbnails() {
    _thumbnails = {};
    _captureThumbnails();
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

const _ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function _escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => _ESCAPE_MAP[ch] || ch);
}

function _escapeAttr(value) {
    return _escapeHtml(value);
}

function _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function _isVideoGenerating() {
    return !!window._ecbytsVideoGenerating;
}
