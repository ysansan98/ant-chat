/** app名称 */
export const APP_NAME = 'ant-chat'

/**
 * app升级 auto-update
 */
export const UPDATE_CHANNEL = {
  INIT: 'update-init',
  SET_URL: 'update-set-url',
  CHECK_UPDATE: 'update-check-update',
  //  手动下载更新文件
  DOWNLOAD_UPDATE: 'update-download-file',
  // 退出并安装
  EXIT_AND_INSTALL: 'update-exit-and-install',

  MSG: 'update-render-msg',
}

/**
 * app升级状态  auto-update
 */
export enum UPDATE_CODE {
  error = -1,
  checking = 0,
  updateAvaible = 1,
  updateNotAvaible = 2,
  downloadProgress = 3,
  updateDownloaded = 4,
}
