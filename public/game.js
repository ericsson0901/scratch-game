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
      .then(r => {
        if (!r.ok) throw new Error("Game not found");
        return r.json();
      });

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

// 玩家刮格子 (前端呼叫後端 API)
async function scratch(index, cell) {
  try {
    const res = await fetch(`/api/game/${encodeURIComponent(gameCode)}/scratch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || '刮格子失敗');
      return;
    }

    const data = await res.json();
    createScratchCell(
      cell,
      data.number,
      winningNumbers.includes(data.number),
      false
    );

    // 更新統計
    const scratchedCount = document.querySelectorAll('.cell.revealed').length;
    updateStats(scratchedCount);
  } catch (e) {
    alert('刮格子失敗，請稍後再試');
  }
}

// 更新統計顯示
function updateStats(scratchedCount) {
  document.getElementById('scratchedCount').innerText = scratchedCount;
  document.getElementById('remainingCount').innerText = totalCells - scratchedCount;
}