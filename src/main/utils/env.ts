/// <reference types="vite/client" />

export const isDev = import.meta.env.DEV
export const isProd = import.meta.env.PROD
export const isMacOS = process.platform === 'darwin'
export const isWindows = process.platform === 'win32'
export const isLinux = process.platform === 'linux'
