import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { LegacyLearnApi } from '@learn/domain';
import { IpcChannels } from '@learn/domain/ipc-channels';

const invoke = (channel: string, input?: unknown) => ipcRenderer.invoke(channel, input);

const api: LegacyLearnApi = {
  appInfo: () => invoke(IpcChannels.appInfo),
  pickAndImport: (input) => invoke(IpcChannels.pickAndImport, input),
  importPaths: (input) => invoke(IpcChannels.importPaths, input),
  listItems: () => invoke(IpcChannels.listItems),
  getItem: (input) => invoke(IpcChannels.getItem, input),
  pickAndRelink: (input) => invoke(IpcChannels.pickAndRelink, input),
  recoveryReport: () => invoke(IpcChannels.recoveryReport),
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('learn', api);
