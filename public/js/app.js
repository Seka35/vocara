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
            saveBtn.textContent = '🔥 Engrave Sound';
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
                    <button class="btn btn-primary play-btn" style="flex:1; padding:8px 12px; font-size:12px; min-height:40px;">▶ Play Sound</button>
                    <button class="btn btn-secondary dl-btn" style="padding:8px 12px; font-size:12px; min-height:40px;">📥 Download</button>
                    <button class="btn btn-danger del-btn" style="padding:8px 12px; font-size:12px; min-height:40px;">🗑️</button>
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
    const captureBtn = document.getElementById('captureBtn');
    const camVideo = document.getElementById('camVideo');
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const scanUploadBtn = document.getElementById('scanUploadBtn');
    const resultBox = document.getElementById('resultBox');

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
        Scanner.stopCamera();
    });

    startCamBtn.addEventListener('click', async () => {
        const ok = await Scanner.startCamera(camVideo);
        if (ok) {
            captureBtn.disabled = false;
            startCamBtn.style.display = 'none';
            toast('Camera initialized. Align motif inside green target area.');
        } else {
            toast('Could not access camera. Please allow permission or upload a photo.');
        }
    });

    captureBtn.addEventListener('click', async () => {
        if (!camVideo.videoWidth) {
            toast('Camera is not ready yet.');
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = camVideo.videoWidth;
        canvas.height = camVideo.videoHeight;
        canvas.getContext('2d').drawImage(camVideo, 0, 0);

        await processScan(canvas);
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
                document.getElementById('resultHeader').textContent = '✨ MATCH FOUND — SOUND RETRIEVED';
                document.getElementById('resultTitle').textContent = scanRes.sound.label;
                document.getElementById('resultMeta').textContent = `Match Confidence: ${(scanRes.confidence * 100).toFixed(0)}% • Code: ${scanRes.sound.sound_code}`;

                const audioEl = document.getElementById('resultAudio');
                audioEl.src = '/audio/' + scanRes.sound.filename;
                audioEl.play().catch(() => {});
                toast('Match found! Playing sound memory.');
            } else {
                resultBox.classList.add('no-match');
                document.getElementById('resultHeader').textContent = '⚠️ NO MATCH FOUND';
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
