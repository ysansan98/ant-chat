declare module 'electron-ipc-decorator/client' {
  interface IpcInvoker {
    invoke: (channel: string, ...args: any[]) => Promise<any>
  }

  export function createIpcProxy<IpcServices extends Record<string, any>>(
    ipc: IpcInvoker | null,
  ): IpcServices | null
}
