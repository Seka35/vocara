/**
 * Vocara Hybrid Scanner Engine
 * Enhanced Feature Extraction with Noise Filtering & Adaptive Thresholding
 */
const Scanner = (function () {
    "use strict";

    const N_BINS = 64;
    let camStream = null;

    async function startCamera(videoElement) {
        try {
            camStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: "environment" },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            videoElement.srcObject = camStream;
            return true;
        } catch (e) {
            console.error('Camera access error:', e);
            return false;
        }
    }

    function stopCamera(videoElement) {
        if (camStream) {
            camStream.getTracks().forEach(t => t.stop());
            camStream = null;
        }
        if (videoElement) {
            videoElement.srcObject = null;
        }
    }

    function otsuThreshold(gray, w, h) {
        const hist = new Array(256).fill(0);
        for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
        const total = gray.length;
        let sum = 0;
        for (let t = 0; t < 256; t++) sum += t * hist[t];
        let sumB = 0, wB = 0, wF = 0, varMax = 0, threshold = 127;
        for (let t = 0; t < 256; t++) {
            wB += hist[t]; if (wB === 0) continue;
            wF = total - wB; if (wF === 0) break;
            sumB += t * hist[t];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const varBetween = wB * wF * (mB - mF) * (mB - mF);
            if (varBetween > varMax) { varMax = varBetween; threshold = t; }
        }
        return threshold;
    }

    function imageToProfile(canvas) {
        const w = canvas.width, h = canvas.height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, w, h).data;
        const gray = new Uint8ClampedArray(w * h);

        let sumGray = 0;
        for (let i = 0; i < w * h; i++) {
            const r = imgData[i * 4], g = imgData[i * 4 + 1], b = imgData[i * 4 + 2];
            const gVal = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
            gray[i] = gVal;
            sumGray += gVal;
        }

        const threshold = otsuThreshold(gray, w, h);

        // 1. Contrast Check: Measure contrast difference between Ink & Background
        let inkSum = 0, inkCount = 0, bgSum = 0, bgCount = 0;
        for (let i = 0; i < w * h; i++) {
            if (gray[i] < threshold) {
                inkSum += gray[i];
                inkCount++;
            } else {
                bgSum += gray[i];
                bgCount++;
            }
        }

        const inkMean = inkCount > 0 ? inkSum / inkCount : 0;
        const bgMean = bgCount > 0 ? bgSum / bgCount : 255;
        const contrast = bgMean - inkMean;

        // Contrast check (contrast >= 20 for real printed/screen sound motifs)
        if (contrast < 20 || inkCount < (w * h * 0.01) || inkCount > (w * h * 0.85)) {
            return null;
        }

        // 2. Waveform Geometry Extraction
        const colHeights = new Array(w).fill(0);
        const colTops = new Array(w).fill(-1);
        const colBots = new Array(w).fill(-1);

        let globalMinTop = h, globalMaxBot = 0;

        for (let x = 0; x < w; x++) {
            let top = -1, bottom = -1;
            for (let y = 0; y < h; y++) {
                const isInk = gray[y * w + x] < threshold;
                if (isInk) {
                    if (top === -1) top = y;
                    bottom = y;
                }
            }
            if (top !== -1 && bottom !== -1) {
                colTops[x] = top;
                colBots[x] = bottom;
                colHeights[x] = bottom - top;
                if (top < globalMinTop) globalMinTop = top;
                if (bottom > globalMaxBot) globalMaxBot = bottom;
            }
        }

        // 3. Symmetry Check: Audio waveforms are vertically symmetric around center axis
        const centerY = (globalMinTop + globalMaxBot) / 2;
        let symSum = 0, symCount = 0;

        for (let x = 0; x < w; x++) {
            if (colHeights[x] > 4) {
                const topDist = Math.abs(centerY - colTops[x]);
                const botDist = Math.abs(colBots[x] - centerY);
                const maxD = Math.max(topDist, botDist);
                const minD = Math.min(topDist, botDist);
                const symRatio = maxD > 0 ? minD / maxD : 0;
                symSum += symRatio;
                symCount++;
            }
        }

        const avgSymmetry = symCount > 0 ? symSum / symCount : 0;
        // Require symmetry (>= 0.42) to distinguish audio stencil bars from arbitrary shapes (faces, clothes, background)
        if (avgSymmetry < 0.42) {
            return null;
        }

        // 4. Moving Average Smoothing
        const smoothedHeights = new Array(w).fill(0);
        for (let x = 0; x < w; x++) {
            const prev = x > 0 ? colHeights[x - 1] : colHeights[x];
            const curr = colHeights[x];
            const next = x < w - 1 ? colHeights[x + 1] : colHeights[x];
            smoothedHeights[x] = (prev + curr * 2 + next) / 4;
        }

        // 5. Bin Reduction (64 Bins)
        const bins = new Array(N_BINS).fill(0);
        const blockSize = w / N_BINS;
        for (let b = 0; b < N_BINS; b++) {
            const start = Math.floor(b * blockSize);
            const end = Math.max(start + 1, Math.floor((b + 1) * blockSize));
            let sum = 0, count = 0;
            for (let x = start; x < end && x < w; x++) {
                sum += smoothedHeights[x];
                count++;
            }
            bins[b] = count > 0 ? sum / count : 0;
        }

        const max = Math.max(...bins);
        if (max < h * 0.05) {
            return null;
        }

        const normalized = bins.map(v => Math.max(0, Math.min(1, v / max)));
        
        // 6. Variance & Peak Count Verification
        const mean = normalized.reduce((a, b) => a + b, 0) / N_BINS;
        const variance = normalized.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / N_BINS;
        const stdDev = Math.sqrt(variance);

        if (stdDev < 0.05) {
            return null;
        }

        // Count local peaks across 64 bins (real audio waveforms have multiple peaks)
        let peakCount = 0;
        for (let i = 1; i < N_BINS - 1; i++) {
            if (normalized[i] > normalized[i - 1] && normalized[i] > normalized[i + 1] && normalized[i] > 0.15) {
                peakCount++;
            }
        }

        if (peakCount < 1) {
            return null;
        }

        return normalized;
    }

    async function analyzeCanvas(canvas, soundCodeText) {
        const fingerprint = imageToProfile(canvas);

        if (!fingerprint) {
            return { success: false, message: 'No sound motif detected in target frame.' };
        }

        const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fingerprint,
                soundCode: soundCodeText || null
            })
        });

        const data = await res.json();
        return data;
    }

    return {
        startCamera,
        stopCamera,
        analyzeCanvas,
        imageToProfile
    };
})();

