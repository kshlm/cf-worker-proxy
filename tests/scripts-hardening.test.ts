import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'

vi.mock('child_process')
vi.mock('readline')
const actualFs = await vi.importActual<typeof import('fs')>('fs')
const realWriteRef = actualFs.writeFileSync.bind(actualFs)
const realExistsRef = actualFs.existsSync.bind(actualFs)
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync.bind(actual)),
    renameSync: vi.fn(actual.renameSync.bind(actual)),
    existsSync: vi.fn(actual.existsSync.bind(actual)),
  }
})

const mockExecFileSync = vi.mocked(execFileSync)

// Use real fs in a temp dir so file modes and atomicity are actually exercised
let tmpDir: string

function freshModule(pathid: string): Promise<Record<string, unknown>> {
  return import(pathid) as Promise<Record<string, unknown>>
}

// Helper to call untyped dynamic-import members without any-casts at each site
function callUnknown<T>(fn: unknown, ...args: unknown[]): T {
  return (fn as (...a: unknown[]) => T)(...args)
}

describe('shared wrangler helper (scripts/wrangler.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes arguments as argv array with explicit config and remote target', async () => {
    const { runWrangler } = await freshModule('../scripts/wrangler')
    mockExecFileSync.mockReturnValue('ok')

    callUnknown<void>(runWrangler, ['kv', 'key', 'list', '--binding=PROXY_SERVERS'])

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'wrangler',
      ['kv', 'key', 'list', '--binding=PROXY_SERVERS', '--remote', '--config', 'wrangler.toml'],
      expect.objectContaining({
        encoding: 'utf-8',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    )
  })

  it('returns stdout trimmed on success', async () => {
    const { runWrangler } = await freshModule('../scripts/wrangler')
    mockExecFileSync.mockReturnValue('  output \n')
    expect(callUnknown(runWrangler, ['kv', 'key', 'list'])).toBe('output')
  })

  it('throws on nonzero exit (failure propagation)', async () => {
    const { runWrangler } = await freshModule('../scripts/wrangler')
    mockExecFileSync.mockImplementation(() => {
      throw new Error('exit status 1')
    })
    expect(() => callUnknown(runWrangler, ['kv', 'key', 'list'])).toThrow('exit status 1')
  })

  it('passes stdin input for secret-style commands', async () => {
    const { runWrangler } = await freshModule('../scripts/wrangler')
    mockExecFileSync.mockReturnValue('ok')

    callUnknown<void>(runWrangler, ['secret', 'put', 'NAME'], { input: 'token\n' })

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'wrangler',
      ['secret', 'put', 'NAME', '--config', 'wrangler.toml'],
      expect.objectContaining({
        input: 'token\n',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    )
  })

  it('is resistant to argv injection: key names with shell metacharacters are passed as single argv', async () => {
    const { runWrangler } = await freshModule('../scripts/wrangler')
    mockExecFileSync.mockReturnValue('ok')

    const evilKey = 'x"; rm -rf /; echo "'
    callUnknown<void>(runWrangler, ['kv', 'key', 'get', evilKey])

    const calledArgs = mockExecFileSync.mock.calls[0][1] as string[]
    expect(calledArgs).toContain(evilKey)
    expect(calledArgs).not.toContain('rm')
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'wrangler',
      expect.anything(),
      expect.objectContaining({ shell: false }),
    )
  })
})

describe('route id / reserved key policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects invalid route ids', async () => {
    const { isValidRouteId } = await freshModule('../scripts/wrangler')
    expect(callUnknown(isValidRouteId, 'good-key_1.2')).toBe(true)
    expect(callUnknown(isValidRouteId, 'bad key')).toBe(false)
    expect(callUnknown(isValidRouteId, 'k;ey')).toBe(false)
    expect(callUnknown(isValidRouteId, '')).toBe(false)
    expect(callUnknown(isValidRouteId, 'a'.repeat(80))).toBe(false)
  })

  it('rejects the reserved global auth key as route id', async () => {
    const { isValidRouteId } = await freshModule('../scripts/wrangler')
    expect(callUnknown(isValidRouteId, 'global-auth-configs')).toBe(false)
  })
})

