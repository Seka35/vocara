const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'vocara.sqlite');
const db = new sqlite3.Database(dbPath);

// Initialize Database Schema
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS sounds (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            filename TEXT NOT NULL,
            duration REAL DEFAULT 0,
            fingerprint TEXT NOT NULL,
            sound_code TEXT UNIQUE NOT NULL,
            mime_type TEXT DEFAULT 'audio/webm',
            created_at INTEGER NOT NULL
        )
    `);
});

// Helper Database Operations (Promisified)
const dbHelpers = {
    saveSound: (sound) => {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO sounds (id, label, filename, duration, fingerprint, sound_code, mime_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            db.run(
                sql,
                [
                    sound.id,
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
    }
};

module.exports = dbHelpers;
