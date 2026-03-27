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
   PLUME ANIMATION HANDLERS
   utils/handlers/plumeAnimation.js

   Handlers window.* para animacao temporal de plumas.
   Registrados em utils/handlers/index.js.
   ================================================================ */

import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { withLoading } from '../ui/loadingOverlay.js';
import {
    generatePlumeAnimation,
    playPlumeAnimation,
    addPlumeAnimationToSequencer,
    removePlumeAnimation,
    getAllPlumeAnimations,
} from '../../core/sequencer/plumeAnimation.js';
import { openPlumeAnimationDialog, closePlumeAnimationDialog } from '../ui/plumeAnimationDialog.js';

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Abre o dialogo de configuracao de animacao de pluma.
 * Chamado via inspector context menu em elementos da familia 'plume'.
 *
 * @param {string} elementId - ID do elemento pluma
 */
async function handleOpenPlumeAnimationDialog(elementId) {
    if (!elementId) {
        showToast(t('plumeAnimation.selectElement') || 'Selecione um elemento do tipo Pluma.', 'warning');
        return;
    }

    openPlumeAnimationDialog(elementId, handleGeneratePlumeAnimation);
}

/**
 * Gera a animacao com as opcoes configuradas no dialogo.
 * Chamado pelo callback do openPlumeAnimationDialog.
 *
 * @param {string} elementId
 * @param {Object} options - { parameterId, method }
 */
async function handleGeneratePlumeAnimation(elementId, options) {
    try {
        let anim;

        await withLoading(async (setMsg, setProgress) => {
            setMsg(t('plumeAnimation.generating') || 'Gerando animacao...');

            anim = await generatePlumeAnimation(elementId, {
                ...options,
                onProgress: (pct) => setProgress(Math.round(pct * 100)),
            });
        });

        if (!anim) return;

        showToast(
            `${t('plumeAnimation.generated') || 'Animacao gerada'}: ${anim.frames.length} ${t('plumeAnimation.frames') || 'frames'}`,
            'success',
        );

        // Registra automaticamente no sequencer e inicia playback
        addPlumeAnimationToSequencer(anim.id);

        showToast(
            t('plumeAnimation.registeredSequencer') || 'Animacao registrada no sequencer. Use Play para reproduzir.',
            'info',
        );
    } catch (err) {
        console.error('[ecbyts] handleGeneratePlumeAnimation:', err);
        showToast(`${t('plumeAnimation.error') || 'Erro ao gerar animacao'}: ${err.message}`, 'error');
    }
}

/**
 * Inicia o playback de uma animacao de pluma.
 *
 * @param {string} animationId
 */
function handlePlayPlumeAnimation(animationId) {
    if (!animationId) {
        // Se nao fornecido, usa a primeira animacao disponivel
        const anims = getAllPlumeAnimations();
        if (anims.length === 0) {
            showToast(t('plumeAnimation.noAnimations') || 'Nenhuma animacao de pluma gerada.', 'warning');
            return;
        }
        animationId = anims[0].id;
    }

    try {
        playPlumeAnimation(animationId);
        showToast(t('plumeAnimation.playing') || 'Reproduzindo animacao de pluma...', 'info');
    } catch (err) {
        console.error('[ecbyts] handlePlayPlumeAnimation:', err);
        showToast(`${t('plumeAnimation.error') || 'Erro'}: ${err.message}`, 'error');
    }
}

/**
 * Remove uma animacao de pluma e seus recursos.
 *
 * @param {string} animationId
 */
function handleRemovePlumeAnimation(animationId) {
    try {
        removePlumeAnimation(animationId);
        showToast(t('plumeAnimation.removed') || 'Animacao removida.', 'info');
    } catch (err) {
        console.error('[ecbyts] handleRemovePlumeAnimation:', err);
    }
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const plumeAnimationHandlers = {
    handleOpenPlumeAnimationDialog,
    handleGeneratePlumeAnimation,
    handlePlayPlumeAnimation,
    handleRemovePlumeAnimation,
};
