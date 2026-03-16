import path from 'path'
import { ipcRenderer, shell } from 'electron'
import { addFile, unlinkFile, addDirectory, unlinkDirectory } from './treeCtrl'
import bus from '../bus'
import { create, paste, rename } from '../util/fileSystem'
import { PATH_SEPARATOR } from '../config'
import notice from '../services/notification'
import { getFileStateFromData } from './help'
import { hasSupportedTextExtension } from '../../common/filesystem/paths'

const normalizePath = pathname => path.normalize(pathname || '')

const isSamePath = (a, b) => normalizePath(a) === normalizePath(b)

const isPathInsideRoot = (rootPath, pathname) => {
  const normalizedRoot = normalizePath(rootPath)
  const normalizedPath = normalizePath(pathname)
  if (!normalizedRoot || !normalizedPath) {
    return false
  }
  if (normalizedPath === normalizedRoot) {
    return true
  }
  return normalizedPath.startsWith(`${normalizedRoot}${PATH_SEPARATOR}`)
}

const createRootDirectoryNode = pathname => {
  let name = path.basename(pathname)
  if (!name) {
    name = pathname
  }
  return {
    pathname: normalizePath(pathname),
    name,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }
}

const syncPrimaryTree = state => {
  if (!state.projectTrees.length) {
    state.projectTree = null
    state.activeProjectPath = ''
    return
  }

  const activeTree = state.projectTrees.find(tree => isSamePath(tree.pathname, state.activeProjectPath))
  if (activeTree) {
    state.projectTree = activeTree
    return
  }

  state.projectTree = state.projectTrees[0]
  state.activeProjectPath = state.projectTree.pathname
}

const state = {
  activeItem: {},
  createCache: {},
  // Use to cache newly created filename, for open immediately.
  newFileNameCache: '',
  renameCache: null,
  clipboard: null,
  projectTree: null,
  projectTrees: [],
  activeProjectPath: ''
}

const getters = {}

const mutations = {
  SET_ROOT_DIRECTORY (state, pathname) {
    const normalizedPath = normalizePath(pathname)
    const existing = state.projectTrees.find(tree => isSamePath(tree.pathname, normalizedPath))

    if (existing) {
      state.activeProjectPath = existing.pathname
      syncPrimaryTree(state)
      return
    }

    const rootTree = createRootDirectoryNode(normalizedPath)
    state.projectTrees.push(rootTree)
    state.activeProjectPath = rootTree.pathname
    syncPrimaryTree(state)
  },
  REMOVE_ROOT_DIRECTORY (state, pathname) {
    const normalizedPath = normalizePath(pathname)
    const index = state.projectTrees.findIndex(tree => isSamePath(tree.pathname, normalizedPath))
    if (index !== -1) {
      state.projectTrees.splice(index, 1)
    }
    if (state.activeProjectPath && isSamePath(state.activeProjectPath, normalizedPath)) {
      state.activeProjectPath = ''
    }
    syncPrimaryTree(state)
  },
  SET_ACTIVE_PROJECT_PATH (state, pathname) {
    state.activeProjectPath = normalizePath(pathname)
    syncPrimaryTree(state)
  },
  SET_NEWFILENAME (state, name) {
    state.newFileNameCache = name
  },
  ADD_FILE (state, change) {
    const roots = state.projectTrees.filter(tree => isPathInsideRoot(tree.pathname, change.pathname))
    for (const tree of roots) {
      addFile(tree, change)
    }
  },
  UNLINK_FILE (state, change) {
    const roots = state.projectTrees.filter(tree => isPathInsideRoot(tree.pathname, change.pathname))
    for (const tree of roots) {
      unlinkFile(tree, change)
    }
  },
  ADD_DIRECTORY (state, change) {
    const roots = state.projectTrees.filter(tree => isPathInsideRoot(tree.pathname, change.pathname))
    for (const tree of roots) {
      addDirectory(tree, change)
    }
  },
  UNLINK_DIRECTORY (state, change) {
    const roots = state.projectTrees.filter(tree => isPathInsideRoot(tree.pathname, change.pathname))
    for (const tree of roots) {
      unlinkDirectory(tree, change)
    }
  },
  SET_ACTIVE_ITEM (state, activeItem) {
    state.activeItem = activeItem
  },
  SET_CLIPBOARD (state, data) {
    state.clipboard = data
  },
  CREATE_PATH (state, cache) {
    state.createCache = cache
  },
  SET_RENAME_CACHE (state, cache) {
    state.renameCache = cache
  }
}

