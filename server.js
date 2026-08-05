const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');

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
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

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
    
    // Constant-time timing-safe buffer comparison to prevent timing attacks
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

// Middleware
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

// --- REST API Endpoints ---

// Get all recorded sounds
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

// Self-service Sound Code lookup by email or phone
app.post('/api/sounds/lookup', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || query.length < 3) {
            return res.status(400).json({ success: false, error: 'Query too short' });
        }
        
        // Search sounds matching contact query
        const sounds = await db.searchSoundsByContact ? await db.searchSoundsByContact(query) : [];
        res.json({ success: true, sounds });
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

// Upload new recorded sound (Multipart OR Base64 JSON)
app.post('/api/sounds', upload.single('audio'), async (req, res) => {
    try {
        let filename = '';
        let mimeType = 'audio/webm';

        if (req.file) {
            filename = req.file.filename;
            mimeType = req.file.mimetype;
            try { fs.copyFileSync(req.file.path, path.join(publicAudioDir, filename)); } catch (e) {}
        } else if (req.body.audioBase64) {
            // Handle base64 fallback from mobile / web recorder (strip any data:*;base64, header cleanly)
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
            label,
            filename,
            duration,
            fingerprint,
            sound_code,
            mime_type: mimeType,
            created_at: Date.now()
        };

        await db.saveSound(soundData);
        res.json({ success: true, sound: soundData });
    } catch (err) {
        console.error('Error saving sound:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Enhanced Correlation matching function (Normalized Pearson Correlation)
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

// Helper to convert 64-bin fingerprint or 2D array into ONNX Float32 Tensor (1, 1, 128, 128)
function fingerprintToTensor(fp) {
    const tensorData = new Float32Array(128 * 128);
    // Fill white canvas background (1.0 normalized)
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
                tensorData[y * 128 + x] = -1.0; // Dark ink waveform line (-1.0 in [-1, 1] scale)
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

// Scan API Endpoint (Handles fingerprint matching and/or sound code lookup)
app.post('/api/scan', async (req, res) => {
    try {
        const { fingerprint, soundCode } = req.body;

        // 1. Direct Sound Code match if present
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

        // 2. ONNX AI Embedding Cosine Similarity Match
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

                // Fallback / ensemble with Pearson correlation if ONNX score isn't available
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

            // Sort candidates descending by match score
            candidateMatches.sort((a, b) => b.score - a.score);
            const top5 = candidateMatches.slice(0, 5);

            if (top5.length > 0) {
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

// Delete sound endpoint
app.delete('/api/sounds/:id', async (req, res) => {
    try {
        const sound = await db.getSoundById(req.params.id);
        if (sound) {
            const filePath = path.join(uploadsDir, sound.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            await db.deleteSound(req.params.id);
        }
        res.json({ success: true });
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
