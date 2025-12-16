const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { google } = require('googleapis');
const archiver = require('archiver');
const cron = require('node-cron');
const unzipper = require('unzipper');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const LOCK_TIMEOUT = 2 * 60 * 1000;

// ================= 預設設定 =================
let defaultConfig = {
  gridSize: 9,
  winNumbers: [7],
  progressThreshold: 3
};

// ================= 密碼 =================
let globalPlayerPassword = process.env.PLAYER_PASSWORD || 'player123';
let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

// ================= 遊戲狀態 =================
let games = {};

// ================= 檔案工具 =================
function getGameFilePath(code) {
  return path.join(__dirname, `game-${code}.json`);
}

function saveGame(code) {
  fs.writeFileSync(getGameFilePath(code), JSON.stringify(games[code], null, 2));
}

function loadGame(code) {
  const file = getGameFilePath(code);
  if (fs.existsSync(file)) {
    try {
      games[code] = JSON.parse(fs.readFileSync(file, 'utf-8'));

      // 相容舊版 winNumber
      if (typeof games[code].config?.winNumber === 'number') {
        games[code].config.winNumbers = [games[code].config.winNumber];
        delete games[code].config.winNumber;
      }
    } catch (err) {
      console.error('Load game failed:', err);
    }
  }
}

function loadAllGames() {
  fs.readdirSync(__dirname)
    .filter(f => f.startsWith('game-') && f.endsWith('.json'))
    .forEach(f => {
      const code = f.replace('game-', '').replace('.json', '');
      loadGame(code);
    });
}

// ================= 密碼持久化 =================
function savePasswords() {
  const file = path.join(__dirname, 'game-__config.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ globalPlayerPassword, adminPassword }, null, 2)
  );
}

function loadPasswords() {
  const file = path.join(__dirname, 'game-__config.json');
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (data.globalPlayerPassword) globalPlayerPassword = data.globalPlayerPassword;
    if (data.adminPassword) adminPassword = data.adminPassword;
  }
}

// ================= 鎖定欄位 =================
function ensureLockFields(code) {
  const g = games[code];
  if (!g) return;
  if (!('lockedBy' in g)) g.lockedBy = null;
  if (!('lockUntil' in g)) g.lockUntil = null;
  if (!('lastActive' in g)) g.lastActive = null;
}

// ================= 初始化遊戲 =================
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
    lockedBy: null,
    lockUntil: null,
    lastActive: null
  };

  saveGame(code);
}

// ================= 玩家登入 =================
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === globalPlayerPassword) {
    res.json({ success: true });
  } else {
    res.status(403).json({ error: '密碼錯誤' });
  }
});

// ================= 遊戲清單 =================
app.get('/api/game-list', (req, res) => {
  const codes = Object.keys(games).filter(c => !c.startsWith('__'));
  res.json({ codes });
});

// ================= 玩家進入遊戲（鎖定） =================
app.get('/api/game/state', (req, res) => {
  const { code, playerId } = req.query;
  if (!code || !playerId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];
  ensureLockFields(code);
  const now = Date.now();

  if (
    game.lockedBy &&
    game.lockedBy !== playerId &&
    game.lockUntil &&
    now < game.lockUntil
  ) {
    return res.status(403).json({ error: 'Game is locked by another player' });
  }

  game.lockedBy = playerId;
  game.lockUntil = now + LOCK_TIMEOUT;
  game.lastActive = now;
  saveGame(code);

  res.json({
    gridSize: game.config.gridSize,
    winningNumbers: game.config.winNumbers,
    progressThreshold: game.config.progressThreshold,
    scratched: game.scratched,
    revealed: game.scratched.map(v => v !== null)
  });
});

// ================= 玩家刮格子（必須持有鎖） =================
app.post('/api/game/scratch', (req, res) => {
  const { index, code, playerId } = req.body;
  if (index === undefined || !code || !playerId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];
  ensureLockFields(code);
  const now = Date.now();

  if (game.lockedBy !== playerId || (game.lockUntil && now > game.lockUntil)) {
    return res.status(403).json({ error: 'Lock expired or not owner' });
  }

  const { gridSize, winNumbers, progressThreshold } = game.config;
  if (index < 0 || index >= gridSize) {
    return res.status(400).json({ error: 'Invalid index' });
  }

  if (game.scratched[index] === null) {
    let chosen = game.numbers[index];
    const scratchedCount = game.scratched.filter(v => v !== null).length;

    if (winNumbers.includes(chosen) && scratchedCount < progressThreshold) {
      const safeIndexes = game.scratched
        .map((v, i) => v === null && !winNumbers.includes(game.numbers[i]) ? i : null)
        .filter(v => v !== null);

      if (safeIndexes.length > 0) {
        const swap = safeIndexes[Math.floor(Math.random() * safeIndexes.length)];
        [game.numbers[index], game.numbers[swap]] =
          [game.numbers[swap], game.numbers[index]];
        chosen = game.numbers[index];
      }
    }

    game.scratched[index] = chosen;
    if (winNumbers.includes(chosen)) backupZipToDrive();
  }

  game.lockUntil = now + LOCK_TIMEOUT;
  game.lastActive = now;
  saveGame(code);

  res.json({ number: game.scratched[index], revealed: true });
});
// ================= Google Drive OAuth =================
function getOAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const token = JSON.parse(process.env.GOOGLE_TOKEN);
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

