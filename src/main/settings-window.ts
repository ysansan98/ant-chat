import type { BrowserWindow } from 'electron'
import { BaseWindow } from './base-window'

let settingsWindow: null | BrowserWindow = null

export class SettingsWindow extends BaseWindow {
  constructor() {
    super({ type: 'settings', width: 900, height: 700, hash: '/settings' })
  }

  override async createWindow() {
    await super.createWindow()
    if (this.window) {
      settingsWindow = this.window
    }
  }

  protected override onWindowClosed() {
    settingsWindow = null
  }
}

export function getSettingsWindow(): typeof settingsWindow {
  return settingsWindow
}
