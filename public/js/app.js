/**
 * Vocara Main App Logic — Espace Membre, Freemium/Paid Model & Super Admin Panel
 */
(function () {
    "use strict";

    let currentRecordingData = null;
    let currentSoundCode = null;
    let pendingRecordingToSave = null;

    // Authentication Session State
    let currentUser = null;
    let authToken = localStorage.getItem('vocara_token') || null;

    // Toast Notification helper
    function toast(msg, duration = 3500) {
        const el = document.getElementById('toastMsg');
        if (!el) return;
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
        if (!ts) return 'N/A';
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    // --- AUTHENTICATION & HEADER WIDGET LOGIC ---

    async function checkAuth() {
        if (!authToken) {
            currentUser = null;
            updateUserHeaderUI();
            return;
        }

        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await res.json();
            if (data.success && data.user) {
                currentUser = data.user;
            } else {
                currentUser = null;
                authToken = null;
                localStorage.removeItem('vocara_token');
            }
        } catch (e) {
            console.error('Auth check error:', e);
        }
        updateUserHeaderUI();
    }

    function updateUserHeaderUI() {
        const widget = document.getElementById('userHeaderWidget');
        const navAdmin = document.getElementById('navTabAdmin');
        const navMemberLabel = document.getElementById('navTabMemberLabel');

        if (navMemberLabel) {
            navMemberLabel.textContent = currentUser ? 'My Account' : 'Login / Sign In';
        }

        if (!widget) return;

        if (currentUser) {
            const planName = (currentUser.plan || 'free').toUpperCase();
            const isAdmin = currentUser.role === 'admin' || currentUser.role === 'superadmin';

            if (navAdmin) {
                navAdmin.style.display = isAdmin ? 'inline-flex' : 'none';
            }

            widget.innerHTML = `
                <div class="user-badge-group">
                    <span class="user-name-text">${escapeHtml(currentUser.name)}</span>
                    <span class="plan-badge-pill">${planName}</span>
                    <span class="credits-badge-pill">${currentUser.credits} CREDITS</span>
                </div>
                <button class="btn btn-secondary" id="hdrMemberBtn" style="padding:6px 12px; font-size:12px; min-height:36px; gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <span>Dashboard</span>
                </button>
                ${isAdmin ? `
                <button class="btn btn-secondary" id="hdrAdminBtn" style="padding:6px 12px; font-size:12px; min-height:36px; border-color:var(--border-highlight); color:var(--primary); gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    <span>Admin</span>
                </button>
                ` : ''}
                <button class="btn btn-danger" id="hdrLogoutBtn" style="padding:6px 10px; font-size:12px; min-height:36px;" title="Sign Out">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                </button>
            `;

            document.getElementById('hdrMemberBtn').onclick = () => switchTab('member');
            if (document.getElementById('hdrAdminBtn')) {
                document.getElementById('hdrAdminBtn').onclick = () => switchTab('admin');
            }
            document.getElementById('hdrLogoutBtn').onclick = () => {
                authToken = null;
                currentUser = null;
                localStorage.removeItem('vocara_token');
                toast('Signed out successfully.');
                closeMemberModal();
                closeAdminModal();
                updateUserHeaderUI();
                switchTab('engrave');
            };
        } else {
            if (navAdmin) navAdmin.style.display = 'none';

            widget.innerHTML = `
                <button class="btn btn-primary" id="hdrLoginBtn" style="padding:8px 16px; font-size:13px; min-height:40px; gap:8px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                    <span>Sign In / Free Account</span>
                </button>
            `;

            document.getElementById('hdrLoginBtn').onclick = () => openAuthModal('register');
        }
    }

    // --- MODALS CONTROL ---

    function openMemberModal() {
        if (!currentUser) {
            openAuthModal('register');
            return;
        }
        const modal = document.getElementById('memberModal');
        if (modal) modal.classList.add('open');
        fetchMemberDashboard();
    }

    function closeMemberModal() {
        const modal = document.getElementById('memberModal');
        if (modal) modal.classList.remove('open');
    }

    function openAdminModal() {
        if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
            toast('Access denied. Super Admin role required.');
            return;
        }
        const modal = document.getElementById('adminModal');
        if (modal) modal.classList.add('open');
        fetchAdminPanel();
    }

    function closeAdminModal() {
        const modal = document.getElementById('adminModal');
        if (modal) modal.classList.remove('open');
    }

    function openAuthModal(mode = 'register') {
        const modal = document.getElementById('authModal');
        const alert = document.getElementById('authErrorAlert');
        if (alert) alert.style.display = 'none';

        if (mode === 'register') {
            document.getElementById('authTabRegister').classList.add('active');
            document.getElementById('authTabLogin').classList.remove('active');
            document.getElementById('registerForm').style.display = 'flex';
            document.getElementById('loginForm').style.display = 'none';
        } else {
            document.getElementById('authTabLogin').classList.add('active');
            document.getElementById('authTabRegister').classList.remove('active');
            document.getElementById('loginForm').style.display = 'flex';
            document.getElementById('registerForm').style.display = 'none';
        }
        if (modal) modal.classList.add('open');
    }

    function closeAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) modal.classList.remove('open');
    }

    function openPlanModal() {
        const modal = document.getElementById('planSelectModal');
        if (modal) modal.classList.add('open');
    }

    function closePlanModal() {
        const modal = document.getElementById('planSelectModal');
        if (modal) modal.classList.remove('open');
    }

    // Attach Modal Close Events
    const closeAuthBtn = document.getElementById('closeAuthModal');
    if (closeAuthBtn) closeAuthBtn.onclick = closeAuthModal;

    const closePlanBtn = document.getElementById('closePlanModal');
    if (closePlanBtn) closePlanBtn.onclick = closePlanModal;

    const closeMemberBtn = document.getElementById('closeMemberModal');
    if (closeMemberBtn) closeMemberBtn.onclick = closeMemberModal;

    const closeAdminBtn = document.getElementById('closeAdminModal');
    if (closeAdminBtn) closeAdminBtn.onclick = closeAdminModal;

    document.getElementById('authTabRegister').onclick = () => {
        document.getElementById('authTabRegister').classList.add('active');
        document.getElementById('authTabLogin').classList.remove('active');
        document.getElementById('registerForm').style.display = 'flex';
        document.getElementById('loginForm').style.display = 'none';
    };

    document.getElementById('authTabLogin').onclick = () => {
        document.getElementById('authTabLogin').classList.add('active');
        document.getElementById('authTabRegister').classList.remove('active');
        document.getElementById('loginForm').style.display = 'flex';
        document.getElementById('registerForm').style.display = 'none';
    };

    // Form Submissions (Register & Login)
    document.getElementById('registerForm').onsubmit = async (e) => {
        e.preventDefault();
        const alert = document.getElementById('authErrorAlert');
        const name = document.getElementById('regName').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value.trim();

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();
            if (data.success) {
                authToken = data.token;
                currentUser = data.user;
                localStorage.setItem('vocara_token', authToken);
                closeAuthModal();
                updateUserHeaderUI();
                toast(`Welcome ${name}! Free account created.`);
                
                // Resume pending sound save if user was interrupted
                if (pendingRecordingToSave) {
                    saveSoundToServer(pendingRecordingToSave);
                    pendingRecordingToSave = null;
                }
            } else {
                if (alert) {
                    alert.textContent = data.error || 'Registration failed.';
                    alert.style.display = 'block';
                }
            }
        } catch (err) {
            if (alert) {
                alert.textContent = 'Server connection error.';
                alert.style.display = 'block';
            }
        }
    };

    document.getElementById('loginForm').onsubmit = async (e) => {
        e.preventDefault();
        const alert = document.getElementById('authErrorAlert');
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (data.success) {
                authToken = data.token;
                currentUser = data.user;
                localStorage.setItem('vocara_token', authToken);
                closeAuthModal();
                updateUserHeaderUI();
                toast(`Welcome back ${currentUser.name}!`);

                if (pendingRecordingToSave) {
                    saveSoundToServer(pendingRecordingToSave);
                    pendingRecordingToSave = null;
                }
            } else {
                if (alert) {
                    alert.textContent = data.error || 'Invalid credentials.';
                    alert.style.display = 'block';
                }
            }
        } catch (err) {
            if (alert) {
                alert.textContent = 'Server connection error.';
                alert.style.display = 'block';
            }
        }
    };

    // Global In-App Stripe Elements Checkout Handler
    let stripeInstance = null;
    let stripeElements = null;
    let activeCheckoutPlan = null;

    window.selectPlan = async function (plan) {
        if (!currentUser || !authToken) {
            openAuthModal('register');
            toast('Please create an account or sign in to choose a plan.');
            return;
        }

        activeCheckoutPlan = plan;
        openPlanModal();
        toast('Initializing secure Stripe payment...');

        try {
            const res = await fetch('/api/create-payment-intent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ plan })
            });

            const data = await res.json();
            if (!data.success || !data.clientSecret) {
                toast('Failed to initialize payment: ' + (data.error || 'Unknown error'));
                return;
            }

            const plansGrid = document.getElementById('plansGrid');
            const stripeContainer = document.getElementById('stripeCheckoutContainer');
            const stripeTitle = document.getElementById('stripePlanTitle');
            const stripeSubtitle = document.getElementById('stripePlanSubtitle');

            if (stripeTitle) stripeTitle.textContent = `Checkout — ${plan === 'lifetime' ? 'Immortal Pass ($89.00)' : 'Starter Pass ($24.99)'}`;
            if (stripeSubtitle) stripeSubtitle.textContent = `Unlimited sound tattoo engravings & stencils • 256-bit SSL encrypted payment`;

            if (plansGrid) plansGrid.style.display = 'none';
            if (stripeContainer) stripeContainer.style.display = 'block';

            if (!stripeInstance && window.Stripe) {
                stripeInstance = Stripe(data.publishableKey);
            }

            if (stripeInstance) {
                const appearance = {
                    theme: 'night',
                    variables: {
                        colorPrimary: '#ff6b00',
                        colorBackground: '#14141c',
                        colorText: '#ffffff',
                        colorDanger: '#ef4444',
                        fontFamily: 'Inter, system-ui, sans-serif',
                        borderRadius: '8px'
                    }
                };

                stripeElements = stripeInstance.elements({ clientSecret: data.clientSecret, appearance });
                const paymentElement = stripeElements.create('payment');
                const paymentElWrap = document.getElementById('payment-element');
                paymentElWrap.innerHTML = '';
                paymentElement.mount('#payment-element');
            }

            document.getElementById('cancel-payment-btn').onclick = () => {
                if (stripeContainer) stripeContainer.style.display = 'none';
                if (plansGrid) plansGrid.style.display = 'grid';
            };

            const paymentForm = document.getElementById('payment-form');
            paymentForm.onsubmit = async (e) => {
                e.preventDefault();
                const submitBtn = document.getElementById('submit-payment-btn');
                const msgBox = document.getElementById('payment-message');
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<span>Processing Secure Payment...</span>`;

                try {
                    let paymentIntentId = null;
                    if (stripeInstance && stripeElements) {
                        const result = await stripeInstance.confirmPayment({
                            elements: stripeElements,
                            confirmParams: {
                                return_url: window.location.href,
                            },
                            redirect: 'if_required'
                        });

                        if (result.error) {
                            if (msgBox) {
                                msgBox.style.display = 'block';
                                msgBox.style.background = 'rgba(239,68,68,0.15)';
                                msgBox.style.color = '#fca5a5';
                                msgBox.textContent = result.error.message;
                            }
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = `<span>Pay Now &amp; Activate Plan</span>`;
                            return;
                        }

                        if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
                            paymentIntentId = result.paymentIntent.id;
                        }
                    }

                    const confRes = await fetch('/api/confirm-payment', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`
                        },
                        body: JSON.stringify({ paymentIntentId, plan: activeCheckoutPlan })
                    });

                    const confData = await confRes.json();
                    if (confData.success) {
                        currentUser = confData.user;
                        closePlanModal();
                        if (stripeContainer) stripeContainer.style.display = 'none';
                        if (plansGrid) plansGrid.style.display = 'grid';
                        updateUserHeaderUI();
                        toast(`🎉 Payment successful! Activated ${activeCheckoutPlan.toUpperCase()} plan!`);
                        if (document.getElementById('panel-member').classList.contains('active')) {
                            fetchMemberDashboard();
                        }
                    } else {
                        if (msgBox) {
                            msgBox.style.display = 'block';
                            msgBox.style.background = 'rgba(239,68,68,0.15)';
                            msgBox.style.color = '#fca5a5';
                            msgBox.textContent = confData.error || 'Payment confirmation failed.';
                        }
                    }
                } catch (err) {
                    toast('Error processing payment.');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = `<span>Pay Now &amp; Activate Plan</span>`;
                }
            };
        } catch (e) {
            toast('Server error during payment initialization.');
        }
    };

    // --- TAB SWITCHING LOGIC ---

    function switchTab(tabName) {
        if (tabName === 'member' && !currentUser) {
            openAuthModal('register');
            return;
        }

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (btn) btn.classList.add('active');

        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        const targetPanel = document.getElementById('panel-' + tabName);
        if (targetPanel) targetPanel.classList.add('active');

        if (tabName !== 'scan') {
            stopAutoScanner();
        } else {
            startLiveCameraScanner();
        }

        if (tabName === 'member') {
            fetchMemberDashboard();
        } else if (tabName === 'admin') {
            fetchAdminPanel();
        }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    // --- RECORDING & SOUND ENGRAVING HANDLER ---
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

    let preSaveSeekController = null;

    function setupPreSavePlayer(data, soundCode) {
        const audioUrl = URL.createObjectURL(data.blob);
        preSaveAudio.src = audioUrl;

        preSaveSeekController = Visualizer.attachSeekHandler(
            waveCanvas,
            preSaveAudio,
            data.fingerprint,
            soundCode
        );

        if (preSavePlayBtn) {
            preSavePlayBtn.onclick = () => {
                if (preSaveAudio.paused) {
                    preSaveAudio.play().catch(() => toast('Playback error'));
                } else {
                    preSaveAudio.pause();
                }
            };
        }

        preSaveAudio.ontimeupdate = () => {
            const cur = formatTime((preSaveAudio.currentTime || 0) * 1000);
            const dur = formatTime((preSaveAudio.duration || 0) * 1000);
            if (preSaveTimeDisplay) preSaveTimeDisplay.textContent = `${cur} / ${dur}`;
        };
    }

    Recorder.init({
        onStart: () => {
            recBtn.classList.add('recording');
            recStatus.textContent = 'Recording live sound... Tap again to finish';
            waveShell.style.display = 'none';
            saveRow.style.display = 'none';
        },
        onStop: (data) => {
            recBtn.classList.remove('recording');
            recStatus.textContent = 'Recording complete! Listen & Engrave your sound below.';
            currentRecordingData = data;
            currentSoundCode = generateCode();

            waveShell.style.display = 'block';
            saveRow.style.display = 'flex';
            if (labelInput) labelInput.value = '';

            setupPreSavePlayer(data, currentSoundCode);
        },
        onTimer: (ms) => {
            timerDisplay.textContent = formatTime(ms);
        },
        onError: (err) => {
            recBtn.classList.remove('recording');
            recStatus.textContent = 'Recording failed or permission denied.';
            toast('Microphone error: ' + err);
        }
    });

    recBtn.addEventListener('click', () => {
        Recorder.toggleRecording();
    });

    const triggerAudioFileBtn = document.getElementById('triggerAudioFileBtn');
    const audioFileInput = document.getElementById('audioFileInput');
    if (triggerAudioFileBtn && audioFileInput) {
        triggerAudioFileBtn.addEventListener('click', () => audioFileInput.click());
        audioFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            toast('Processing audio file & extracting fingerprint...');
            try {
                const data = await Recorder.processAudioFile(file);
                currentRecordingData = data;
                currentSoundCode = generateCode();

                waveShell.style.display = 'block';
                saveRow.style.display = 'flex';
                recStatus.textContent = `Audio file "${file.name}" loaded (${data.duration.toFixed(1)}s)`;

                setupPreSavePlayer(currentRecordingData, currentSoundCode);
                toast('Audio file imported successfully!');
            } catch (err) {
                toast('Error decoding audio file: ' + (err.message || err));
            }
        });
    }

    document.getElementById('discardBtn').addEventListener('click', () => {
        waveShell.style.display = 'none';
        saveRow.style.display = 'none';
        preSaveAudio.removeAttribute('src');
        currentRecordingData = null;
        currentSoundCode = null;
        recStatus.textContent = 'Tap microphone to start recording';
        timerDisplay.textContent = '00:00';
    });

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
        toast('Tattoo stencil downloaded! Pure black, transparent background.');

        // Save design stencil entry if user is logged in
        if (currentUser && authToken) {
            fetch('/api/user/designs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    title: (labelInput.value || 'Tattoo Stencil') + ' Stencil',
                    image_url: tempCanvas.toDataURL('image/png')
                })
            }).catch(() => {});
        }
    });

    // Save Sound to Database with Gating Enforcement
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

            // Enforce account creation before sound engraving!
            if (!currentUser || !authToken) {
                pendingRecordingToSave = payload;
                openAuthModal('register');
                toast('Please create a free account to engrave sound memories.');
                return;
            }

            await saveSoundToServer(payload);
        };
    });

    async function saveSoundToServer(payload) {
        const saveBtn = document.getElementById('saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            const res = await fetch('/api/sounds', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.success) {
                toast(`" ${payload.label} " engraved into database!`);
                waveShell.style.display = 'none';
                saveRow.style.display = 'none';
                preSaveAudio.removeAttribute('src');
                currentRecordingData = null;
                currentSoundCode = null;
                recStatus.textContent = 'Tap microphone to start recording';
                timerDisplay.textContent = '00:00';
                
                await checkAuth(); // Refresh user credit count
                fetchGallery();
                switchTab('member');
            } else if (data.requireAuth) {
                pendingRecordingToSave = payload;
                openAuthModal('register');
            } else if (data.requirePlan) {
                openPlanModal();
                toast('Please select a plan in your Dashboard to engrave more sounds.');
            } else {
                toast('Failed to save sound: ' + data.error);
            }
        } catch (e) {
            console.error(e);
            toast('Server error during saving.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Engrave Sound';
        }
    }

    // --- PUBLIC GALLERY FETCH & RENDER ---

    async function fetchGallery() {
        const grid = document.getElementById('galleryGrid');
        if (!grid) return;
        try {
            const res = await fetch('/api/sounds');
            const data = await res.json();
            if (!data.success || !data.sounds || data.sounds.length === 0) {
                grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">No engraved sounds yet — record your first sound above!</div>';
                return;
            }

            grid.innerHTML = '';
            data.sounds.forEach(sound => {
                const card = createSoundCardElement(sound, false);
                grid.appendChild(card);
            });
        } catch (e) {
            grid.innerHTML = '<div style="color:var(--danger);">Error loading sound gallery.</div>';
        }
    }

    function createSoundCardElement(sound, isOwner = false) {
        const card = document.createElement('div');
        card.className = 'gallery-card';

        const canvas = document.createElement('canvas');
        canvas.className = 'g-canvas';
        canvas.width = 500;
        canvas.height = 130;
        canvas.style.cursor = 'pointer';

        const audio = new Audio('/audio/' + sound.filename);
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

        const canDelete = isOwner || (currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin'));

        const actions = document.createElement('div');
        actions.className = 'g-actions';
        actions.innerHTML = `
            <button class="btn btn-primary play-btn" style="flex:1; padding:8px 10px; font-size:12px; font-weight:700; white-space:nowrap; min-height:38px; gap:6px; justify-content:center;">
                <svg class="play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>Play</span>
            </button>
            <button class="btn btn-secondary dl-btn" style="padding:8px 12px; font-size:12px; font-weight:600; white-space:nowrap; min-height:38px; gap:6px; justify-content:center;" title="Download Tattoo Stencil">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>Stencil</span>
            </button>
            ${canDelete ? `
            <button class="btn btn-danger del-btn" style="width:38px; min-width:38px; padding:0; height:38px; display:flex; align-items:center; justify-content:center;" title="Delete Sound">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            ` : ''}
        `;

        const playBtn = actions.querySelector('.play-btn');
        playBtn.addEventListener('click', () => {
            if (audio.paused) {
                document.querySelectorAll('audio').forEach(a => { if (a !== audio) a.pause(); });
                audio.play().catch(err => {
                    toast('Playback error. Tap play again.');
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

        actions.querySelector('.dl-btn').addEventListener('click', () => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 1200;
            tempCanvas.height = 350;
            Visualizer.drawWaveform(tempCanvas, sound.fingerprint, null, { exportMode: true });

            const link = document.createElement('a');
            link.download = `vocara-tattoo-stencil-${sound.sound_code}.png`;
            link.href = tempCanvas.toDataURL('image/png');
            link.click();
            toast('Tattoo stencil downloaded! Pure black, transparent background.');
        });

        if (canDelete) {
            actions.querySelector('.del-btn').addEventListener('click', async () => {
                if (!confirm(`Delete "${sound.label}"?`)) return;
                await fetch('/api/sounds/' + sound.id, {
                    method: 'DELETE',
                    headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
                });
                toast('Sound deleted.');
                fetchGallery();
                if (currentUser) fetchMemberDashboard();
            });
        }

        card.appendChild(actions);
        return card;
    }

    // --- MEMBER DASHBOARD LOGIC ---

    async function fetchMemberDashboard() {
        const banner = document.getElementById('memberBanner');
        const soundsGrid = document.getElementById('memberSoundsGrid');
        const designsGrid = document.getElementById('memberDesignsGrid');

        if (!currentUser || !authToken) {
            if (banner) {
                banner.innerHTML = `
                    <div style="text-align:center; width:100%; padding:20px;">
                        <h2 style="font-size:20px; margin-bottom:8px;">Sign In to Access Your Espace Membre</h2>
                        <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Store private sound memories, view tattoo stencils, and manage your subscription.</p>
                        <button class="btn btn-primary" onclick="window.openAuthModal('register')">Create Free Account / Sign In</button>
                    </div>
                `;
            }
            if (soundsGrid) soundsGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">Please sign in to view your saved sounds.</div>';
            if (designsGrid) designsGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">Please sign in to view your tattoo stencils.</div>';
            return;
        }

        // Render Banner
        banner.innerHTML = `
            <div class="member-info-group">
                <div class="member-title">Welcome, ${escapeHtml(currentUser.name)}</div>
                <div class="member-subtitle">${escapeHtml(currentUser.email)} • Account Role: <strong style="color:var(--primary); text-transform:uppercase;">${currentUser.role}</strong></div>
                <div class="member-stats-row">
                    <div class="member-stat-box">
                        <span class="stat-label">Active Plan</span>
                        <span class="stat-val" style="text-transform:uppercase;">${currentUser.plan || 'free'}</span>
                    </div>
                    <div class="member-stat-box">
                        <span class="stat-label">Remaining Credits</span>
                        <span class="stat-val">${currentUser.credits}</span>
                    </div>
                </div>
            </div>
            <button class="btn btn-primary" id="mbrUpgradeBtn" style="gap:8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span>Upgrade Plan &amp; Add Credits</span>
            </button>
        `;

        document.getElementById('mbrUpgradeBtn').onclick = openPlanModal;

        // Fetch User Sounds
        try {
            const res = await fetch('/api/user/sounds', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await res.json();
            if (data.success && data.sounds && data.sounds.length > 0) {
                soundsGrid.innerHTML = '';
                data.sounds.forEach(sound => {
                    soundsGrid.appendChild(createSoundCardElement(sound, true));
                });
            } else {
                soundsGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">No private sounds saved yet. Record a sound to get started!</div>';
            }
        } catch (e) {
            soundsGrid.innerHTML = '<div style="color:var(--danger);">Error loading your sound vault.</div>';
        }

        // Fetch User Designs / Stencils
        try {
            const res = await fetch('/api/user/designs', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await res.json();
            if (data.success && data.designs && data.designs.length > 0) {
                designsGrid.innerHTML = '';
                data.designs.forEach(dsg => {
                    const card = document.createElement('div');
                    card.className = 'gallery-card';
                    card.innerHTML = `
                        <img src="${dsg.image_url}" alt="Tattoo Stencil" style="width:100%; height:110px; object-fit:contain; background:#000000; border-radius:8px; border:1px solid var(--border-color);">
                        <div class="g-info" style="margin-top:8px;">
                            <div>
                                <div class="g-title">${escapeHtml(dsg.title)}</div>
                                <div style="font-size:11px; color:var(--text-dim);">${formatDate(dsg.created_at)}</div>
                            </div>
                        </div>
                        <div class="g-actions" style="margin-top:10px;">
                            <a href="${dsg.image_url}" download="tattoo-stencil-${dsg.id}.png" class="btn btn-secondary" style="flex:1; text-decoration:none; font-size:12px; min-height:36px; padding:6px 12px; gap:6px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                <span>Download PNG</span>
                            </a>
                        </div>
                    `;
                    designsGrid.appendChild(card);
                });
            } else {
                designsGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">No saved tattoo stencils yet.</div>';
            }
        } catch (e) {
            designsGrid.innerHTML = '<div style="color:var(--danger);">Error loading tattoo designs.</div>';
        }
    }

    // --- SUPER ADMIN CONTROL PANEL LOGIC ---

    async function fetchAdminPanel() {
        const statsGrid = document.getElementById('adminStatsGrid');
        const usersTable = document.getElementById('adminUsersTable');
        const soundsTable = document.getElementById('adminSoundsTable');

        if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin') || !authToken) {
            toast('Admin authorization required.');
            switchTab('engrave');
            return;
        }

        try {
            const res = await fetch('/api/admin/stats', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await res.json();
            if (data.success) {
                statsGrid.innerHTML = `
                    <div class="admin-stat-card">
                        <span class="admin-stat-num">${data.stats.usersCount || 0}</span>
                        <span class="admin-stat-lbl">Total Registered Users</span>
                    </div>
                    <div class="admin-stat-card">
                        <span class="admin-stat-num">${data.totalSounds || 0}</span>
                        <span class="admin-stat-lbl">Engraved Sound Memories</span>
                    </div>
                    <div class="admin-stat-card">
                        <span class="admin-stat-num">${data.totalDesigns || 0}</span>
                        <span class="admin-stat-lbl">Generated Tattoo Stencils</span>
                    </div>
                    <div class="admin-stat-card">
                        <span class="admin-stat-num" style="color:#10b981;">100% ONLINE</span>
                        <span class="admin-stat-lbl">Server Status</span>
                    </div>
                `;

                // Render Sounds Audit Table
                soundsTable.innerHTML = '';
                (data.sounds || []).forEach(snd => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-family:'JetBrains Mono', monospace; font-size:11px; color:var(--text-dim);">${snd.id}</td>
                        <td><strong>${escapeHtml(snd.label)}</strong></td>
                        <td><span class="g-code">${snd.sound_code}</span></td>
                        <td style="font-size:11px; color:var(--text-muted);">${snd.user_id || 'Public/Guest'}</td>
                        <td style="font-size:11px;">${formatDate(snd.created_at)}</td>
                        <td>
                            <button class="btn btn-danger adm-del-snd" style="padding:4px 10px; font-size:11px; min-height:28px;" data-id="${snd.id}">Delete</button>
                        </td>
                    `;
                    tr.querySelector('.adm-del-snd').onclick = async () => {
                        if (!confirm(`Delete sound ${snd.label}?`)) return;
                        await fetch('/api/sounds/' + snd.id, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${authToken}` }
                        });
                        toast('Sound deleted by Admin.');
                        fetchAdminPanel();
                    };
                    soundsTable.appendChild(tr);
                });
            }
        } catch (e) {
            console.error('Admin stats error:', e);
        }

        // Fetch Admin Users List
        try {
            const res = await fetch('/api/admin/users', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await res.json();
            if (data.success && data.users) {
                usersTable.innerHTML = '';
                data.users.forEach(usr => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${escapeHtml(usr.name)}</strong></td>
                        <td>${escapeHtml(usr.email)}</td>
                        <td>
                            <select class="admin-select role-sel">
                                <option value="user" ${usr.role === 'user' ? 'selected' : ''}>user</option>
                                <option value="pro" ${usr.role === 'pro' ? 'selected' : ''}>pro</option>
                                <option value="admin" ${usr.role === 'admin' ? 'selected' : ''}>admin</option>
                                <option value="superadmin" ${usr.role === 'superadmin' ? 'selected' : ''}>superadmin</option>
                            </select>
                        </td>
                        <td>
                            <select class="admin-select plan-sel">
                                <option value="free" ${usr.plan === 'free' ? 'selected' : ''}>free</option>
                                <option value="essential" ${usr.plan === 'essential' ? 'selected' : ''}>starter</option>
                                <option value="lifetime" ${usr.plan === 'lifetime' ? 'selected' : ''}>immortal</option>
                            </select>
                        </td>
                        <td>
                            <input type="number" class="input-field cred-inp" value="${usr.credits}" style="width:70px; padding:4px 8px; font-size:12px; min-width:auto;">
                        </td>
                        <td style="display:flex; gap:6px;">
                            <button class="btn btn-primary adm-save-usr" style="padding:4px 10px; font-size:11px; min-height:28px;">Grant / Save</button>
                            <button class="btn btn-danger adm-del-usr" style="padding:4px 10px; font-size:11px; min-height:28px;">Delete</button>
                        </td>
                    `;

                    tr.querySelector('.adm-save-usr').onclick = async () => {
                        const role = tr.querySelector('.role-sel').value;
                        const plan = tr.querySelector('.plan-sel').value;
                        const credits = parseInt(tr.querySelector('.cred-inp').value, 10);

                        const gRes = await fetch(`/api/admin/users/${usr.id}/grant`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ role, plan, credits })
                        });
                        const gData = await gRes.json();
                        if (gData.success) {
                            toast(`Updated ${usr.name} successfully!`);
                            fetchAdminPanel();
                        }
                    };

                    tr.querySelector('.adm-del-usr').onclick = async () => {
                        if (!confirm(`Delete user account for ${usr.name}?`)) return;
                        const dRes = await fetch(`/api/admin/users/${usr.id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${authToken}` }
                        });
                        const dData = await dRes.json();
                        if (dData.success) {
                            toast(`User ${usr.name} deleted.`);
                            fetchAdminPanel();
                        } else {
                            toast(dData.error || 'Failed to delete user.');
                        }
                    };

                    usersTable.appendChild(tr);
                });
            }
        } catch (e) {
            usersTable.innerHTML = '<tr><td colspan="6" style="color:var(--danger);">Failed to load users list.</td></tr>';
        }
    }

    // --- SCANNER & RECOGNITION FX ---
    const camVideo = document.getElementById('camVideo');
    const stopCamBtn = document.getElementById('stopCamBtn');
    const autoScanBadge = document.getElementById('autoScanBadge');
    const resultBox = document.getElementById('resultBox');
    const resultAudio = document.getElementById('resultAudio');
    const resultPlayBtn = document.getElementById('resultPlayBtn');
    const resultTimeDisplay = document.getElementById('resultTimeDisplay');
    const resultWaveCanvas = document.getElementById('resultWaveCanvas');
    const camTargetBox = document.getElementById('camTargetBox');

    let autoScanInterval = null;
    let isScanningFrame = false;
    let lastMatchedCode = null;
    let cooldownTimer = null;
    let resultSeekController = null;

    function stopAutoScanner() {
        if (autoScanInterval) {
            clearInterval(autoScanInterval);
            autoScanInterval = null;
        }
        Scanner.stopCamera(camVideo);
        if (camVideo) camVideo.srcObject = null;
        if (stopCamBtn) stopCamBtn.style.display = 'none';
        const startCamBtn = document.getElementById('startCamBtn');
        if (startCamBtn) startCamBtn.style.display = 'inline-flex';
        if (autoScanBadge) autoScanBadge.style.display = 'none';
    }

    async function startLiveCameraScanner() {
        if (!camVideo) return;
        const ok = await Scanner.startCamera(camVideo);
        if (ok) {
            if (stopCamBtn) stopCamBtn.style.display = 'inline-flex';
            const startCamBtn = document.getElementById('startCamBtn');
            if (startCamBtn) startCamBtn.style.display = 'none';
            if (autoScanBadge) autoScanBadge.style.display = 'flex';

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

                Scanner.processMindFrame(camVideo);

                const box = camTargetBox || document.getElementById('camTargetBox');
                const vidRect = camVideo.getBoundingClientRect();
                const boxRect = box ? box.getBoundingClientRect() : vidRect;

                const scaleX = camVideo.videoWidth / (vidRect.width || 1);
                const scaleY = camVideo.videoHeight / (vidRect.height || 1);

                const sx = Math.max(0, Math.floor((boxRect.left - vidRect.left) * scaleX));
                const sy = Math.max(0, Math.floor((boxRect.top - vidRect.top) * scaleY));
                const sw = Math.min(camVideo.videoWidth - sx, Math.max(50, Math.floor(boxRect.width * scaleX)));
                const sh = Math.min(camVideo.videoHeight - sy, Math.max(50, Math.floor(boxRect.height * scaleY)));

                const canvas = document.createElement('canvas');
                canvas.width = sw;
                canvas.height = sh;
                canvas.getContext('2d').drawImage(camVideo, sx, sy, sw, sh, 0, 0, sw, sh);

                try {
                    const scanRes = await Scanner.analyzeCanvas(canvas);
                    if (scanRes.success && scanRes.sound) {
                        const candidates = scanRes.candidates || [{ sound: scanRes.sound, score: scanRes.confidence }];
                        let bestVerified = null;
                        for (const candItem of candidates) {
                            if (candItem.score >= 0.48) {
                                bestVerified = candItem;
                                break;
                            }
                        }

                        if (bestVerified && lastMatchedCode !== bestVerified.sound.sound_code) {
                            lastMatchedCode = bestVerified.sound.sound_code;
                            handleMatchedSound(bestVerified.sound, bestVerified.score);

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

    function playSuccessChime() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.08);
            osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.16);

            gain.gain.setValueAtTime(0.35, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.5);
        } catch (e) {}
    }

    function triggerRecognitionAnimation() {
        if (camTargetBox) {
            camTargetBox.classList.add('success');
            setTimeout(() => camTargetBox.classList.remove('success'), 6000);
        }

        resultBox.classList.remove('show', 'match', 'no-match');
        void resultBox.offsetWidth;
        resultBox.classList.add('show', 'match', 'hologram-reveal');
    }

    function handleMatchedSound(sound, confidence) {
        if (autoScanInterval) {
            clearInterval(autoScanInterval);
            autoScanInterval = null;
        }

        playSuccessChime();
        triggerRecognitionAnimation();

        const autoBadge = document.getElementById('autoScanBadge');
        if (autoBadge) {
            autoBadge.style.color = '#10b981';
            autoBadge.innerHTML = `<span style="display:inline-block; width:10px; height:10px; background:#10b981; border-radius:50%; box-shadow:0 0 10px #10b981;"></span><span>✓ MATCH CONFIRMED — PLAYING SOUND MEMORY</span>`;
        }

        document.getElementById('resultHeader').textContent = 'MATCH FOUND — SOUND MEMORY RETRIEVED';
        document.getElementById('resultTitle').textContent = sound.label;
        document.getElementById('resultMeta').textContent = `Match Confidence: ${(confidence * 100).toFixed(0)}% • Sound Code: ${sound.sound_code}`;

        resultAudio.src = '/audio/' + sound.filename;

        if (resultWaveCanvas) {
            resultSeekController = Visualizer.attachSeekHandler(
                resultWaveCanvas,
                resultAudio,
                sound.fingerprint,
                sound.sound_code
            );
        }

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

        resultAudio.onpause = () => {
            if (resultPlayBtn) resultPlayBtn.innerHTML = `<svg class="play-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        };

        resultAudio.onended = () => {
            if (resultPlayBtn) resultPlayBtn.innerHTML = `<svg class="play-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
            
            setTimeout(() => {
                if (camStream && !autoScanInterval) {
                    lastMatchedCode = null;
                    const b = document.getElementById('autoScanBadge');
                    if (b) {
                        b.style.color = '#ff6b00';
                        b.innerHTML = `<span style="display:inline-block; width:10px; height:10px; background:#ff6b00; border-radius:50%; box-shadow:0 0 10px #ff6b00; animation:pulse 1.2s infinite;"></span><span>AUTO SCANNING LIVE — ALIGN TATTOO IN TARGET AREA</span>`;
                    }
                    startLiveCameraScanner();
                }
            }, 3500);
        };

        resultAudio.play().catch(() => {});
        toast(`Motif Recognized: "${sound.label}"! Reliving sound memory...`, 4000);
        resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const startCamBtn = document.getElementById('startCamBtn');
    if (startCamBtn) {
        startCamBtn.addEventListener('click', () => {
            startLiveCameraScanner();
        });
    }

    if (stopCamBtn) {
        stopCamBtn.addEventListener('click', () => {
            stopAutoScanner();
            toast('Camera stopped.');
        });
    }

    // Photo Upload Scanner
    const triggerPhotoUploadBtn = document.getElementById('triggerPhotoUploadBtn');
    const fileInput = document.getElementById('fileInput');
    if (triggerPhotoUploadBtn && fileInput) {
        triggerPhotoUploadBtn.addEventListener('click', () => fileInput.click());
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

    // Manual Sound Code Fallback Lookup
    const manualCodeBtn = document.getElementById('manualCodeBtn');
    const manualCodeInput = document.getElementById('manualCodeInput');

    async function handleManualCodeLookup() {
        if (!manualCodeInput) return;
        const code = manualCodeInput.value.trim().toUpperCase();
        if (!code) {
            toast('Please enter a Sound Code (e.g. VCR-NPH5WK)');
            return;
        }

        toast(`Searching database for Sound Code "${code}"...`);
        try {
            const res = await fetch(`/api/sounds/${encodeURIComponent(code)}`);
            const data = await res.json();
            if (data.success && data.sound) {
                handleMatchedSound(data.sound, 1.0);
                toast(`Sound Code Validated: "${data.sound.label}"!`);
            } else {
                toast(`Sound Code "${code}" not found. Please check spelling.`);
            }
        } catch (e) {
            toast('Lookup failed. Please check network connection.');
        }
    }

    if (manualCodeBtn) manualCodeBtn.addEventListener('click', handleManualCodeLookup);
    if (manualCodeInput) {
        manualCodeInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleManualCodeLookup();
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

    // Export modal trigger helpers for inline onclicks
    window.openAuthModal = openAuthModal;
    window.openPlanModal = openPlanModal;

    // Initialize Application
    checkAuth();
    fetchGallery();
})();
