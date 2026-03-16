import path from 'path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { enable as remoteEnable } from '@electron/remote/main'
import log from 'electron-log'
import windowStateKeeper from 'electron-window-state'
import { isChildOfDirectory, isSamePathSync } from 'common/filesystem/paths'
import BaseWindow, { WindowLifecycle, WindowType } from './base'
import { ensureWindowPosition, zoomIn, zoomOut } from './utils'
import { TITLE_BAR_HEIGHT, editorWinOptions, isLinux, isOsx } from '../config'
import { showEditorContextMenu } from '../contextMenu/editor'
import { loadMarkdownFile } from '../filesystem/markdown'
import { switchLanguage } from '../spellchecker'

const createWindowState = () => {
  const fallbackState = {
    x: undefined,
    y: undefined,
    width: 1200,
    height: 800,
    manage: () => {}
  }

  if (!app.isReady()) {
    return fallbackState
  }

  try {
    return windowStateKeeper({
      defaultWidth: 1200,
      defaultHeight: 800
    })
  } catch (error) {
    log.warn('window-state keeper unavailable, using fallback state:', error && error.message ? error.message : error)
    return fallbackState
  }
}

class EditorWindow extends BaseWindow {
  /**
   * @param {Accessor} accessor The application accessor for application instances.
   */
  constructor (accessor) {
    super(accessor)
    this.type = WindowType.EDITOR

    // Root directory and file list to open when the window is ready.
    this._directoriesToOpen = []
    this._filesToOpen = [] // {doc: IMarkdownDocumentRaw, options: any, selected: boolean}
    this._markdownToOpen = [] // List of markdown strings or an empty string will open a new untitled tab

    // Root directory and file list that are currently opened. These lists are
    // used to find the best window to open new files in.
    this._openedRootDirectories = []
    this._openedFiles = []

    // Protect close flow when renderer hangs: fallback force-close after timeout.
    this._closeRequestPending = false
    this._closeRequestTimer = null
  }