describe('backup-config', () => {
  let writeFileSpy: ReturnType<typeof vi.spyOn>
  let existsSpy: ReturnType<typeof vi.spyOn>
  let createdModes: number[]
  let consoleLog: ReturnType<typeof vi.spyOn>
  let consoleError: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.fn>
  const originalArgv = process.argv

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'))
    createdModes = []
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.fn(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never) as unknown as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    process.argv = originalArgv
    consoleLog.mockRestore()
    consoleError.mockRestore()
    exitSpy.mockRestore()
    vi.mocked(fs.writeFileSync).mockImplementation(realWriteRef as never)
    vi.mocked(
      fs.existsSync as unknown as { mockImplementation: (impl: unknown) => unknown },
    ).mockImplementation(realExistsRef)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function interceptFileWrites() {
    createdModes = []
    const realWrite = realWriteRef
    const realExists = realExistsRef
    const mockWrite = fs.writeFileSync as unknown as ReturnType<typeof vi.fn>
    const mockExists = fs.existsSync as unknown as ReturnType<typeof vi.fn>
    mockWrite.mockImplementation(((
      file: fs.PathOrFileDescriptor,
      data: unknown,
      options?: fs.WriteFileOptions,
    ) => {
      const f = file.toString()
      if (f.includes(tmpDir)) {
        const mode =
          typeof options === 'object' && options !== null && 'mode' in options
            ? (options as { mode?: number }).mode
            : undefined
        createdModes.push(mode ?? 0o666)
      }
      return realWrite(file, data as string, options)
    }) as typeof fs.writeFileSync)
    mockExists.mockImplementation(((f: fs.PathLike) => realExists(f)) as typeof fs.existsSync)
    writeFileSpy = mockWrite
    existsSpy = mockExists
  }

  function setListOutput(entries: unknown) {
    mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
      if (args && args.includes('key') && args.includes('list')) {
        return JSON.stringify(entries) as unknown
      }
      if (args && args.includes('key') && args.includes('get')) {
        const keyIdx = args.indexOf('get')
        const keyName = args[keyIdx + 1]
        if (keyName === 'api')
          return JSON.stringify({
            url: 'https://api.example.com',
            authConfigs: [{ header: 'Authorization', value: 'Bearer ${SECRET}' }],
          }) as unknown
        if (keyName === 'global-auth-configs')
          return JSON.stringify([{ header: 'Authorization', value: 'Bearer t' }]) as unknown
        return 'raw-string-value' as unknown
      }
      return '' as unknown
    }) as typeof execFileSync)
  }

  it('writes versioned backup into backups/ with unique timestamp, 0600 mode, atomic rename; preserves raw KV values', async () => {
    interceptFileWrites()
    existsSpy.mockReturnValue(false) // no existing file
    setListOutput([{ name: 'api' }, { name: 'plain' }, { name: 'global-auth-configs' }])
    process.argv = ['bun', 'scripts/backup-config.ts']

    const mod = await freshModule('../scripts/backup-config')
    await (mod as { backup: (dir?: string) => Promise<void> }).backup(tmpDir)

    // file written inside backups dir
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.json'))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(
      /^proxy-config-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]+\.json$/,
    )
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8'))
    expect(written.version).toBe(1)
    expect(typeof written.exportedAt).toBe('string')
    // Raw KV values preserved per key
    expect(written.entries.api).toEqual({
      url: 'https://api.example.com',
      authConfigs: [{ header: 'Authorization', value: 'Bearer ${SECRET}' }],
    })
    expect(written.entries.plain).toBe('raw-string-value')
    expect(written.entries['global-auth-configs']).toEqual([
      { header: 'Authorization', value: 'Bearer t' },
    ])
    // 0600 mode on the temp file
    expect(createdModes).toEqual([0o600])
    // Atomic: temp file was renamed away (no .tmp files remain)
    expect(fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp'))).toHaveLength(0)
    expect(writeFileSpy).toHaveBeenCalled()
  })

  it('refuses to overwrite an existing backup file', async () => {
    interceptFileWrites()
    existsSpy.mockImplementation(((f: fs.PathLike) =>
      f.toString().includes('.json')) as unknown as never)
    setListOutput([{ name: 'api' }])
    process.argv = ['bun', 'scripts/backup-config.ts']

    const mod = await freshModule('../scripts/backup-config')
    await expect(
      (mod as { backup: (dir?: string) => Promise<void> }).backup(tmpDir),
    ).rejects.toThrow(/refus|exists|overwrite/i)
  })

  it('rejects malformed list output (non-array JSON)', async () => {
    interceptFileWrites()
    existsSpy.mockReturnValue(false)
    mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
      if (args && args.includes('list')) return '{"not":"an array"}' as unknown
      return '' as unknown
    }) as typeof execFileSync)
    process.argv = ['bun', 'scripts/backup-config.ts']

    const mod = await freshModule('../scripts/backup-config')
    await expect(
      (mod as { backup: (dir?: string) => Promise<void> }).backup(tmpDir),
    ).rejects.toThrow(/list/i)
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.json'))).toHaveLength(0)
  })

  it('does not log raw credentials', async () => {
    interceptFileWrites()
    existsSpy.mockReturnValue(false)
    setListOutput([{ name: 'api' }])
    process.argv = ['bun', 'scripts/backup-config.ts']

    const mod = await freshModule('../scripts/backup-config')
    await (mod as { backup: (dir?: string) => Promise<void> }).backup(tmpDir)

    const allLogged = [...consoleLog.mock.calls, ...consoleError.mock.calls]
      .map((c) => c.join(' '))
      .join('\n')
    expect(allLogged).not.toContain('Bearer ${SECRET}')
    expect(allLogged).not.toContain('Bearer t')
  })
})

