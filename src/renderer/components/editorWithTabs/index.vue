<template>
    <div
      class="editor-with-tabs"
      :style="{'max-width': showSideBar ? `calc(100vw - ${sideBarWidth}px` : '100vw' }"
    >
      <tabs v-show="showTabBar"></tabs>
      <div class="container">
        <editor
          v-if="shouldShowRichEditor"
          :markdown="markdown"
          :cursor="cursor"
          :text-direction="textDirection"
          :platform="platform"
        ></editor>
        <source-code
          v-else
          :markdown="markdown"
          :cursor="cursor"
          :text-direction="textDirection"
        ></source-code>
      </div>
      <tab-notifications></tab-notifications>
    </div>
</template>

<script>
import { mapState } from 'vuex'
import Tabs from './tabs.vue'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabNotifications from './notifications.vue'

const MARKDOWN_EDITOR_EXTENSIONS = Object.freeze([
  'markdown',
  'mdown',
  'mkdn',
  'md',
  'mkd',
  'mdwn',
  'mdtxt',
  'mdtext',
  'mdx'
])

export default {
  props: {
    markdown: {
      type: String,
      required: true
    },
    cursor: {
      validator (value) {
        return typeof value === 'object'
      },
      required: true
    },
    sourceCode: {
      type: Boolean,
      required: true
    },
    showTabBar: {
      type: Boolean,
      required: true
    },
    textDirection: {
      type: String,
      required: true
    },
    platform: {
      type: String,
      required: true
    }
  },
  components: {
    Tabs,
    Editor,
    SourceCode,
    TabNotifications
  },
  computed: {
    ...mapState({
      showSideBar: state => state.layout.showSideBar,
      sideBarWidth: state => state.layout.sideBarWidth,
      currentFile: state => state.editor.currentFile
    }),
    isMarkdownEditorFile () {
      const { filename = '' } = this.currentFile || {}
      const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : ''

      // Keep default untitled tabs in rich markdown editor mode.
      if (!extension) {
        return true
      }
      return MARKDOWN_EDITOR_EXTENSIONS.includes(extension)
    },
    shouldShowRichEditor () {
      return !this.sourceCode && this.isMarkdownEditorFile
    }
  }
}
</script>

<style scoped>
  .editor-with-tabs {
    position: relative;
    height: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;

    overflow: hidden;
    background: var(--editorBgColor);
    & > .container {
      flex: 1;
      overflow: hidden;
    }
  }
</style>
