try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Stripe = require('stripe');
const db = require('./db');

const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
let stripe = null;
try {
    if (stripeSecret && stripeSecret !== 'YOUR_STRIPE_SECRET_KEY') {
        stripe = Stripe(stripeSecret);
    }
} catch (err) {
    console.warn('⚠️ Stripe initialized in offline mode:', err.message);
}

const app = express();
const PORT = process.env.PORT || 4892;

// Ensure uploads and public audio directories exist
const uploadsDir = path.join(__dirname, 'uploads', 'audio');
const publicAudioDir = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(publicAudioDir)) fs.mkdirSync(publicAudioDir, { recursive: true });

// Multer storage for audio uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        let ext = '.webm';
        if (file.mimetype.includes('mp4') || file.mimetype.includes('m4a') || file.mimetype.includes('aac')) {
            ext = '.m4a';
        } else if (file.mimetype.includes('mp3') || file.mimetype.includes('mpeg')) {
            ext = '.mp3';
        } else if (file.mimetype.includes('wav')) {
            ext = '.wav';
        } else if (file.originalname) {
            const origExt = path.extname(file.originalname).toLowerCase();
            if (origExt) ext = origExt;
        }
        cb(null, `sound-${uniqueSuffix}${ext}`);
    }
});
const upload = multer({ storage });

const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'vocara_super_secret_jwt_key_2026_secure';

// Cryptographically sign user account token (HMAC-SHA256)
function generateSecureAccountToken(userId) {
    const payload = JSON.stringify({ userId, iat: Date.now() });
    const base64Payload = Buffer.from(payload).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(base64Payload).digest('base64url');
    return `${base64Payload}.${signature}`;
}

// Cryptographically verify user account token
function verifySecureAccountToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    
    const [base64Payload, signature] = parts;
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(base64Payload).digest('base64url');
    
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return null; // Signature invalid or tampered!
    }
    
    try {
        const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
        return payload.userId;
    } catch (e) {
        return null;
    }
}

// Helper to extract Auth token from Header / Query / Body
function getAuthToken(req) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    if (req.headers['x-access-token']) {
        return req.headers['x-access-token'];
    }
    if (req.body && req.body.token) {
        return req.body.token;
    }
    return null;
}

// Middleware: Authentication Guard
async function authMiddleware(req, res, next) {
    try {
        const token = getAuthToken(req);
        const userId = verifySecureAccountToken(token);
        if (!userId) {
            return res.status(401).json({ success: false, requireAuth: true, error: 'Authentication required. Please log in.' });
        }
        const user = await db.getUserById(userId);
        if (!user) {
            return res.status(401).json({ success: false, requireAuth: true, error: 'User account not found.' });
        }
        req.user = user;
        next();
    } catch (err) {
        res.status(401).json({ success: false, requireAuth: true, error: 'Invalid authentication token.' });
    }
}

// Middleware: Optional Authentication (attaches req.user if valid token provided)
async function optionalAuthMiddleware(req, res, next) {
    try {
        const token = getAuthToken(req);
        const userId = verifySecureAccountToken(token);
        if (userId) {
            const user = await db.getUserById(userId);
            if (user) req.user = user;
        }
    } catch (e) {}
    next();
}

// Middleware: Admin / SuperAdmin Guard
async function adminMiddleware(req, res, next) {
    authMiddleware(req, res, () => {
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'Access denied: Admin authorization required.' });
        }
        next();
    });
}

// Middleware setup
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Stream Route with HTTP Range (206 Partial Content) support for iOS/Safari & Nginx compatibility
app.get('/audio/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    let filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
        filePath = path.join(publicAudioDir, filename);
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Audio file not found on server');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    let mimeType = 'audio/webm';
    if (filename.endsWith('.mp3')) mimeType = 'audio/mpeg';
    else if (filename.endsWith('.m4a') || filename.endsWith('.mp4')) mimeType = 'audio/mp4';
    else if (filename.endsWith('.wav')) mimeType = 'audio/wav';

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': mimeType,
        };
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes'
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/audio', express.static(uploadsDir));

// Direct route for Android APK download
app.get('/downloads/vocara-android.apk', (req, res) => {
    const apkPath = path.join(__dirname, 'public', 'downloads', 'vocara-android.apk');
    if (fs.existsSync(apkPath)) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', 'attachment; filename="vocara-android.apk"');
        return res.sendFile(apkPath);
    }
    res.status(404).send('APK file not found on server');
});

// --- AUTHENTICATION ENDPOINTS ---

