import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, 'database.db');
let db;

try {
  const { default: Database } = await import('better-sqlite3');
  db = new Database(dbPath);

  // Initialize database schemas
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mimetype TEXT NOT NULL,
      path TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('success', 'error', 'info')),
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('SQLite database initialized successfully at:', dbPath);
} catch (e) {
  console.warn('================================================================');
  console.warn('WARNING: better-sqlite3 could not be loaded in this environment.');
  console.warn('Initializing robust in-memory mock database layer as fallback.');
  console.warn('================================================================');

  class MockDatabase {
    constructor() {
      this.files = [];
      this.notifications = [];
    }

    exec(sql) {
      // Mock exec
    }

    prepare(sql) {
      const lower = sql.toLowerCase().trim();
      return {
        run: (...args) => {
          if (lower.startsWith('insert into files')) {
            const [id, filename, original_name, size, mimetype, path] = args;
            this.files.push({
              id,
              filename,
              original_name,
              size,
              mimetype,
              path,
              uploaded_at: new Date().toISOString()
            });
            return { changes: 1 };
          }
          if (lower.startsWith('insert into notifications')) {
            const [id, message, type] = args;
            this.notifications.push({
              id,
              message,
              type,
              is_read: 0,
              created_at: new Date().toISOString()
            });
            return { changes: 1 };
          }
          if (lower.startsWith('update notifications set is_read = 1')) {
            if (lower.includes('where id = ?')) {
              const [id] = args;
              const notif = this.notifications.find(n => n.id === id);
              if (notif) {
                notif.is_read = 1;
                return { changes: 1 };
              }
              return { changes: 0 };
            } else {
              this.notifications.forEach(n => n.is_read = 1);
              return { changes: this.notifications.length };
            }
          }
          if (lower.startsWith('delete from files')) {
            if (lower.includes('where id = ?')) {
              const [id] = args;
              const index = this.files.findIndex(f => f.id === id);
              if (index !== -1) {
                this.files.splice(index, 1);
                return { changes: 1 };
              }
              return { changes: 0 };
            } else {
              const count = this.files.length;
              this.files = [];
              return { changes: count };
            }
          }
          return { changes: 0 };
        },
        all: (...args) => {
          if (lower.includes('from files')) {
            return [...this.files].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
          }
          if (lower.includes('from notifications')) {
            return [...this.notifications].sort((a, b) => b.created_at.localeCompare(a.created_at));
          }
          return [];
        },
        get: (...args) => {
          if (lower.includes('from files where id = ?')) {
            const [id] = args;
            return this.files.find(f => f.id === id) || null;
          }
          if (lower.includes('from notifications where id = ?')) {
            const [id] = args;
            return this.notifications.find(n => n.id === id) || null;
          }
          return null;
        }
      };
    }
  }

  db = new MockDatabase();
}

export default db;
