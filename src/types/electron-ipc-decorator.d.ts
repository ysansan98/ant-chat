declare module 'electron-ipc-decorator' {
  import type { IpcMainInvokeEvent, WebContents } from 'electron'

  export interface IpcContext {
    sender: WebContents
    event: IpcMainInvokeEvent
  }

  export function getIpcContext(): IpcContext
  export function IpcMethod(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor

  export abstract class IpcService {
    protected handler: IpcHandler
    static readonly groupName: string
    protected registerMethods(): void
    protected registerMethod<TOutput>(methodName: string, handler: (...args: any[]) => Promise<TOutput> | TOutput): void
  }

  export interface IpcServiceConstructor {
    new (): IpcService
    readonly groupName: string
  }

  export function createServices<T extends readonly IpcServiceConstructor[]>(serviceConstructors: T): CreateServicesResult<T>
  export type CreateServicesResult<T extends readonly IpcServiceConstructor[]> = { [K in T[number] as K['groupName']]: InstanceType<K> }

  export type ExtractServiceMethods<T> = {
    [K in keyof T as T[K] extends ((...args: any[]) => any) ? K : never]:
    T[K] extends ((...args: infer Args) => infer Output)
      ? Args extends []
        ? () => AlwaysPromise<Output>
        : Args extends [infer Input]
          ? (input: Input) => AlwaysPromise<Output>
          : (...args: Args) => AlwaysPromise<Output>
      : never
  }

  export type MergeIpcService<T> = {
    [K in keyof T]:
    T[K] extends (new (...args: any[]) => infer Instance)
      ? ExtractServiceMethods<Instance>
      : T[K] extends infer Instance
        ? ExtractServiceMethods<Instance>
        : never
  }

  type AlwaysPromise<T> = Promise<Awaited<T>>

  export class IpcHandler {
    static getInstance(): IpcHandler
    registerMethod<TOutput>(channel: string, handler: (...args: any[]) => Promise<TOutput> | TOutput): void
    sendToRenderer<T = any>(webContents: WebContents, channel: string, data: T): void
  }
}
