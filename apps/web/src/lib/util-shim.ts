/**
 * Node 内置模块的 browser shim。
 *
 * wasm-bindgen / 部分依赖在模块顶层引用 Node 内置模块（util、async_hooks），
 * Vite 在浏览器环境将其 externalize 为空 stub，导致构造函数不可用。
 * 浏览器原生已有 TextEncoder/TextDecoder；AsyncLocalStorage 提供同步存储的
 * 最小实现（预览场景无需跨 async 边界的上下文传播）。
 */

// --- util shim ---
const TextEncoder = globalThis.TextEncoder
const TextDecoder = globalThis.TextDecoder

export { TextDecoder, TextEncoder }
export default { TextEncoder, TextDecoder }

// --- async_hooks shim ---
/**
 * 最小化 AsyncLocalStorage 实现：同步存储 context，不追踪 async 边界。
 * 预览场景（只读渲染）不依赖跨 await 的上下文传播，同步存储足够。
 */
class AsyncLocalStorage {
  private store: unknown = undefined

  run<R>(store: unknown, callback: () => R): R {
    const previous = this.store
    this.store = store
    try {
      return callback()
    }
    finally {
      this.store = previous
    }
  }

  getStore(): unknown {
    return this.store
  }

  enterWith(store: unknown): void {
    this.store = store
  }

  disable(): void {
    this.store = undefined
  }
}

export { AsyncLocalStorage }