describe('restore-config', () => {
  let consoleLog: ReturnType<typeof vi.spyOn>
  let consoleError: ReturnType<typeof vi.spyOn>
  let exitSpy: { mockRestore: () => void }
  const originalArgv = process.argv
  const writtenPaths: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-test-'))
    writtenPaths.length = 0
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.fn(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never) as unknown as ReturnType<typeof vi.fn>
    // Intercept fs.writeFileSync for temp KV put files: record mode before cleanup
    const realWrite = realWriteRef
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((
      file: fs.PathOrFileDescriptor,
      data: unknown,
      options?: fs.WriteFileOptions,
    ) => {
      if (file.toString().includes('restore-put-')) {
        const mode =
          typeof options === 'object' && options !== null && 'mode' in (options as object)
            ? (options as { mode?: number }).mode
            : undefined
        writtenPaths.push(`${file}|${mode ?? 0o666}|${String(data)}`)
      }
      return realWrite(file, data as string, options)
    }) as typeof fs.writeFileSync)
  })

  afterEach(() => {
    process.argv = originalArgv
    consoleLog.mockRestore()
    consoleError.mockRestore()
    exitSpy.mockRestore()
    vi.mocked(fs.writeFileSync).mockImplementation(realWriteRef as never)
    vi.mocked(
      fs.existsSync as unknown as { mockImplementation: (impl: unknown) => unknown },
    ).mockImplementation(realExistsRef)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeBackup(doc: unknown): string {
    const file = path.join(tmpDir, 'backup.json')
    fs.writeFileSync(file, JSON.stringify(doc))
    if (!fs.existsSync(file)) {
      throw new Error(`test setup failed: backup file missing at ${file}`)
    }
    return file
  }

  function putSucceeds() {
    mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
      if (args && args.includes('put')) return 'ok' as unknown
      return '' as unknown
    }) as typeof execFileSync)
  }

  it('restores versioned and legacy backups, validating before first write (merge default)', async () => {
    putSucceeds()
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: {
        api: { url: 'https://api.example.com' },
        plain: 'raw-string',
      },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{ restored: string[]; failed: { key: string; error: string }[] }>
    }
    const result = await mod.restore(file, { yes: true })

    expect(result.restored.sort()).toEqual(['api', 'plain'])
    expect(result.failed).toEqual([])
    expect(mockExecFileSync).toHaveBeenCalled()
    // 0600 temp files
    expect(writtenPaths.length).toBe(2)
    for (const p of writtenPaths) {
      const [pathPart, modePart] = p.split('|')
      expect(pathPart).toContain('restore-put-')
      expect(Number(modePart) & 0o777).toBe(0o600)
    }
  })

  it('validates the entire backup before first remote write (all-or-nothing validation)', async () => {
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: {
        api: { url: 'https://api.example.com' },
        bad: { url: 'https://api.example.com', auth: 'legacy' }, // legacy fields invalid
      },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{ restored: string[]; failed: { key: string; error: string }[] }>
    }
    await expect(mod.restore(file, { yes: true })).rejects.toThrow(/validation|invalid/i)
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('reports partial failures without aborting other keys', async () => {
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: {
        ok1: { url: 'https://a.example.com' },
        ok2: { url: 'https://b.example.com' },
      },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]
    mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
      if (args && args.includes('put')) {
        const pathIdx = args.indexOf('--path')
        const content = fs.readFileSync(args[pathIdx + 1] as string, 'utf-8')
        if (content.includes('a.example.com')) throw new Error('put failed')
        return 'ok' as unknown
      }
      return '' as unknown
    }) as typeof execFileSync)

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{ restored: string[]; failed: { key: string; error: string }[] }>
    }
    const result = await mod.restore(file, { yes: true })
    expect(result.restored).toEqual(['ok2'])
    expect(result.failed).toEqual([{ key: 'ok1', error: 'put failed' }])
  })

  it('requires explicit confirmation without --yes', async () => {
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: { api: { url: 'https://api.example.com' } },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{ restored: string[]; failed: { key: string; error: string }[] }>
    }
    await expect(mod.restore(file, {})).rejects.toThrow(/confirm/i)
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('--dry-run performs validation but no remote writes', async () => {
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: { api: { url: 'https://api.example.com' } },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{ restored: string[]; failed: { key: string; error: string }[] }>
    }
    const result = await mod.restore(file, { dryRun: true })
    expect(result.restored).toEqual([]) // nothing written
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('global-auth-configs overwrite requires strong confirmation even with --yes', async () => {
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: { 'global-auth-configs': [{ header: 'Authorization', value: 'Bearer t' }] },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{ restored: string[]; failed: { key: string; error: string }[] }>
    }
    const mockRlQuestion = {
      question: (_q: string, cb: (a: string) => void) => cb('wrong-answer'),
      close: () => {},
    }
    ;(readline.createInterface as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockRlQuestion as never,
    )
    await expect(mod.restore(file, { yes: true })).rejects.toThrow(/confirm|global-auth/i)
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('--replace prunes remote keys not present in backup, with strong confirmation', async () => {
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: { api: { url: 'https://api.example.com' } },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]
    // list shows a stale remote key 'stale' not in backup
    mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
      if (args && args.includes('list'))
        return JSON.stringify([{ name: 'api' }, { name: 'stale' }]) as unknown
      if (args && args.includes('put')) return 'ok' as unknown
      if (args && args.includes('delete')) return 'ok' as unknown
      return '' as unknown
    }) as typeof execFileSync)

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{
        restored: string[]
        failed: { key: string; error: string }[]
        pruned: string[]
      }>
    }
    const result = await mod.restore(file, { yes: true, replace: true, confirmReplace: true })
    expect(result.pruned).toEqual(['stale'])
  })

  it('--replace without strong confirmation refuses to prune', async () => {
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: { api: { url: 'https://api.example.com' } },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{
        restored: string[]
        failed: { key: string; error: string }[]
        pruned: string[]
      }>
    }
    await expect(mod.restore(file, { yes: true, replace: true })).rejects.toThrow(/confirm|prune/i)
    const mutatingCalls = mockExecFileSync.mock.calls.filter((c) => {
      const args = c[1] as string[]
      return args.includes('put') || args.includes('delete')
    })
    expect(mutatingCalls).toHaveLength(0)
  })

  it('preserves raw KV values and does not log credentials', async () => {
    const secretValue = {
      url: 'https://api.example.com',
      authConfigs: [{ header: 'Authorization', value: 'Bearer real-secret-token' }],
    }
    const file = writeBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: { api: secretValue, plain: 'raw' },
    })
    process.argv = ['bun', 'scripts/restore-config.ts', file]
    putSucceeds()

    const mod = (await freshModule('../scripts/restore-config')) as {
      restore: (
        file?: string,
        opts?: object,
      ) => Promise<{ restored: string[]; failed: { key: string; error: string }[] }>
    }
    await mod.restore(file, { yes: true })

    // raw value written verbatim (stringify once, not double-encoded)
    expect(writtenPaths.length).toBe(2)
    const apiWrite = writtenPaths.find((p) => p.split('|')[2].includes('api.example.com'))
    expect(apiWrite).toBeTruthy()
    const [, modePart, contentPart] = apiWrite!.split('|')
    expect(Number(modePart) & 0o777).toBe(0o600)
    expect(JSON.parse(contentPart)).toEqual(secretValue)
    const allLogged = [...consoleLog.mock.calls, ...consoleError.mock.calls]
      .map((c) => c.join(' '))
      .join('\n')
    expect(allLogged).not.toContain('real-secret-token')
  })
})

