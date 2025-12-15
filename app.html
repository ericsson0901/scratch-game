const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { google } = require('googleapis');
const archiver = require('archiver'); // 新增壓縮套件
const unzipper = require('unzipper'); // 新增解壓縮套件

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Google Drive 設定
const FILE_ID = process.env.DRIVE_FILE_ID; // 在環境變數設定檔案 ID
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS); // 從環境變數讀取 Service Account JSON
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive']
});
const drive = google.drive({ version: 'v3', auth });

// 本地檔案資料夾 (分檔儲存)
const GAMES_DIR = path.join(__dirname, 'games');

// 預設設定
let defaultConfig = {
  gridSize: 9,
  winNumbers: [7],
  progressThreshold: 3
};

// 全域玩家密碼
let globalPlayerPassword = process.env.PLAYER_PASSWORD || 'player123';

// 管理員密碼
let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

// 多場遊戲狀態
let games = {};

// 確保資料夾存在
if (!fs.existsSync(GAMES_DIR)) {
  fs.mkdirSync(GAMES_DIR);
}

// 載入單一遊戲
async function loadGame(code) {
  try {
    const filePath = path.join(GAMES_DIR, `${code}.json`);
    const data = await fs.promises.readFile(filePath, 'utf-8');
    games[code] = JSON.parse(data);
  } catch {
    games[code] = null;
  }
}

