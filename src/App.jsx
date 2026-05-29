import { useState, useEffect, useRef } from 'react';
import { 
  Bell, 
  FileText, 
  UploadCloud, 
  Download, 
  CheckCircle, 
  AlertCircle, 
  X, 
  ChevronDown, 
  ChevronUp, 
  Search,
  File,
  Info,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { io } from 'socket.io-client';

function App() {
  // Application State
  const [documents, setDocuments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [uploads, setUploads] = useState({}); // uploadId -> { id, name, size, progress, status, batchId }
  const [activeBatches, setActiveBatches] = useState({}); // batchId -> { totalFiles, completedCount, collapsed }
  
  // UI State
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toasts, setToasts] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isConnectingSSE, setIsConnectingSSE] = useState(true);

  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Fetch initial data
  useEffect(() => {
    fetchDocuments();
    fetchNotifications();

    // Close notifications dropdown when clicking outside
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setNotifDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Socket.IO setup for real-time notifications
  useEffect(() => {
    console.log('Connecting to Socket.IO server...');
    const socket = io();

    socket.on('connect', () => {
      console.log('Socket.IO connection established');
      setIsConnectingSSE(false);
    });

    socket.on('disconnect', () => {
      console.log('Socket.IO connection lost');
      setIsConnectingSSE(true);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err);
      setIsConnectingSSE(true);
    });

    // Listen for bulk upload completion
    socket.on('bulk_upload_complete', (data) => {
      try {
        console.log('Socket event received (bulk_upload_complete):', data);
        if (data.type === 'upload_complete') {
          // Add new notification to list (support mapping SQLite 0/1 to UI 0)
          const formattedNotif = {
            id: data.notification.id,
            message: data.notification.message,
            type: data.notification.type,
            read_status: data.notification.read_status !== undefined ? data.notification.read_status : 0,
            timestamp: data.notification.timestamp || new Date().toISOString()
          };
          setNotifications(prev => [formattedNotif, ...prev]);
          
          // Show visual toast notification
          addToast('Upload Complete', formattedNotif.message, 'success');
          
          // Refresh files table to display newly uploaded items
          fetchDocuments();
        }
      } catch (err) {
        console.error('Error handling bulk_upload_complete socket event:', err);
      }
    });

    // Listen for new standard/custom notifications
    socket.on('notification_created', (data) => {
      try {
        console.log('Socket event received (notification_created):', data);
        const formattedNotif = {
          id: data.notification.id,
          message: data.notification.message,
          type: data.notification.type,
          read_status: data.notification.read_status !== undefined ? data.notification.read_status : 0,
          timestamp: data.notification.timestamp || new Date().toISOString()
        };
        setNotifications(prev => [formattedNotif, ...prev]);
        addToast('New Notification', formattedNotif.message, formattedNotif.type || 'info');
        fetchDocuments();
      } catch (err) {
        console.error('Error handling notification_created socket event:', err);
      }
    });

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  // Fetch Functions
  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  };

  // Toast Helpers
  const addToast = (title, message, type = 'info') => {
    const id = Date.now() + Math.random().toString();
    setToasts(prev => [...prev, { id, title, message, type }]);
    
    // Auto-remove toast after 6 seconds
    setTimeout(() => {
      removeToast(id);
    }, 6000);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Document formatting helpers
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Notification Operations
  const handleMarkAsRead = async (id, e) => {
    e.stopPropagation(); // Avoid closing dropdown unnecessarily
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH'
      });
      if (res.ok) {
        setNotifications(prev =>
          prev.map(n => n.id === id ? { ...n, read_status: 1 } : n)
        );
      }
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const res = await fetch('/api/notifications/read-all', {
        method: 'PATCH'
      });
      if (res.ok) {
        setNotifications(prev =>
          prev.map(n => ({ ...n, read_status: 1 }))
        );
        addToast('Notifications Cleared', 'All notifications marked as read', 'success');
      }
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
    }
  };

  // File Upload Logic
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files) {
      processSelectedFiles(Array.from(e.target.files));
    }
  };

  const processSelectedFiles = (selectedFiles) => {
    // Filter out non-PDF files
    const pdfFiles = selectedFiles.filter(file => file.type === 'application/pdf');
    const nonPdfCount = selectedFiles.length - pdfFiles.length;

    if (nonPdfCount > 0) {
      addToast(
        'Invalid File Type', 
        `${nonPdfCount} file(s) ignored. Only PDF documents are supported.`, 
        'error'
      );
    }

    if (pdfFiles.length === 0) return;

    const batchId = 'batch-' + Math.random().toString(36).substring(2, 15);
    const totalFiles = pdfFiles.length;

    // If uploading more than 3 files, immediately initialize bulk upload tracking
    if (totalFiles > 3) {
      setActiveBatches(prev => ({
        ...prev,
        [batchId]: {
          totalFiles,
          completedCount: 0,
          collapsed: false
        }
      }));
    }

    // Trigger parallel uploads for each PDF
    pdfFiles.forEach(file => {
      uploadIndividualFile(file, batchId, totalFiles);
    });
  };

  const uploadIndividualFile = (file, batchId, totalFiles) => {
    const uploadId = 'upload-' + Math.random().toString(36).substring(2, 15);

    // Initial state: pending
    setUploads(prev => ({
      ...prev,
      [uploadId]: {
        id: uploadId,
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'pending',
        batchId
      }
    }));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    // Monitor upload progress
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploads(prev => {
          if (!prev[uploadId]) return prev;
          return {
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              progress: percent,
              status: 'uploading'
            }
          };
        });
      }
    });

    // Handle completed upload response
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Success
        setUploads(prev => {
          if (!prev[uploadId]) return prev;
          return {
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              progress: 100,
              status: 'complete'
            }
          };
        });

        // Trigger document list refresh
        fetchDocuments();

        // Increment batch completed count if applicable
        if (totalFiles > 3) {
          setActiveBatches(prev => {
            const batch = prev[batchId];
            if (!batch) return prev;

            const nextCompletedCount = batch.completedCount + 1;
            
            // If all files in the batch are finished, clean up batch banner after a small delay
            if (nextCompletedCount >= batch.totalFiles) {
              setTimeout(() => {
                setActiveBatches(curr => {
                  const copy = { ...curr };
                  delete copy[batchId];
                  return copy;
                });
                
                // Also clean up finished uploads in state
                setUploads(currUploads => {
                  const copy = { ...currUploads };
                  Object.keys(copy).forEach(k => {
                    if (copy[k].batchId === batchId) {
                      delete copy[k];
                    }
                  });
                  return copy;
                });
              }, 4000);
            }

            return {
              ...prev,
              [batchId]: {
                ...batch,
                completedCount: nextCompletedCount
              }
            };
          });
        } else {
          // For standard uploads (<= 3 files), auto-remove from progress list after 3 seconds
          setTimeout(() => {
            setUploads(prev => {
              const copy = { ...prev };
              delete copy[uploadId];
              return copy;
            });
          }, 3000);
        }
      } else {
        handleUploadError();
      }
    };

    xhr.onerror = () => {
      handleUploadError();
    };

    const handleUploadError = () => {
      setUploads(prev => {
        if (!prev[uploadId]) return prev;
        return {
          ...prev,
          [uploadId]: {
            ...prev[uploadId],
            status: 'failed'
          }
        };
      });

      addToast('Upload Failed', `Could not upload ${file.name}`, 'error');

      // Update completed count in batch so progress bar layout doesn't hang
      if (totalFiles > 3) {
        setActiveBatches(prev => {
          const batch = prev[batchId];
          if (!batch) return prev;
          
          const nextCompletedCount = batch.completedCount + 1;
          
          if (nextCompletedCount >= batch.totalFiles) {
            setTimeout(() => {
              setActiveBatches(curr => {
                const copy = { ...curr };
                delete copy[batchId];
                return copy;
              });
            }, 4000);
          }

          return {
            ...prev,
            [batchId]: {
              ...batch,
              completedCount: nextCompletedCount
            }
          };
        });
      }
    };

    // Construct form data payload
    const formData = new FormData();
    formData.append('file', file);
    formData.append('batchId', batchId);
    formData.append('totalFiles', totalFiles.toString());

    xhr.send(formData);
  };

  const toggleBatchCollapse = (batchId) => {
    setActiveBatches(prev => {
      const batch = prev[batchId];
      if (!batch) return prev;
      return {
        ...prev,
        [batchId]: {
          ...batch,
          collapsed: !batch.collapsed
        }
      };
    });
  };

  const handleDownload = (docId) => {
    window.open(`/api/documents/${docId}/download`, '_blank');
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        addToast('Document Deleted', 'The document has been successfully removed.', 'success');
        fetchDocuments();
      } else {
        addToast('Delete Failed', 'Could not delete the document.', 'error');
      }
    } catch (err) {
      console.error('Error deleting document:', err);
      addToast('Delete Error', 'An error occurred while deleting the document.', 'error');
    }
  };

  // Computed Values
  const unreadCount = notifications.filter(n => n.read_status === 0).length;
  
  // Filtered documents
  const filteredDocuments = documents.filter(doc => 
    doc.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group uploads into standard and bulk
  const uploadArray = Object.values(uploads);
  const standardUploads = uploadArray.filter(u => {
    const batch = activeBatches[u.batchId];
    return !batch; // Uploads that do not belong to an active bulk batch
  });

  return (
    <div className="app-container">
      {/* Header Bar */}
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-icon">S</div>
          <div className="logo-text">SWS AI Document Manager</div>
        </div>

        <div className="header-actions">
          {/* Notification Center */}
          <div className="notif-bell-container" ref={dropdownRef}>
            <button 
              className="btn btn-icon"
              onClick={() => setNotifDropdownOpen(!notifDropdownOpen)}
              title="Notifications"
            >
              <Bell size={18} />
              {unreadCount > 0 && <span className="bell-badge">{unreadCount}</span>}
            </button>

            {notifDropdownOpen && (
              <div className="notif-dropdown">
                <div className="notif-header">
                  <h3>Notifications</h3>
                  {unreadCount > 0 && (
                    <button className="btn-link" onClick={handleMarkAllAsRead}>
                      Mark all as read
                    </button>
                  )}
                </div>

                <div className="notif-list">
                  {notifications.length === 0 ? (
                    <div className="notif-empty">
                      <Bell size={24} className="empty-state-icon" />
                      <p>All clean! No notifications yet.</p>
                    </div>
                  ) : (
                    notifications.map(notif => (
                      <div 
                        key={notif.id} 
                        className={`notif-item ${notif.read_status === 0 ? 'unread' : ''}`}
                        onClick={(e) => notif.read_status === 0 && handleMarkAsRead(notif.id, e)}
                        style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}
                      >
                        <div className={`notif-icon-wrapper ${notif.type}`} style={{ flexShrink: 0, marginTop: '2px' }}>
                          {notif.type === 'success' && <CheckCircle size={16} style={{ color: 'var(--success)' }} />}
                          {notif.type === 'error' && <AlertCircle size={16} style={{ color: 'var(--error)' }} />}
                          {notif.type === 'info' && <Info size={16} style={{ color: 'var(--primary)' }} />}
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <span className="notif-item-msg">{notif.message}</span>
                          <div className="notif-item-meta">
                            <span>{formatDate(notif.timestamp)}</span>
                            {notif.read_status === 0 && (
                              <button 
                                className="btn-link"
                                onClick={(e) => handleMarkAsRead(notif.id, e)}
                                style={{ fontSize: '0.7rem' }}
                              >
                                Mark read
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="dashboard-main">
        {/* SSE connection indicator if unstable */}
        {isConnectingSSE && (
          <div style={{
            background: 'var(--warning-light)',
            color: 'var(--warning)',
            padding: '0.5rem 1.5rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            border: '1px solid #fde68a'
          }}>
            <RefreshCw size={14} className="animate-spin" style={{ animation: 'spin 1.5s linear infinite' }} />
            <span>Connecting to real-time notification stream...</span>
          </div>
        )}

        {/* Smart Bulk Upload Banners */}
        {Object.entries(activeBatches).map(([batchId, batch]) => (
          <div key={batchId} className="bulk-banner">
            <div className="bulk-banner-header">
              <div className="bulk-banner-title">
                <Info size={16} />
                <span>Upload in progress — processing {batch.totalFiles} files in background</span>
              </div>
              <button 
                className="bulk-banner-toggle"
                onClick={() => toggleBatchCollapse(batchId)}
              >
                {batch.collapsed ? (
                  <>
                    <span>Show Details</span>
                    <ChevronDown size={14} />
                  </>
                ) : (
                  <>
                    <span>Hide Details</span>
                    <ChevronUp size={14} />
                  </>
                )}
              </button>
            </div>

            {/* Overall progress indicator inside banner */}
            <div className="progress-bar-container" style={{ height: '4px' }}>
              <div 
                className="progress-bar-fill" 
                style={{ 
                  width: `${(batch.completedCount / batch.totalFiles) * 100}%`,
                  transition: 'width 0.3s ease-out'
                }}
              />
            </div>

            {/* Collapsible individual progress bars */}
            {!batch.collapsed && (
              <div className="bulk-progress-list">
                {uploadArray
                  .filter(u => u.batchId === batchId)
                  .map(fileUpload => (
                    <div key={fileUpload.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.8rem', padding: '0.2rem 0' }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px', fontWeight: 500 }}>
                        {fileUpload.name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                        <span style={{ color: fileUpload.status === 'failed' ? 'var(--error)' : 'var(--primary)', fontWeight: 600 }}>
                          {fileUpload.status === 'complete' ? 'Completed' : `${fileUpload.progress}%`}
                        </span>
                        <div style={{ width: '80px', height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              width: `${fileUpload.progress}%`, 
                              height: '100%', 
                              background: fileUpload.status === 'failed' ? 'var(--error)' : 'var(--primary)' 
                            }} 
                          />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}

        {/* Dashboard Grid Section */}
        <div className="grid-section">
          {/* Left Column: Drag & Drop Upload Panel */}
          <div className="card" style={{ alignSelf: 'start' }}>
            <h2 className="card-title">
              <UploadCloud size={18} />
              <span>Document Upload</span>
            </h2>

            <div 
              className={`dropzone ${isDragging ? 'active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}
            >
              <UploadCloud size={40} className="dropzone-icon" />
              <p className="dropzone-text">Drag & drop your PDF here</p>
              <p className="dropzone-subtext">or click to browse from files</p>
              
              <input 
                type="file" 
                className="file-input"
                multiple
                accept=".pdf,application/pdf"
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
            </div>

            {/* Standard upload progress list (for uploads <= 3 files) */}
            {standardUploads.length > 0 && (
              <div className="progress-list">
                <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Uploading:</h4>
                {standardUploads.map(uploadItem => (
                  <div key={uploadItem.id} className="progress-item">
                    <div className="progress-item-header">
                      <span className="progress-item-name" title={uploadItem.name}>
                        {uploadItem.name}
                      </span>
                      <span className="progress-item-percent">
                        {uploadItem.status === 'complete' ? 'Done' : `${uploadItem.progress}%`}
                      </span>
                    </div>

                    <div className="progress-bar-container">
                      <div 
                        className={`progress-bar-fill ${uploadItem.status}`}
                        style={{ width: `${uploadItem.progress}%` }}
                      />
                    </div>

                    <div className="progress-status" style={{ marginTop: '0.25rem' }}>
                      {uploadItem.status === 'pending' && (
                        <span className="badge badge-pending" style={{
                          background: '#f1f5f9',
                          color: '#64748b',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '100px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          border: '1px solid #cbd5e1'
                        }}>
                          Pending
                        </span>
                      )}
                      {uploadItem.status === 'uploading' && (
                        <span className="badge badge-uploading" style={{
                          background: '#eff6ff',
                          color: 'var(--primary)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '100px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          border: '1px solid var(--primary-border)'
                        }}>
                          <RefreshCw size={10} className="animate-spin" style={{ animation: 'spin 1.5s linear infinite' }} />
                          Uploading {uploadItem.progress}%
                        </span>
                      )}
                      {uploadItem.status === 'complete' && (
                        <span className="badge badge-complete" style={{
                          background: 'var(--success-light)',
                          color: 'var(--success)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '100px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          border: '1px solid #a7f3d0'
                        }}>
                          <CheckCircle size={10} /> Complete
                        </span>
                      )}
                      {uploadItem.status === 'failed' && (
                        <span className="badge badge-failed" style={{
                          background: 'var(--error-light)',
                          color: 'var(--error)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '100px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          border: '1px solid #fecaca'
                        }}>
                          <AlertCircle size={10} /> Failed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Uploaded Documents Table */}
          <div className="card">
            <div className="doc-table-header">
              <h2 className="card-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                <FileText size={18} />
                <span>Uploaded Documents</span>
              </h2>

              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-light)' }} />
                <input 
                  type="text" 
                  placeholder="Search documents..."
                  className="table-search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ paddingLeft: '2.25rem' }}
                />
              </div>
            </div>

            <div className="table-container">
              {filteredDocuments.length === 0 ? (
                <div className="empty-state">
                  <File size={36} className="empty-state-icon" />
                  <h3>No documents found</h3>
                  <p>Upload PDF documents using the panel on the left to see them here.</p>
                </div>
              ) : (
                <table className="doc-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Size</th>
                      <th>Upload Date</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocuments.map(doc => (
                      <tr key={doc.id}>
                        <td>
                          <div className="doc-name-cell" title={doc.name}>
                            <FileText size={16} />
                            <span>{doc.name}</span>
                          </div>
                        </td>
                        <td>{formatBytes(doc.size)}</td>
                        <td>{formatDate(doc.uploaded_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button 
                            className="btn btn-icon"
                            onClick={() => handleDelete(doc.id)}
                            style={{ padding: '0.35rem', marginRight: '1rem', color: 'var(--error)', borderColor: 'var(--error-light)' }}
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Floating Toast Notification Container */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <div className="toast-icon">
              {toast.type === 'success' && <CheckCircle size={16} className="toast-icon success" />}
              {toast.type === 'error' && <AlertCircle size={16} className="toast-icon error" />}
              {toast.type === 'info' && <Info size={16} className="toast-icon info" />}
            </div>
            <div className="toast-body">
              <div className="toast-title">{toast.title}</div>
              <div className="toast-message">{toast.message}</div>
            </div>
            <button className="btn-toast-close" onClick={() => removeToast(toast.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
