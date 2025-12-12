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
    const state = await fetch(`/api/game/state?code=${encodeURIComponent(gameCode)}`)
      .then(r => r.json());

    winningNumbers = state.winningNumbers || []; // 後端回傳陣列
    totalCells = state.gridSize;
    document.getElementById('winning').innerText = winningNumbers.join(', ');

    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    // 動態設定 grid 列數
    const root = Math.sqrt(state.gridSize);
    if (Number.isInteger(root)) {
      grid.style.gridTemplateColumns = `repeat(${root}, auto)`;
    } else {
      grid.style.gridTemplateColumns = `repeat(6, auto)`; // 預設 6 列
    }

    // 建立格子
    for (let i = 0; i < state.gridSize; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (state.scratched[i] !== null) {
        cell.classList.add('revealing');
        cell.innerText = state.scratched[i];
        if (winningNumbers.includes(state.scratched[i])) {
          cell.classList.add('win'); // 標記中獎格子
        }
      }
      cell.onclick = () => scratch(i, cell);
      grid.appendChild(cell);
    }

    updateStats(state.scratched.filter(n => n !== null).length);
  } catch (e) {
    alert('載入遊戲失敗，請確認遊戲代碼是否正確');
  }
}

// 刮格子
async function scratch(i, cell) {
  if (cell.innerText && cell.innerText !== '') return; // 已經刮過就不再刮

  cell.classList.add('revealing');
  if (navigator.vibrate) navigator.vibrate(100);

  setTimeout(async () => {
    try {
      const res = await fetch('/api/game/scratch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: i, code: gameCode })
      });
      const data = await res.json();

      cell.innerText = data.number;

      const scratchedCount = document.querySelectorAll('.cell.revealing').length;
      updateStats(scratchedCount);

      if (winningNumbers.includes(data.number)) {
        cell.classList.add('win'); // 標記中獎格子
        alert('🎉 恭喜中獎！你刮到了號碼 ' + data.number);
      }
    } catch (e) {
      alert('刮格子失敗，請稍後再試');
    }
  }, 800);
}

// 更新統計資訊
function updateStats(scratchedCount) {
  document.getElementById('scratchedCount').innerText = scratchedCount;
  document.getElementById('remainingCount').innerText = totalCells - scratchedCount;
}