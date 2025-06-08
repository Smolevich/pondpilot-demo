<script setup>
import { ref, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import { saveFile, getFile, deleteFile, listFiles } from '../utils/db'

const widgetContainer = ref(null)
const loadedTables = ref([]) // [{id, name, type, size, timestamp}]
const isLoading = ref(false)
const isWidgetReady = ref(false)
const isRestoring = ref(false)
const notifications = ref([])
let widget = null

const CONFIG = {
  MAX_FILES_COUNT: 5
}

// Система уведомлений
function showNotification(message, type = 'info', duration = 4000) {
  const id = Date.now() + Math.random()
  const notification = { id, message, type, visible: true }
  notifications.value.push(notification)
  setTimeout(() => removeNotification(id), duration)
}

function removeNotification(id) {
  const idx = notifications.value.findIndex(n => n.id === id)
  if (idx > -1) notifications.value.splice(idx, 1)
}

// Ensure widget is initialized and DuckDB is ready
async function ensureWidget() {
  if (!widget && window.PondPilot) {
    isLoading.value = true
    try {
      widget = new window.PondPilot.Widget(widgetContainer.value, { theme: 'light' })
      await widget.initDuckDB()
      isWidgetReady.value = true
    } catch (err) {
      showNotification('Widget initialization failed. Please refresh the page.', 'error')
    } finally {
      isLoading.value = false
    }
  }
  return widget?.conn
}

async function showTableInfo(tableName) {
  try {
    await ensureWidget()
    if (widget && widget.editor) {
      const query = `DESCRIBE ${tableName};`
      if (widget.setQuery) widget.setQuery(query)
      if (widget.editor.setValue) widget.editor.setValue(query)
      const preElement = widget.editor.querySelector('pre')
      if (preElement) {
        preElement.textContent = query
        try {
          const event = new Event('input', { bubbles: true })
          preElement.dispatchEvent(event)
        } catch (e) {}
      }
      await widget.run()
    }
  } catch (err) {
    alert('Something went wrong')
  }
}

async function showTableSample(tableName) {
  try {
    const conn = await ensureWidget()
    widget.editor.querySelector('pre').textContent = `SELECT * FROM ${tableName} LIMIT 10;`
    await widget.run()
  } catch (err) {
    console.error(err)
  }
}

onMounted(async () => {
  await waitForPondPilot()
  await ensureWidget()
  await restoreSavedTables()
})

async function waitForPondPilot() {
  let attempts = 0
  while (!window.PondPilot && attempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 100))
    attempts++
  }
  if (!window.PondPilot) {
    showNotification('Failed to load PondPilot. Please refresh the page.', 'error')
  }
}

async function restoreSavedTables() {
  isRestoring.value = true
  try {
    const files = await listFiles()
    // сортируем по времени (старые -> новые)
    files.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    for (const file of files) {
      await restoreTable(file)
      loadedTables.value.push({
        id: file.id,
        name: file.name,
        tableName: file.tableName,
        type: file.type,
        size: file.size,
        timestamp: file.timestamp
      })
    }
  } catch (err) {
    showNotification('Failed to restore saved files', 'error')
  } finally {
    isRestoring.value = false
  }
}

async function restoreTable(file) {
  try {
    const conn = await ensureWidget()
    if (!conn) return false
    if (file.type === 'csv') {
      await conn.bindings.registerFileBuffer(file.name, new Uint8Array(file.buffer))
      await conn.query(`CREATE OR REPLACE TABLE ${file.tableName} AS SELECT * FROM read_csv_auto('${file.name.replace(/'/g, "''")}')`)
    } else if (file.type === 'excel') {
      await conn.bindings.registerFileText(file.csvName, file.csvContent)
      await conn.query(`CREATE OR REPLACE TABLE ${file.tableName} AS SELECT * FROM read_csv_auto('${file.csvName.replace(/'/g, "''")}')`)
    }
    return true
  } catch {
    return false
  }
}

