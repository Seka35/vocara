const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'vocara.sqlite');
const db = new sqlite3.Database(dbPath);

// Crypto password hashing helpers
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedCombined) {
    if (!storedCombined || typeof storedCombined !== 'string' || !storedCombined.includes(':')) return false;
    try {
        const [salt, hash] = storedCombined.split(':');
        const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
    } catch (e) {
        return false;
    }
}

// Initialize Database Schema
db.serialize(() => {
    // 1. Users Table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            plan TEXT DEFAULT 'free',
            credits INTEGER DEFAULT 1,
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            created_at INTEGER NOT NULL
        )
    `);

    // 2. Sounds Table (with user_id)
    db.run(`
        CREATE TABLE IF NOT EXISTS sounds (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            label TEXT NOT NULL,
            filename TEXT NOT NULL,
            duration REAL DEFAULT 0,
            fingerprint TEXT NOT NULL,
            sound_code TEXT UNIQUE NOT NULL,
            mime_type TEXT DEFAULT 'audio/webm',
            created_at INTEGER NOT NULL
        )
    `);

    // Migrate user_id column if sounds table existed without it
    db.run(`ALTER TABLE sounds ADD COLUMN user_id TEXT`, (err) => {
        // Ignore column already exists error
    });

    // Migrate stripe columns if users table existed without them
    db.run(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`, (err) => {});
    db.run(`ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`, (err) => {});

    // 3. Designs Table (Tattoo visual stencils & design creations)
    db.run(`
        CREATE TABLE IF NOT EXISTS designs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            sound_id TEXT,
            title TEXT NOT NULL,
            image_url TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);

    // Seed Super Admin Account if not existing
    const adminEmail = 'admin@vocara.ai';
    db.get(`SELECT id FROM users WHERE email = ?`, [adminEmail], (err, row) => {
        if (!row) {
            const adminId = 'usr_superadmin_' + Date.now().toString(36);
            const passHash = hashPassword('AdminVocara2026!');
            db.run(`
                INSERT INTO users (id, name, email, password_hash, role, plan, credits, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [adminId, 'Super Admin', adminEmail, passHash, 'superadmin', 'lifetime', 99999, Date.now()]);
            console.log('✅ Default Super Admin account seeded: admin@vocara.ai / AdminVocara2026!');
        }
    });
});

