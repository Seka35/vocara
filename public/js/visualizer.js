/**
 * Vocara Canvas Visualizer & Sound Motif Renderer
 * Modern Real-Time Lighted Audio Progress & Interactive Seeking Engine
 */
const Visualizer = (function () {
    "use strict";

    function drawWaveform(canvas, fingerprint, soundCode, opts) {
        opts = opts || {};
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;

        ctx.save();
        ctx.clearRect(0, 0, W, H);

        const isExport = opts.exportMode === true || opts.transparent === true;
        const progress = typeof opts.progress === 'number' ? Math.max(0, Math.min(1, opts.progress)) : 0;
        const isPlaying = opts.isPlaying === true;
        const hoverProgress = typeof opts.hoverProgress === 'number' ? Math.max(0, Math.min(1, opts.hoverProgress)) : null;

        if (!isExport) {
            // 1. Futuristic Pitch Black & Dark Amber Gradient Background
            const bgGrad = ctx.createLinearGradient(0, 0, W, H);
            bgGrad.addColorStop(0, opts.bg1 || '#07070b');
            bgGrad.addColorStop(1, opts.bg2 || '#111119');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, W, H);

            // Subtle cybernetic grid
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
            ctx.lineWidth = 1;
            for (let x = 0; x < W; x += 25) {
                ctx.beginPath();
                ctx.moveTo(x, 0); ctx.lineTo(x, H);
                ctx.stroke();
            }
        }

        const midY = H / 2;
        const n = (fingerprint && fingerprint.length) ? fingerprint.length : 64;
        const padX = W * 0.06;
        const usableW = W - padX * 2;
        const slot = usableW / n;
        const barW = Math.max(2, slot * 0.46);
        const minH = H * 0.04;
        const maxH = H * 0.68;

        // 2. Center Baseline
        if (!isExport) {
            // Ambient baseline glow
            ctx.shadowColor = 'rgba(255, 107, 0, 0.5)';
            ctx.shadowBlur = 8;
            ctx.strokeStyle = 'rgba(255, 107, 0, 0.25)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(padX * 0.4, midY);
            ctx.lineTo(W - padX * 0.4, midY);
            ctx.stroke();
            ctx.shadowBlur = 0;
        } else {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(padX * 0.4, midY);
            ctx.lineTo(W - padX * 0.4, midY);
            ctx.stroke();
        }

        // 3. Render Waveform Bars with Real-Time Progress Lighting
        ctx.lineCap = 'round';

        for (let i = 0; i < n; i++) {
            const v = (fingerprint && fingerprint[i] !== undefined) ? fingerprint[i] : 0.1;
            const h = minH + v * (maxH - minH);
            const x = padX + i * slot + slot / 2;
            const barNormPos = n > 1 ? i / (n - 1) : 0;
            const isPlayed = !isExport && (barNormPos <= progress);

            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = barW;
            ctx.moveTo(x, midY - h / 2);
            ctx.lineTo(x, midY + h / 2);

            if (isExport) {
                ctx.strokeStyle = '#000000';
            } else if (isPlayed) {
                // Vibrant Neon Played Bar with Electric Glow
                ctx.shadowColor = '#ff6b00';
                ctx.shadowBlur = isPlaying ? 14 : 8;

                const playedGrad = ctx.createLinearGradient(0, midY - h / 2, 0, midY + h / 2);
                playedGrad.addColorStop(0, '#fff4e6');
                playedGrad.addColorStop(0.2, '#ffaa00');
                playedGrad.addColorStop(0.5, '#ff5500');
                playedGrad.addColorStop(1, '#ff2200');
                ctx.strokeStyle = playedGrad;
            } else {
                // Dim Unplayed / Default Bar
                const unplayedGrad = ctx.createLinearGradient(0, midY - h / 2, 0, midY + h / 2);
                unplayedGrad.addColorStop(0, 'rgba(255, 140, 0, 0.45)');
                unplayedGrad.addColorStop(0.5, 'rgba(255, 107, 0, 0.35)');
                unplayedGrad.addColorStop(1, 'rgba(200, 70, 0, 0.25)');
                ctx.strokeStyle = unplayedGrad;
                ctx.shadowBlur = 0;
            }

            ctx.stroke();
            ctx.restore();
        }

        // 4. Glowing Playhead Laser Line & Indicator Dot
        if (!isExport && progress > 0) {
            const playheadX = padX + progress * usableW;

            // Vertical Laser Line
            ctx.save();
            ctx.shadowColor = '#ff6b00';
            ctx.shadowBlur = isPlaying ? 16 : 10;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(playheadX, midY - maxH * 0.58);
            ctx.lineTo(playheadX, midY + maxH * 0.58);
            ctx.stroke();

            // Laser Head Outer Ring
            ctx.fillStyle = '#ff6b00';
            ctx.beginPath();
            ctx.arc(playheadX, midY, isPlaying ? 6 : 5, 0, Math.PI * 2);
            ctx.fill();

            // Laser Core White Dot
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(playheadX, midY, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 5. Hover Seek Preview Indicator
        if (!isExport && hoverProgress !== null && Math.abs(hoverProgress - progress) > 0.01) {
            const hoverX = padX + hoverProgress * usableW;
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(hoverX, midY - maxH * 0.5);
            ctx.lineTo(hoverX, midY + maxH * 0.5);
            ctx.stroke();
            ctx.restore();
        }

        // 6. Sound Code & Brand Marker (Only for web UI display, excluded from export stencils)
        if (soundCode && !isExport) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 13px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(soundCode, W - 18, H - 14);

            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 11px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText('VOCARA AUDIO MOTIF', 18, H - 14);
        }

        ctx.restore();
    }

    /**
     * Attach Interactive Canvas Seek Controls to Audio Element
     */
    function attachSeekHandler(canvas, audioEl, fingerprint, soundCode, opts) {
        opts = opts || {};
        audioEl.loop = false; // Ensure audio never loops automatically
        let isDragging = false;
        let hoverProgress = null;
        let animFrameId = null;

        function getProgressFromEvent(e) {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clickX = clientX - rect.left;
            const padX = rect.width * 0.06;
            const usableW = rect.width - padX * 2;
            if (usableW <= 0) return 0;
            const p = (clickX - padX) / usableW;
            return Math.max(0, Math.min(1, p));
        }

        function renderCurrentState() {
            const durValid = audioEl.duration && isFinite(audioEl.duration) && audioEl.duration > 0;
            const duration = durValid ? audioEl.duration : 1;
            const currentTime = (audioEl.currentTime && isFinite(audioEl.currentTime)) ? audioEl.currentTime : 0;
            const progress = durValid ? (currentTime / duration) : 0;
            const isPlaying = !audioEl.paused && !audioEl.ended;

            drawWaveform(canvas, fingerprint, soundCode, {
                ...opts,
                progress: isFinite(progress) ? progress : 0,
                isPlaying: isPlaying,
                hoverProgress: hoverProgress
            });

            if (isPlaying) {
                animFrameId = requestAnimationFrame(renderCurrentState);
            }
        }

        function applySeek(p) {
            if (audioEl.duration && isFinite(audioEl.duration) && audioEl.duration > 0) {
                const targetTime = p * audioEl.duration;
                if (isFinite(targetTime)) {
                    try {
                        audioEl.currentTime = targetTime;
                    } catch (err) {}
                }
            }
            renderCurrentState();
        }

        function seekToEvent(e) {
            const p = getProgressFromEvent(e);
            applySeek(p);

            if (audioEl.paused) {
                audioEl.play().then(() => {
                    applySeek(p);
                }).catch(() => {});
            }
        }

        // Mouse Events
        canvas.addEventListener('mousemove', (e) => {
            hoverProgress = getProgressFromEvent(e);
            if (isDragging) seekToEvent(e);
            else renderCurrentState();
        });

        canvas.addEventListener('mouseleave', () => {
            hoverProgress = null;
            isDragging = false;
            renderCurrentState();
        });

        canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            seekToEvent(e);
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
            }
        });

        // Touch Events
        canvas.addEventListener('touchstart', (e) => {
            isDragging = true;
            seekToEvent(e);
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (isDragging) seekToEvent(e);
        }, { passive: true });

        canvas.addEventListener('touchend', () => {
            isDragging = false;
            hoverProgress = null;
            renderCurrentState();
        });

        // Audio State Listeners
        audioEl.addEventListener('play', () => {
            if (animFrameId) cancelAnimationFrame(animFrameId);
            renderCurrentState();
        });

        audioEl.addEventListener('timeupdate', () => {
            if (audioEl.paused) {
                renderCurrentState();
            }
        });

        audioEl.addEventListener('pause', () => {
            if (animFrameId) cancelAnimationFrame(animFrameId);
            renderCurrentState();
        });

        audioEl.addEventListener('ended', () => {
            if (animFrameId) cancelAnimationFrame(animFrameId);
            audioEl.currentTime = 0; // Reset position to start when finished
            renderCurrentState();
        });

        // Initial Draw
        renderCurrentState();

        return {
            update: renderCurrentState
        };
    }

    return {
        drawWaveform,
        attachSeekHandler
    };
})();

