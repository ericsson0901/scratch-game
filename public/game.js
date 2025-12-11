let winningNumber = null;
let totalCells = 0;
let gameCode = null;

document.getElementById('loginBtn').addEventListener('click', async () => {
  const password = document.getElementById('password').value;
  gameCode = document.getElementById('gameCode').value;

  const res = await fetch('/api/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password, code: gameCode })
  });

  if(res.ok){
    document.getElementById('login').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    loadGame();
  } else {
    const err = await res.json();
    alert(err.error);
  }
});

async function loadGame() {
  const state = await fetch(`/api/game/state?code=${gameCode}`).then(r=>r.json());
  winningNumber = state.winningNumber;
  totalCells = state.gridSize;
  document.getElementById('winning').innerText = winningNumber;

  const grid = document.getElementById('grid');
  grid.innerHTML='';

  const root = Math.sqrt(state.gridSize);
  if (Number.isInteger(root)) {
    grid.style.gridTemplateColumns = `repeat(${root}, auto)`;
  } else {
    grid.style.gridTemplateColumns = `repeat(6, auto)`;
  }

  for(let i=0;i<state.gridSize;i++){
    const cell=document.createElement('div');
    cell.className='cell';
    if(state.scratched[i] !== null){
      cell.classList.add('revealing');
      cell.innerText = state.scratched[i];
    }
    cell.onclick=()=>scratch(i, cell);
    grid.appendChild(cell);
  }

  updateStats(state.scratched.filter(n=>n!==null).length);
}

async function scratch(i, cell){
  if (cell.innerText && cell.innerText !== '') return;

  cell.classList.add('revealing');
  if (navigator.vibrate) navigator.vibrate(100);

  setTimeout(async ()=>{
    const res = await fetch('/api/game/scratch',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ index:i, code: gameCode })
    });
    const data = await res.json();

    cell.innerText = data.number;

    const scratchedCount = document.querySelectorAll('.cell.revealing').length;
    updateStats(scratchedCount);

    if(data.number == winningNumber){
      alert('🎉 恭喜中獎！你刮到了號碼 ' + winningNumber);
    }
  }, 800);
}

function updateStats(scratchedCount){
  document.getElementById('scratchedCount').innerText = scratchedCount;
  document.getElementById('remainingCount').innerText = totalCells - scratchedCount;
}