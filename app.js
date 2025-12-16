const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { google } = require('googleapis');
const archiver = require('archiver');
const cron = require('node-cron');
const unzipper = require('unzipper');

dotenv.config();

const __dirname = path.resolve();
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ===== 遊戲設定 =====
let defaultConfig = {
  gridSize: 9,
  winNumbers: [7],
  progressThreshold: 3
};

// 密碼
let globalPlayerPassword = process.env.PLAYER_PASSWORD || 'player123';
let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

// 遊戲狀態
let games = {};

// ===== 檔案操作 =====
function getGameFilePath(code) {
  return path.join(__dirname, "game-" + code + ".json");
}

function saveGame(code) {
  fs.writeFileSync(getGameFilePath(code), JSON.stringify(games[code], null, 2));
}

function loadGame(code) {
  const file = getGameFilePath(code);
  if (fs.existsSync(file)) {
    try {
      games[code] = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const config = games[code].config;
      if (typeof config?.winNumber === 'number') {
        config.winNumbers = [config.winNumber];
        delete config.winNumber;
      }
    } catch (err) {
      console.error("載入遊戲 " + code + " 失敗:", err);
    }
  }
}

function loadAllGames() {
  const files = fs.readdirSync(__dirname).filter(f => f.startsWith('game-') && f.endsWith('.json'));
  for (const file of files) {
    const code = file.replace('game-', '').replace('.json', '');
    loadGame(code);
  }
  console.log("已載入所有遊戲代碼:", Object.keys(games));
}

// ===== 密碼持久化 =====
function savePasswords() {
  const file = path.join(__dirname, "game-__config.json");
  fs.writeFileSync(file, JSON.stringify({ globalPlayerPassword, adminPassword }, null, 2));
}

function loadPasswords() {
  const file = path.join(__dirname, "game-__config.json");
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (data.globalPlayerPassword) globalPlayerPassword = data.globalPlayerPassword;
    if (data.adminPassword) adminPassword = data.adminPassword;
  }
}

// ===== Google Drive 備份 =====
const TARGET_FOLDER_ID = '1ZbWY6V2RCllvccOsL6cftTz1kqZENE9Y'; // 從環境變數中讀取 Google API 認證資訊

function getOAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS); // 從環境變數讀取 Google credentials
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  const token = JSON.parse(process.env.GOOGLE_TOKEN); // 從環境變數讀取 Token
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

async function backupZipToDrive() {
  try {
    const zipPath = path.join(__dirname, 'games-backup.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);

    const files = fs.readdirSync(__dirname).filter(f => f.startsWith('game-') && f.endsWith('.json'));
    for (const file of files) archive.file(path.join(__dirname, file), { name: file });

    await new Promise((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
      archive.finalize();
    });

    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const media = { mimeType: 'application/zip', body: fs.createReadStream(zipPath) };
    const requestBody = { name: 'games-backup.zip', mimeType: 'application/zip' };
    if (TARGET_FOLDER_ID) requestBody.parents = [TARGET_FOLDER_ID];

    const file = await drive.files.create({ requestBody, media, uploadType: 'media' });
    console.log("備份成功，檔案ID:", file.data.id);
  } catch (err) {
    console.error("備份失敗:", err);
  }
}

async function restoreFromDrive() {
  try {
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.list({
      q: "name='games-backup.zip' and '" + TARGET_FOLDER_ID + "' in parents",
      orderBy: 'createdTime desc',
      pageSize: 1,
      fields: 'files(id, name)'
    });

    if (res.data.files.length === 0) {
      console.log("沒有找到備份檔案");
      return;
    }

    const fileId = res.data.files[0].id;
    const dest = fs.createWriteStream(path.join(__dirname, 'games-backup.zip'));
    await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' }).then(resp => {
      return new Promise((resolve, reject) => {
        resp.data.pipe(dest);
        dest.on('finish', resolve);
        dest.on('error', reject);
      });
    });

    await fs.createReadStream(path.join(__dirname, 'games-backup.zip')).pipe(unzipper.Extract({ path: __dirname })).promise();
    console.log("已還原遊戲 JSON 檔案");
    loadPasswords();
  } catch (err) {
    console.error("還原失敗:", err);
  }
}

// 定時備份
cron.schedule('*/30 * * * *', backupZipToDrive);

// ===== 遊戲初始化 =====
function initGame(code, config = defaultConfig) {
  let arr = Array.from({ length: config.gridSize }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  games[code] = { numbers: arr, scratched: Array(config.gridSize).fill(null), config: { ...config } };
  saveGame(code);
}

// ===== API =====
// 玩家登入
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === globalPlayerPassword) return res.json({ success: true });
  res.status(401).json({ error: 'Invalid player password' });
});

// 管理員登入
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) return res.json({ token: 'admin-token' });
  res.status(401).json({ error: 'Invalid admin password' });
});

// 場次管理員登入
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  if (password !== games[code].config.managerPassword) return res.status(401).json({ error: 'Invalid manager password' });
  res.json({ token: "manager-token-" + code, code });
});

