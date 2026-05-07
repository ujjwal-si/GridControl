import { useEffect, useRef, useState } from 'react';
import { Application, Graphics, Container, Rectangle, Assets, Sprite } from 'pixi.js';
import './App.css';

const GRID_COLS = 160;
const GRID_ROWS = 90;
const TOP_BAR_HEIGHT = 50;
const SIDEBAR_WIDTH = 280;
const USER_COOLDOWN_MS = 3000; 
const PIXEL_LOCK_MS = 60000; 
// Automatically use 'ws://localhost:3000' for local dev, and 'wss://your-render-url.com' for production
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.host;
const SOCKET_URL = `${protocol}//${host}`;

const THEMES = {
  obsidian: {
    name: 'Obsidian',
    pixi: { bg: 0x000000, gridLines: 0x111111, hoverFront: 0xffffff, rippleFade: 0xffffff, lockedHover: 0xff3333, mapAlpha: 0.15 },
    css: { '--app-bg': '#000000', '--panel-bg': 'rgba(10, 10, 10, 0.85)', '--border': 'rgba(255, 255, 255, 0.08)', '--text-main': '#EDEDED', '--text-muted': '#888888', '--accent': '#FFFFFF', '--status-green': '#00ff9d' },
  },
  vesper: {
    name: 'Vesper',
    pixi: { bg: 0x07090f, gridLines: 0x141824, hoverFront: 0x4d88ff, rippleFade: 0x4d88ff, lockedHover: 0xff3366, mapAlpha: 0.25 },
    css: { '--app-bg': '#030407', '--panel-bg': 'rgba(11, 14, 23, 0.85)', '--border': 'rgba(77, 136, 255, 0.15)', '--text-main': '#E2E8F0', '--text-muted': '#64748B', '--accent': '#4D88FF', '--status-green': '#00ff9d' },
  },
  cyber: {
    name: 'Cyber',
    pixi: { bg: 0x06020a, gridLines: 0x1a0b2e, hoverFront: 0x00ffff, rippleFade: 0xff00ff, lockedHover: 0xff0055, mapAlpha: 0.3 },
    css: { '--app-bg': '#040108', '--panel-bg': 'rgba(15, 5, 25, 0.85)', '--border': 'rgba(0, 255, 255, 0.2)', '--text-main': '#E0D8F0', '--text-muted': '#8870A0', '--accent': '#00FFFF', '--status-green': '#00ff9d' },
  }
};

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function colorStringToNumber(hex) { return parseInt(hex.replace('#', ''), 16) || 0xffffff; }
function numberToHexString(num) { return '#' + num.toString(16).padStart(6, '0'); }

function getContrastColor(colorNum) {
  const r = (colorNum >> 16) & 0xff;
  const g = (colorNum >> 8) & 0xff;
  const b = colorNum & 0xff;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 150 ? 0x000000 : 0xffffff;
}

function getRankIcon(rank) {
  if (rank === 1) return '🏆';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  if (rank <= 5) return '🏅';
  return '🎖️';
}

const CooldownPie = ({ cooldownEnd }) => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf;
    const update = () => {
      const now = Date.now();
      const remaining = cooldownEnd - now;
      if (remaining <= 0) { setProgress(0); } 
      else { setProgress(remaining / USER_COOLDOWN_MS); raf = requestAnimationFrame(update); }
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [cooldownEnd]);

  if (progress <= 0) return <span className="status-badge ready anim-fade-in">Ready</span>;

  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="cooldown-wrapper anim-fade-in">
      <span className="status-badge cooldown">Wait</span>
      <svg width="20" height="20" viewBox="0 0 24 24" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="12" cy="12" r={radius} fill="transparent" stroke="var(--border)" strokeWidth="3" />
        <circle cx="12" cy="12" r={radius} fill="transparent" stroke="var(--accent)" strokeWidth="3" strokeDasharray={circumference} strokeDashoffset={circumference * progress} strokeLinecap="round" />
      </svg>
    </div>
  );
};

