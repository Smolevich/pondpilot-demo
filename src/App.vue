<script setup>
import FileLoader from './components/FileLoader.vue'
</script>

<template>
  <h1>PondPilot Demo</h1>
  <p>Upload a CSV or Excel file to create a <code>data</code> table. Edit the
  query in the editor and click the run button (or press <kbd>Shift</kbd>+<kbd>Enter</kbd>)
  to see the results.</p>
  <FileLoader />
</template>

<style scoped>
</style>