// 玩家查詢遊戲代碼清單
app.get('/api/game-list', (req, res) => {
  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// 玩家查詢遊戲狀態
app.get('/api/game/state', (req, res) => {
  const { code } = req.query;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  const game = games[code];
  res.json({
    gridSize: game.config.gridSize,
    winningNumbers: game.config.winNumbers,
    progressThreshold: game.config.progressThreshold,
    scratched: game.scratched,
    revealed: game.scratched.map(n => n !== null)
  });
});

// 玩家刮格子
app.post('/api/game/scratch', (req, res) => {
  const { index, code } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  const game = games[code];
  const { winNumbers, progressThreshold, gridSize } = game.config;
  if (index < 0 || index >= gridSize) return res.status(400).json({ error: 'Invalid index' });
  if (game.scratched[index] === null) {
    let chosen = game.numbers[index];
    const scratchedCount = game.scratched.filter(n => n !== null).length;
    if (winNumbers.includes(chosen) && scratchedCount < progressThreshold) {
      const availableIndexes = game.scratched.map((val, idx) => (val === null && !winNumbers.includes(game.numbers[idx]) ? idx : null)).filter(idx => idx !== null);
      if (availableIndexes.length > 0) {
        const swapIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
        const temp = game.numbers[swapIndex];
        game.numbers[swapIndex] = chosen;
        game.numbers[index] = temp;
        chosen = temp;
      }
    }
    game.scratched[index] = chosen;
    saveGame(code);
    if (winNumbers.includes(game.scratched[index])) backupZipToDrive();
  }
  res.json({ number: game.scratched[index], revealed: true });
});

// ===== Manager API =====
app.post('/api/manager/reset', (req, res) => {
  const auth = req.headers.authorization;
  const { code } = req.body;
  if (!auth || auth !== "Bearer manager-token-" + code) return res.status(403).json({ error: 'Unauthorized' });
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  initGame(code, games[code].config);
  res.json({ message: "遊戲 " + code + " 已由場次管理員重製" });
});

app.post('/api/manager/config/grid', (req, res) => {
  const auth = req.headers.authorization;
  const { code, gridSize } = req.body;
  if (!auth || auth !== "Bearer manager-token-" + code) return res.status(403).json({ error: 'Unauthorized' });
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  games[code].config.gridSize = gridSize;
  saveGame(code);
  res.json({ message: "遊戲 " + code + " 格子數已更新為 " + gridSize });
});

app.post('/api/manager/config/win', (req, res) => {
  const auth = req.headers.authorization;
  const { code, winNumbers } = req.body;
  if (!auth || auth !== "Bearer manager-token-" + code) return res.status(403).json({ error: 'Unauthorized' });
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  saveGame(code);
  res.json({ message: "遊戲 " + code + " 中獎號碼已更新為 " + games[code].config.winNumbers.join(', ') });
});

// ===== Admin API =====
app.post('/api/admin/create-game', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  const { code, managerPassword } = req.body;
  if (!code) return res.status(400).json({ error: 'Game code required' });
  loadGame(code);
  if (games[code]) return res.status(400).json({ error: 'Game already exists' });
  initGame(code, { ...defaultConfig, managerPassword });
  res.json({ message: "遊戲 " + code + " 已建立" });
});

app.post('/api/admin/reset', (req, res) => {
  const auth = req.headers.authorization;
  const { code } = req.body;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  initGame(code, games[code].config);
  res.json({ message: "遊戲 " + code + " 已重設" });
});

app.post('/api/admin/delete-game', (req, res) => {
  const auth = req.headers.authorization;
  const { code } = req.body;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  delete games[code];
  const file = getGameFilePath(code);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ message: "遊戲 " + code + " 已刪除" });
});

app.post('/api/admin/config', (req, res) => {
  const auth = req.headers.authorization;
  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  games[code].config.gridSize = gridSize || games[code].config.gridSize;
  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  games[code].config.progressThreshold = progressThreshold || games[code].config.progressThreshold;
  if (managerPassword) games[code].config.managerPassword = managerPassword;
  saveGame(code);
  res.json({ success: true, config: games[code].config });
});

app.get('/api/admin/game-list', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

app.get('/api/admin/progress', (req, res) => {
  const auth = req.headers.authorization;
  const { code } = req.query;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  const game = games[code];
  const scratchedCount = game.scratched.filter(n => n !== null).length;
  const remainingCount = game.scratched.filter(n => n === null).length;
  const thresholdReached = scratchedCount >= game.config.progressThreshold;
  res.json({ scratchedCount, remainingCount, progressThreshold: game.config.progressThreshold, thresholdReached });
});

app.post('/api/admin/change-password', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New password required' });
  adminPassword = newPassword;
  savePasswords();
  res.json({ message: "管理員密碼已更新" });
});

app.post('/api/admin/change-global-password', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New player password required' });
  globalPlayerPassword = newPassword;
  savePasswords();
  res.json({ message: "全域玩家密碼已更新" });
});

// ===== 啟動伺服器 =====
app.listen(PORT, async () => {
  console.log("Server running on port " + PORT);
  await restoreFromDrive();
  loadAllGames();
  loadPasswords();
});