// Promisified Database Helpers
const dbHelpers = {
    hashPassword,
    verifyPassword,

    // --- USER OPERATIONS ---
    createUser: ({ name, email, password, role = 'user', plan = 'free', credits = 1 }) => {
        return new Promise((resolve, reject) => {
            const id = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
            const password_hash = hashPassword(password);
            const created_at = Date.now();
            const cleanEmail = email.trim().toLowerCase();

            const sql = `
                INSERT INTO users (id, name, email, password_hash, role, plan, credits, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            db.run(sql, [id, name.trim(), cleanEmail, password_hash, role, plan, credits, created_at], function (err) {
                if (err) return reject(err);
                resolve({ id, name: name.trim(), email: cleanEmail, role, plan, credits, created_at });
            });
        });
    },

    getUserByEmail: (email) => {
        return new Promise((resolve, reject) => {
            const cleanEmail = email.trim().toLowerCase();
            db.get(`SELECT * FROM users WHERE LOWER(email) = ?`, [cleanEmail], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    },

    getUserById: (id) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT id, name, email, role, plan, credits, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE id = ?`, [id], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    },

    getUserByStripeSubscriptionId: (subscriptionId) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT id, name, email, role, plan, credits, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE stripe_subscription_id = ?`, [subscriptionId], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    },

    getAllUsers: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT id, name, email, role, plan, credits, stripe_customer_id, stripe_subscription_id, created_at FROM users ORDER BY created_at DESC`, [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    },

    updateUser: (id, updates) => {
        return new Promise((resolve, reject) => {
            const allowed = ['name', 'role', 'plan', 'credits', 'stripe_customer_id', 'stripe_subscription_id'];
            const setClause = [];
            const values = [];

            for (const key of allowed) {
                if (updates[key] !== undefined) {
                    setClause.push(`${key} = ?`);
                    values.push(updates[key]);
                }
            }

            if (setClause.length === 0) return resolve(null);
            values.push(id);

            const sql = `UPDATE users SET ${setClause.join(', ')} WHERE id = ?`;
            db.run(sql, values, function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            });
        });
    },

    deleteUser: (id) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM users WHERE id = ?`, [id], function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            });
        });
    },

    decrementCredits: (userId) => {
        return new Promise((resolve, reject) => {
            db.run(`UPDATE users SET credits = MAX(0, credits - 1) WHERE id = ?`, [userId], function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            });
        });
    },

    // --- SOUND OPERATIONS ---
    saveSound: (sound) => {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO sounds (id, user_id, label, filename, duration, fingerprint, sound_code, mime_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            db.run(
                sql,
                [
                    sound.id,
                    sound.user_id || null,
                    sound.label,
                    sound.filename,
                    sound.duration || 0,
                    JSON.stringify(sound.fingerprint),
                    sound.sound_code,
                    sound.mime_type || 'audio/webm',
                    sound.created_at || Date.now()
                ],
                function (err) {
                    if (err) return reject(err);
                    resolve({ id: sound.id, ...sound });
                }
            );
        });
    },

    getAllSounds: () => {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM sounds ORDER BY created_at DESC`;
            db.all(sql, [], (err, rows) => {
                if (err) return reject(err);
                const parsed = rows.map(r => ({
                    ...r,
                    fingerprint: JSON.parse(r.fingerprint)
                }));
                resolve(parsed);
            });
        });
    },

    getSoundsByUserId: (userId) => {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM sounds WHERE user_id = ? ORDER BY created_at DESC`;
            db.all(sql, [userId], (err, rows) => {
                if (err) return reject(err);
                const parsed = rows.map(r => ({
                    ...r,
                    fingerprint: JSON.parse(r.fingerprint)
                }));
                resolve(parsed);
            });
        });
    },

    getSoundById: (id) => {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM sounds WHERE id = ?`;
            db.get(sql, [id], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                resolve({
                    ...row,
                    fingerprint: JSON.parse(row.fingerprint)
                });
            });
        });
    },

    getSoundByCode: (code) => {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM sounds WHERE UPPER(sound_code) = UPPER(?)`;
            db.get(sql, [code], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                resolve({
                    ...row,
                    fingerprint: JSON.parse(row.fingerprint)
                });
            });
        });
    },

    deleteSound: (id) => {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM sounds WHERE id = ?`;
            db.run(sql, [id], function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            });
        });
    },

    // --- DESIGN OPERATIONS ---
    saveDesign: (design) => {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO designs (id, user_id, sound_id, title, image_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            db.run(sql, [design.id, design.user_id, design.sound_id || null, design.title, design.image_url, design.created_at || Date.now()], function (err) {
                if (err) return reject(err);
                resolve(design);
            });
        });
    },

    getDesignsByUserId: (userId) => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM designs WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    },

    getAllDesigns: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM designs ORDER BY created_at DESC`, [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    },

    deleteDesign: (id) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM designs WHERE id = ?`, [id], function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            });
        });
    },

    // --- SYSTEM STATS ---
    getStats: () => {
        return new Promise(async (resolve, reject) => {
            try {
                const usersCount = await new Promise(r => db.get(`SELECT COUNT(*) as c FROM users`, [], (err, row) => r(row ? row.c : 0)));
                const soundsCount = await new Promise(r => db.get(`SELECT COUNT(*) as c FROM sounds`, [], (err, row) => r(row ? row.c : 0)));
                const designsCount = await new Promise(r => db.get(`SELECT COUNT(*) as c FROM designs`, [], (err, row) => r(row ? row.c : 0)));
                resolve({ usersCount, soundsCount, designsCount });
            } catch (e) {
                reject(e);
            }
        });
    }
};

module.exports = dbHelpers;
