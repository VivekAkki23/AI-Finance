
//database.js
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./data.db");

db.serialize(() => {

  // ✅ Keep your existing table
  db.run("CREATE TABLE IF NOT EXISTS logs (time TEXT)");

  // ✅ Add users table (no removal or modification of logs table)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      verification_token TEXT,
      verification_expires INTEGER
    )
  `);
});

module.exports = db;
