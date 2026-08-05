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
                Scanner.stopCamera();
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
    const preSavePlayerContainer = document.getElementById('preSavePlayerContainer');
    const preSaveAudio = document.getElementById('preSaveAudio');

    let isRecording = false;

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

            // Setup Pre-save Audio Player for user preview
            const audioUrl = URL.createObjectURL(data.blob);
            preSaveAudio.src = audioUrl;
            preSavePlayerContainer.style.display = 'block';

            // Render visual motif on canvas for UI preview
            Visualizer.drawWaveform(waveCanvas, data.fingerprint, currentSoundCode);
            waveShell.style.display = 'block';
            saveRow.style.display = 'flex';
            labelInput.value = '';
            labelInput.focus();

            recStatus.textContent = 'Recording ready! Listen to preview or engrave below.';
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
                preSavePlayerContainer.style.display = 'none';
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

                // Setup Pre-save Audio Player
                const audioUrl = URL.createObjectURL(data.blob);
                preSaveAudio.src = audioUrl;
                preSavePlayerContainer.style.display = 'block';

                // Render visual motif
                Visualizer.drawWaveform(waveCanvas, data.fingerprint, currentSoundCode);
                waveShell.style.display = 'block';
                saveRow.style.display = 'flex';
                labelInput.value = file.name.replace(/\.[^/.]+$/, "");
                labelInput.focus();

                recStatus.textContent = 'Uploaded sound ready! Listen to preview or engrave below.';
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
        preSavePlayerContainer.style.display = 'none';
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
            // Convert Blob to Base64
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
                    preSavePlayerContainer.style.display = 'none';
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
                canvas.width = 400;
                canvas.height = 90;
                Visualizer.drawWaveform(canvas, sound.fingerprint, sound.sound_code);

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
                    <button class="btn btn-primary play-btn" style="flex:1; padding:8px 12px; font-size:12px; min-height:40px; gap:6px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        <span>Play Sound</span>
                    </button>
                    <button class="btn btn-secondary dl-btn" style="padding:8px 12px; font-size:12px; min-height:40px; gap:6px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        <span>Download</span>
                    </button>
                    <button class="btn btn-danger del-btn" style="padding:8px 12px; font-size:12px; min-height:40px;" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                `;

                // Play Audio
                actions.querySelector('.play-btn').addEventListener('click', () => {
                    const audio = new Audio('/audio/' + sound.filename);
                    audio.play().catch(() => toast('Playback error'));
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

    // --- Scanner Logic ---
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

    let autoScanInterval = null;
    let isScanningFrame = false;
    let lastMatchedCode = null;
    let cooldownTimer = null;

    srcCamBtn.addEventListener('click', () => {
        srcCamBtn.classList.add('active');
        srcFileBtn.classList.remove('active');
        camSection.style.display = 'block';
        uploadSection.style.display = 'none';
    });

    srcFileBtn.addEventListener('click', () => {
        srcFileBtn.classList.add('active');
        srcCamBtn.classList.remove('active');
        camSection.style.display = 'none';
        uploadSection.style.display = 'block';
        stopAutoScanner();
    });

    function stopAutoScanner() {
        if (autoScanInterval) {
            clearInterval(autoScanInterval);
            autoScanInterval = null;
        }
        Scanner.stopCamera();
        startCamBtn.style.display = 'inline-flex';
        stopCamBtn.style.display = 'none';
        if (autoScanBadge) autoScanBadge.style.display = 'none';
    }

    startCamBtn.addEventListener('click', async () => {
        const ok = await Scanner.startCamera(camVideo);
        if (ok) {
            startCamBtn.style.display = 'none';
            stopCamBtn.style.display = 'inline-flex';
            if (autoScanBadge) autoScanBadge.style.display = 'flex';
            toast('Live camera active — auto-scanning target motif...');

            // Start continuous QR-style auto scanning loop (every 700ms)
            if (autoScanInterval) clearInterval(autoScanInterval);
            autoScanInterval = setInterval(async () => {
                if (isScanningFrame || !camVideo.videoWidth) return;
                isScanningFrame = true;

                const canvas = document.createElement('canvas');
                canvas.width = camVideo.videoWidth;
                canvas.height = camVideo.videoHeight;
                canvas.getContext('2d').drawImage(camVideo, 0, 0);

                try {
                    const scanRes = await Scanner.analyzeCanvas(canvas);
                    if (scanRes.success && scanRes.sound) {
                        // Prevent repeated trigger for same code within 6s
                        if (lastMatchedCode !== scanRes.sound.sound_code) {
                            lastMatchedCode = scanRes.sound.sound_code;

                            resultBox.classList.remove('show', 'match', 'no-match');
                            resultBox.classList.add('show', 'match');
                            document.getElementById('resultHeader').textContent = 'MATCH FOUND — SOUND RETRIEVED';
                            document.getElementById('resultTitle').textContent = scanRes.sound.label;
                            document.getElementById('resultMeta').textContent = `Match Confidence: ${(scanRes.confidence * 100).toFixed(0)}% • Code: ${scanRes.sound.sound_code}`;

                            const audioEl = document.getElementById('resultAudio');
                            audioEl.src = '/audio/' + scanRes.sound.filename;
                            audioEl.play().catch(() => {});
                            toast(`Match found: "${scanRes.sound.label}"! Playing audio.`);

                            if (cooldownTimer) clearTimeout(cooldownTimer);
                            cooldownTimer = setTimeout(() => { lastMatchedCode = null; }, 6000);
                        }
                    }
                } catch (e) {
                    console.error('Auto scan error:', e);
                } finally {
                    isScanningFrame = false;
                }
            }, 700);
        } else {
            toast('Could not access camera. Please allow permission or upload a photo.');
        }
    });

    stopCamBtn.addEventListener('click', () => {
        stopAutoScanner();
        toast('Camera stopped.');
    });

    // File Upload Scanner
    let uploadedImg = null;
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            uploadedImg = img;
            uploadArea.querySelector('#uploadInner').innerHTML = `
                <img src="${url}" style="max-width:100%; max-height:180px; border-radius:8px;">
                <div style="font-size:12px; color:var(--text-muted); margin-top:8px;">Tap to change photo</div>
            `;
            scanUploadBtn.disabled = false;
        };
        img.src = url;
    });

    scanUploadBtn.addEventListener('click', async () => {
        if (!uploadedImg) return;
        const canvas = document.createElement('canvas');
        canvas.width = uploadedImg.naturalWidth;
        canvas.height = uploadedImg.naturalHeight;
        canvas.getContext('2d').drawImage(uploadedImg, 0, 0);

        await processScan(canvas);
    });

    async function processScan(canvas) {
        resultBox.classList.remove('show', 'match', 'no-match');
        toast('Scanning & analyzing motif pattern...');

        try {
            const scanRes = await Scanner.analyzeCanvas(canvas);

            resultBox.classList.add('show');
            if (scanRes.success && scanRes.sound) {
                resultBox.classList.add('match');
                document.getElementById('resultHeader').textContent = 'MATCH FOUND — SOUND RETRIEVED';
                document.getElementById('resultTitle').textContent = scanRes.sound.label;
                document.getElementById('resultMeta').textContent = `Match Confidence: ${(scanRes.confidence * 100).toFixed(0)}% • Code: ${scanRes.sound.sound_code}`;

                const audioEl = document.getElementById('resultAudio');
                audioEl.src = '/audio/' + scanRes.sound.filename;
                audioEl.play().catch(() => {});
                toast('Match found! Playing sound memory.');
            } else {
                resultBox.classList.add('no-match');
                document.getElementById('resultHeader').textContent = 'NO MATCH FOUND';
                document.getElementById('resultTitle').textContent = 'Motif Unrecognized';
                document.getElementById('resultMeta').textContent = 'Could not match sound motif in database. Please ensure lighting is bright and tattoo/motif is clearly aligned.';
                document.getElementById('resultAudio').removeAttribute('src');
                toast('No matching sound motif found.');
            }
        } catch (e) {
            toast('Scan processing failed. Please try again.');
        }
    }

    // Initialize App
    fetchGallery();
})();