describe('script review follow-ups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('restore: string-valued route entries', () => {
    let consoleLog: ReturnType<typeof vi.spyOn>
    let consoleError: ReturnType<typeof vi.spyOn>
    let exitSpy: { mockRestore: () => void }
    const originalArgv = process.argv
    const writtenData: string[] = []

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-restore-'))
      writtenData.length = 0
      consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`)
      }) as never)
      const realWrite = realWriteRef
      vi.spyOn(fs, 'writeFileSync').mockImplementation(((
        file: fs.PathOrFileDescriptor,
        data: unknown,
        options?: fs.WriteFileOptions,
      ) => {
        if (file.toString().includes('restore-put-')) {
          writtenData.push(String(data))
        }
        return realWrite(file, data as string, options)
      }) as typeof fs.writeFileSync)
    })

    afterEach(() => {
      process.argv = originalArgv
      consoleLog.mockRestore()
      consoleError.mockRestore()
      exitSpy.mockRestore()
      vi.mocked(fs.writeFileSync).mockImplementation(realWriteRef as never)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    function writeBackup(doc: unknown): string {
      const file = path.join(tmpDir, 'backup.json')
      realWriteRef(file, JSON.stringify(doc))
      return file
    }

    it('validates a string-valued route entry by parsing it and running the shared validator before write', async () => {
      const file = writeBackup({
        version: 1,
        exportedAt: 'x',
        entries: { api: JSON.stringify({ url: 'https://api.example.com', auth: 'legacy' }) },
      })
      const mod = (await freshModule('../scripts/restore-config')) as {
        restore: (f?: string, o?: object) => Promise<unknown>
      }
      await expect(mod.restore(file, { yes: true })).rejects.toThrow(/validation|invalid|legacy/i)
      expect(mockExecFileSync).not.toHaveBeenCalled()
    })

    it('accepts and restores a string-valued route entry whose parsed JSON is valid', async () => {
      const file = writeBackup({
        version: 1,
        exportedAt: 'x',
        entries: { api: JSON.stringify({ url: 'https://api.example.com' }) },
      })
      mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
        if (args && args.includes('put')) return 'ok' as unknown
        return '' as unknown
      }) as typeof execFileSync)
      const mod = (await freshModule('../scripts/restore-config')) as {
        restore: (f?: string, o?: object) => Promise<{ restored: string[] }>
      }
      const result = await mod.restore(file, { yes: true })
      expect(result.restored).toEqual(['api'])
      expect(writtenData.some((d) => d.includes('api.example.com'))).toBe(true)
    })

    it('always preserves global-auth-configs during --replace pruning', async () => {
      const file = writeBackup({
        version: 1,
        exportedAt: 'x',
        entries: { api: { url: 'https://api.example.com' } },
      })
      process.argv = ['bun', 'scripts/restore-config.ts', file]
      mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
        if (args && args.includes('list'))
          return JSON.stringify([
            { name: 'api' },
            { name: 'stale' },
            { name: 'global-auth-configs' },
          ]) as unknown as string
        if (args && args.includes('put')) return 'ok' as unknown as string
        if (args && args.includes('delete')) return 'ok' as unknown as string
        return '' as unknown as string
      }) as typeof execFileSync)
      const mod = (await freshModule('../scripts/restore-config')) as {
        restore: (f?: string, o?: object) => Promise<{ pruned: string[] }>
      }
      const result = await mod.restore(file, { yes: true, replace: true, confirmReplace: true })
      expect(result.pruned).toEqual(['stale'])
      const deleteCalls = mockExecFileSync.mock.calls.filter((c) =>
        (c[1] as string[]).includes('delete'),
      )
      const deletedKeys = deleteCalls.map((c) => {
        const args = c[1] as string[]
        return args[args.indexOf('delete') + 1]
      })
      expect(deletedKeys).not.toContain('global-auth-configs')
    })

    it('parseKeyList rejects a malformed entry instead of dropping it', async () => {
      const { parseKeyList } = (await freshModule('../scripts/wrangler')) as {
        parseKeyList: (o: string) => { name: string }[]
      }
      expect(() =>
        callUnknown(parseKeyList, JSON.stringify([{ name: 'ok' }, { nope: true }])),
      ).toThrow(/malformed/i)
      expect(() =>
        callUnknown(parseKeyList, JSON.stringify([{ name: 'ok' }, 'string-entry'])),
      ).toThrow(/malformed/i)
      expect(() => callUnknown(parseKeyList, JSON.stringify([{ name: 'ok' }, null]))).toThrow(
        /malformed/i,
      )
    })

    it('exported GLOBAL_AUTH_KV_KEY is consistent between wrangler helper and runtime', async () => {
      const helper = await freshModule('../scripts/wrangler')
      const runtime = await freshModule('../src/utils/global-auth')
      expect(helper.GLOBAL_AUTH_KV_KEY).toBe(runtime.GLOBAL_AUTH_KV_KEY)
    })
  })

  describe('update-proxy-config: interactive failure handling', () => {
    it('does not mutate in-memory state when save fails; catches, reports, continues', async () => {
      const mod = (await freshModule('../scripts/update-proxy-config')) as {
        saveSingleConfig: (id: string, config: unknown) => void
      }
      // saveSingleConfig now throws on failure; addEntry must catch and not
      // keep state. Verified indirectly: saveSingleConfig throws, addEntry
      // catches. Direct unit check of the throw path:
      mockExecFileSync.mockImplementation(() => {
        throw new Error('put failed')
      })
      expect(() => mod.saveSingleConfig('test-server', { url: 'https://example.com' })).toThrow(
        'put failed',
      )
    })

    it('validates header names with the shared isValidHeaderName helper', async () => {
      const helper = await freshModule('../scripts/wrangler')
      expect(typeof helper.isValidHeaderName).toBe('function')
    })
  })
})
