import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppApi } from '../renderer/src/state/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppApi
  }
}