async function handleFile(event) {
  const file = event.target.files[0]
  if (!file) return
  if (!isWidgetReady.value) {
    showNotification('Widget is still loading, please wait...', 'warning')
    return
  }
  isLoading.value = true
  try {
    // enforce file count limit
    const files = await listFiles()
    if (files.length >= CONFIG.MAX_FILES_COUNT) {
      // remove oldest
      const oldest = files.reduce((a, b) => (a.timestamp < b.timestamp ? a : b))
      await deleteFile(oldest.id)
      loadedTables.value.splice(loadedTables.value.findIndex(t => t.id === oldest.id), 1)
      showNotification(`Storage limit reached (${CONFIG.MAX_FILES_COUNT} files). Removed oldest file: ${oldest.name}`, 'info', 5000)
    }
    const conn = await ensureWidget()
    const fileName = file.name
    const ext = fileName.split('.').pop().toLowerCase()
    const buffer = new Uint8Array(await file.arrayBuffer())
    const tableName = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_')
    let meta = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: fileName,
      tableName,
      type: ext === 'csv' ? 'csv' : 'excel',
      size: file.size,
      timestamp: Date.now()
    }
    if (ext === 'csv') {
      await conn.bindings.registerFileBuffer(fileName, buffer)
      await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${fileName.replace(/'/g, "''")}')`)
      await saveFile(meta.id, { ...meta, buffer })
    } else if (ext === 'xlsx' || ext === 'xls') {
      const workbook = XLSX.read(buffer, { type: 'array' })
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]])
      const csvName = fileName.replace(/\.[^.]+$/, '.csv')
      await conn.bindings.registerFileText(csvName, csv)
      await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${csvName.replace(/'/g, "''")}')`)
      await saveFile(meta.id, { ...meta, csvName, csvContent: csv })
    } else {
      showNotification('Only CSV and Excel files are supported', 'warning')
      return
    }
    loadedTables.value.push(meta)
    showNotification(`File ${fileName} loaded and saved successfully`, 'success')
    // Показываем пример запроса
    if (widget && widget.editor) {
      const query = `SELECT * FROM ${tableName} LIMIT 20;`
      if (widget.setQuery) widget.setQuery(query)
      if (widget.editor.setValue) widget.editor.setValue(query)
      const preElement = widget.editor.querySelector('pre')
      if (preElement) {
        preElement.textContent = query
        try {
          const event = new Event('input', { bubbles: true })
          preElement.dispatchEvent(event)
        } catch (e) {}
      }
      await widget.run()
    }
  } catch (err) {
    showNotification('Something went wrong while processing the file', 'error')
  } finally {
    isLoading.value = false
  }
}

async function showTableData(tableName) {
  try {
    await ensureWidget()
    if (widget && widget.editor) {
      const query = `SELECT * FROM ${tableName} LIMIT 20;`
      if (widget.setQuery) widget.setQuery(query)
      if (widget.editor.setValue) widget.editor.setValue(query)
      const preElement = widget.editor.querySelector('pre')
      if (preElement) {
        preElement.textContent = query
        try {
          const event = new Event('input', { bubbles: true })
          preElement.dispatchEvent(event)
        } catch (e) {}
      }
      await widget.run()
    }
  } catch (err) {
    showNotification('Something went wrong', 'error')
  }
}

async function showAllTables() {
  try {
    await ensureWidget()
    if (widget && widget.editor) {
      const preElement = widget.editor.querySelector('pre')
      if (preElement) {
        preElement.textContent = `SHOW ALL TABLES;`
        await widget.run()
      }
    }
  } catch (err) {
    showNotification('Something went wrong', 'error')
  }
}

async function removeTable(tableId) {
  try {
    await deleteFile(tableId)
    const idx = loadedTables.value.findIndex(t => t.id === tableId)
    if (idx > -1) loadedTables.value.splice(idx, 1)
    showNotification('Table deleted successfully', 'success')
  } catch {
    showNotification('Something went wrong while deleting table', 'error')
  }
}

function getStorageSize() {
  return Math.round(loadedTables.value.reduce((sum, t) => sum + (t.size || 0), 0) / 1024 / 1024 * 100) / 100
}
</script>

