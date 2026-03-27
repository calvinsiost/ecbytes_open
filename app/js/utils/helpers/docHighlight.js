// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/**
 * Computes a highlight rectangle in wrapper-local CSS pixels.
 * Converts PDF-point bbox -> rendered canvas pixels -> CSS pixels and offsets.
 *
 * @param {{
 *   bbox: {x0:number,y0:number,x1:number,y1:number},
 *   pdfScale: number,
 *   canvasWidth: number,
 *   canvasHeight: number,
 *   canvasRect: {left:number,top:number,width:number,height:number},
 *   wrapperRect: {left:number,top:number},
 *   padX?: number,
 *   padY?: number
 * }} params
 * @returns {{left:number,top:number,width:number,height:number}|null}
 */
export function computeDocHighlightRect(params) {
    const { bbox, pdfScale, canvasWidth, canvasHeight, canvasRect, wrapperRect, padX = 8, padY = 4 } = params || {};

    if (!bbox || bbox.x0 == null || bbox.y0 == null || bbox.x1 == null || bbox.y1 == null) return null;
    if (!canvasRect || !wrapperRect) return null;
    if (!Number.isFinite(pdfScale) || pdfScale <= 0) return null;
    if (!Number.isFinite(canvasWidth) || canvasWidth <= 0 || !Number.isFinite(canvasHeight) || canvasHeight <= 0)
        return null;

    const scaleX = canvasRect.width / canvasWidth;
    const scaleY = canvasRect.height / canvasHeight;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;

    const offX = canvasRect.left - wrapperRect.left;
    const offY = canvasRect.top - wrapperRect.top;

    const rawLeft = offX + bbox.x0 * pdfScale * scaleX;
    const rawTop = offY + bbox.y0 * pdfScale * scaleY;
    const rawWidth = (bbox.x1 - bbox.x0) * pdfScale * scaleX;
    const rawHeight = (bbox.y1 - bbox.y0) * pdfScale * scaleY;

    if (
        !Number.isFinite(rawLeft) ||
        !Number.isFinite(rawTop) ||
        !Number.isFinite(rawWidth) ||
        !Number.isFinite(rawHeight)
    )
        return null;
    if (rawWidth <= 0 || rawHeight <= 0) return null;

    return {
        left: Math.max(0, rawLeft - padX),
        top: Math.max(0, rawTop - padY),
        width: Math.max(1, rawWidth + padX * 2),
        height: Math.max(1, rawHeight + padY * 2),
    };
}
