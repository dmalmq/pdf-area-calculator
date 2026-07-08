import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  openPdf: () => ipcRenderer.invoke('pdf:open'),
  openPdfPath: (path: string) => ipcRenderer.invoke('pdf:openPath', path),
  savePdf: (bytes: Uint8Array, defaultName: string) =>
    ipcRenderer.invoke('pdf:save', bytes, defaultName),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project: unknown, defaultName: string) =>
    ipcRenderer.invoke('project:save', project, defaultName)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
