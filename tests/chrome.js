// Finds a Chrome or Edge to drive with puppeteer-core (no 150MB Chromium download). CHROME_PATH wins.
const fs = require('fs'), path = require('path');
module.exports = function findChrome(){
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cands = process.platform === 'win32'
    ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(b => [path.join(b, 'Google/Chrome/Application/chrome.exe'), path.join(b, 'Microsoft/Edge/Application/msedge.exe'), path.join(b, 'Chromium/Application/chrome.exe')])
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return cands.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || '';
};