// Register new user
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
        }

        const existing = await db.getUserByEmail(email);
        if (existing) {
            return res.status(400).json({ success: false, error: 'An account with this email address already exists.' });
        }

        const user = await db.createUser({ name, email, password, role: 'user', plan: 'free', credits: 1 });
        const token = generateSecureAccountToken(user.id);
        res.json({ success: true, token, user });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required.' });
        }

        const userWithPass = await db.getUserByEmail(email);
        if (!userWithPass || !db.verifyPassword(password, userWithPass.password_hash)) {
            return res.status(401).json({ success: false, error: 'Invalid email or password credentials.' });
        }

        const token = generateSecureAccountToken(userWithPass.id);
        const { password_hash, ...user } = userWithPass;
        res.json({ success: true, token, user });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Current Logged In User Profile
app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ success: true, user: req.user });
});

// --- MEMBER DASHBOARD & PLAN SELECTION ENDPOINTS ---

// Select / Upgrade Plan
app.post('/api/user/select-plan', authMiddleware, async (req, res) => {
    try {
        const { plan } = req.body;
        const validPlans = ['essential', 'lifetime', 'pro'];
        if (!validPlans.includes(plan)) {
            return res.status(400).json({ success: false, error: 'Invalid plan selected.' });
        }

        let credits = 10;
        if (plan === 'lifetime') credits = 99999;
        else if (plan === 'pro') credits = 100;

        await db.updateUser(req.user.id, { plan, credits });
        const updatedUser = await db.getUserById(req.user.id);
        res.json({ success: true, message: `Successfully upgraded to ${plan.toUpperCase()} plan!`, user: updatedUser });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// --- STRIPE HELPERS ---

async function getOrCreateStripeCustomer(user) {
    if (user.stripe_customer_id) return user.stripe_customer_id;
    if (!stripe) return null;
    const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id }
    });
    await db.updateUser(user.id, { stripe_customer_id: customer.id });
    return customer.id;
}

let starterSubscriptionPriceId = null;
let starterSetupPriceId = null;

async function initStripePrices() {
    if (!stripe) return;
    try {
        const prices = await stripe.prices.list({ limit: 100, active: true });
        const subPrice = prices.data.find(p => p.lookup_key === 'vocara_starter_yearly_v2');
        if (subPrice) {
            starterSubscriptionPriceId = subPrice.id;
        } else {
            const product = await stripe.products.create({ name: 'Vocara Starter Pass (Yearly)' });
            const newPrice = await stripe.prices.create({
                unit_amount: 2499,
                currency: 'usd',
                recurring: { interval: 'year' },
                product: product.id,
                lookup_key: 'vocara_starter_yearly_v2'
            });
            starterSubscriptionPriceId = newPrice.id;
        }

        const setupPrice = prices.data.find(p => p.lookup_key === 'vocara_starter_setup');
        if (setupPrice) {
            starterSetupPriceId = setupPrice.id;
        } else {
            const productSetup = await stripe.products.create({ name: 'Vocara Starter Pass (Setup Fee)' });
            const newSetupPrice = await stripe.prices.create({
                unit_amount: 2499,
                currency: 'usd',
                product: productSetup.id,
                lookup_key: 'vocara_starter_setup'
            });
            starterSetupPriceId = newSetupPrice.id;
        }
    } catch (e) {
        console.warn('Stripe pricing init warning:', e.message);
    }
}
initStripePrices();

