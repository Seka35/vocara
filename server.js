const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4892;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads', 'audio');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage for audio uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = file.mimetype.includes('mp4') || file.mimetype.includes('m4a') ? '.m4a' : '.webm';
        cb(null, `sound-${uniqueSuffix}${ext}`);
    }
});
const upload = multer({ storage });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files and uploads
app.use(express.static(path.join(__dirname, 'public')));
app.use('/audio', express.static(uploadsDir));

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
        } else if (req.body.audioBase64) {
            // Handle base64 fallback from mobile / web recorder
            const base64Data = req.body.audioBase64.replace(/^data:audio\/\w+;base64,/, '');
            mimeType = req.body.mimeType || 'audio/webm';
            const ext = mimeType.includes('mp4') ? '.m4a' : '.webm';
            filename = `sound-${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`;
            const filePath = path.join(uploadsDir, filename);
            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
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

// Correlation matching function (Pearson Correlation)
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

        // 2. Waveform Fingerprint Correlation Match
        if (fingerprint && Array.isArray(fingerprint)) {
            const allSounds = await db.getAllSounds();
            let bestMatch = null;
            let bestScore = -1;

            for (const s of allSounds) {
                // Try small shifts (-5 to +5) for tolerance to frame shifts
                for (let shift = -5; shift <= 5; shift++) {
                    let subA = [];
                    let subB = [];
                    for (let i = 0; i < fingerprint.length; i++) {
                        const j = i + shift;
                        if (j >= 0 && j < s.fingerprint.length) {
                            subA.push(fingerprint[i]);
                            subB.push(s.fingerprint[j]);
                        }
                    }
                    if (subA.length >= fingerprint.length * 0.6) {
                        const score = pearsonCorrelation(subA, subB);
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = s;
                        }
                    }
                }
            }

            if (bestMatch && bestScore >= 0.45) {
                return res.json({
                    success: true,
                    matchType: 'fingerprint',
                    confidence: Math.round(bestScore * 100) / 100,
                    sound: bestMatch
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
