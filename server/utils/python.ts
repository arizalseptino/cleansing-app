import fs from 'node:fs'
import path from 'node:path'

function findCommandInPath(commandName: string): string | null {
  const pathEnv = process.env.PATH || ''
  if (!pathEnv) return null

  const isWindows = process.platform === 'win32'
  const extensions = isWindows ? ['.exe', '.cmd', '.bat', ''] : ['']
  const dirs = pathEnv.split(path.delimiter).filter(Boolean)

  for (const dir of dirs) {
    // Skip Microsoft Store alias stub on Windows when scanning PATH
    if (isWindows && dir.toLowerCase().includes('microsoft\\windowsapps')) {
      continue
    }
    for (const ext of extensions) {
      const candidate = path.join(dir, commandName.endsWith(ext) ? commandName : `${commandName}${ext}`)
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          if (!isWindows) {
            fs.accessSync(candidate, fs.constants.X_OK)
          }
          return candidate
        }
      } catch {
        // ignore inaccessible candidate
      }
    }
  }
  return null
}

/**
 * Resolve Python interpreter path across Windows, macOS, Linux, and Docker:
 * 1. process.env.PYTHON_PATH (manual override)
 * 2. manualOverride / process.env.PYTHON_BIN (runtimeConfig / legacy override)
 * 3. python-etl/.venv/Scripts/python.exe (Windows)
 * 4. python-etl/.venv/bin/python (Linux / macOS / Docker)
 * 5. Fallback to python3 then python on PATH
 */
export function resolvePythonPath(manualOverride?: string): string {
  const explicitPythonPath = (process.env.PYTHON_PATH || '').trim()
  if (explicitPythonPath) {
    return explicitPythonPath
  }

  const legacyBin = (manualOverride || process.env.PYTHON_BIN || '').trim()
  if (legacyBin) {
    return legacyBin
  }

  const cwd = process.cwd()
  const winVenvPython = path.resolve(cwd, 'python-etl', '.venv', 'Scripts', 'python.exe')
  const unixVenvPython = path.resolve(cwd, 'python-etl', '.venv', 'bin', 'python')
  const unixVenvPython3 = path.resolve(cwd, 'python-etl', '.venv', 'bin', 'python3')

  if (process.platform === 'win32') {
    if (fs.existsSync(winVenvPython)) return winVenvPython
    if (fs.existsSync(unixVenvPython)) return unixVenvPython
  } else {
    if (fs.existsSync(unixVenvPython)) return unixVenvPython
    if (fs.existsSync(unixVenvPython3)) return unixVenvPython3
    if (fs.existsSync(winVenvPython)) return winVenvPython
  }

  const python3OnPath = findCommandInPath('python3')
  if (python3OnPath) return python3OnPath

  const pythonOnPath = findCommandInPath('python')
  if (pythonOnPath) return pythonOnPath

  return process.platform === 'win32' ? 'python' : 'python3'
}

export function buildPythonSubprocessEnv(extraEnv: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extraEnv,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
}
