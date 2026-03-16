<template>
  <div class="tree-view">
    <div class="actions-panel">
      <div class="actions-title">Workspace</div>
      <div class="actions-grid">
        <button class="action-btn primary" @click="importFiles">Import Files</button>
        <button class="action-btn" @click="openFolder">Open Folder</button>
        <button class="action-btn" @click="createFileInDefaultLocation">New (Default)</button>
        <button class="action-btn" @click="createFileManually">New (Choose Path)</button>
      </div>
    </div>

    <div class="roots-section">
      <div class="section-title">
        <span>Opened Folders</span>
        <span class="section-count">{{ rootTrees.length }}</span>
      </div>

      <div class="roots-list" v-if="rootTrees.length">
        <div
          class="root-card"
          v-for="root in rootTrees"
          :key="root.pathname"
          :class="{
            active: !isVirtualRoot(root) && activeProjectPath === root.pathname
          }"
        >
          <div
            class="root-header"
            @click="handleRootHeaderClick(root)"
          >
            <span class="root-title">
              <svg
                class="icon icon-arrow"
                :class="{ fold: !isRootExpanded(root.pathname) }"
                aria-hidden="true"
              >
                <use xlink:href="#icon-arrow"></use>
              </svg>
              <span class="text-overflow">{{ root.name }}</span>
            </span>
            <button
              v-if="!isVirtualRoot(root)"
              class="remove-root-btn"
              title="Remove folder from sidebar"
              @click.stop="removeRoot(root)"
            >
              Remove
            </button>
          </div>

          <div class="root-body" v-show="isRootExpanded(root.pathname)">
            <folder
              v-for="(folder, index) of root.folders"
              :key="index + 'folder'"
              :folder="folder"
              :depth="depth"
            ></folder>

            <input
              type="text"
              class="new-input"
              v-show="showCreateInput(root)"
              :style="{ 'margin-left': `${depth * 5 + 15}px` }"
              ref="input"
              v-model="createName"
              @keydown.enter="handleInputEnter"
            >

            <file
              v-for="(file, index) of root.files"
              :key="index + 'file'"
              :file="file"
              :depth="depth"
            ></file>

            <div class="empty-project" v-if="!hasTreeItems(root)">
              <span>No file loaded</span>
              <span class="hint">Use Import Files or Open Folder above.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="empty-project global-empty" v-else>
        <span>No folder opened</span>
        <span class="hint">Open Folder supports multi-select and Import Files supports md/txt/json.</span>
      </div>
    </div>
  </div>
</template>

<script>
import path from 'path'
import Folder from './treeFolder.vue'
import File from './treeFile.vue'
import { mapState } from 'vuex'
import bus from '../../bus'
import { createFileOrDirectoryMixins } from '../../mixins'

const VIRTUAL_ROOT = '__opened_files__'

export default {
  mixins: [createFileOrDirectoryMixins],
  data () {
    this.depth = 0
    return {
      createName: '',
      rootCollapsedMap: {}
    }
  },
  props: {
    projectTree: {
      type: Object,
      default: null
    },
    projectTrees: {
      type: Array,
      default: () => []
    },
    openedFiles: Array,
    tabs: {
      type: Array,
      default: () => []
    }
  },
  components: {
    Folder,
    File
  },
  computed: {
    ...mapState({
      createCache: state => state.project.createCache,
      activeProjectPath: state => state.project.activeProjectPath
    }),
    rootTrees () {
      if (this.projectTrees && this.projectTrees.length) {
        return this.projectTrees
      }
      if (!this.tabs || this.tabs.length === 0) {
        return []
      }
      return [this.openedTabsTree]
    },
    openedTabsTree () {
      const root = {
        pathname: VIRTUAL_ROOT,
        name: 'Opened Files',
        isDirectory: true,
        isFile: false,
        isMarkdown: false,
        folders: [],
        files: []
      }

      const ensureFolder = (folder, name, pathname) => {
        let child = folder.folders.find(item => item.pathname === pathname)
        if (!child) {
          child = {
            id: pathname,
            pathname,
            name,
            isCollapsed: true,
            isDirectory: true,
            isFile: false,
            isMarkdown: false,
            folders: [],
            files: []
          }
          folder.folders.push(child)
          folder.folders.sort((a, b) => a.name.localeCompare(b.name))
        }
        return child
      }

      for (const tab of this.tabs) {
        if (!tab || !tab.pathname) {
          continue
        }

        const normalizedPath = path.normalize(tab.pathname)
        const dirname = path.dirname(normalizedPath)
        const filename = path.basename(normalizedPath)
        const rootDir = path.parse(dirname).root || path.sep

        let currentFolder = ensureFolder(root, rootDir, rootDir)
        const relativeDir = dirname.slice(rootDir.length)
        const dirSegments = relativeDir.split(path.sep).filter(Boolean)

        let currentPath = rootDir
        for (const segment of dirSegments) {
          currentPath = path.join(currentPath, segment)
          currentFolder = ensureFolder(currentFolder, segment, currentPath)
        }

        if (!currentFolder.files.find(item => item.pathname === normalizedPath)) {
          currentFolder.files.push({
            id: normalizedPath,
            pathname: normalizedPath,
            name: filename,
            isFile: true,
            isDirectory: false,
            isMarkdown: /\.(md|markdown|mdown|mkdn|mkd|mdwn|mdtxt|mdtext|mdx|text|txt)$/i.test(filename)
          })
          currentFolder.files.sort((a, b) => a.name.localeCompare(b.name))
        }
      }

      return root
    }
  },
  watch: {
    rootTrees: {
      immediate: true,
      handler (roots) {
        const nextMap = {}
        for (const root of roots) {
          const expanded = this.rootCollapsedMap[root.pathname]
          nextMap[root.pathname] = typeof expanded === 'boolean' ? expanded : true
        }
        this.rootCollapsedMap = nextMap
      }
    }
  },
  created () {
    this.$nextTick(() => {
      bus.$on('SIDEBAR::show-new-input', this.handleInputFocus)
      document.addEventListener('click', event => {
        const target = event.target
        if (target.tagName !== 'INPUT') {
          this.$store.dispatch('CHANGE_ACTIVE_ITEM', {})
          this.$store.commit('CREATE_PATH', {})
          this.$store.commit('SET_RENAME_CACHE', null)
        }
      })
      document.addEventListener('contextmenu', event => {
        const target = event.target
        if (target.tagName !== 'INPUT') {
          this.$store.commit('CREATE_PATH', {})
          this.$store.commit('SET_RENAME_CACHE', null)
        }
      })
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          this.$store.commit('CREATE_PATH', {})
          this.$store.commit('SET_RENAME_CACHE', null)
        }
      })
    })
  },
  methods: {
    isVirtualRoot (root) {
      return root.pathname === VIRTUAL_ROOT
    },
    hasTreeItems (root) {
      return root.files.length > 0 || root.folders.length > 0
    },
    isRootExpanded (pathname) {
      return this.rootCollapsedMap[pathname] !== false
    },
    showCreateInput (root) {
      return !this.isVirtualRoot(root) &&
        this.createCache.dirname === root.pathname &&
        this.isRootExpanded(root.pathname)
    },
    handleRootHeaderClick (root) {
      const pathname = root.pathname
      this.rootCollapsedMap = {
        ...this.rootCollapsedMap,
        [pathname]: !this.isRootExpanded(pathname)
      }
      if (!this.isVirtualRoot(root)) {
        this.$store.dispatch('SET_ACTIVE_PROJECT', pathname)
      }
    },
    removeRoot (root) {
      this.$store.dispatch('REMOVE_OPENED_PROJECT', root.pathname)
    },
    openFolder () {
      this.$store.dispatch('ASK_FOR_OPEN_PROJECT')
    },
    importFiles () {
      this.$store.dispatch('ASK_FOR_IMPORT_FILES_IN_SIDEBAR')
    },
    createFileInDefaultLocation () {
      this.$store.dispatch('ASK_FOR_CREATE_DEFAULT_FILE_IN_SIDEBAR')
    },
    createFileManually () {
      this.$store.dispatch('ASK_FOR_CREATE_FILE_MANUALLY_IN_SIDEBAR')
    }
  }
}
</script>

