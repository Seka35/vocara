/**
 * Vocara Main App Logic
 */
(function () {
    "use strict";

    let currentRecordingData = null;
    let currentSoundCode = null;

    // Toast Notification helper
    function toast(msg, duration = 3000) {
        const el = document.getElementById('toastMsg');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), duration);
    }

    function formatTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    function formatDate(ts) {
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let c = 'VCR-';
        for (let i = 0; i < 6; i++) c += chars.charAt(Math.floor(Math.random() * chars.length));
        return c;
    }

    // --- Tab Switching ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tabName = btn.dataset.tab;
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            const targetPanel = document.getElementById('panel-' + tabName);
            if (targetPanel) targetPanel.classList.add('active');

            if (tabName !== 'scan') {
                stopAutoScanner();
            } else {
                startLiveCameraScanner();
            }
        });
    });

    // --- Recording Handler ---
    const recBtn = document.getElementById('recBtn');
    const timerDisplay = document.getElementById('timerDisplay');
    const recStatus = document.getElementById('recStatus');
    const waveShell = document.getElementById('waveShell');
    const waveCanvas = document.getElementById('waveCanvas');
    const saveRow = document.getElementById('saveRow');
    const labelInput = document.getElementById('labelInput');
    const preSaveAudio = document.getElementById('preSaveAudio');
    const preSavePlayBtn = document.getElementById('preSavePlayBtn');
    const preSaveTimeDisplay = document.getElementById('preSaveTimeDisplay');

    let isRecording = false;
    let preSaveSeekController = null;

    function setupPreSavePlayer(data, soundCode) {
        const audioUrl = URL.createObjectURL(data.blob);
        preSaveAudio.src = audioUrl;

        // Attach interactive waveform seek handler
        preSaveSeekController = Visualizer.attachSeekHandler(
            waveCanvas,
            preSaveAudio,
            data.fingerprint,
            soundCode
        );

        // Play/Pause button toggle
        if (preSavePlayBtn) {
            preSavePlayBtn.onclick = () => {
                if (preSaveAudio.paused) {
                    preSaveAudio.play().catch(() => toast('Playback error'));
                } else {
                    preSaveAudio.pause();
                }
            };
        }

        // Time updates
        preSaveAudio.ontimeupdate = () => {
            const cur = formatTime((preSaveAudio.currentTime || 0) * 1000);
            const dur = formatTime((preSaveAudio.duration || 0) * 1000);
            if (preSaveTimeDisplay) preSaveTimeDisplay.textContent = `${cur} / ${dur}`;
        };

        preSaveAudio.onplay = () => {
            if (preSavePlayBtn) preSavePlayBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>`;
        };

        preSaveAudio.onpause = preSaveAudio.onended = () => {
            if (preSavePlayBtn) preSavePlayBtn.innerHTML = `<svg class="play-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Play Preview</span>`;
        };
    }

    Recorder.setCallbacks({
        onTimerUpdate: (ms) => {
            timerDisplay.textContent = formatTime(ms);
        },
        onComplete: (data) => {
            isRecording = false;
            recBtn.classList.remove('recording');
            recStatus.textContent = 'Processing sound motif...';

            currentRecordingData = data;
            currentSoundCode = generateCode();

            setupPreSavePlayer(data, currentSoundCode);
            waveShell.style.display = 'block';
            saveRow.style.display = 'flex';
            labelInput.value = '';
            labelInput.focus();

            recStatus.textContent = 'Recording ready! Click waveform to seek or play preview.';
        },
        onError: (err) => {
            isRecording = false;
            recBtn.classList.remove('recording');
            recStatus.textContent = 'Tap microphone to start recording';
            toast(err);
        }
    });

    recBtn.addEventListener('click', async () => {
        if (!isRecording) {
            const started = await Recorder.start();
            if (started) {
                isRecording = true;
                recBtn.classList.add('recording');
                recStatus.textContent = 'Recording... Speak or play sound';
                waveShell.style.display = 'none';
                saveRow.style.display = 'none';
            }
        } else {
            Recorder.stop();
        }
    });

    // Custom Audio File Upload handling
    const triggerAudioFileBtn = document.getElementById('triggerAudioFileBtn');
    const audioFileInput = document.getElementById('audioFileInput');

    if (triggerAudioFileBtn && audioFileInput) {
        triggerAudioFileBtn.addEventListener('click', () => {
            audioFileInput.click();
        });

        audioFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            recStatus.textContent = 'Processing uploaded audio file...';
            try {
                const data = await Recorder.processAudioFile(file);
                currentRecordingData = data;
                currentSoundCode = generateCode();

                setupPreSavePlayer(data, currentSoundCode);
                waveShell.style.display = 'block';
                saveRow.style.display = 'flex';
                labelInput.value = file.name.replace(/\.[^/.]+$/, "");
                labelInput.focus();

                recStatus.textContent = 'Uploaded sound ready! Click waveform curve to seek or play preview.';
                toast('Audio file loaded successfully!');
            } catch (err) {
                toast(err.message || 'Error processing audio file.');
                recStatus.textContent = 'Tap microphone to start recording';
            }
        });
    }

    // Reset recording
    document.getElementById('discardBtn').addEventListener('click', () => {
        waveShell.style.display = 'none';
        saveRow.style.display = 'none';
        preSaveAudio.removeAttribute('src');
        currentRecordingData = null;
        currentSoundCode = null;
        recStatus.textContent = 'Tap microphone to start recording';
        timerDisplay.textContent = '00:00';
    });

    // Download Tattoo Stencil Image (PURE BLACK WAVEFORM, TRANSPARENT BACKGROUND, NO TEXT)
    document.getElementById('downloadMotifBtn').addEventListener('click', () => {
        if (!currentRecordingData) return;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 1200;
        tempCanvas.height = 350;
        Visualizer.drawWaveform(tempCanvas, currentRecordingData.fingerprint, null, { exportMode: true });

        const link = document.createElement('a');
        link.download = `vocara-tattoo-stencil-${currentSoundCode || 'motif'}.png`;
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
        toast('Tattoo stencil downloaded! Pure black, transparent background, no text.');
    });

    // Save Sound to Database
    document.getElementById('saveBtn').addEventListener('click', async () => {
        const label = labelInput.value.trim();
        if (!label) {
            toast('Please enter a title for this sound memory.');
            labelInput.focus();
            return;
        }

        if (!currentRecordingData) {
            toast('No recording available to save.');
            return;
        }

        const saveBtn = document.getElementById('saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            const reader = new FileReader();
            reader.readAsDataURL(currentRecordingData.blob);
            reader.onloadend = async () => {
                const base64Audio = reader.result;

                const payload = {
                    label,
                    duration: currentRecordingData.duration,
                    fingerprint: currentRecordingData.fingerprint,
                    sound_code: currentSoundCode,
                    mimeType: currentRecordingData.mime,
                    audioBase64: base64Audio
                };

                const res = await fetch('/api/sounds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (data.success) {
                    toast(`" ${label} " engraved into database!`);
                    waveShell.style.display = 'none';
                    saveRow.style.display = 'none';
                    preSaveAudio.removeAttribute('src');
                    currentRecordingData = null;
                    currentSoundCode = null;
                    recStatus.textContent = 'Tap microphone to start recording';
                    timerDisplay.textContent = '00:00';
                    fetchGallery();
                } else {
                    toast('Failed to save sound: ' + data.error);
                }
            };
        } catch (e) {
            console.error(e);
            toast('Server error during saving.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Engrave Sound';
        }
    });

    // --- Gallery Fetch & Render ---
    async function fetchGallery() {
        const grid = document.getElementById('galleryGrid');
        try {
            const res = await fetch('/api/sounds');
            const data = await res.json();
            if (!data.success || !data.sounds || data.sounds.length === 0) {
                grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">No engraved sounds yet — record your first sound above!</div>';
                return;
            }

            grid.innerHTML = '';
            data.sounds.forEach(sound => {
                const card = document.createElement('div');
                card.className = 'gallery-card';

                const canvas = document.createElement('canvas');
                canvas.className = 'g-canvas';
                canvas.width = 500;
                canvas.height = 130;
                canvas.style.cursor = 'pointer';

                const audio = new Audio('/audio/' + sound.filename);

                // Attach Real-Time Lighted Interactive Seek Waveform to Gallery Card!
                Visualizer.attachSeekHandler(canvas, audio, sound.fingerprint, sound.sound_code);

                card.appendChild(canvas);

                const info = document.createElement('div');
                info.className = 'g-info';
                info.innerHTML = `
                    <div>
                        <div class="g-title">${escapeHtml(sound.label)}</div>
                        <div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${formatDate(sound.created_at)} • ${(sound.duration || 0).toFixed(1)}s</div>
                    </div>
                    <span class="g-code">${sound.sound_code}</span>
                `;
                card.appendChild(info);

                const actions = document.createElement('div');
                actions.className = 'g-actions';
                actions.innerHTML = `
                    <button class="btn btn-primary play-btn" style="flex:1; padding:8px 10px; font-size:12px; font-weight:700; white-space:nowrap; min-height:38px; gap:6px; justify-content:center;">
                        <svg class="play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        <span>Play</span>
                    </button>
                    <button class="btn btn-secondary dl-btn" style="padding:8px 12px; font-size:12px; font-weight:600; white-space:nowrap; min-height:38px; gap:6px; justify-content:center;" title="Download Tattoo Stencil">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        <span>Stencil</span>
                    </button>
                    <button class="btn btn-danger del-btn" style="width:38px; min-width:38px; padding:0; height:38px; display:flex; align-items:center; justify-content:center;" title="Delete Sound">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                `;

                const playBtn = actions.querySelector('.play-btn');
                playBtn.addEventListener('click', () => {
                    if (audio.paused) {
                        // Pause any other playing audio in page
                        document.querySelectorAll('audio').forEach(a => { if (a !== audio) a.pause(); });
                        audio.play().catch(err => {
                            console.error('Gallery audio playback error:', err, audio.error);
                            if (audio.error && audio.error.code === 4) {
                                toast('Audio file missing on server.');
                            } else if (err.name === 'NotSupportedError') {
                                toast('Audio format (.webm) not supported on iOS Safari.');
                            } else {
                                toast('Playback error. Tap play again.');
                            }
                        });
                    } else {
                        audio.pause();
                    }
                });

                audio.addEventListener('play', () => {
                    playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>`;
                    card.classList.add('playing');
                });

                audio.addEventListener('pause', () => {
                    playBtn.innerHTML = `<svg class="play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Play</span>`;
                    card.classList.remove('playing');
                });

                audio.addEventListener('ended', () => {
                    playBtn.innerHTML = `<svg class="play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Play</span>`;
                    card.classList.remove('playing');
                });

                // Download Tattoo Stencil Image (Transparent PNG, Pure Black Waveform, No Text)
                actions.querySelector('.dl-btn').addEventListener('click', () => {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = 1200;
                    tempCanvas.height = 350;
                    Visualizer.drawWaveform(tempCanvas, sound.fingerprint, null, { exportMode: true });

                    const link = document.createElement('a');
                    link.download = `vocara-tattoo-stencil-${sound.sound_code}.png`;
                    link.href = tempCanvas.toDataURL('image/png');
                    link.click();
                    toast('Tattoo stencil downloaded! Pure black, transparent background, no text.');
                });

                // Delete Sound
                actions.querySelector('.del-btn').addEventListener('click', async () => {
                    if (!confirm(`Delete "${sound.label}" from database?`)) return;
                    await fetch('/api/sounds/' + sound.id, { method: 'DELETE' });
                    toast('Sound deleted.');
                    fetchGallery();
                });

                card.appendChild(actions);
                grid.appendChild(card);
            });
        } catch (e) {
            grid.innerHTML = '<div style="color:var(--danger);">Error loading sound gallery.</div>';
        }
    }

    function escapeHtml(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    // --- Scanner Logic & Recognition FX ---
    const srcCamBtn = document.getElementById('srcCamBtn');
    const srcFileBtn = document.getElementById('srcFileBtn');
    const camSection = document.getElementById('camSection');
    const uploadSection = document.getElementById('uploadSection');
    const startCamBtn = document.getElementById('startCamBtn');
    const stopCamBtn = document.getElementById('stopCamBtn');
    const autoScanBadge = document.getElementById('autoScanBadge');
    const camVideo = document.getElementById('camVideo');
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const scanUploadBtn = document.getElementById('scanUploadBtn');
    const resultBox = document.getElementById('resultBox');
    const resultAudio = document.getElementById('resultAudio');
    const resultPlayBtn = document.getElementById('resultPlayBtn');
    const resultTimeDisplay = document.getElementById('resultTimeDisplay');
    const resultWaveCanvas = document.getElementById('resultWaveCanvas');
    const camTargetBox = document.getElementById('camTargetBox');

    let autoScanInterval = null;
    let isScanningFrame = false;
    let lastMatchedCode = null;
    let pendingCandidateCode = null;
    let pendingMatchCount = 0;
    let cooldownTimer = null;
    let resultSeekController = null;

    function stopAutoScanner() {
        if (autoScanInterval) {
            clearInterval(autoScanInterval);
            autoScanInterval = null;
        }
        pendingCandidateCode = null;
        pendingMatchCount = 0;
        Scanner.stopCamera(camVideo);
        if (camVideo) {
            camVideo.srcObject = null;
        }
        if (stopCamBtn) stopCamBtn.style.display = 'none';
        if (autoScanBadge) autoScanBadge.style.display = 'none';
    }

    async function startLiveCameraScanner() {
        if (!camVideo) return;
        const ok = await Scanner.startCamera(camVideo);
        if (ok) {
            if (stopCamBtn) stopCamBtn.style.display = 'inline-flex';
            if (autoScanBadge) autoScanBadge.style.display = 'flex';

            pendingCandidateCode = null;
            pendingMatchCount = 0;

            // Initialize MindAR 2D Target Tracking in parallel if sounds are available
            fetch('/api/sounds')
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.sounds && data.sounds.length > 0) {
                        Scanner.startMindTracking(camVideo, data.sounds, (matchedSound, conf) => {
                            const candidate = matchedSound.sound_code;
                            if (lastMatchedCode !== candidate) {
                                lastMatchedCode = candidate;
                                handleMatchedSound(matchedSound, conf || 0.98);

                                if (cooldownTimer) clearTimeout(cooldownTimer);
                                cooldownTimer = setTimeout(() => { lastMatchedCode = null; }, 5000);
                            }
                        });
                    }
                })
                .catch(() => {});

            if (autoScanInterval) clearInterval(autoScanInterval);
            autoScanInterval = setInterval(async () => {
                if (isScanningFrame || !camVideo.videoWidth) return;
                isScanningFrame = true;

                // Process MindAR 2D frame
                Scanner.processMindFrame(camVideo);

                const canvas = document.createElement('canvas');
                canvas.width = camVideo.videoWidth;
                canvas.height = camVideo.videoHeight;
                canvas.getContext('2d').drawImage(camVideo, 0, 0);

                try {
                    const scanRes = await Scanner.analyzeCanvas(canvas);
                    if (scanRes.success && scanRes.sound) {
                        const candidate = scanRes.sound.sound_code;

                        // Tier-2 MindAR Precision Target Lock for 360° pose verification
                        Scanner.lockCandidateMindAR(scanRes.sound, camVideo, (matched, conf) => {
                            if (lastMatchedCode !== matched.sound_code) {
                                lastMatchedCode = matched.sound_code;
                                handleMatchedSound(matched, conf || 0.98);
                                if (cooldownTimer) clearTimeout(cooldownTimer);
                                cooldownTimer = setTimeout(() => { lastMatchedCode = null; }, 5000);
                            }
                        });

                        if (lastMatchedCode !== candidate) {
                            lastMatchedCode = candidate;
                            handleMatchedSound(scanRes.sound, scanRes.confidence);

                            if (cooldownTimer) clearTimeout(cooldownTimer);
                            cooldownTimer = setTimeout(() => { lastMatchedCode = null; }, 5000);
                        }
                    }
                } catch (e) {
                    console.error('Auto scan error:', e);
                } finally {
                    isScanningFrame = false;
                }
            }, 400);
        }
    }

    function triggerRecognitionAnimation() {
        // Holographic flash on camera target frame
        if (camTargetBox) {
            camTargetBox.classList.add('locked-on');
            setTimeout(() => camTargetBox.classList.remove('locked-on'), 1500);
        }

        // Animate result card reveal
        resultBox.classList.remove('show', 'match', 'no-match');
        void resultBox.offsetWidth; // Force reflow
        resultBox.classList.add('show', 'match', 'hologram-reveal');
    }

    function handleMatchedSound(sound, confidence) {
        triggerRecognitionAnimation();

        document.getElementById('resultHeader').textContent = 'MATCH FOUND — SOUND MEMORY RETRIEVED';
        document.getElementById('resultTitle').textContent = sound.label;
        document.getElementById('resultMeta').textContent = `Match Confidence: ${(confidence * 100).toFixed(0)}% • Sound Code: ${sound.sound_code}`;

        resultAudio.src = '/audio/' + sound.filename;

        // Attach Interactive Lighted Waveform Player to Scanner Result Canvas!
        if (resultWaveCanvas) {
            resultSeekController = Visualizer.attachSeekHandler(
                resultWaveCanvas,
                resultAudio,
                sound.fingerprint,
                sound.sound_code
            );
        }

        // Play/Pause button
        if (resultPlayBtn) {
            resultPlayBtn.onclick = () => {
                if (resultAudio.paused) {
                    resultAudio.play().catch(() => toast('Playback error'));
                } else {
                    resultAudio.pause();
                }
            };
        }

        resultAudio.ontimeupdate = () => {
            const cur = formatTime((resultAudio.currentTime || 0) * 1000);
            const durValid = isFinite(resultAudio.duration) && !isNaN(resultAudio.duration) && resultAudio.duration > 0;
            const dur = durValid ? formatTime(resultAudio.duration * 1000) : '--:--';
            if (resultTimeDisplay) resultTimeDisplay.textContent = `${cur} / ${dur}`;
        };

        resultAudio.onplay = () => {
            if (resultPlayBtn) resultPlayBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        };

        resultAudio.onpause = resultAudio.onended = () => {
            if (resultPlayBtn) resultPlayBtn.innerHTML = `<svg class="play-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        };

        // Auto play retrieved sound memory instantly with real-time waveform progress lighting
        resultAudio.play().catch(() => {});
        toast(`Motif Recognized: "${sound.label}"! Reliving sound memory...`, 4000);

        // Smooth scroll to result card
        resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    if (stopCamBtn) {
        stopCamBtn.addEventListener('click', () => {
            stopAutoScanner();
            toast('Camera stopped.');
        });
    }

    // File Upload Scanner Handler
    const triggerPhotoUploadBtn = document.getElementById('triggerPhotoUploadBtn');
    if (triggerPhotoUploadBtn && fileInput) {
        triggerPhotoUploadBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;

            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);

                await processScan(canvas);
            };
            img.src = url;
        });
    }

    async function processScan(canvas) {
        resultBox.classList.remove('show', 'match', 'no-match');
        toast('Scanning & analyzing uploaded motif photo...');

        try {
            const scanRes = await Scanner.analyzeCanvas(canvas);

            if (scanRes.success && scanRes.sound) {
                handleMatchedSound(scanRes.sound, scanRes.confidence);
            } else {
                resultBox.classList.add('show', 'no-match');
                document.getElementById('resultHeader').textContent = 'NO MATCH FOUND';
                document.getElementById('resultTitle').textContent = 'Motif Unrecognized';
                document.getElementById('resultMeta').textContent = 'Could not match sound motif in database. Check lighting or use Instant Sound Code Lookup.';
                resultAudio.removeAttribute('src');
                toast('No matching sound motif found in photo.');
            }
        } catch (e) {
            toast('Scan processing failed. Please try again.');
        }
    }

    // Initialize App
    fetchGallery();
})();