export default function App() {
  const canvasRef = useRef(null);
  const pixiAppRef = useRef(null);
  const socketRef = useRef(null);
  const tooltipRef = useRef(null);
  const mapDataRef = useRef(new Map());
  const renderBlocksRef = useRef(() => {});

  const [activeThemeKey, setActiveThemeKey] = useState('obsidian');
  const [myScore, setMyScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [clientId] = useState(() => {
    let id = localStorage.getItem('canvas_client_id');
    if (!id) { id = 'client_' + Math.random().toString(36).substr(2, 9); localStorage.setItem('canvas_client_id', id); }
    return id;
  });

  const [myUsername, setMyUsername] = useState(() => localStorage.getItem('canvas_username') || 'Guest_' + Math.floor(Math.random() * 9999));
  const [myColor, setMyColor] = useState(() => localStorage.getItem('canvas_color') || '#ffffff');
  const [connectionState, setConnectionState] = useState('connecting');
  const [cooldownEnd, setCooldownEnd] = useState(0);

  const clientIdRef = useRef(clientId);
  const myUsernameRef = useRef(myUsername);
  const myColorRef = useRef(myColor);
  const myCooldownRef = useRef(0);
  const activeThemeRef = useRef(THEMES[activeThemeKey]);

  useEffect(() => { myUsernameRef.current = myUsername; localStorage.setItem('canvas_username', myUsername); }, [myUsername]);
  useEffect(() => { myColorRef.current = myColor; localStorage.setItem('canvas_color', myColor); }, [myColor]);
  useEffect(() => { activeThemeRef.current = THEMES[activeThemeKey]; }, [activeThemeKey]);

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(activeThemeRef.current.css).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [activeThemeKey]);

  const updateScores = () => {
    const stats = new Map();
    mapDataRef.current.forEach((cell) => {
      if (!stats.has(cell.clientId)) { stats.set(cell.clientId, { score: 0, color: typeof cell.color === 'number' ? numberToHexString(cell.color) : cell.color, username: cell.username }); }
      stats.get(cell.clientId).score += 1;
    });
    const sorted = Array.from(stats.entries()).map(([cId, data]) => ({ id: cId === clientIdRef.current ? 'me' : cId, name: data.username, score: data.score, color: data.color })).sort((a, b) => b.score - a.score);
    setLeaderboard(sorted);
    const me = sorted.find(u => u.id === 'me');
    setMyScore(me ? me.score : 0);
  };

  const updateScoresRef = useRef(updateScores);
  useEffect(() => { updateScoresRef.current = updateScores; });

  useEffect(() => {
    const ws = new WebSocket(SOCKET_URL);
    socketRef.current = ws;
    ws.onopen = () => setConnectionState('connected');
    ws.onclose = () => setConnectionState('disconnected');
    ws.onerror = () => setConnectionState('offline');
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'init' && msg.data) {
          const nextMap = new Map();
          for (const [key, cell] of Object.entries(msg.data)) {
            const [x, y] = key.split(',').map(Number);
            nextMap.set(key, { x, y, color: typeof cell.color === 'string' ? colorStringToNumber(cell.color) : cell.color, clientId: cell.clientId, username: cell.username, lockedUntil: cell.lockedUntil });
          }
          mapDataRef.current = nextMap;
          renderBlocksRef.current();
          updateScoresRef.current(); 
        } else if (msg.type === 'pixel') {
          const key = `${msg.x},${msg.y}`;
          if (msg.action === 'unown') mapDataRef.current.delete(key);
          else mapDataRef.current.set(key, { x: msg.x, y: msg.y, color: msg.color, clientId: msg.clientId, username: msg.username, lockedUntil: msg.lockedUntil });
          renderBlocksRef.current();
          updateScoresRef.current();
        } else if (msg.type === 'purge_user') {
          for (const [key, cell] of mapDataRef.current.entries()) { if (cell.clientId === msg.clientId) mapDataRef.current.delete(key); }
          renderBlocksRef.current();
          updateScoresRef.current();
        } else if (msg.type === 'rename') {
          mapDataRef.current.forEach((cell) => { if (cell.clientId === msg.clientId) cell.username = msg.username; });
          renderBlocksRef.current();
          updateScoresRef.current();
        }
      } catch (err) {}
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (connectionState === 'connected' && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "identify", clientId, username: myUsername }));
      }
    }, 500); 
    return () => clearTimeout(timer);
  }, [connectionState, myUsername, clientId]);

  useEffect(() => {
    let isMounted = true;
    const calculateCellSize = () => clamp(Math.floor(Math.min((window.innerWidth - SIDEBAR_WIDTH - 32) / GRID_COLS, (window.innerHeight - TOP_BAR_HEIGHT - 32) / GRID_ROWS) * 0.95), 4, 32);

    const initPixi = async () => {
      const cellSize = calculateCellSize();
      const canvasWidth = window.innerWidth - SIDEBAR_WIDTH;
      const canvasHeight = window.innerHeight - TOP_BAR_HEIGHT;
      const app = new Application();
      await app.init({ width: canvasWidth, height: canvasHeight, background: activeThemeRef.current.pixi.bg, antialias: false, resolution: window.devicePixelRatio || 1 });

      if (!isMounted) return;
      pixiAppRef.current = app;
      if (canvasRef.current) { canvasRef.current.innerHTML = ''; canvasRef.current.appendChild(app.canvas); }

      const worldContainer = new Container();
      app.stage.addChild(worldContainer);

      // --- DEFAULT CENTER LOGIC ---
      const gridWidth = GRID_COLS * cellSize;
      const gridHeight = GRID_ROWS * cellSize;
      worldContainer.x = (canvasWidth - gridWidth) / 2;
      worldContainer.y = (canvasHeight - gridHeight) / 2;

      try {
        const texture = await Assets.load('https://upload.wikimedia.org/wikipedia/commons/8/80/World_map_-_low_resolution.svg');
        const mapSprite = new Sprite(texture);
        mapSprite.width = gridWidth; mapSprite.height = gridHeight;
        mapSprite.alpha = activeThemeRef.current.pixi.mapAlpha; mapSprite.tint = activeThemeRef.current.pixi.gridLines; 
        worldContainer.addChild(mapSprite);
      } catch (e) {}

      const gridG = new Graphics();
      const blocksG = new Graphics();
      const fxG = new Graphics();
      worldContainer.addChild(gridG, blocksG, fxG);

      const drawGrid = () => {
        gridG.clear();
        gridG.setStrokeStyle({ width: 1, color: activeThemeRef.current.pixi.gridLines, alpha: 1 });
        for (let x = 0; x <= GRID_COLS; x++) { gridG.moveTo(x * cellSize, 0); gridG.lineTo(x * cellSize, gridHeight); }
        for (let y = 0; y <= GRID_ROWS; y++) { gridG.moveTo(0, y * cellSize); gridG.lineTo(gridWidth, y * cellSize); }
        gridG.stroke();
      };

      const renderBlocks = () => {
        blocksG.clear();
        const now = Date.now();
        mapDataRef.current.forEach((cell) => {
          blocksG.rect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize).fill({ color: cell.color, alpha: 1 });
          if (cell.lockedUntil <= now) {
            const dot = Math.max(2, cellSize * 0.03); 
            blocksG.rect(cell.x * cellSize + (cellSize/2 - dot/2), cell.y * cellSize + (cellSize/2 - dot/2), dot, dot).fill({ color: getContrastColor(cell.color), alpha: 0.85 }); 
          }
        });
      };

      renderBlocksRef.current = renderBlocks;
      drawGrid(); renderBlocks();
      const refreshInterval = setInterval(() => renderBlocks(), 1000);

      const dragData = { isDragging: false, startX: 0, startY: 0, moved: false };
      const ripples = []; const flickers = []; let hoverX = -1, hoverY = -1;

      app.stage.eventMode = 'static';
      app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);

      const handleWheel = (e) => {
        e.preventDefault();
        const scaleChange = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newScale = clamp(worldContainer.scale.x * scaleChange, 0.2, 8);
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
        const worldX = (mouseX - worldContainer.x) / worldContainer.scale.x;
        const worldY = (mouseY - worldContainer.y) / worldContainer.scale.y;
        worldContainer.scale.set(newScale);
        worldContainer.x = mouseX - worldX * newScale; worldContainer.y = mouseY - worldY * newScale;
      };
      canvasRef.current.addEventListener('wheel', handleWheel, { passive: false });

      app.stage.on('pointerdown', (e) => { dragData.isDragging = true; dragData.startX = e.global.x - worldContainer.x; dragData.startY = e.global.y - worldContainer.y; dragData.moved = false; });
      app.stage.on('pointermove', (e) => { 
        if (dragData.isDragging) {
           const newX = e.global.x - dragData.startX, newY = e.global.y - dragData.startY;
           if (Math.abs(worldContainer.x - newX) > 2 || Math.abs(worldContainer.y - newY) > 2) dragData.moved = true;
           worldContainer.position.set(newX, newY);
        }
        const local = worldContainer.toLocal(e.global); hoverX = Math.floor(local.x / cellSize); hoverY = Math.floor(local.y / cellSize); 
        if (tooltipRef.current && !dragData.moved) {
          const cell = mapDataRef.current.get(`${hoverX},${hoverY}`);
          if (cell) {
            tooltipRef.current.style.display = 'block';
            tooltipRef.current.innerHTML = `<strong>${cell.username}</strong> ${cell.lockedUntil > Date.now() ? '🔒' : '🔓'}`;
            tooltipRef.current.style.left = `${e.nativeEvent.clientX + 15}px`; tooltipRef.current.style.top = `${e.nativeEvent.clientY + 15}px`;
          } else { tooltipRef.current.style.display = 'none'; }
        } else if (tooltipRef.current) { tooltipRef.current.style.display = 'none'; }
      });
      app.stage.on('pointerupoutside', () => dragData.isDragging = false);
      app.stage.on('pointerup', (e) => {
        dragData.isDragging = false;
        if (dragData.moved) return;
        const local = worldContainer.toLocal(e.global);
        const x = Math.floor(local.x / cellSize), y = Math.floor(local.y / cellSize);
        if (x < 0 || x >= GRID_COLS || y < 0 || y >= GRID_ROWS) return;
        const now = Date.now(), key = `${x},${y}`, cell = mapDataRef.current.get(key), colorVal = colorStringToNumber(myColorRef.current);
        if (cell && cell.clientId === clientIdRef.current && cell.color === colorVal) {
          mapDataRef.current.delete(key); renderBlocks(); updateScoresRef.current(); 
          if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "pixel", action: "unown", x, y, clientId: clientIdRef.current, username: myUsernameRef.current }));
          return;
        }
        if (now < myCooldownRef.current) { flickers.push({ x, y, start: now }); return; }
        if (cell && cell.clientId !== clientIdRef.current && cell.lockedUntil > now) { flickers.push({ x, y, start: now }); return; }
        const lockedUntil = now + PIXEL_LOCK_MS;
        mapDataRef.current.set(key, { x, y, color: colorVal, clientId: clientIdRef.current, username: myUsernameRef.current, lockedUntil });
        renderBlocks(); updateScoresRef.current(); ripples.push({ cx: x, cy: y, alpha: 1 });
        myCooldownRef.current = now + USER_COOLDOWN_MS; setCooldownEnd(myCooldownRef.current);
        if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "pixel", action: "place", x, y, color: colorVal, clientId: clientIdRef.current, username: myUsernameRef.current }));
      });

      app.ticker.add(() => {
        fxG.clear();
        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i]; r.alpha -= 0.1;
          if (r.alpha <= 0) { ripples.splice(i, 1); continue; }
          const spread = 2; 
          for (let dx = -spread; dx <= spread; dx++) {
            for (let dy = -spread; dy <= spread; dy++) {
              if (Math.abs(dx) === spread || Math.abs(dy) === spread) {
                const nx = r.cx + dx, ny = r.cy + dy;
                if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) fxG.rect(nx * cellSize, ny * cellSize, cellSize, cellSize).fill({ color: activeThemeRef.current.pixi.rippleFade, alpha: r.alpha * 0.5 });
              }
            }
          }
        }
        const now = Date.now();
        for (let i = flickers.length - 1; i >= 0; i--) {
          const f = flickers[i]; const elapsed = now - f.start;
          if (elapsed > 400) { flickers.splice(i, 1); continue; }
          if (Math.floor(elapsed / 50) % 2 === 0) fxG.rect(f.x * cellSize, f.y * cellSize, cellSize, cellSize).stroke({ width: 3, color: activeThemeRef.current.pixi.lockedHover, alpha: 1, alignment: 1 });
        }
        if (hoverX >= 0 && hoverX < GRID_COLS && hoverY >= 0 && hoverY < GRID_ROWS) {
          const hCell = mapDataRef.current.get(`${hoverX},${hoverY}`);
          fxG.rect(hoverX * cellSize, hoverY * cellSize, cellSize, cellSize).stroke({ width: 2, color: hCell && hCell.clientId !== clientIdRef.current && hCell.lockedUntil > now ? activeThemeRef.current.pixi.lockedHover : activeThemeRef.current.pixi.hoverFront, alpha: 0.8, alignment: 1 });
        }
      });
      return () => { clearInterval(refreshInterval); canvasRef.current?.removeEventListener('wheel', handleWheel); };
    };
    initPixi();
    const handleResize = () => window.location.reload();
    window.addEventListener('resize', handleResize);
    return () => { isMounted = false; window.removeEventListener('resize', handleResize); if (pixiAppRef.current) pixiAppRef.current.destroy(true, { children: true }); };
  }, [activeThemeKey]);

  const top5 = leaderboard.slice(0, 5);
  const myRankIndex = leaderboard.findIndex(u => u.id === 'me');
  const myRank = myRankIndex !== -1 ? myRankIndex + 1 : leaderboard.length + 1;
  const targetScore = top5.length === 5 ? top5[4].score : 1;
  const pointsToTop5 = Math.max(0, targetScore - myScore + 1);

  return (
    <div className="app-root">
      <div ref={tooltipRef} className="floating-tooltip" />
      <header className="top-nav">
        <div className="nav-brand anim-slide-down">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--accent)"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm15 0h-2v3h-3v2h3v3h2v-3h3v-2h-3z" /></svg>
          <span>Grid<span className="dim">_Control</span></span>
        </div>
        <div className="nav-status anim-slide-down">
          <span className={`status-dot ${connectionState === 'connected' ? 'dot-online' : 'dot-offline'}`} />
          {connectionState === 'connected' ? 'Connected to SERVER' : connectionState === 'connecting' ? 'Connecting...' : 'SERVER Offline'}
        </div>
      </header>

      <div className="workspace">
        <aside className="tool-panel anim-slide-right">
          <div className="panel-group">
            <div className="group-header">
              <span className="group-label">Identity</span>
              <CooldownPie cooldownEnd={cooldownEnd} /> 
            </div>
            <div className="identity-card">
              <div className="palette-btn-wrapper">
                <input type="color" value={myColor} onChange={(e) => setMyColor(e.target.value)} />
                <div className="palette-icon">🎨</div>
                <div className="swatch-mini" style={{ backgroundColor: myColor }} />
              </div>
              <input type="text" className="sleek-input" value={myUsername} onChange={(e) => setMyUsername(e.target.value)} maxLength={14} spellCheck="false" />
            </div>
          </div>

          <div className="panel-group">
            <span className="group-label">Theme</span>
            <div className="theme-pills">
              {Object.keys(THEMES).map((key) => (<button key={key} className={`pill ${activeThemeKey === key ? 'active' : ''}`} onClick={() => setActiveThemeKey(key)}>{THEMES[key].name}</button>))}
            </div>
          </div>

          <div className="panel-group flex-fill">
            <div className="group-header">
              <span className="group-label">Global Leaderboard</span>
              <span className="points-to-goal">{myRank > 5 ? `${pointsToTop5} pts to Top 5` : 'TOP 5'}</span>
            </div>
            <div className="leaderboard-container">
              {top5.map((user, idx) => (
                <div key={user.id} className={`lb-row ${user.id === 'me' ? 'is-me' : ''}`} style={{animationDelay: `${idx * 0.05}s`}}>
                  <div className="rank-unit">
                    <span className="rank-num">{idx + 1}</span>
                    <span className="rank-medal">{getRankIcon(idx + 1)}</span>
                  </div>
                  <div className="lb-main">
                    <span className="lb-name-txt">{user.name}</span>
                    <span className="lb-stat-txt">{user.score * 100} km²</span>
                  </div>
                  <div className="lb-points">{user.score}</div>
                </div>
              ))}
              {myRank > 5 && (
                <>
                  <div className="lb-divider">•••</div>
                  <div className="lb-row is-me anim-pop-in">
                    <div className="rank-unit">
                      <span className="rank-num">{myRank}</span>
                      <span className="rank-medal">{getRankIcon(myRank)}</span>
                    </div>
                    <div className="lb-main">
                      <span className="lb-name-txt">{myUsername}</span>
                      <span className="lb-stat-txt">{myScore * 100} km²</span>
                    </div>
                    <div className="lb-points">{myScore}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>
        <main className="canvas-stage"><div className="canvas-wrapper"><div ref={canvasRef} className="pixi-mount" /></div></main>
      </div>
    </div>
  );
}