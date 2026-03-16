<template>
  <div class="json-node">
    <div
      class="json-row"
      :style="{ paddingLeft: `${depth * 16}px` }"
    >
      <span
        class="toggle"
        :class="{ disabled: !isCollapsible }"
        @click="toggle"
      >{{ isCollapsible ? (expanded ? '▾' : '▸') : ' ' }}</span>
      <span v-if="!isRoot" class="json-key">{{ renderedKey }}:</span>
      <span class="json-value" :class="`type-${valueType}`">{{ previewValue }}</span>
    </div>

    <div v-if="isCollapsible && expanded" class="json-children">
      <json-node
        v-for="entry in childEntries"
        :key="entry.path"
        :node-key="entry.key"
        :node-value="entry.value"
        :depth="depth + 1"
        :path="entry.path"
      ></json-node>

      <div
        class="json-row closing-row"
        :style="{ paddingLeft: `${depth * 16}px` }"
      >
        <span class="toggle disabled"> </span>
        <span class="json-value" :class="`type-${valueType}`">{{ closingToken }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'json-node',
  props: {
    nodeKey: {
      type: [String, Number],
      default: ''
    },
    nodeValue: {
      required: true
    },
    depth: {
      type: Number,
      default: 0
    },
    path: {
      type: String,
      default: 'root'
    },
    isRoot: {
      type: Boolean,
      default: false
    }
  },
  data () {
    return {
      expanded: this.isRoot || this.depth < 1
    }
  },
  computed: {
    valueType () {
      if (this.nodeValue === null) {
        return 'null'
      }
      if (Array.isArray(this.nodeValue)) {
        return 'array'
      }
      return typeof this.nodeValue
    },
    isCollapsible () {
      if (Array.isArray(this.nodeValue)) {
        return this.nodeValue.length > 0
      }
      if (this.nodeValue && typeof this.nodeValue === 'object') {
        return Object.keys(this.nodeValue).length > 0
      }
      return false
    },
    renderedKey () {
      if (typeof this.nodeKey === 'number') {
        return `[${this.nodeKey}]`
      }
      return this.nodeKey
    },
    previewValue () {
      if (Array.isArray(this.nodeValue)) {
        return this.expanded ? '[' : `[${this.nodeValue.length}]`
      }
      if (this.nodeValue && typeof this.nodeValue === 'object') {
        return this.expanded ? '{' : '{...}'
      }
      if (typeof this.nodeValue === 'string') {
        return `"${this.nodeValue}"`
      }
      return String(this.nodeValue)
    },
    closingToken () {
      if (Array.isArray(this.nodeValue)) {
        return ']'
      }
      if (this.nodeValue && typeof this.nodeValue === 'object') {
        return '}'
      }
      return ''
    },
    childEntries () {
      if (Array.isArray(this.nodeValue)) {
        return this.nodeValue.map((value, index) => ({
          key: index,
          value,
          path: `${this.path}.${index}`
        }))
      }
      if (this.nodeValue && typeof this.nodeValue === 'object') {
        return Object.keys(this.nodeValue).map(key => ({
          key,
          value: this.nodeValue[key],
          path: `${this.path}.${key}`
        }))
      }
      return []
    }
  },
  methods: {
    toggle () {
      if (this.isCollapsible) {
        this.expanded = !this.expanded
      }
    }
  }
}
</script>

<style scoped>
  .json-row {
    display: flex;
    align-items: baseline;
    min-height: 24px;
    line-height: 24px;
    font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
    font-size: 13px;
    color: var(--editorColor);
  }

  .toggle {
    width: 16px;
    cursor: pointer;
    color: var(--themeColor);
    user-select: none;
    display: inline-block;
  }

  .toggle.disabled {
    cursor: default;
    color: transparent;
  }

  .json-key {
    color: var(--sideBarTitleColor);
    margin-right: 6px;
  }

  .json-value.type-string {
    color: #38a169;
  }

  .json-value.type-number,
  .json-value.type-boolean,
  .json-value.type-null {
    color: #3182ce;
  }

  .json-value.type-array,
  .json-value.type-object {
    color: var(--editorColor);
  }

  .closing-row {
    opacity: .9;
  }
</style>