  /**
   * Creates a new editor window.
   *
   * @param {string} [rootDirectory] The root directory to open.
   * @param {string[]} [fileList] A list of markdown files to open.
   * @param {string[]} [markdownList] Array of markdown data to open.
   * @param {*} [options] The BrowserWindow options.
   */
  createWindow (rootDirectory = null, fileList = [], markdownList = [], options = {}) {
    const { menu: appMenu, env, preferences } = this._accessor
    const addBlankTab = !rootDirectory && fileList.length === 0 && markdownList.length === 0

    const mainWindowState = createWindowState()

    const { x, y, width, height } = ensureWindowPosition(mainWindowState)
    const winOptions = Object.assign({ x, y, width, height }, editorWinOptions, options)
    if (isLinux) {
      winOptions.icon = path.join(__static, 'logo-96px.png')
    }

    const {
      titleBarStyle,
      theme,
      sideBarVisibility,
      tabBarVisibility,
      sourceCodeModeEnabled,
      spellcheckerEnabled,
      spellcheckerLanguage
    } = preferences.getAll()

    // Enable native or custom/frameless window and titlebar
    if (!isOsx) {
      winOptions.titleBarStyle = 'default'
      if (titleBarStyle === 'native') {
        winOptions.frame = true
      }
    }

    winOptions.backgroundColor = this._getPreferredBackgroundColor(theme)
    if (env.disableSpellcheck) {
      winOptions.webPreferences.spellcheck = false
    }

    let win = this.browserWindow = new BrowserWindow(winOptions)
    remoteEnable(win.webContents)
    this.id = win.id

    if (spellcheckerEnabled && !isOsx) {
      try {
        switchLanguage(win, spellcheckerLanguage)
      } catch (error) {
        log.error('Unable to set spell checker language on startup:', error)
      }
    }

    // Create a menu for the current window
    appMenu.addEditorMenu(win, { sourceCodeModeEnabled })

    win.webContents.on('context-menu', (event, params) => {
      showEditorContextMenu(win, event, params, preferences.getItem('spellcheckerEnabled'))
    })

    win.webContents.once('did-finish-load', () => {
      this.lifecycle = WindowLifecycle.READY
      this.emit('window-ready')

      // Restore and focus window
      this.bringToFront()

      const lineEnding = preferences.getPreferredEol()
      appMenu.updateLineEndingMenu(this.id, lineEnding)

      win.webContents.send('mt::bootstrap-editor', {
        addBlankTab,
        markdownList: this._markdownToOpen,
        lineEnding,
        sideBarVisibility,
        tabBarVisibility,
        sourceCodeModeEnabled
      })

      this._doOpenFilesToOpen()
      this._markdownToOpen.length = 0

      // Listen on default system mouse zoom event (e.g. Ctrl+MouseWheel on Linux/Windows).
      win.webContents.on('zoom-changed', (event, zoomDirection) => {
        if (zoomDirection === 'in') {
          zoomIn(win)
        } else if (zoomDirection === 'out') {
          zoomOut(win)
        }
      })
    })

    win.webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
      log.error(`The window failed to load or was cancelled: ${errorCode}; ${errorDescription}`)
    })

    win.webContents.once('render-process-gone', async (event, { reason }) => {
      if (reason === 'clean-exit') {
        return
      }

      const msg = `The renderer process has crashed unexpected or is killed (${reason}).`
      log.error(msg)

      if (reason === 'abnormal-exit') {
        return
      }

      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Close', 'Reload', 'Keep It Open'],
        message: 'MarkText has crashed',
        detail: msg
      })

      if (win.id) {
        switch (response) {
          case 0:
            return this.destroy()
          case 1:
            return this.reload()
        }
      }
    })

    win.on('focus', () => {
      this.emit('window-focus')
      win.webContents.send('mt::window-active-status', { status: true })
    })

    // Lost focus
    win.on('blur', () => {
      this.emit('window-blur')
      win.webContents.send('mt::window-active-status', { status: false })
    })

    ;['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach(channel => {
      win.on(channel, () => {
        win.webContents.send(`mt::window-${channel}`)
      })
    })

    // Before closed. We cancel the action and ask the editor further instructions.
    win.on('close', event => {
      this.emit('window-close')

      if (this._closeRequestPending) {
        this._closeRequestPending = false
        if (this._closeRequestTimer) {
          clearTimeout(this._closeRequestTimer)
          this._closeRequestTimer = null
        }
        ipcMain.emit('window-close-by-id', win.id)
        return
      }

      event.preventDefault()
      this._closeRequestPending = true
      win.webContents.send('mt::ask-for-close')

      // If renderer does not answer close request in time, force close.
      this._closeRequestTimer = setTimeout(() => {
        if (!this._closeRequestPending || !win || win.isDestroyed()) {
          return
        }
        this._closeRequestPending = false
        this._closeRequestTimer = null
        ipcMain.emit('window-close-by-id', win.id)
      }, 1200)

      // TODO: Close all watchers etc. Should we do this manually or listen to 'quit' event?
    })

    // The window is now destroyed.
    win.on('closed', () => {
      this.lifecycle = WindowLifecycle.QUITTED
      this.emit('window-closed')

      // Free window reference
      win = null
    })

    this.lifecycle = WindowLifecycle.LOADING
    win.loadURL(this._buildUrlString(this.id, env, preferences))
    win.setSheetOffset(TITLE_BAR_HEIGHT)

    mainWindowState.manage(win)

    // Disable application menu shortcuts because we want to handle key bindings ourself.
    win.webContents.setIgnoreMenuShortcuts(true)

    // Delay load files and directories after the current control flow.
    setTimeout(() => {
      if (rootDirectory) {
        this.openFolder(rootDirectory, false)
      }
      if (fileList.length) {
        this.openTabsFromPaths(fileList)
      }
    }, 0)

    return win
  }

  /**
   * Open a new tab from a markdown file.
   *
   * @param {string} filePath The markdown file path.
   * @param {string} [options] The tab option for the editor window.
   * @param {boolean} [selected] Whether the tab should become the selected tab (true if not set).
   */
  openTab (filePath, options = {}, selected = true) {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return
    this.openTabs([{ filePath, options, selected }])
  }

  /**
   * Open new tabs from the given file paths.
   *
   * @param {string[]} filePaths The file paths to open.
   */
  openTabsFromPaths (filePaths) {
    if (!filePaths || filePaths.length === 0) return

    const fileList = filePaths.map(p => ({ filePath: p, options: {}, selected: false }))
    fileList[0].selected = true
    this.openTabs(fileList)
  }

  /**
   * Open new tabs from markdown files with options for editor window.
   *
   * @param {{filePath: string, selected: boolean, options: any}[]} filePath A list of markdown file paths and options to open.
   */
  openTabs (fileList) {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return

    const { browserWindow } = this
    const { preferences } = this._accessor
    const eol = preferences.getPreferredEol()
    const { autoGuessEncoding, trimTrailingNewline } = preferences.getAll()

    for (const { filePath, options, selected } of fileList) {
      loadMarkdownFile(filePath, eol, autoGuessEncoding, trimTrailingNewline).then(rawDocument => {
        if (this.lifecycle === WindowLifecycle.READY) {
          this._doOpenTab(rawDocument, options, selected)
        } else {
          this._filesToOpen.push({ doc: rawDocument, options, selected })
        }
      }).catch(err => {
        const { message, stack } = err
        log.error(`[ERROR] Cannot open file or directory: ${message}\n\n${stack}`)
        browserWindow.webContents.send('mt::show-notification', {
          title: 'Cannot open tab',
          type: 'error',
          message: err.message
        })
      })
    }
  }

  /**
   * Open a new untitled tab optional with a markdown string.
   *
   * @param {[boolean]} selected Whether the tab should become the selected tab (true if not set).
   * @param {[string]} markdown The markdown string.
   */
  openUntitledTab (selected = true, markdown = '') {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return

    if (this.lifecycle === WindowLifecycle.READY) {
      const { browserWindow } = this
      browserWindow.webContents.send('mt::new-untitled-tab', selected, markdown)
    } else {
      this._markdownToOpen.push(markdown)
    }
  }

  /**
   * Open a directory.
   *
   * @param {string} pathname The directory path.
   * @param {boolean} [keepExisting=true] Whether existing opened directories should be kept.
   */
  openFolder (pathname, keepExisting = true) {
    // TODO: Don't allow new files if quitting.
    if (!pathname || this.lifecycle === WindowLifecycle.QUITTED) {
      return
    }

    if (this.lifecycle === WindowLifecycle.READY) {
      const { _accessor, browserWindow } = this
      const { menu: appMenu } = _accessor
      const normalizedPath = path.normalize(pathname)

      if (!keepExisting && this._openedRootDirectories.length) {
        for (const openedDir of this._openedRootDirectories) {
          ipcMain.emit('watcher-unwatch-directory', browserWindow, openedDir)
          browserWindow.webContents.send('mt::close-directory', openedDir)
        }
        this._openedRootDirectories = []
      }

      const alreadyOpened = this._openedRootDirectories.some(dir => isSamePathSync(dir, normalizedPath))
      if (alreadyOpened) {
        return
      }

      appMenu.addRecentlyUsedDocument(normalizedPath)
      this._openedRootDirectories.push(normalizedPath)
      ipcMain.emit('watcher-watch-directory', browserWindow, normalizedPath)
      browserWindow.webContents.send('mt::open-directory', normalizedPath)
    } else {
      if (!keepExisting) {
        this._directoriesToOpen = []
      }
      const normalizedPath = path.normalize(pathname)
      const alreadyQueued = this._directoriesToOpen.some(dir => isSamePathSync(dir, normalizedPath))
      if (!alreadyQueued) {
        this._directoriesToOpen.push(normalizedPath)
      }
    }
  }

  /**
   * Remove an opened root directory.
   *
   * @param {string} pathname The directory path.
   */
  removeFolder (pathname) {
    if (!pathname || this.lifecycle !== WindowLifecycle.READY) {
      return
    }

    const normalizedPath = path.normalize(pathname)
    const index = this._openedRootDirectories.findIndex(dir => isSamePathSync(dir, normalizedPath))
    if (index === -1) {
      return
    }

    const { browserWindow } = this
    this._openedRootDirectories.splice(index, 1)
    ipcMain.emit('watcher-unwatch-directory', browserWindow, normalizedPath)
    browserWindow.webContents.send('mt::close-directory', normalizedPath)
  }

  markCloseRequestHandled () {
    this._closeRequestPending = false
    if (this._closeRequestTimer) {
      clearTimeout(this._closeRequestTimer)
      this._closeRequestTimer = null
    }
  }

  /**
   * Add a new path to the file list and watch the given path.
   *
   * @param {string} filePath The file path.
   */
  addToOpenedFiles (filePath) {
    const { _openedFiles, browserWindow } = this
    _openedFiles.push(filePath)
    ipcMain.emit('watcher-watch-file', browserWindow, filePath)
  }

  /**
   * Change a path in the opened file list and update the watcher.
   *
   * @param {string} pathname
   * @param {string} oldPathname
   */
  changeOpenedFilePath (pathname, oldPathname) {
    const { _openedFiles, browserWindow } = this
    const index = _openedFiles.findIndex(p => p === oldPathname)
    if (index === -1) {
      // The old path was not found but add the new one.
      _openedFiles.push(pathname)
    } else {
      _openedFiles[index] = pathname
    }
    ipcMain.emit('watcher-unwatch-file', browserWindow, oldPathname)
    ipcMain.emit('watcher-watch-file', browserWindow, pathname)
  }

  /**
   * Remove a path from the opened file list and stop watching the path.
   *
   * @param {string} pathname The full path.
   */
  removeFromOpenedFiles (pathname) {
    const { _openedFiles, browserWindow } = this
    const index = _openedFiles.findIndex(p => p === pathname)
    if (index !== -1) {
      _openedFiles.splice(index, 1)
    }
    ipcMain.emit('watcher-unwatch-file', browserWindow, pathname)
  }

  /**
   * Returns a score list for a given file list.
   *
   * @param {string[]} fileList The file list.
   * @returns {number[]}
   */
  getCandidateScores (fileList) {
    const { _openedFiles, _openedRootDirectories, id } = this
    const buf = []
    for (const pathname of fileList) {
      let score = 0
      if (_openedFiles.some(p => p === pathname)) {
        score = -1
      } else {
        const inOpenedRoot = _openedRootDirectories.some(rootDir => isChildOfDirectory(rootDir, pathname))
        if (inOpenedRoot) {
          score += 5
        }
        for (const item of _openedFiles) {
          if (isChildOfDirectory(path.dirname(item), pathname)) {
            score += 1
          }
        }
      }
      buf.push({ id, score })
    }
    return buf
  }

  reload () {
    const { id, browserWindow } = this

    // Close watchers
    ipcMain.emit('watcher-unwatch-all-by-id', id)

    // Reset saved state
    this._directoriesToOpen = []
    this._filesToOpen = []
    this._markdownToOpen = []
    this._openedRootDirectories = []
    this._openedFiles = []
    this._closeRequestPending = false
    if (this._closeRequestTimer) {
      clearTimeout(this._closeRequestTimer)
      this._closeRequestTimer = null
    }

    browserWindow.webContents.once('did-finish-load', () => {
      this.lifecycle = WindowLifecycle.READY
      const { preferences } = this._accessor
      const { sideBarVisibility, tabBarVisibility, sourceCodeModeEnabled } = preferences.getAll()
      const lineEnding = preferences.getPreferredEol()
      browserWindow.webContents.send('mt::bootstrap-editor', {
        addBlankTab: true,
        markdownList: [],
        lineEnding,
        sideBarVisibility,
        tabBarVisibility,
        sourceCodeModeEnabled
      })
    })

    this.lifecycle = WindowLifecycle.LOADING
    super.reload()
  }

  destroy () {
    super.destroy()

    // Watchers are freed from WindowManager.

    this._directoriesToOpen = null
    this._filesToOpen = null
    this._markdownToOpen = null
    this._openedRootDirectories = null
    this._openedFiles = null
    this._closeRequestPending = null
    if (this._closeRequestTimer) {
      clearTimeout(this._closeRequestTimer)
      this._closeRequestTimer = null
    }
  }

  get openedRootDirectory () {
    return this._openedRootDirectories && this._openedRootDirectories.length
      ? this._openedRootDirectories[0]
      : ''
  }

  get openedRootDirectories () {
    return this._openedRootDirectories ? [...this._openedRootDirectories] : []
  }

  get openedFiles () {
    return this._openedFiles ? [...this._openedFiles] : []
  }

  applyOpenedFilesSession (openedFiles = [], activeFilePath = '') {
    if (!Array.isArray(openedFiles)) {
      return
    }

    const normalized = []
    const cache = new Set()
    for (const rawPath of openedFiles) {
      if (typeof rawPath !== 'string' || !rawPath) {
        continue
      }
      const filePath = path.normalize(rawPath)
      if (!cache.has(filePath)) {
        cache.add(filePath)
        normalized.push(filePath)
      }
    }

    if (activeFilePath && cache.has(path.normalize(activeFilePath))) {
      const normalizedActivePath = path.normalize(activeFilePath)
      this._openedFiles = [normalizedActivePath, ...normalized.filter(p => p !== normalizedActivePath)]
    } else {
      this._openedFiles = normalized
    }
  }

  // --- private ---------------------------------

  /**
   * Open a new new tab from the markdown document.
   *
   * @param {IMarkdownDocumentRaw} rawDocument The markdown document.
   * @param {any} options The tab option for the editor window.
   * @param {boolean} selected Whether the tab should become the selected tab (true if not set).
   */
  _doOpenTab (rawDocument, options, selected) {
    const { _accessor, _openedFiles, browserWindow } = this
    const { menu: appMenu } = _accessor
    const { pathname } = rawDocument

    // Listen for file changed.
    ipcMain.emit('watcher-watch-file', browserWindow, pathname)

    appMenu.addRecentlyUsedDocument(pathname)
    _openedFiles.push(pathname)
    browserWindow.webContents.send('mt::open-new-tab', rawDocument, options, selected)
  }

  _doOpenFilesToOpen () {
    if (this.lifecycle !== WindowLifecycle.READY) {
      throw new Error('Invalid state.')
    }

    for (const pathname of this._directoriesToOpen) {
      this.openFolder(pathname, true)
    }
    this._directoriesToOpen.length = 0

    for (const { doc, options, selected } of this._filesToOpen) {
      this._doOpenTab(doc, options, selected)
    }
    this._filesToOpen.length = 0
  }
}

export default EditorWindow
