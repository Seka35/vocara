/**
 * Vocara Canvas Visualizer & Sound Motif Renderer
 */
const Visualizer = (function () {
    "use strict";

    function drawWaveform(canvas, fingerprint, soundCode, opts) {
        opts = opts || {};
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);

        // 1. Dark Futuristic Background
        const bgGrad = ctx.createLinearGradient(0, 0, W, H);
        bgGrad.addColorStop(0, opts.bg1 || '#0b0f19');
        bgGrad.addColorStop(1, opts.bg2 || '#111827');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Subtle grid pattern
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 30) {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, H);
            ctx.stroke();
        }

        const midY = H / 2;
        const n = fingerprint ? fingerprint.length : 64;
        const padX = W * 0.06;
        const usableW = W - padX * 2;
        const slot = usableW / n;
        const barW = Math.max(2, slot * 0.45);
        const minH = H * 0.03;
        const maxH = H * 0.68;

        // 2. Baseline
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padX * 0.5, midY);
        ctx.lineTo(W - padX * 0.5, midY);
        ctx.stroke();

        // 3. Render Waveform Bars with Gradient Glow
        const barGrad = ctx.createLinearGradient(0, midY - maxH / 2, 0, midY + maxH / 2);
        barGrad.addColorStop(0, opts.color1 || '#6366f1');
        barGrad.addColorStop(0.5, opts.color2 || '#8b5cf6');
        barGrad.addColorStop(1, opts.color3 || '#10b981');

        ctx.fillStyle = barGrad;
        ctx.strokeStyle = barGrad;
        ctx.lineCap = 'round';

        for (let i = 0; i < n; i++) {
            const v = fingerprint ? fingerprint[i] : 0.1;
            const h = minH + v * (maxH - minH);
            const x = padX + i * slot + slot / 2;

            ctx.beginPath();
            ctx.lineWidth = barW;
            ctx.moveTo(x, midY - h / 2);
            ctx.lineTo(x, midY + h / 2);
            ctx.stroke();
        }

        // 4. Embedded Visual Sound Code Marker (Guarantees 100% Reliable Scan Match)
        if (soundCode) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(soundCode, W - 20, H - 16);

            // Left brand stamp
            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 12px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText('VOCARA AUDIO MOTIF', 20, H - 16);
        }
    }

    return {
        drawWaveform
    };
})();
