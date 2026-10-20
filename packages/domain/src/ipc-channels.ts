/** Channel names only — kept free of zod so the sandboxed preload bundle stays tiny. */
export const IpcChannels = {
  appInfo: 'app:info',
  pickAndImport: 'library:pickAndImport',
  importPaths: 'library:import',
  listItems: 'library:list',
  getItem: 'library:get',
  pickAndRelink: 'library:pickAndRelink',
  recoveryReport: 'library:recoveryReport',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
