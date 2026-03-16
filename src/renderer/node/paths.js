import { rgPath } from 'vscode-ripgrep'
import EnvPaths from 'common/envPaths'
import fs from 'fs'
import { spawnSync } from 'child_process'

// // "vscode-ripgrep" is unpacked out of asar because of the binary.
const rgDiskPath = rgPath.replace(/\bapp\.asar\b/, 'app.asar.unpacked')

const getSystemRgCandidates = () => {
  if (process.platform === 'darwin') {
    return ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg']
  }
  if (process.platform === 'win32') {
    return []
  }
  return ['/usr/local/bin/rg', '/usr/bin/rg']
}

const resolveFromSystemPath = () => {
  const command = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(command, ['rg'], {
    encoding: 'utf8'
  })
  if (result.status !== 0 || !result.stdout) {
    return ''
  }

  const binaryPath = result.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean)

  return binaryPath || ''
}

const resolveRipgrepPath = () => {
  const envPath = process.env.MARKTEXT_RIPGREP_PATH
  if (envPath) {
    if (fs.existsSync(envPath) || !pathLooksAbsolute(envPath)) {
      return envPath
    }
  }
  if (rgDiskPath && fs.existsSync(rgDiskPath)) {
    return rgDiskPath
  }

  const pathBinary = resolveFromSystemPath()
  if (pathBinary && fs.existsSync(pathBinary)) {
    return pathBinary
  }

  const candidate = getSystemRgCandidates().find(binaryPath => fs.existsSync(binaryPath))
  if (candidate) {
    return candidate
  }

  // Final fallback for local/dev environments.
  return 'rg'
}

const pathLooksAbsolute = pathname => {
  if (!pathname) return false
  if (pathname.startsWith('/') || pathname.startsWith('~')) return true
  return /^[A-Za-z]:\\/.test(pathname)
}

class RendererPaths extends EnvPaths {
  /**
   * Configure and sets all application paths.
   *
   * @param {string} userDataPath The user data path.
   */
  constructor (userDataPath) {
    if (!userDataPath) {
      throw new Error('No user data path is given.')
    }

    // Initialize environment paths
    super(userDataPath)

    // Allow to use a local ripgrep binary (e.g. an optimized version).
    this._ripgrepBinaryPath = resolveRipgrepPath()
  }

  // Returns the path to ripgrep on disk.
  get ripgrepBinaryPath () {
    return this._ripgrepBinaryPath
  }
}

export default RendererPaths
