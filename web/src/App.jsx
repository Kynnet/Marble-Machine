import { useCallback, useEffect, useRef, useState } from 'react';
import Board from './Board.jsx';
import { api } from './api.js';
import { synth } from './audio.js';
import { KINDS, PENTATONIC, demoBoard, newObstacleId } from './engine.js';

const NoteSelect = ({ value, onChange }) => (
  <select value={value} onChange={(event) => onChange(event.target.value)}>
    {PENTATONIC.map((note) => (
      <option key={note}>{note}</option>
    ))}
  </select>
);

function AuthPanel({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const login = mode === 'login';

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const { user } = await (login ? api.login : api.register)(form.username, form.password);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit}>
        <h1 className="auth__title">Marble Machine</h1>
        <p className="auth__blurb">Drop a marble, let it play your board.</p>
        {['username', 'password'].map((field) => (
          <label className="field" key={field}>
            <span>{field === 'username' ? 'Username' : 'Password'}</span>
            <input
              type={field === 'password' ? 'password' : 'text'}
              value={form[field]}
              autoComplete={field === 'username' ? 'username' : login ? 'current-password' : 'new-password'}
              onChange={(event) => setForm({ ...form, [field]: event.target.value })}
            />
          </label>
        ))}
        {error && <p className="auth__error">{error}</p>}
        <button className="btn btn--primary" type="submit">{login ? 'Sign in' : 'Create account'}</button>
        <button className="btn btn--link" type="button" onClick={() => { setMode(login ? 'register' : 'login'); setError(''); }}>
          {login ? 'Need an account? Register' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [obstacles, setObstacles] = useState(demoBoard);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('plank');
  const [note, setNote] = useState('C4');
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [boards, setBoards] = useState([]);
  const [boardName, setBoardName] = useState('My machine');
  const [status, setStatus] = useState('');
  const boardRef = useRef(null);

  const selected = obstacles.find((o) => o.id === selectedId) ?? null;

  useEffect(() => {
    api.me().then(({ user: current }) => setUser(current)).catch(() => setUser(null));
  }, []);

  const refreshBoards = useCallback(() => {
    api.listBoards().then(({ boards: list }) => setBoards(list)).catch(() => setBoards([]));
  }, []);

  useEffect(() => {
    if (user) refreshBoards();
  }, [user, refreshBoards]);

  // Start from a clean board whenever the signed-in user changes. Without this
  // the previous user's layout stays on the canvas after a logout, and the next
  // person to hit Save would write it into their own account.
  useEffect(() => {
    setObstacles(demoBoard());
    setBoardName('My machine');
    setSelectedId(null);
    boardRef.current?.reset();
  }, [user?.id]);

  const flash = (message) => {
    setStatus(message);
    setTimeout(() => setStatus(''), 2500);
  };

  const patch = useCallback((id, changes) => {
    setObstacles((list) => list.map((o) => (o.id === id ? { ...o, ...changes } : o)));
  }, []);

  const place = useCallback(
    (kind, x, y) => {
      const created = { id: newObstacleId(), kind, x, y, angle: 0, note };
      setObstacles((list) => [...list, created]);
      setSelectedId(created.id);
    },
    [note],
  );

  const remove = (id) => {
    setObstacles((list) => list.filter((o) => o.id !== id));
    setSelectedId(null);
  };

  // Keyboard nudges for orientation, so a board can be tuned without a mouse.
  useEffect(() => {
    const onKey = (event) => {
      if (!selectedId || event.target.matches('input, select, textarea')) return;
      const step = event.shiftKey ? 0.02 : 0.09;
      if (event.key === '[' || event.key === 'ArrowLeft') patch(selectedId, { angle: (selected?.angle ?? 0) - step });
      else if (event.key === ']' || event.key === 'ArrowRight') patch(selectedId, { angle: (selected?.angle ?? 0) + step });
      else if (event.key === 'Backspace' || event.key === 'Delete') remove(selectedId);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, selected, patch]);

  const drop = async () => {
    await synth.unlock();
    setPlaying(true);
    boardRef.current.drop();
  };

  const save = async () => {
    try {
      await api.saveBoard(boardName, { obstacles });
      refreshBoards();
      flash(`Saved “${boardName}”.`);
    } catch (err) {
      flash(err.message);
    }
  };

  const load = async (id, name) => {
    const { board } = await api.loadBoard(id);
    setObstacles(board.data.obstacles);
    setBoardName(name);
    setSelectedId(null);
    boardRef.current.reset();
    flash(`Loaded “${name}”.`);
  };

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (user === null) return <AuthPanel onSignedIn={setUser} />;

  return (
    <div className="app" onPointerDown={() => synth.unlock()}>
      <header className="topbar">
        <h1 className="topbar__title">Marble Machine</h1>
        <div className="topbar__spacer" />
        <span className="topbar__user">{user.username}</span>
        <button className="btn" onClick={() => api.logout().then(() => setUser(null))}>Log out</button>
      </header>

      <main className="layout">
        <Board
          ref={boardRef}
          obstacles={obstacles}
          tool={tool}
          selectedId={selectedId}
          playing={playing}
          onSelect={setSelectedId}
          onPlace={place}
          onCommit={patch}
        />

        <aside className="panel">
          <section className="panel__block">
            <h2>Transport</h2>
            <div className="row">
              <button className="btn btn--primary" onClick={drop}>Drop marble</button>
              <button className="btn" onClick={() => boardRef.current.reset()}>Clear</button>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause' : 'Play'}</button>
              <button className="btn" onClick={() => { synth.setMuted(!muted); setMuted(!muted); }}>
                {muted ? 'Unmute' : 'Mute'}
              </button>
            </div>
          </section>

          <section className="panel__block">
            <h2>Place</h2>
            <div className="row">
              {Object.entries(KINDS).map(([kind, spec]) => (
                <button
                  key={kind}
                  className={`btn btn--tool ${tool === kind ? 'is-active' : ''}`}
                  style={{ borderColor: spec.color }}
                  onClick={() => setTool(kind)}
                >
                  {spec.label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Note for new pieces</span>
              <NoteSelect value={note} onChange={setNote} />
            </label>
            <p className="hint">Click empty space to place. Drag a piece to move it, or grab its yellow handle to rotate.</p>
          </section>

          <section className="panel__block">
            <h2>Selected</h2>
            {selected ? (
              <>
                <label className="field">
                  <span>Note</span>
                  <NoteSelect value={selected.note} onChange={(value) => patch(selected.id, { note: value })} />
                </label>
                <label className="field">
                  <span>Rotation {Math.round((selected.angle * 180) / Math.PI)}°</span>
                  <input
                    type="range"
                    min={-Math.PI}
                    max={Math.PI}
                    step={0.01}
                    value={selected.angle}
                    onChange={(event) => patch(selected.id, { angle: Number(event.target.value) })}
                  />
                </label>
                <button className="btn btn--danger" onClick={() => remove(selected.id)}>Delete piece</button>
              </>
            ) : (
              <p className="hint">Nothing selected.</p>
            )}
          </section>

          <section className="panel__block">
            <h2>Boards</h2>
            <div className="row">
              <input value={boardName} onChange={(event) => setBoardName(event.target.value)} />
              <button className="btn btn--primary" onClick={save}>Save</button>
            </div>
            <ul className="boards">
              {boards.map((board) => (
                <li key={board.id} className="boards__item">
                  <button className="btn btn--link" onClick={() => load(board.id, board.name)}>{board.name}</button>
                  <button
                    className="btn btn--icon"
                    title="Delete board"
                    onClick={() => api.deleteBoard(board.id).then(refreshBoards)}
                  >
                    ×
                  </button>
                </li>
              ))}
              {boards.length === 0 && <li className="hint">No saved boards yet.</li>}
            </ul>
          </section>
        </aside>
      </main>

      {status && <div className="toast">{status}</div>}
    </div>
  );
}
