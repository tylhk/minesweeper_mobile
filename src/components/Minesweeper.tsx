import { useState, useEffect, useCallback, useRef } from 'react';
import { generateEmptyBoard, generateBoard, getNeighbors, getHint } from '../utils/minesweeperLogic';
import type { BoardData, HintResult } from '../utils/minesweeperLogic';
import './Minesweeper.css';

type Difficulty = 'beginner' | 'intermediate' | 'expert' | 'extreme' | 'custom';

const DIFFICULTIES = {
  beginner: { rows: 9, cols: 9, mines: 10, label: '初级' },
  intermediate: { rows: 16, cols: 16, mines: 40, label: '中级' },
  expert: { rows: 16, cols: 30, mines: 99, label: '高级' },
  extreme: { rows: 24, cols: 30, mines: 220, label: '极难' },
  custom: { rows: 20, cols: 20, mines: 50, label: '自定义' }
};

export default function Minesweeper() {
  const [difficulty, setDifficulty] = useState<Difficulty>('beginner');
  const [board, setBoard] = useState<BoardData>([]);
  const [gameState, setGameState] = useState<'initial' | 'playing' | 'won' | 'lost'>('initial');
  const [minesLeft, setMinesLeft] = useState(0);
  const [time, setTime] = useState(0);
  const [shakingCell, setShakingCell] = useState<{ r: number; c: number; key: number } | null>(null);
  const [hint, setHint] = useState<HintResult | null>(null);
  
  const [customRows, setCustomRows] = useState(20);
  const [customCols, setCustomCols] = useState(20);
  const [customMines, setCustomMines] = useState(50);

  // 临时输入状态，防止在输入过程中棋盘不断重置
  const [inputRows, setInputRows] = useState('20');
  const [inputCols, setInputCols] = useState('20');
  const [inputMines, setInputMines] = useState('50');

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isAnimating, setIsAnimating] = useState(false);

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const activePointers = useRef<Map<number, { x: number, y: number }>>(new Map());
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef<number>(1);

  const longPressTimer = useRef<number | null>(null);
  const shakeTimeoutRef = useRef<number | null>(null);

  // 处理自定义参数提交
  const validateAndCommit = useCallback(() => {
    let r = Math.max(5, Math.min(50, parseInt(inputRows) || 5));
    let c = Math.max(5, Math.min(50, parseInt(inputCols) || 5));
    
    // 雷数上限设为总格数的 50%，保证逻辑可解性生成的效率
    const maxAllowedMines = Math.floor((r * c) * 0.5);
    let m = Math.max(1, Math.min(maxAllowedMines, parseInt(inputMines) || 1));

    setInputRows(r.toString());
    setInputCols(c.toString());
    setInputMines(m.toString());
    
    if (r !== customRows || c !== customCols || m !== customMines) {
      setCustomRows(r);
      setCustomCols(c);
      setCustomMines(m);
    }
  }, [inputRows, inputCols, inputMines, customRows, customCols, customMines]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const getParams = useCallback(() => {
    if (difficulty === 'custom') return { rows: customRows, cols: customCols, mines: customMines };
    return DIFFICULTIES[difficulty];
  }, [difficulty, customRows, customCols, customMines]);

  const { rows, cols, mines } = getParams();

  const initGame = useCallback(() => {
    const p = getParams();
    setBoard(generateEmptyBoard(p.rows, p.cols));
    setGameState('initial');
    setMinesLeft(p.mines);
    setTime(0);
    setShakingCell(null);
    setHint(null);
    setOffset({ x: 0, y: 0 });
    setScale(1);
    setIsAnimating(false);
    if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
  }, [getParams]);

  useEffect(() => {
    initGame();
  }, [initGame]);

  useEffect(() => {
    let timer: number;
    if (gameState === 'playing') {
      timer = window.setInterval(() => setTime((t) => t + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [gameState]);

  const triggerShake = (r: number, c: number) => {
    if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
    setShakingCell({ r, c, key: Date.now() });
    shakeTimeoutRef.current = window.setTimeout(() => setShakingCell(null), 400);
  };

  const handleFlag = (r: number, c: number) => {
    if (gameState === 'initial' || gameState === 'won' || gameState === 'lost' || board[r][c].status === 'revealed') return;
    const newBoard = [...board.map(row => [...row])];
    const status = newBoard[r][c].status;
    newBoard[r][c].status = status === 'hidden' ? 'flagged' : 'hidden';
    setMinesLeft(m => status === 'hidden' ? m - 1 : m + 1);
    setBoard(newBoard);
    setHint(null);
  };

  const checkWinCondition = (currentBoard: BoardData) => {
    let unrevealedSafeCells = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!currentBoard[r][c].isMine && currentBoard[r][c].status !== 'revealed') unrevealedSafeCells++;
      }
    }
    if (unrevealedSafeCells === 0) {
      setGameState('won');
      setMinesLeft(0);
      const finalBoard = currentBoard.map(row => row.map(cell => cell.isMine ? { ...cell, status: 'flagged' as const } : cell));
      setBoard(finalBoard);
    }
  };

  const revealCellSafe = (r: number, c: number, newBoard: BoardData) => {
    if (newBoard[r][c].status !== 'hidden') return;
    const queue: [number, number][] = [[r, c]];
    newBoard[r][c].status = 'revealed';
    while (queue.length > 0) {
      const [currR, currC] = queue.shift()!;
      if (newBoard[currR][currC].neighborMines === 0) {
        for (const [nr, nc] of getNeighbors(currR, currC, rows, cols)) {
          if (newBoard[nr][nc].status === 'hidden') {
            newBoard[nr][nc].status = 'revealed';
            queue.push([nr, nc]);
          }
        }
      }
    }
  };

  const handleSmartAction = (r: number, c: number) => {
    if (gameState !== 'playing') return;
    const cell = board[r][c];
    if (cell.status !== 'revealed' || cell.neighborMines === 0) return;

    const neighbors = getNeighbors(r, c, rows, cols);
    const hidden = neighbors.filter(([nr, nc]) => board[nr][nc].status === 'hidden');
    const flagged = neighbors.filter(([nr, nc]) => board[nr][nc].status === 'flagged');

    if (hidden.length + flagged.length === cell.neighborMines && hidden.length > 0) {
      const newBoard = [...board.map(row => [...row])];
      hidden.forEach(([hr, hc]) => { newBoard[hr][hc].status = 'flagged'; });
      setMinesLeft(prev => prev - hidden.length);
      setBoard(newBoard);
      setHint(null);
      return;
    }

    if (flagged.length === cell.neighborMines) {
      const newBoard = [...board.map(row => [...row])];
      let hitMine = false;
      const toReveal = hidden.filter(([nr, nc]) => {
        if (newBoard[nr][nc].isMine) hitMine = true;
        return true;
      });

      if (hitMine) {
        board.forEach((row, ir) => row.forEach((_, ic) => { if (board[ir][ic].isMine) newBoard[ir][ic].status = 'revealed'; }));
        setBoard(newBoard);
        setGameState('lost');
        return;
      }

      if (toReveal.length > 0) {
        toReveal.forEach(([tr, tc]) => revealCellSafe(tr, tc, newBoard));
        setBoard(newBoard);
        setHint(null);
        checkWinCondition(newBoard);
      } else if (hidden.length === 0) {
        triggerShake(r, c);
      }
    } else {
      triggerShake(r, c);
    }
  };

  const handleCellClickLogic = (r: number, c: number) => {
    if (gameState === 'won' || gameState === 'lost') return;
    if (board[r][c].status === 'revealed') { handleSmartAction(r, c); return; }
    if (board[r][c].status === 'flagged') return;

    let currentBoard = board;
    if (gameState === 'initial') {
      setGameState('playing');
      currentBoard = generateBoard(rows, cols, mines, r, c);
    }

    setHint(null);

    if (currentBoard[r][c].isMine) {
      const newBoard = [...currentBoard.map(row => [...row])];
      currentBoard.forEach((row, ir) => row.forEach((_, ic) => { if (currentBoard[ir][ic].isMine) newBoard[ir][ic].status = 'revealed'; }));
      setBoard(newBoard);
      setGameState('lost');
    } else {
      const newBoard = [...currentBoard.map(row => [...row])];
      revealCellSafe(r, c, newBoard);
      setBoard(newBoard);
      checkWinCondition(newBoard);
    }
  };

  const handleHintClick = () => {
    if (gameState !== 'playing') return;
    const result = getHint(board, rows, cols);
    if (result) {
      setHint(result);
      const involvedArray = Array.from(result.involved);
      let avgR = 0, avgC = 0;
      involvedArray.forEach(pos => {
        const [r, c] = pos.split(',').map(Number);
        avgR += r; avgC += c;
      });
      avgR /= involvedArray.length;
      avgC /= involvedArray.length;

      const targetX = -(avgC * 34 + 16 - (cols * 34) / 2) * scale;
      const targetY = -(avgR * 34 + 16 - (rows * 34) / 2) * scale;
      
      setIsAnimating(true);
      setOffset({ x: targetX, y: targetY });
      setTimeout(() => setHint(prev => prev === result ? null : prev), 4000);
    }
  };

  const getDistance = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    setIsAnimating(false);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.current.size === 1) {
      isDragging.current = true;
      hasMoved.current = false;
      dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
      const cellData = (e.target as HTMLElement).dataset;
      if (cellData.r && cellData.c) {
        const r = parseInt(cellData.r);
        const c = parseInt(cellData.c);
        longPressTimer.current = window.setTimeout(() => {
          if (!hasMoved.current) {
             handleFlag(r, c);
             if (window.navigator.vibrate) window.navigator.vibrate(50);
             longPressTimer.current = null;
          }
        }, 500);
      }
    } else if (activePointers.current.size === 2) {
      isDragging.current = false;
      if (longPressTimer.current) {
        window.clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      const pts = Array.from(activePointers.current.values());
      initialDistance.current = getDistance(pts[0], pts[1]);
      initialScale.current = scale;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.current.size === 1 && isDragging.current) {
      const dx = Math.abs(e.clientX - (dragStart.current.x + offset.x));
      const dy = Math.abs(e.clientY - (dragStart.current.y + offset.y));
      if (dx > 5 || dy > 5) {
        hasMoved.current = true;
        if (longPressTimer.current) {
          window.clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
      }
    } else if (activePointers.current.size === 2 && initialDistance.current !== null) {
      const pts = Array.from(activePointers.current.values());
      const currentDist = getDistance(pts[0], pts[1]);
      const newScale = (currentDist / initialDistance.current) * initialScale.current;
      setScale(Math.max(0.5, Math.min(3, newScale)));
      hasMoved.current = true;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasMultiTouch = activePointers.current.size >= 2;
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) initialDistance.current = null;
    if (activePointers.current.size === 0) {
      isDragging.current = false;
      if (longPressTimer.current) {
        window.clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      if (!hasMoved.current && !wasMultiTouch && e.button === 0) {
        const cellData = (e.target as HTMLElement).dataset;
        if (cellData.r && cellData.c) handleCellClickLogic(parseInt(cellData.r), parseInt(cellData.c));
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    setIsAnimating(false);
    const zoomSpeed = 0.001;
    const newScale = scale - e.deltaY * zoomSpeed;
    setScale(Math.max(0.5, Math.min(3, newScale)));
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const cellData = (e.target as HTMLElement).dataset;
    if (cellData.r && cellData.c) handleFlag(parseInt(cellData.r), parseInt(cellData.c));
  };

  return (
    <div className="minesweeper-app" 
         onPointerDown={onPointerDown} 
         onPointerMove={onPointerMove} 
         onPointerUp={onPointerUp}
         onWheel={handleWheel}
         onContextMenu={handleContextMenu}>
      
      <div className="status-bar" onPointerDown={e => e.stopPropagation()}>
        <div className="status-left">
          <div className="version-tag">无猜扫雷Ver.0.1.0</div>
          <div className="stat-box">🚩 {minesLeft}</div>
          <div className="stat-box">⏱️ {time}</div>
        </div>
        <div className="status-center">
          <button className="reset-btn" onClick={initGame}>
            {gameState === 'won' ? '😎' : gameState === 'lost' ? '😵' : '😊'}
          </button>
        </div>
        <div className="status-right">
          <button 
            className={`hint-btn ${gameState !== 'playing' ? 'disabled' : ''}`} 
            onClick={handleHintClick}
            title="显示提示"
          >
            💡
          </button>
          <select className="diff-select" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            {Object.entries(DIFFICULTIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {difficulty === 'custom' && (
            <div className="custom-inputs-mini" onPointerDown={e => e.stopPropagation()}>
              <div className="input-group">
                <span className="input-label">行</span>
                <input 
                  type="number" 
                  value={inputRows} 
                  onChange={(e) => setInputRows(e.target.value)} 
                  onBlur={validateAndCommit}
                  onKeyDown={handleKeyDown}
                  title="行数 (5-50)" 
                />
              </div>
              <div className="input-group">
                <span className="input-label">列</span>
                <input 
                  type="number" 
                  value={inputCols} 
                  onChange={(e) => setInputCols(e.target.value)} 
                  onBlur={validateAndCommit}
                  onKeyDown={handleKeyDown}
                  title="列数 (5-50)" 
                />
              </div>
              <div className="input-group">
                <span className="input-label">雷</span>
                <input 
                  type="number" 
                  value={inputMines} 
                  onChange={(e) => setInputMines(e.target.value)} 
                  onBlur={validateAndCommit}
                  onKeyDown={handleKeyDown}
                  title="雷数 (最大 50%)" 
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div 
        className="board-container" 
        style={{ 
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: isAnimating ? 'transform 0.5s cubic-bezier(0.2, 0, 0.2, 1)' : 'none' 
        }}
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 32px)` }}>
          {board.map((row, r) => row.map((cell, c) => (
            <div
              key={`${r}-${c}`}
              data-r={r}
              data-c={c}
              className={`cell ${cell.status} ${cell.status === 'revealed' ? `val-${cell.neighborMines}` : ''} ${cell.isMine && cell.status === 'revealed' ? 'mine' : ''} ${shakingCell?.r === r && shakingCell?.c === c ? 'shake' : ''} ${hint?.involved.has(`${r},${c}`) ? (hint.type === 'error' ? 'highlight-error' : 'highlight-hint') : ''}`}
            >
              {cell.status === 'flagged' && '🚩'}
              {cell.status === 'revealed' && cell.isMine && '💣'}
              {cell.status === 'revealed' && !cell.isMine && cell.neighborMines > 0 && cell.neighborMines}
            </div>
          )))}
        </div>
      </div>
      <div className="mobile-tip">💡 双指缩放 | 右键或长按插旗</div>
    </div>
  );
}