// 儲存單一遊戲
async function saveGame(code) {
  const filePath = path.join(GAMES_DIR, `${code}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(games[code], null, 2));
}

// 壓縮整個 games 資料夾成 zip
async function createGamesZip() {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(__dirname, 'games.zip');
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outputPath));
    archive.on('error', err => reject(err));

    archive.pipe(output);
    archive.directory(GAMES_DIR, false);
    archive.finalize();
  });
}

// 從 Google Drive 初始化 (下載 zip 並解壓縮)
async function initFromDrive() {
  try {
    const destPath = path.join(__dirname, 'games.zip');
    const dest = fs.createWriteStream(destPath);

    const res = await drive.files.get({ fileId: FILE_ID, alt: 'media' }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      res.data.pipe(dest);
      res.data.on('end', resolve);
      res.data.on('error', reject);
    });

    await fs.createReadStream(destPath).pipe(unzipper.Extract({ path: GAMES_DIR })).promise();

    // 載入所有遊戲檔案到記憶體
    const files = await fs.promises.readdir(GAMES_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const code = path.basename(file, '.json');
        await loadGame(code);
      }
    }

    console.log('遊戲資料已從 Google Drive 初始化');
  } catch (err) {
    console.error('初始化失敗，改用本地檔案:', err);
  }
}

// 初始化遊戲
function initGame(code, config = defaultConfig) {
  let arr = Array.from({ length: config.gridSize }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  games[code] = {
    numbers: arr,
    scratched: Array(config.gridSize).fill(null),
    config: { ...config },
    lockedUntil: null // 新增心跳機制用的鎖定時間
  };
  saveGame(code);
}

// === 玩家登入 ===
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === globalPlayerPassword) {
    res.json({ success: true });
  } else {
    res.status(403).json({ error: '密碼錯誤' });
  }
});

// === 玩家查詢遊戲清單 ===
app.get('/api/game-list', (req, res) => {
  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});
// === 玩家刮格子 ===
app.post('/api/game/:code/scratch', async (req, res) => {
  const { code } = req.params;
  const { index } = req.body;

  if (!games[code]) {
    return res.status(404).json({ error: 'Game not found' });
  }

  // 檢查是否鎖定中
  const now = Date.now();
  if (games[code].lockedUntil && games[code].lockedUntil > now) {
    return res.status(403).json({ error: '遊戲正在進行中，請稍候再試' });
  }

  // 設定鎖定 2 分鐘
  games[code].lockedUntil = now + 2 * 60 * 1000;

  // 如果已經刮過，直接回傳
  if (games[code].scratched[index] !== null) {
    games[code].lockedUntil = null; // 操作完成解除鎖定
    return res.json({ number: games[code].scratched[index] });
  }

  const number = games[code].numbers[index];
  const scratchedCount = games[code].scratched.filter(n => n !== null).length;

  // 檢查進度門檻：未達門檻時替換中獎號碼
  if (scratchedCount < games[code].config.progressThreshold &&
      games[code].config.winNumbers.includes(number)) {
    
    const available = games[code].numbers.filter((n, i) => 
      games[code].scratched[i] === null && !games[code].config.winNumbers.includes(n)
    );

    if (available.length > 0) {
      const fakeNumber = available[Math.floor(Math.random() * available.length)];
      games[code].scratched[index] = fakeNumber;

      const fakeIndex = games[code].numbers.indexOf(fakeNumber);
      games[code].numbers[fakeIndex] = number;

      await saveGame(code);
      games[code].lockedUntil = null; // 操作完成解除鎖定
      return res.json({ number: fakeNumber });
    }
  }

  games[code].scratched[index] = number;
  await saveGame(code);
  games[code].lockedUntil = null; // 操作完成解除鎖定
  res.json({ number });
});

// === 玩家查詢某場遊戲狀態 ===
app.get('/api/game/:code', (req, res) => {
  const { code } = req.params;
  if (!games[code]) {
    return res.status(404).json({ error: 'Game not found' });
  }
  res.json(games[code]);
});

// === 玩家心跳 API (修改版：不再延長鎖定時間) ===
app.post('/api/game/:code/heartbeat', (req, res) => {
  const { code } = req.params;
  if (!games[code]) {
    return res.status(404).json({ error: 'Game not found' });
  }
  // 僅回傳目前鎖定狀態，不延長鎖定
  res.json({ success: true, lockedUntil: games[code].lockedUntil });
});
// === 管理員登入 ===
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    res.json({ token: 'admin-token' });
  } else {
    res.status(403).json({ error: '管理員密碼錯誤' });
  }
});

// === 場次管理員登入 ===
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  if (!games[code]) {
    return res.status(404).json({ error: 'Game not found' });
  }
  if (password === games[code].config.managerPassword) {
    res.json({ token: `manager-token-${code}`, code });
  } else {
    res.status(403).json({ error: '場次管理員密碼錯誤' });
  }
});

// === Manager 重製遊戲 ===
app.post('/api/manager/reset', (req, res) => {
  const authHeader = req.headers.authorization;
  const { code } = req.body;
  if (!authHeader || authHeader !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  initGame(code, games[code].config);
  res.json({ message: `遊戲 ${code} 已由場次管理員重製` });
});

// === Manager 修改格子數 ===
app.post('/api/manager/config/grid', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { code, gridSize } = req.body;
  if (!authHeader || authHeader !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.gridSize = gridSize;
  await saveGame(code);
  res.json({ message: `遊戲 ${code} 格子數已更新為 ${gridSize}` });
});

// === Manager 修改中獎號碼 ===
app.post('/api/manager/config/win', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { code, winNumbers } = req.body;
  if (!authHeader || authHeader !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  await saveGame(code);
  res.json({ message: `遊戲 ${code} 中獎號碼已更新為 ${games[code].config.winNumbers.join(', ')}` });
});

// === Admin 查詢所有遊戲代碼清單 ===
app.get('/api/admin/game-list', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// === Admin 查詢所有遊戲進度 (全部) ===
app.get('/api/admin/game-progress', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const progress = {};
  for (const code of Object.keys(games).filter(c => !c.startsWith('__'))) {
    const scratchedCount = games[code].scratched.filter(n => n !== null).length;
    progress[code] = {
      scratched: scratchedCount,
      remaining: games[code].config.gridSize - scratchedCount,
      gridSize: games[code].config.gridSize,
      winNumbers: games[code].config.winNumbers
    };
  }

  res.json(progress);
});

// === Admin 查詢單一遊戲進度 ===
app.get('/api/admin/progress', (req, res) => {
  const authHeader = req.headers.authorization;
  const { code } = req.query;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const scratchedCount = games[code].scratched.filter(n => n !== null).length;
  const remainingCount = games[code].config.gridSize - scratchedCount;
  const progressThreshold = games[code].config.progressThreshold;
  const thresholdReached = scratchedCount >= progressThreshold;

  res.json({ scratchedCount, remainingCount, progressThreshold, thresholdReached });
});

// === Admin 建立遊戲 ===
app.post('/api/admin/create-game', (req, res) => {
  const authHeader = req.headers.authorization;
  const { code, config, managerPassword } = req.body;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (games[code]) return res.status(400).json({ error: 'Game already exists' });

  initGame(code, { ...(config || defaultConfig), managerPassword });
  res.json({ message: `遊戲 ${code} 已建立` });
});

// === Admin 重設遊戲 ===
app.post('/api/admin/reset', (req, res) => {
  const authHeader = req.headers.authorization;
  const { code } = req.body;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  initGame(code, games[code].config);
  res.json({ message: `遊戲 ${code} 已重設` });
});

// === Admin 刪除遊戲 ===
app.post('/api/admin/delete-game', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { code } = req.body;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  delete games[code];
  const filePath = path.join(GAMES_DIR, `${code}.json`);
  try { await fs.promises.unlink(filePath); } catch {}
  res.json({ message: `遊戲 ${code} 已刪除` });
});

// === Admin 修改遊戲設定 ===
app.post('/api/admin/config', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  if (gridSize) games[code].config.gridSize = gridSize;
  if (Array.isArray(winNumbers)) games[code].config.winNumbers = winNumbers;
  if (progressThreshold) games[code].config.progressThreshold = progressThreshold;
  if (managerPassword) games[code].config.managerPassword = managerPassword;

  await saveGame(code);
  res.json({ success: true, config: games[code].config });
});

// === Admin 修改管理員密碼 ===
app.post('/api/admin/change-password', (req, res) => {
  const authHeader = req.headers.authorization;
  const { newPassword } = req.body;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  adminPassword = newPassword;
  games.__adminPassword = newPassword;
  res.json({ message: '管理員密碼已更新' });
});

// === Admin 修改全域玩家密碼 ===
app.post('/api/admin/change-global-password', (req, res) => {
  const authHeader = req.headers.authorization;
  const { newPassword } = req.body;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  globalPlayerPassword = newPassword;
  games.__globalPlayerPassword = newPassword;
  res.json({ message: '全域玩家密碼已更新' });
});

// 備份到 Google Drive (壓縮整個 games 資料夾上傳)
async function backupToDrive() {
  try {
    const zipPath = await createGamesZip();
    const media = {
      mimeType: 'application/zip',
      body: fs.createReadStream(zipPath)
    };

    await drive.files.update({
      fileId: FILE_ID,   // ✅ 這裡要用 FILE_ID，不是 FILE
      media
    });

    console.log('已備份整個 games 資料夾到 Google Drive');
  } catch (err) {
    console.error('備份失敗:', err);
  }
}