<template>
  <div>
    <!-- Уведомления -->
    <div class="notifications-container">
      <div 
        v-for="notification in notifications" 
        :key="notification.id"
        :class="['notification', `notification-${notification.type}`]"
        @click="removeNotification(notification.id)"
      >
        <div class="notification-content">
          <span class="notification-icon">
            {{ notification.type === 'success' ? '✅' : 
               notification.type === 'error' ? '❌' : 
               notification.type === 'warning' ? '⚠️' : 'ℹ️' }}
          </span>
          <span class="notification-message">{{ notification.message }}</span>
          <button class="notification-close" @click.stop="removeNotification(notification.id)">×</button>
        </div>
      </div>
    </div>

    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>Loading...</p>
    </div>
    
    <div class="file-section">
      <label for="file-input" class="file-label">
        📁 Upload CSV or Excel file
      </label>
      <input id="file-input" type="file" @change="handleFile" accept=".csv,.xlsx,.xls" 
             :disabled="!isWidgetReady || isLoading" />
             <div v-if="!isWidgetReady" class="widget-status">
         🔄 Initializing widget...
       </div>
       <div v-if="isRestoring" class="widget-status">
         📂 Restoring saved tables...
       </div>
       <div class="file-limits">
         <small>Limits: max {{ CONFIG.MAX_FILES_COUNT }} files, {{ getStorageSize() }}MB</small>
       </div>
    </div>
    
    <div v-if="loadedTables.length > 0" class="tables-section">
      <div class="tables-header">
        <div class="tables-title">
          <h3>Loaded tables:</h3>
          <span class="storage-info">{{ loadedTables.length }}/{{ CONFIG.MAX_FILES_COUNT }} files ({{ getStorageSize() }}MB)</span>
        </div>
        <div class="header-actions">
          <button @click="showAllTables" class="show-all-btn">Show all tables</button>
        </div>
      </div>
      <div class="tables-list">
        <div v-for="table in loadedTables" :key="table.id" class="table-item">
          <span class="table-name">{{ table.name }}</span>
          <div class="table-actions">
            <button @click="showTableInfo(table.tableName)" class="action-btn" title="Table structure">📋</button>
            <button @click="showTableData(table.tableName)" class="action-btn" title="View data">👁️</button>
            <button @click="removeTable(table.id)" class="action-btn delete-btn" title="Delete table">🗑️</button>
          </div>
        </div>
      </div>
    </div>

    <div ref="widgetContainer" class="pondpilot-snippet">
      <pre>SELECT 1 as example;</pre>
    </div>
  </div>
</template>

<style scoped>
.notifications-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 1050;
  max-width: 400px;
}

.notification {
  margin-bottom: 10px;
  padding: 0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  animation: slideIn 0.3s ease-out;
  overflow: hidden;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.notification-content {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: white;
  border-left: 4px solid;
}

.notification-success .notification-content {
  border-left-color: #28a745;
}

.notification-error .notification-content {
  border-left-color: #dc3545;
}

.notification-warning .notification-content {
  border-left-color: #ffc107;
}

.notification-info .notification-content {
  border-left-color: #17a2b8;
}

.notification-icon {
  margin-right: 8px;
  font-size: 16px;
}

.notification-message {
  flex: 1;
  color: #333;
  font-size: 14px;
  line-height: 1.4;
}

.notification-close {
  background: none;
  border: none;
  font-size: 18px;
  color: #999;
  cursor: pointer;
  padding: 0;
  margin-left: 8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s;
}

.notification-close:hover {
  background-color: #f5f5f5;
  color: #666;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  color: white;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007acc;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.widget-status {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background-color: #ffeaa7;
  color: #d63031;
  border-radius: 4px;
  text-align: center;
  font-size: 0.875rem;
}

.file-section {
  margin-bottom: 1.5rem;
  padding: 1rem;
  border: 2px dashed #ccc;
  border-radius: 8px;
  text-align: center;
  transition: border-color 0.3s;
}

.file-section:hover {
  border-color: #007acc;
}

.file-label {
  display: block;
  font-size: 1.1rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: #333;
  cursor: pointer;
}

#file-input {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

#file-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.file-limits {
  margin-top: 0.5rem;
  color: #6c757d;
  font-size: 0.75rem;
}

.tables-section {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background-color: #f8f9fa;
  border-radius: 8px;
}

.tables-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.tables-title {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.storage-info {
  background-color: #e9ecef;
  color: #495057;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 500;
}

.tables-section h3 {
  margin: 0;
  color: #333;
  font-size: 1rem;
}

.show-all-btn {
  background-color: #6c757d;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
}

.show-all-btn:hover {
  background-color: #5a6268;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.tables-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.table-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: white;
  padding: 0.75rem;
  border-radius: 6px;
  border: 1px solid #dee2e6;
}

.table-name {
  font-weight: 500;
  color: #007acc;
}

.table-actions {
  display: flex;
  gap: 0.25rem;
}

.action-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.action-btn:hover {
  background-color: #f8f9fa;
}

.delete-btn:hover {
  background-color: #ffebee;
}

.pondpilot-snippet {
  min-height: 400px;
}
</style>
