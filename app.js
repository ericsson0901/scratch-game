// app.js - 第一段
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let gameData = {}; // 存放所有遊戲狀態
let gameLocks = {}; // 遊戲鎖定狀態

// 全域密碼
const GLOBAL_PASSWORD = "player123";

// 管理員密碼
const ADMIN_PASSWORD = "admin123";
const MANAGER_PASSWORD = "manager123";

// ======================================
// 玩家登入 API
// ======================================
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if(password === GLOBAL_PASSWORD){
    res.json({ success:true });
  } else {
    res.status(401).json({ error:'密碼錯誤' });
  }
});

// 取得遊戲清單
app.get('/api/game-list', (req,res)=>{
  const codes = Object.keys(gameData);
  res.json({ codes });
});

// 取得單個遊戲狀態（含鎖定）
app.get('/api/game/state', (req,res)=>{
  const { code, playerId } = req.query;
  if(!gameData[code]){
    return res.status(404).json({ error:'遊戲代碼不存在' });
  }
  if(gameLocks[code] && gameLocks[code]!==playerId){
    return res.status(403).json({ error:'locked' });
  }
  // 鎖定遊戲給該玩家
  gameLocks[code] = playerId;
  res.json(gameData[code]);
});

// 釋放遊戲鎖
app.post('/api/game/unlock', (req,res)=>{
  const { code, playerId } = req.body;
  if(gameLocks[code] === playerId){
    delete gameLocks[code];
    res.json({ success:true });
  } else {
    res.status(403).json({ error:'無權限釋放鎖定' });
  }
});

// ======================================
// 第一段結束
// 第二段將包含管理員 / manager API 以及備份功能
// app.js - 第二段

// ======================================
// 管理員登入 API
// ======================================
app.post('/api/admin', (req,res)=>{
  const { password } = req.body;
  if(password === ADMIN_PASSWORD){
    res.json({ success:true, role:'admin' });
  } else {
    res.status(401).json({ error:'密碼錯誤' });
  }
});

// manager 登入 API
app.post('/api/manager', (req,res)=>{
  const { password } = req.body;
  if(password === MANAGER_PASSWORD){
    res.json({ success:true, role:'manager' });
  } else {
    res.status(401).json({ error:'密碼錯誤' });
  }
});

// ======================================
// 建立新遊戲
// ======================================
app.post('/api/admin/create-game', (req,res)=>{
  const { code, numbers } = req.body;
  if(!code || !numbers) return res.status(400).json({ error:'缺少代碼或號碼' });
  if(gameData[code]) return res.status(400).json({ error:'遊戲代碼已存在' });

  gameData[code] = {
    numbers,
    scratched: Array(numbers.length).fill(false)
  };

  saveGameData();
  res.json({ success:true });
});

// ======================================
// 刪除舊備份（管理員操作）
// ======================================
app.post('/api/admin/delete-backup', (req,res)=>{
  const backupDir = path.join(__dirname,'backups');
  fs.readdir(backupDir, (err, files)=>{
    if(err) return res.status(500).json({ error:'讀取備份失敗' });
    files.forEach(file=>{
      const filePath = path.join(backupDir,file);
      fs.unlink(filePath,()=>{});
    });
    res.json({ success:true, deleted: files.length });
  });
});

// ======================================
// 儲存遊戲資料到檔案
// ======================================
function saveGameData(){
  const dataPath = path.join(__dirname,'gameData.json');
  fs.writeFileSync(dataPath, JSON.stringify(gameData,null,2));
  // 同步產生備份
  const backupDir = path.join(__dirname,'backups');
  if(!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  const backupPath = path.join(backupDir,`backup_${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(gameData,null,2));
}

// ======================================
// 讀取遊戲資料
// ======================================
function loadGameData(){
  const dataPath = path.join(__dirname,'gameData.json');
  if(fs.existsSync(dataPath)){
    const raw = fs.readFileSync(dataPath);
    gameData = JSON.parse(raw);
  }
}

// 初始化
loadGameData();

// ======================================
// 啟動服務
// ======================================
app.listen(PORT, ()=>{
  console.log(`Server running on port ${PORT}`);
});
