let winningNumbers = []; // 改成陣列
let totalCells = 0;
let gameCode = null;

// 提供給 index.html 呼叫
function startGame(code) {
  gameCode = code;
  document.getElementById('selectGame').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  loadGame();
}

// 載入遊戲狀態
async function loadGame() {
  try {
    const state = await fetch(`/api/game/${encodeURIComponent(gameCode)}`)
      .then(r => r.json());

    // 從後端 config 讀取設定
    winningNumbers = state.config.winNumbers || [];
    totalCells = state.config.gridSize;
    document.getElementById('winning').innerText = winningNumbers.join(', ');

    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    // 動態設定 grid 列數
    const root = Math.sqrt(state.config.gridSize);
    if (Number.isInteger(root)) {
      grid.style.gridTemplateColumns = `repeat(${root}, auto)`;
    } else {
      grid.style.gridTemplateColumns = `repeat(6, auto)`; // 預設 6 列
    }

    // 建立格子
    for (let i = 0; i < state.config.gridSize; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      if (state.scratched[i] !== null) {
        // 已刮過 → 顯示 revealed 狀態
        createScratchCell(
          cell,
          state.scratched[i],
          winningNumbers.includes(state.scratched[i]),
          true // alreadyRevealed
        );
      }

      // 點擊事件
      cell.onclick = () => {
        if (isAnyCellEnlarged && !cell.classList.contains('enlarged')) {
          return; // 有格子放大時，其他格子點擊無效
        }
        scratch(i, cell);
      };

      grid.appendChild(cell);
    }

    // 初始化統計：只算已刮過的格子
    updateStats(state.scratched.filter(n => n !== null).length);
  } catch (e) {
    alert('載入遊戲失敗，請確認遊戲代碼是否正確');
  }
}
// 玩家刮格子
app.post('/api/game/:code/scratch', async (req, res) => {
  const { code } = req.params;
  const { index } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const number = games[code].numbers[index];
  const scratchedCount = games[code].scratched.filter(n => n !== null).length;

  // 未達進度門檻且刮到中獎號碼 → 替換
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
      games[code].lockedUntil = null;
      return res.json({ number: fakeNumber });
    }
  }

  // 正常情況 → 顯示號碼
  games[code].scratched[index] = number;
  await saveGame(code);
  games[code].lockedUntil = null;
  res.json({ number });
});
