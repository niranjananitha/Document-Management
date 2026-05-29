import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH']
  }
});

const PORT = process.env.PORT || 5000;

// Ensure uploads directory exists
const uploadsDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Express Middleware
app.use(cors());
app.use(express.json());

// Setup Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Multer file filter (PDF only)
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.mimetype === 'application/pdf' || ext === '.pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF documents are supported.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// In-memory batch tracker for bulk uploads
// key: batchId -> value: { totalFiles, completedCount, successCount, failedCount }
const activeBatches = new Map();

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

// ==========================================
// REST API ROUTES
// ==========================================

// POST /api/upload - Upload a file (individual or as part of a batch)
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err.message);
      return res.status(400).json({ success: false, error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided.' });
    }

    const { batchId, totalFiles: totalFilesStr } = req.body;
    const totalFiles = totalFilesStr ? parseInt(totalFilesStr, 10) : 1;

    const fileId = generateId();
    const originalName = req.file.originalname;
    const filename = req.file.filename;
    const size = req.file.size;
    const mimetype = req.file.mimetype;
    const filePath = req.file.path;

    try {
      // Save file details to database
      const stmt = db.prepare(`
        INSERT INTO files (id, filename, original_name, size, mimetype, path)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(fileId, filename, originalName, size, mimetype, filePath);

      const savedFile = {
        id: fileId,
        filename,
        original_name: originalName,
        size,
        mimetype,
        path: filePath,
        uploaded_at: new Date().toISOString()
      };

      console.log(`Successfully uploaded: ${originalName} (ID: ${fileId})`);

      // Handle batch logic if more than 3 files are uploading in bulk
      if (batchId && totalFiles > 3) {
        if (!activeBatches.has(batchId)) {
          activeBatches.set(batchId, {
            totalFiles,
            completedCount: 0,
            successCount: 0,
            failedCount: 0
          });
        }

        const batch = activeBatches.get(batchId);
        batch.completedCount += 1;
        batch.successCount += 1;

        console.log(`Batch ${batchId} progress: ${batch.completedCount}/${batch.totalFiles}`);

        // If batch completed, create notification & emit socket event
        if (batch.completedCount >= batch.totalFiles) {
          const notifId = generateId();
          const message = `${batch.totalFiles} files uploaded successfully`;
          const type = 'success';

          const notifStmt = db.prepare(`
            INSERT INTO notifications (id, message, type)
            VALUES (?, ?, ?)
          `);
          notifStmt.run(notifId, message, type);

          const newNotif = {
            id: notifId,
            message,
            type,
            read_status: 0, // 0 is unread in UI
            created_at: new Date().toISOString()
          };

          // Emit to all connected clients
          console.log(`Batch ${batchId} complete. Emitting bulk_upload_complete event...`);
          io.emit('bulk_upload_complete', {
            type: 'upload_complete',
            notification: newNotif
          });

          activeBatches.delete(batchId);
        }
      }

      return res.status(200).json({ success: true, file: savedFile });
    } catch (dbErr) {
      console.error('Database write error during upload:', dbErr);
      return res.status(500).json({ success: false, error: 'Database write error.' });
    }
  });
});

// GET /api/files & GET /api/documents - List all uploaded files
const listFiles = (req, res) => {
  try {
    const files = db.prepare('SELECT * FROM files ORDER BY uploaded_at DESC').all();
    // Map column names for compatibility with frontend if needed
    const documents = files.map(file => ({
      id: file.id,
      name: file.original_name,
      size: file.size,
      mimetype: file.mimetype,
      uploaded_at: file.uploaded_at
    }));
    return res.status(200).json(documents);
  } catch (err) {
    console.error('Error fetching files:', err);
    return res.status(500).json({ error: 'Database query error.' });
  }
};
app.get('/api/files', listFiles);
app.get('/api/documents', listFiles);

// GET /api/files/:id/download & GET /api/documents/:id/download - Download a file
const downloadFile = (req, res) => {
  const { id } = req.params;
  try {
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    if (!file) {
      return res.status(404).json({ error: 'File not found.' });
    }

    if (!fs.existsSync(file.path)) {
      return res.status(404).json({ error: 'Physical file not found on disk.' });
    }

    return res.download(file.path, file.original_name);
  } catch (err) {
    console.error('Error downloading file:', err);
    return res.status(500).json({ error: 'File download error.' });
  }
};
app.get('/api/files/:id/download', downloadFile);
app.get('/api/documents/:id/download', downloadFile);

// DELETE /api/files/:id & DELETE /api/documents/:id - Delete a file
const deleteFile = (req, res) => {
  const { id } = req.params;
  try {
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    if (!file) {
      return res.status(404).json({ error: 'File not found.' });
    }

    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    
    db.prepare('DELETE FROM files WHERE id = ?').run(id);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error deleting file:', err);
    return res.status(500).json({ error: 'File deletion error.' });
  }
};
app.delete('/api/files/:id', deleteFile);
app.delete('/api/documents/:id', deleteFile);

// GET /api/notifications - Get all notifications
app.get('/api/notifications', (req, res) => {
  try {
    const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC').all();
    const formatted = notifications.map(n => ({
      id: n.id,
      message: n.message,
      type: n.type,
      read_status: n.is_read, // Map SQLite is_read (0/1) to read_status (0/1)
      timestamp: n.created_at
    }));
    return res.status(200).json(formatted);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    return res.status(500).json({ error: 'Database query error.' });
  }
});

// PATCH /api/notifications/:id/read - Mark one as read
app.patch('/api/notifications/:id/read', (req, res) => {
  const { id } = req.params;
  try {
    const result = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    return res.status(500).json({ error: 'Database update error.' });
  }
});

// PATCH /api/notifications/read-all - Mark all as read
app.patch('/api/notifications/read-all', (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1').run();
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    return res.status(500).json({ error: 'Database update error.' });
  }
});

// ==========================================
// SOCKET.IO REAL-TIME CONNECTIVITY
// ==========================================
io.on('connection', (socket) => {
  console.log(`Socket client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Socket client disconnected: ${socket.id}`);
  });
});

// Start Server
httpServer.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`Local link: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