// Create Stripe PaymentIntent or Subscription for In-App Checkout
app.post('/api/create-payment-intent', authMiddleware, async (req, res) => {
    try {
        const { plan } = req.body;

        if (!stripe) {
            return res.status(400).json({ success: false, error: 'Stripe payments are not configured on server.' });
        }

        if (plan === 'lifetime') {
            const paymentIntent = await stripe.paymentIntents.create({
                amount: 8900,
                currency: 'usd',
                metadata: { userId: req.user.id, plan: 'lifetime' },
                automatic_payment_methods: { enabled: true }
            });

            return res.json({
                success: true,
                clientSecret: paymentIntent.client_secret,
                publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51U1JsLRU52o5cW8gvcz9OtLNGb8vwYKI9D4uT7uY6lOg67q34YwDRGLtEdWf7xg0Q6Ngf2ugHItFxaWd9oxTAEeo001LqSAdo5'
            });
        }

        // Starter plan uses a Subscription
        if (!starterSubscriptionPriceId || !starterSetupPriceId) {
            await initStripePrices();
        }

        const customerId = await getOrCreateStripeCustomer(req.user);

        const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: starterSubscriptionPriceId }],
            trial_period_days: 7,
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
            metadata: { userId: req.user.id, plan: 'starter' }
        });

        await db.updateUser(req.user.id, { stripe_subscription_id: subscription.id });

        res.json({
            success: true,
            clientSecret: subscription.pending_setup_intent ? subscription.pending_setup_intent.client_secret : (subscription.latest_invoice && subscription.latest_invoice.payment_intent ? subscription.latest_invoice.payment_intent.client_secret : null),
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51U1JsLRU52o5cW8gvcz9OtLNGb8vwYKI9D4uT7uY6lOg67q34YwDRGLtEdWf7xg0Q6Ngf2ugHItFxaWd9oxTAEeo001LqSAdo5'
        });
    } catch (err) {
        console.error('Stripe PaymentIntent/Subscription error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Confirm Payment & Activate Subscription Plan
app.post('/api/confirm-payment', authMiddleware, async (req, res) => {
    try {
        const { paymentIntentId, plan } = req.body;

        if (paymentIntentId && stripe) {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            if (paymentIntent.status !== 'succeeded') {
                return res.status(400).json({ success: false, error: 'Payment status is not completed.' });
            }
        }

        let credits = 10;
        if (plan === 'lifetime') credits = 99999;

        await db.updateUser(req.user.id, { plan: plan || 'starter', credits });
        const updatedUser = await db.getUserById(req.user.id);
        res.json({
            success: true,
            message: `Payment confirmed! ${plan.toUpperCase()} plan activated.`,
            user: updatedUser
        });
    } catch (err) {
        console.error('Confirm payment error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Basic Stripe Webhook Endpoint
app.post('/api/webhook', async (req, res) => {
    const event = req.body;
    try {
        if (event.type === 'invoice.payment_failed') {
            const invoice = event.data.object;
            console.log('Payment failed for subscription:', invoice.subscription);
            if (invoice.subscription) {
                const user = await db.getUserByStripeSubscriptionId(invoice.subscription);
                if (user) {
                    await db.updateUser(user.id, { stripe_subscription_id: null, plan: 'free' });
                    console.log(`Downgraded user ${user.id} due to payment failure on sub ${invoice.subscription}`);
                }
            }
        } else if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;
            console.log('Subscription canceled:', subscription.id);
            const user = await db.getUserByStripeSubscriptionId(subscription.id);
            if (user) {
                await db.updateUser(user.id, { stripe_subscription_id: null, plan: 'free' });
                console.log(`Downgraded user ${user.id} due to subscription cancellation: ${subscription.id}`);
            }
        }
    } catch (err) {
        console.error('Webhook error:', err);
    }
    res.json({ received: true });
});

// Get User's Saved Sounds
app.get('/api/user/sounds', authMiddleware, async (req, res) => {
    try {
        const sounds = await db.getSoundsByUserId(req.user.id);
        res.json({ success: true, sounds });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get User's Saved Tattoo Designs / Stencils
app.get('/api/user/designs', authMiddleware, async (req, res) => {
    try {
        const designs = await db.getDesignsByUserId(req.user.id);
        res.json({ success: true, designs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save User Tattoo Design Stencil
app.post('/api/user/designs', authMiddleware, async (req, res) => {
    try {
        const { title, sound_id, image_url } = req.body;
        if (!title || !image_url) {
            return res.status(400).json({ success: false, error: 'Design title and image data are required.' });
        }
        const id = 'dsg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
        const designData = { id, user_id: req.user.id, sound_id: sound_id || null, title, image_url, created_at: Date.now() };
        await db.saveDesign(designData);
        res.json({ success: true, design: designData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- PUBLIC REST API ENDPOINTS ---

// Get all recorded sounds (Public Gallery)
app.get('/api/sounds', async (req, res) => {
    try {
        const sounds = await db.getAllSounds();
        res.json({ success: true, sounds });
    } catch (err) {
        console.error('Error fetching sounds:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get sound by ID or Code
app.get('/api/sounds/:id', async (req, res) => {
    try {
        const sound = await db.getSoundById(req.params.id) || await db.getSoundByCode(req.params.id);
        if (!sound) {
            return res.status(404).json({ success: false, error: 'Sound not found' });
        }
        res.json({ success: true, sound });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper to generate clean unique 6-char sound code
function generateSoundCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'VCR-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Gated Sound Creation Endpoint (Multipart OR Base64 JSON)
// Require Account Creation for Sound Generation!
app.post('/api/sounds', optionalAuthMiddleware, upload.single('audio'), async (req, res) => {
    try {
        // Enforce Authentication for Sound Generation
        if (!req.user) {
            return res.status(401).json({
                success: false,
                requireAuth: true,
                error: 'Please create a free account to engrave sound memories and generate tattoo stencils.'
            });
        }

        // Check user plan / credits if free plan
        if (req.user.plan === 'free' && req.user.credits <= 0) {
            return res.status(402).json({
                success: false,
                requirePlan: true,
                error: 'You have reached the limit of free sound engravings. Please select a plan in your Dashboard to continue.'
            });
        }

        let filename = '';
        let mimeType = 'audio/webm';

        if (req.file) {
            filename = req.file.filename;
            mimeType = req.file.mimetype;
            try { fs.copyFileSync(req.file.path, path.join(publicAudioDir, filename)); } catch (e) {}
        } else if (req.body.audioBase64) {
            const base64Data = req.body.audioBase64.replace(/^data:.*?;base64,/, '');
            mimeType = req.body.mimeType || 'audio/webm';
            let ext = '.webm';
            if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) ext = '.m4a';
            else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) ext = '.mp3';
            else if (mimeType.includes('wav')) ext = '.wav';

            filename = `sound-${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`;
            const filePath = path.join(uploadsDir, filename);
            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
            try { fs.copyFileSync(filePath, path.join(publicAudioDir, filename)); } catch (e) {}
        } else {
            return res.status(400).json({ success: false, error: 'No audio data provided' });
        }

        const id = 'vcr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
        const label = req.body.label || 'Untitled Memory';
        const duration = parseFloat(req.body.duration) || 0;
        const fingerprint = typeof req.body.fingerprint === 'string'
            ? JSON.parse(req.body.fingerprint)
            : (req.body.fingerprint || []);
        const sound_code = req.body.sound_code || generateSoundCode();

        const soundData = {
            id,
            user_id: req.user.id,
            label,
            filename,
            duration,
            fingerprint,
            sound_code,
            mime_type: mimeType,
            created_at: Date.now()
        };

        await db.saveSound(soundData);

        // Decrement credit if on free plan
        if (req.user.plan === 'free') {
            await db.decrementCredits(req.user.id);
        }

        res.json({ success: true, sound: soundData });
    } catch (err) {
        console.error('Error saving sound:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Pearson Correlation matching function
function pearsonCorrelation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n === 0) return 0;

    let sumA = 0, sumB = 0;
    for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
    const meanA = sumA / n;
    const meanB = sumB / n;

    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
        const diffA = a[i] - meanA;
        const diffB = b[i] - meanB;
        num += diffA * diffB;
        denA += diffA * diffA;
        denB += diffB * diffB;
    }
    const den = Math.sqrt(denA * denB);
    return den === 0 ? 0 : num / den;
}

const ort = require('onnxruntime-node');
let onnxSession = null;

// Initialize ONNX AI Model Session
(async () => {
    try {
        const modelPath = path.join(__dirname, 'public', 'models', 'vocara_embed.onnx');
        if (fs.existsSync(modelPath)) {
            onnxSession = await ort.InferenceSession.create(modelPath);
            console.log('✅ ONNX AI Embedding Engine initialized successfully in server.js!');
        }
    } catch (e) {
        console.warn('⚠️ ONNX Session init warning:', e.message);
    }
})();

function fingerprintToTensor(fp) {
    const tensorData = new Float32Array(128 * 128);
    tensorData.fill(1.0);
    
    const cy = 64;
    const barW = 128 / fp.length;
    for (let i = 0; i < fp.length; i++) {
        const val = Math.max(0, Math.min(1, fp[i]));
        const barH = Math.round(val * 50);
        const xStart = Math.floor(i * barW);
        const xEnd = Math.floor((i + 1) * barW);
        for (let x = xStart; x < xEnd && x < 128; x++) {
            for (let y = Math.max(0, cy - barH); y <= Math.min(127, cy + barH); y++) {
                tensorData[y * 128 + x] = -1.0;
            }
        }
    }
    return new ort.Tensor('float32', tensorData, [1, 1, 128, 128]);
}

async function extractOnnxEmbedding(fp) {
    if (!onnxSession) return null;
    try {
        const tensor = fingerprintToTensor(fp);
        const feeds = {};
        feeds[onnxSession.inputNames[0]] = tensor;
        const results = await onnxSession.run(feeds);
        const emb = results[onnxSession.outputNames[0]].data;
        return Array.from(emb);
    } catch (e) {
        console.error('ONNX embedding error:', e);
        return null;
    }
}

// 100% FREE PUBLIC Tattoo Camera & Photo Scan API Endpoint
app.post('/api/scan', async (req, res) => {
    try {
        const { fingerprint, soundCode } = req.body;

        if (soundCode) {
            const matchByCode = await db.getSoundByCode(soundCode);
            if (matchByCode) {
                return res.json({
                    success: true,
                    matchType: 'code',
                    confidence: 1.0,
                    sound: matchByCode
                });
            }
        }

        if (fingerprint && Array.isArray(fingerprint) && fingerprint.length > 0) {
            const queryEmb = await extractOnnxEmbedding(fingerprint);
            const allSounds = await db.getAllSounds();
            let candidateMatches = [];

            for (const s of allSounds) {
                if (!s.fingerprint || !Array.isArray(s.fingerprint)) continue;

                let score = 0;
                if (queryEmb) {
                    const dbEmb = await extractOnnxEmbedding(s.fingerprint);
                    if (dbEmb) {
                        let dot = 0;
                        for (let k = 0; k < queryEmb.length; k++) {
                            dot += queryEmb[k] * dbEmb[k];
                        }
                        score = Math.max(0, Math.min(1, dot));
                    }
                }

                if (score < 0.1) {
                    const fpCandidates = [s.fingerprint, s.fingerprint.map(v => 1 - v)];
                    for (const candidateFp of fpCandidates) {
                        for (let shift = -8; shift <= 8; shift++) {
                            let subA = [], subB = [];
                            for (let i = 0; i < fingerprint.length; i++) {
                                const j = i + shift;
                                if (j >= 0 && j < candidateFp.length) {
                                    subA.push(fingerprint[i]);
                                    subB.push(candidateFp[j]);
                                }
                            }
                            if (subA.length >= fingerprint.length * 0.65) {
                                const pScore = pearsonCorrelation(subA, subB);
                                if (pScore > score) score = pScore;
                            }
                        }
                    }
                }

                if (score >= 0.50) {
                    candidateMatches.push({
                        sound: s,
                        score: Math.min(0.99, Math.round(score * 100) / 100)
                    });
                }
            }

            candidateMatches.sort((a, b) => b.score - a.score);
            const top5 = candidateMatches.slice(0, 5);

            if (top5.length > 0 && top5[0].score >= 0.45) {
                return res.json({
                    success: true,
                    matchType: 'onnx_embedding',
                    confidence: top5[0].score,
                    sound: top5[0].sound,
                    candidates: top5
                });
            }
        }

        res.json({ success: false, message: 'No matching sound motif found' });
    } catch (err) {
        console.error('Scan error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete sound endpoint (User or Admin)
app.delete('/api/sounds/:id', optionalAuthMiddleware, async (req, res) => {
    try {
        const sound = await db.getSoundById(req.params.id);
        if (!sound) {
            return res.status(404).json({ success: false, error: 'Sound not found' });
        }

        // Permit deletion if sound owner or admin
        if (req.user && (req.user.id === sound.user_id || req.user.role === 'admin' || req.user.role === 'superadmin')) {
            const filePath = path.join(uploadsDir, sound.filename);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
            await db.deleteSound(req.params.id);
            return res.json({ success: true, message: 'Sound deleted successfully.' });
        }

        res.status(403).json({ success: false, error: 'Unauthorized to delete this sound.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- SUPER ADMIN ENDPOINTS ---

// Admin: Get all registered users
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
    try {
        const users = await db.getAllUsers();
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin: Grant credits / upgrade plan / change role
app.post('/api/admin/users/:id/grant', adminMiddleware, async (req, res) => {
    try {
        const { plan, credits, role } = req.body;
        const updates = {};
        if (plan !== undefined) updates.plan = plan;
        if (credits !== undefined) updates.credits = parseInt(credits, 10);
        if (role !== undefined) updates.role = role;

        await db.updateUser(req.params.id, updates);
        const updatedUser = await db.getUserById(req.params.id);
        res.json({ success: true, user: updatedUser });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin: Delete user
app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own admin account.' });
        }
        await db.deleteUser(req.params.id);
        res.json({ success: true, message: 'User account deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin: Get system metrics & global media audit
app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
    try {
        const stats = await db.getStats();
        const allSounds = await db.getAllSounds();
        const allDesigns = await db.getAllDesigns();
        res.json({
            success: true,
            stats,
            totalSounds: allSounds.length,
            totalDesigns: allDesigns.length,
            sounds: allSounds,
            designs: allDesigns
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Catch-all for SPA client routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================`);
    console.log(`Vocara Server running on port ${PORT}`);
    console.log(`URL: http://127.0.0.1:${PORT}`);
    console.log(`=================================`);
});