const TARGET_FOLDER_ID = '1ZbWY6V2RCllvccOsL6cftTz1kqZENE9Y';

// ================= 備份 ZIP =================
async function backupZipToDrive() {
  try {
    const zipPath = path.join(__dirname, 'games-backup.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);

    const files = fs.readdirSync(__dirname)
      .filter(f => f.startsWith('game-') && f.endsWith('.json'));

    files.forEach(file => {
      archive.file(path.join(__dirname, file), { name: file });
    });

    await new Promise((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
      archive.finalize();
    });

    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const media = {
      mimeType: 'application/zip',
      body: fs.createReadStream(zipPath)
    };

    const requestBody = {
      name: 'games-backup.zip',
      mimeType: 'application/zip',
      parents: [TARGET_FOLDER_ID]
    };

    const file = await drive.files.create({
      requestBody,
      media,
      uploadType: 'media'
    });

    console.log('Backup success:', file.data.id);
  } catch (err) {
    console.error('Backup failed:', err);
  }
}

// ================= 還原備份 =================
async function restoreFromDrive() {
  try {
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.files.list({
      q: `name='games-backup.zip' and '${TARGET_FOLDER_ID}' in parents`,
      orderBy: 'createdTime desc',
      pageSize: 1,
      fields: 'files(id)'
    });

    if (!res.data.files.length) return;

    const fileId = res.data.files[0].id;
    const zipPath = path.join(__dirname, 'games-backup.zip');
    const dest = fs.createWriteStream(zipPath);

    await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    ).then(resp => {
      return new Promise((resolve, reject) => {
        resp.data.pipe(dest);
        dest.on('finish', resolve);
        dest.on('error', reject);
      });
    });

    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: __dirname }))
      .promise();

    loadPasswords();
    console.log('Restore completed');
  } catch (err) {
    console.error('Restore failed:', err);
  }
}

// ================= 定時備份 =================
cron.schedule('*/30 * * * *', backupZipToDrive);

// ================= Manager API =================
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  if (games[code].config.managerPassword === password) {
    res.json({ success: true, token: 'manager-token-' + code });
  } else {
    res.status(403).json({ error: '密碼錯誤' });
  }
});

app.post('/api/manager/reset', (req, res) => {
  const auth = req.headers.authorization;
  const { code } = req.body;
  if (auth !== 'Bearer manager-token-' + code) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  loadGame(code);
  initGame(code, games[code].config);
  res.json({ message: '遊戲已重置' });
});

app.post('/api/manager/config/grid', (req, res) => {
  const auth = req.headers.authorization;
  const { code, gridSize } = req.body;
  if (auth !== 'Bearer manager-token-' + code) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  loadGame(code);
  games[code].config.gridSize = gridSize;
  saveGame(code);
  res.json({ success: true });
});

app.post('/api/manager/config/win', (req, res) => {
  const auth = req.headers.authorization;
  const { code, winNumbers } = req.body;
  if (auth !== 'Bearer manager-token-' + code) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  loadGame(code);
  games[code].config.winNumbers = winNumbers;
  saveGame(code);
  res.json({ success: true });
});

// ================= Admin API =================
app.post('/api/admin', (req, res) => {
  if (req.body.password === adminPassword) {
    res.json({ success: true, token: 'admin-token' });
  } else {
    res.status(403).json({ error: '管理員密碼錯誤' });
  }
});

app.post('/api/admin/create-game', (req, res) => {
  if (req.headers.authorization !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code, managerPassword } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  if (games[code]) return res.status(400).json({ error: 'Game exists' });

  initGame(code, { ...defaultConfig, managerPassword });
  res.json({ success: true });
});

app.post('/api/admin/reset', (req, res) => {
  if (req.headers.authorization !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { code } = req.body;
  loadGame(code);
  initGame(code, games[code].config);
  res.json({ success: true });
});

app.post('/api/admin/delete-game', (req, res) => {
  if (req.headers.authorization !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { code } = req.body;
  delete games[code];
  const file = getGameFilePath(code);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ success: true });
});

app.post('/api/admin/change-password', (req, res) => {
  if (req.headers.authorization !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  adminPassword = req.body.newPassword;
  savePasswords();
  res.json({ success: true });
});

app.post('/api/admin/change-global-password', (req, res) => {
  if (req.headers.authorization !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  globalPlayerPassword = req.body.newPassword;
  savePasswords();
  res.json({ success: true });
});

// ================= 啟動伺服器 =================
app.listen(PORT, async () => {
  console.log('Server running on port', PORT);
  await restoreFromDrive();
  loadAllGames();
  loadPasswords();
});
