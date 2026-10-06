import { spawn } from 'node:child_process'
import process from 'node:process'

/** 发 SIGTERM 后等待进程组退出的窗口，超时补 SIGKILL。 */
const KILL_GRACE_MS = 1_000

/**
 * 终止目标进程所在的进程组（POSIX）或整棵命令树（Windows）。
 *
 * POSIX 子进程以 `detached` 启动成为进程组 leader，因此对 `-pid` 发信号可整组终止；
 * Windows 没有 POSIX 进程组语义，用 `taskkill /T /F` 终止含孙进程的命令树。
 * 进程组可能已退出或尚未建立，失败被静默忽略。
 */
export function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined)
    return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref?.()
    return
  }
  try {
    process.kill(-pid, signal)
  }
  catch {
    // 进程组可能已退出或尚未建立，忽略
  }
}

/** SIGTERM/SIGKILL 异步执行的兜底：宽限窗口后对同一进程组补 SIGKILL。 */
export function scheduleHardKill(pid: number | undefined): void {
  const hardKillTimer = setTimeout(() => {
    terminateProcessTree(pid, 'SIGKILL')
  }, KILL_GRACE_MS)
  hardKillTimer.unref?.()
}
