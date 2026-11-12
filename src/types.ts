export type LogFn = (line: string) => void

export type ShellOptions = {
  asUser?: boolean
  input?: string
  onLine?: LogFn
}

export type ShellResult = {
  code: number
  lines: string[]
}

export type ShellFn = (script: string, options?: ShellOptions) => Promise<ShellResult>

export type GroupId = 'base' | 'gui' | 'flatpak' | 'docker'

export type StepResult = 'ok' | 'warn'

export type SkipFlags = {
  skipGui: boolean
  skipFlatpak: boolean
  skipNomad: boolean
}

export type SetupContext = {
  realUser: string
  realHome: string
  osId: string
  osVersionId: string
  debArch: 'amd64' | 'arm64'
  grokPlatform: 'linux-x64' | 'linux-arm64'
  shell: ShellFn
} & SkipFlags

export type Step = {
  id: string
  label: string
  group: GroupId
  run: (ctx: SetupContext, log: LogFn) => Promise<StepResult>
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'error'

export type TaskState = {
  id: string
  label: string
  status: TaskStatus
}

export type RunSummary = {
  ok: number
  warn: number
  aborted: boolean
}

export type RunHooks = {
  onTasks: (tasks: TaskState[]) => void
  onLog: LogFn
  shouldAbort: () => boolean
}
