import { logger } from '@main/utils/logger'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'

export async function installDevTools() {
  try {
    // 先安装 React Developer Tools
    await installExtension(REACT_DEVELOPER_TOOLS, {
      loadExtensionOptions: {
        allowFileAccess: true,
      },
      forceDownload: true,
    })
      .then(ext => logger.info(`Added Extension: ${ext.name}`))
      .catch(err => logger.error('React DevTools installation error:', err))

    // 再安装 Redux DevTools
    await installExtension(REDUX_DEVTOOLS, {
      loadExtensionOptions: {
        allowFileAccess: true,
      },
      forceDownload: true,
    })
      .then(ext => logger.info(`Added Extension: ${ext.name}`))
      .catch(err => logger.error('Redux DevTools installation error:', err))
  }
  catch (err) {
    logger.error('Failed to install dev tools:', err)
  }
}