<style scoped>
  .tree-view {
    font-size: 13px;
    color: var(--sideBarColor);
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .actions-panel {
    padding: 12px;
    border-bottom: 1px solid var(--floatBorderColor);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, rgba(0, 0, 0, 0) 100%);
  }

  .actions-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .5px;
    margin-bottom: 8px;
    color: var(--sideBarTextColor);
    opacity: .85;
  }

  .actions-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .action-btn {
    border: 1px solid var(--floatBorderColor);
    background: var(--floatBorderColor);
    color: var(--sideBarTitleColor);
    border-radius: 8px;
    font-size: 12px;
    padding: 7px 8px;
    cursor: pointer;
    transition: all .2s ease;
  }

  .action-btn.primary {
    border-color: var(--themeColor);
    background: rgba(64, 158, 255, 0.18);
  }

  .action-btn:hover {
    border-color: var(--themeColor);
    color: var(--themeColor);
    transform: translateY(-1px);
  }

  .roots-section {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }

  .section-title {
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    font-size: 12px;
    color: var(--sideBarTextColor);
    border-bottom: 1px solid var(--floatBorderColor);
  }

  .section-count {
    font-size: 11px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
    padding: 1px 6px;
    background: var(--itemBgColor);
  }

  .roots-list {
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    min-height: 0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .root-card {
    border: 1px solid var(--floatBorderColor);
    border-radius: 10px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.01);
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    min-height: 0;
    max-height: 45vh;
  }

  .root-card.active {
    border-color: var(--themeColor);
  }

  .root-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 34px;
    padding: 0 10px 0 8px;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.02);
  }

  .root-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    font-size: 13px;
  }

  .remove-root-btn {
    border: none;
    background: transparent;
    color: var(--sideBarTextColor);
    font-size: 11px;
    cursor: pointer;
    padding: 0 4px;
    opacity: .85;
  }

  .remove-root-btn:hover {
    color: #ff7676;
  }

  .icon-arrow {
    transition: all .25s ease-out;
    transform: rotate(90deg);
    fill: var(--sideBarTextColor);
    flex-shrink: 0;
  }

  .icon-arrow.fold {
    transform: rotate(0);
  }

  .root-body {
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    max-height: calc(45vh - 34px);
  }

  .new-input {
    outline: none;
    height: 22px;
    margin: 6px 0;
    padding: 0 6px;
    color: var(--sideBarColor);
    border: 1px solid var(--floatBorderColor);
    background: var(--floatBorderColor);
    width: calc(100% - 45px);
    border-radius: 4px;
  }

  .empty-project {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 16px 14px;
    gap: 6px;
    color: var(--sideBarTextColor);
    font-size: 12px;
  }

  .empty-project.global-empty {
    padding: 20px 14px;
  }

  .hint {
    font-size: 11px;
    opacity: .9;
  }
</style>
