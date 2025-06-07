<script setup>
import { ref, onMounted } from 'vue'
import * as XLSX from 'xlsx'

const widgetContainer = ref(null)
let widget = null

// Ensure widget is initialized and DuckDB is ready
async function ensureWidget() {
  if (!widget) {
    widget = new window.PondPilot.Widget(widgetContainer.value, { theme: 'light' })
    await widget.initDuckDB()
  }
  return widget.conn
}

async function handleFile(event) {
  const file = event.target.files[0]
  if (!file) return

  const conn = await ensureWidget()
  const fileName = file.name
  const ext = fileName.split('.').pop().toLowerCase()
  const buffer = new Uint8Array(await file.arrayBuffer())

  if (ext === 'csv') {
    await conn.bindings.registerFileBuffer(fileName, buffer)
    await conn.query(`CREATE OR REPLACE TABLE data AS SELECT * FROM read_csv_auto('${fileName}')`)
  } else if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]])
    const csvName = fileName.replace(/\.[^.]+$/, '.csv')
    await conn.bindings.registerFileText(csvName, csv)
    await conn.query(`CREATE OR REPLACE TABLE data AS SELECT * FROM read_csv_auto('${csvName}')`)
  } else {
    alert('Unsupported file type: ' + ext)
    return
  }

  widget.editor.querySelector('pre').textContent = 'SELECT * FROM data LIMIT 20;'
}
</script>

<template>
  <div>
    <input type="file" @change="handleFile" />
    <div ref="widgetContainer" class="pondpilot-snippet">
      <pre>SELECT 1;</pre>
    </div>
  </div>
</template>

<style scoped>
input {
  margin-bottom: 1rem;
}
</style>
