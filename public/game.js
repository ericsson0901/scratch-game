let winningNumbers = [];
let totalCells = 0;
let gameCode = null;

function startGame(code) {
  gameCode = code;
  document.getElementById('selectGame').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  loadGame();
}

async function loadGame() {
  try {
    const state = await fetch(`/api/game/state?code=${encodeURIComponent(gameCode)}`)
      .then(r => r.json());

    // ✅ 後端回傳的是 winNumbers
    winningNumbers = state.winNumbers || [];
    totalCells = state.gridSize;

    // ✅ 顯示中獎號碼時要 map 出 number
    document.getElementById('winning').innerText =
      winningNumbers.map(w => w.number).join(', ');

    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    const root = Math.sqrt(state.gridSize);
    grid.style.gridTemplateColumns = Number.isInteger(root)
      ? `repeat(${root}, auto)`
      : `repeat(6, auto)`;

    // ✅ 不管有沒有刮過，都要建立格子
    for (let i = 0; i < state.gridSize; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      const number = state.scratched[i] !== null ? state.scratched[i] : state.numbers[i];
      const isWin = winningNumbers.some(w => w.number === number);
      const alreadyRevealed = state.scratched[i] !== null;

      createScratchCell(cell, number, isWin, alreadyRevealed);

      cell.onclick = () => scratch(i, cell);
      grid.appendChild(cell);
    }

    updateStats(state.scratched.filter(n => n !== null).length);
  } catch (e) {
    alert('載入遊戲失敗，請確認遊戲代碼是否正確');
  }
}

async function scratch(i, cell) {
  if (cell.querySelector('.hiddenNumber')) return;

  cell.classList.add('enlarged');
  if (navigator.vibrate) navigator.vibrate(100);

  try {
    const res = await fetch('/api/game/scratch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: i, code: gameCode })
    });
    const data = await res.json();

    // ✅ 判斷中獎號碼改用 some
    const isWin = winningNumbers.some(w => w.number === data.number);
    createScratchCell(cell, data.number, isWin, false);
    cell.classList.add('revealed');

    const scratchedCount = document.querySelectorAll('.cell .hiddenNumber').length;
    updateStats(scratchedCount);

    if (isWin) cell.dataset.win = "true";
  } catch (e) {
    alert('刮格子失敗，請稍後再試');
  }
}

function updateStats(scratchedCount) {
  document.getElementById('scratchedCount').innerText = scratchedCount;
  document.getElementById('remainingCount').innerText = totalCells - scratchedCount;
}