const actions = {
  LISTEN_FOR_LOAD_PROJECT ({ commit, dispatch }) {
    ipcRenderer.on('mt::open-directory', (e, pathname) => {
      commit('SET_ROOT_DIRECTORY', pathname)
      commit('SET_LAYOUT', {
        rightColumn: 'files',
        showSideBar: true,
        showTabBar: true
      })
      dispatch('DISPATCH_LAYOUT_MENU_ITEMS')
    })

    ipcRenderer.on('mt::close-directory', (e, pathname) => {
      commit('REMOVE_ROOT_DIRECTORY', pathname)
    })
  },
  LISTEN_FOR_UPDATE_PROJECT ({ commit, state, dispatch }) {
    ipcRenderer.on('mt::update-object-tree', (e, { type, change }) => {
      switch (type) {
        case 'add': {
          const { pathname, data } = change
          commit('ADD_FILE', change)
          if (state.newFileNameCache && pathname === state.newFileNameCache && data) {
            const fileState = getFileStateFromData(data)
            dispatch('UPDATE_CURRENT_FILE', fileState)
            commit('SET_NEWFILENAME', '')
          }
          break
        }
        case 'unlink':
          commit('UNLINK_FILE', change)
          commit('SET_SAVE_STATUS_WHEN_REMOVE', change)
          break
        case 'addDir':
          commit('ADD_DIRECTORY', change)
          break
        case 'unlinkDir':
          commit('UNLINK_DIRECTORY', change)
          break
        case 'change':
          break
        default:
          if (process.env.NODE_ENV === 'development') {
            console.log(`Unknown directory watch type: "${type}"`)
          }
          break
      }
    })
  },
  CHANGE_ACTIVE_ITEM ({ commit }, activeItem) {
    commit('SET_ACTIVE_ITEM', activeItem)
  },
  CHANGE_CLIPBOARD ({ commit }, data) {
    commit('SET_CLIPBOARD', data)
  },
  ASK_FOR_OPEN_PROJECT ({ commit }) {
    ipcRenderer.send('mt::ask-for-open-project-in-sidebar')
  },
  ASK_FOR_IMPORT_FILES_IN_SIDEBAR () {
    ipcRenderer.send('mt::ask-for-import-files-in-sidebar')
  },
  ASK_FOR_CREATE_DEFAULT_FILE_IN_SIDEBAR ({ state }) {
    const defaultDir = state.activeProjectPath || (state.projectTree ? state.projectTree.pathname : '')
    ipcRenderer.send('mt::ask-for-create-default-file-in-sidebar', defaultDir)
  },
  ASK_FOR_CREATE_FILE_MANUALLY_IN_SIDEBAR ({ state }) {
    const defaultDir = state.activeProjectPath || (state.projectTree ? state.projectTree.pathname : '')
    ipcRenderer.send('mt::ask-for-create-file-manually-in-sidebar', defaultDir)
  },
  REMOVE_OPENED_PROJECT ({ commit }, pathname) {
    commit('REMOVE_ROOT_DIRECTORY', pathname)
    ipcRenderer.send('mt::remove-opened-directory', pathname)
  },
  SET_ACTIVE_PROJECT ({ commit }, pathname) {
    commit('SET_ACTIVE_PROJECT_PATH', pathname)
  },
  LISTEN_FOR_SIDEBAR_CONTEXT_MENU ({ commit, state }) {
    bus.$on('SIDEBAR::show-in-folder', () => {
      const { pathname } = state.activeItem
      shell.showItemInFolder(pathname)
    })
    bus.$on('SIDEBAR::new', type => {
      const { pathname, isDirectory } = state.activeItem
      const dirname = isDirectory ? pathname : path.dirname(pathname)
      commit('CREATE_PATH', { dirname, type })
      bus.$emit('SIDEBAR::show-new-input')
    })
    bus.$on('SIDEBAR::remove', () => {
      const { pathname } = state.activeItem
      ipcRenderer.invoke('mt::fs-trash-item', pathname).catch(err => {
        notice.notify({
          title: 'Error while deleting',
          type: 'error',
          message: err.message
        })
      })
    })
    bus.$on('SIDEBAR::copy-cut', type => {
      const { pathname: src } = state.activeItem
      commit('SET_CLIPBOARD', { type, src })
    })
    bus.$on('SIDEBAR::paste', () => {
      const { clipboard } = state
      const { pathname, isDirectory } = state.activeItem
      const dirname = isDirectory ? pathname : path.dirname(pathname)
      if (clipboard && clipboard.src) {
        clipboard.dest = dirname + PATH_SEPARATOR + path.basename(clipboard.src)

        if (path.normalize(clipboard.src) === path.normalize(clipboard.dest)) {
          notice.notify({
            title: 'Paste Forbidden',
            type: 'warning',
            message: 'Source and destination must not be the same.'
          })
          return
        }

        paste(clipboard)
          .then(() => {
            commit('SET_CLIPBOARD', null)
          })
          .catch(err => {
            notice.notify({
              title: 'Error while pasting',
              type: 'error',
              message: err.message
            })
          })
      }
    })
    bus.$on('SIDEBAR::rename', () => {
      const { pathname } = state.activeItem
      commit('SET_RENAME_CACHE', pathname)
      bus.$emit('SIDEBAR::show-rename-input')
    })
  },

  CREATE_FILE_DIRECTORY ({ commit, state }, name) {
    const { dirname, type } = state.createCache

    if (type === 'file' && !hasSupportedTextExtension(name)) {
      name += '.md'
    }

    const fullName = `${dirname}/${name}`

    create(fullName, type)
      .then(() => {
        commit('CREATE_PATH', {})
        if (type === 'file') {
          commit('SET_NEWFILENAME', fullName)
        }
      })
      .catch(err => {
        notice.notify({
          title: 'Error in Side Bar',
          type: 'error',
          message: err.message
        })
      })
  },

  RENAME_IN_SIDEBAR ({ commit, state }, name) {
    const src = state.renameCache
    const dirname = path.dirname(src)
    const dest = dirname + PATH_SEPARATOR + name
    rename(src, dest)
      .then(() => {
        commit('RENAME_IF_NEEDED', { src, dest })
      })
  },

  OPEN_SETTING_WINDOW () {
    ipcRenderer.send('mt::open-setting-window')
  }
}

export default { state, getters, mutations, actions }
