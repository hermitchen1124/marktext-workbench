<template>
  <div class="json-viewer">
    <div class="json-header">JSON Viewer (foldable)</div>

    <div v-if="parseError" class="json-error">
      <p class="error-title">Invalid JSON</p>
      <p class="error-message">{{ parseError }}</p>
      <pre class="raw-content">{{ content }}</pre>
    </div>

    <div v-else class="json-tree">
      <json-node
        :is-root="true"
        :node-value="parsedJson"
        :depth="0"
        path="root"
      ></json-node>
    </div>
  </div>
</template>

<script>
import JsonNode from './jsonNode.vue'

export default {
  name: 'json-viewer',
  components: {
    JsonNode
  },
  props: {
    content: {
      type: String,
      default: ''
    }
  },
  computed: {
    parsedJson () {
      if (!this.content) {
        return {}
      }
      try {
        return JSON.parse(this.content)
      } catch (error) {
        return null
      }
    },
    parseError () {
      if (!this.content) {
        return ''
      }
      try {
        JSON.parse(this.content)
        return ''
      } catch (error) {
        return error.message
      }
    }
  }
}
</script>

<style scoped>
  .json-viewer {
    height: calc(100vh - var(--titleBarHeight));
    overflow: auto;
    padding: 20px 24px 40px;
    box-sizing: border-box;
    background: var(--editorBgColor);
  }

  .json-header {
    font-size: 13px;
    color: var(--sideBarTextColor);
    margin-bottom: 12px;
    letter-spacing: .2px;
  }

  .json-error {
    border: 1px solid var(--floatBorderColor);
    background: var(--itemBgColor);
    border-radius: 6px;
    padding: 12px;
  }

  .error-title {
    margin: 0 0 6px;
    color: var(--themeColor);
    font-weight: 600;
  }

  .error-message {
    margin: 0 0 10px;
    color: var(--sideBarColor);
    font-size: 12px;
  }

  .raw-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--editorColor);
    font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
    font-size: 12px;
  }
</style>
