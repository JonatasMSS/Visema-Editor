import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {keptDuration, removeTranscriptForRange} from './editor.js';
import Timeline from './Timeline.jsx';
import {
  DEFAULT_FPS,
  createSegments,
  deleteLeftRange,
  deleteRightRange,
  formatTimecode,
  frameToTime,
  playableFrame,
  removeFrames,
  segmentAt,
  splitAt,
  toTimeRanges,
} from './timeline.js';
import {useFramePlayer} from './useFramePlayer.js';

const formatTime = (seconds = 0) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${(safe % 60).toFixed(2).padStart(5, '0')}`;
};

const LABELS_MISSING = ' O segmento não consta em nenhum CSV de labels; confira com “npm run labels -- --check”.';

async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'A operação falhou.');
  return body;
}

function Icon({children}) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function EmptyEditor() {
  return <main className="empty-state">
    <div className="empty-mark">V</div>
    <h2>Selecione um segmento</h2>
    <p>Escolha um clipe na biblioteca para editar vídeo, áudio e transcrição juntos.</p>
  </main>;
}

const STATUS_FILTERS = [
  {id: 'pending', label: 'Pendentes'},
  {id: 'done', label: 'Concluídos'},
  {id: 'all', label: 'Todos'},
];

// O filtro escolhido é só uma conveniência local; sem armazenamento, volta a "Pendentes".
const storedStatus = () => {
  try {
    const value = localStorage.getItem('visema:status-filter');
    return STATUS_FILTERS.some((filter) => filter.id === value) ? value : 'pending';
  } catch { return 'pending'; }
};

function App() {
  const [library, setLibrary] = useState({items: [], page: 1, pages: 1, total: 0, doneCount: 0, clipCount: 0});
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(storedStatus);
  const [marking, setMarking] = useState(false);
  const [selected, setSelected] = useState(null);
  const [clip, setClip] = useState(null);
  const [text, setText] = useState('');
  const [segments, setSegments] = useState([]);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [selection, setSelection] = useState({start: 0, end: 0});
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [volume, setVolume] = useState(0.85);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [revision, setRevision] = useState(0);
  const [videoElement, setVideoElement] = useState(null);
  const [audioElement, setAudioElement] = useState(null);
  const shortcuts = useRef(null);

  const loadLibrary = useCallback(async (page = 1, term = search, status = statusFilter) => {
    try {
      const data = await api(`/api/clips?page=${page}&limit=48&status=${status}&query=${encodeURIComponent(term)}`);
      // A página pode deixar de existir quando um item sai do filtro (ex.: concluído em "Pendentes").
      if (!data.items.length && page > data.pages) return loadLibrary(data.pages, term, status);
      setLibrary(data);
      if (!selected && data.items[0]) setSelected(data.items[0].id);
    } catch (error) { setNotice({type: 'error', text: error.message}); }
  }, [search, selected, statusFilter]);

  const changeStatusFilter = (status) => {
    setStatusFilter(status);
    try { localStorage.setItem('visema:status-filter', status); } catch { /* sem armazenamento local */ }
    loadLibrary(1, search, status);
  };

  useEffect(() => { loadLibrary(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setLoading(true);
    api(`/api/clips/${selected}`).then((data) => {
      if (!active) return;
      const fps = data.fps || DEFAULT_FPS;
      const frames = data.frames || Math.round(data.duration * fps);
      setClip({...data, fps, frames});
      setText(data.text);
      setSegments(createSegments(frames));
      setSelectedSegment(null);
      setSelection({start: 0, end: frames});
      setHistory([]);
      setFuture([]);
      setDirty(false);
      setLoading(false);
    }).catch((error) => {
      if (active) { setNotice({type: 'error', text: error.message}); setLoading(false); }
    });
    return () => { active = false; };
  }, [selected, revision]);

  useEffect(() => {
    if (audioElement) audioElement.volume = volume;
  }, [audioElement, volume]);

  const fps = clip?.fps || DEFAULT_FPS;
  const totalFrames = clip?.frames || 0;
  const duration = frameToTime(totalFrames, fps);
  const ranges = useMemo(() => toTimeRanges(segments, fps), [segments, fps]);
  const resultDuration = keptDuration(ranges);
  const removedDuration = Math.max(0, duration - resultDuration);
  const wordCount = useMemo(() => text.trim() ? text.trim().split(/\s+/u).length : 0, [text]);
  const showError = useCallback((message) => setNotice({type: 'error', text: message}), []);
  const {
    currentFrame, presentedFrame, playing, frameLocked, seekToFrame, stepFrames, pause, togglePlay,
  } = useFramePlayer({video: videoElement, audio: audioElement, fps, totalFrames, segments, onError: showError});

  const checkpoint = () => {
    setHistory((items) => [...items, {text, segments}].slice(-20));
    setFuture([]);
  };

  // Toda remoção passa por aqui: corta os quadros e as palavras proporcionais daquele trecho.
  const removeFrameRange = (start, end) => {
    if (end <= start) return null;
    const next = removeFrames(segments, start, end);
    if (!next.length) {
      setNotice({type: 'error', text: 'Para remover tudo, use “Excluir clipe”.'});
      return null;
    }
    checkpoint();
    setText(removeTranscriptForRange(text, ranges, frameToTime(start, fps), frameToTime(end, fps)));
    setSegments(next);
    setDirty(true);
    return next;
  };

  const activeSegment = segmentAt(segments, currentFrame);
  const selectedBlock = segments.find((segment) => segment.id === selectedSegment) ?? null;
  const canSplitHere = Boolean(activeSegment && currentFrame > activeSegment.start);

  const split = () => {
    const next = splitAt(segments, currentFrame);
    if (!next) return;
    checkpoint();
    setSegments(next);
    setSelectedSegment(segmentAt(next, currentFrame).id);
  };

  const deleteLeft = () => {
    const range = deleteLeftRange(segments, currentFrame);
    if (range) removeFrameRange(range.start, range.end);
  };

  const deleteRight = () => {
    const range = deleteRightRange(segments, currentFrame);
    if (range) removeFrameRange(range.start, range.end);
  };

  const deleteSelected = () => {
    if (selectedBlock && removeFrameRange(selectedBlock.start, selectedBlock.end)) setSelectedSegment(null);
  };

  const removeSelection = () => {
    if (selection.end - selection.start < 1) {
      return setNotice({type: 'error', text: 'Marque um intervalo com pelo menos 1 quadro.'});
    }
    const next = removeFrameRange(selection.start, selection.end);
    if (!next) return;
    pause();
    seekToFrame(playableFrame(next, selection.end));
  };

  const markIn = () => setSelection((value) => ({...value, start: Math.min(currentFrame, value.end - 1)}));
  // A saída inclui o quadro em exibição, como em editores de vídeo.
  const markOut = () => setSelection((value) => ({...value, end: Math.max(currentFrame + 1, value.start + 1)}));
  const setSelectionSeconds = (edge, seconds) => {
    const frame = Math.max(0, Math.min(totalFrames, Math.round(Number(seconds) * fps)));
    setSelection((value) => edge === 'start'
      ? {...value, start: Math.min(frame, value.end - 1)}
      : {...value, end: Math.max(frame, value.start + 1)});
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [...items, {text, segments}]);
    setText(previous.text);
    setSegments(previous.segments);
    setHistory((items) => items.slice(0, -1));
    setDirty(true);
  };

  const redo = () => {
    const next = future.at(-1);
    if (!next) return;
    setHistory((items) => [...items, {text, segments}]);
    setText(next.text);
    setSegments(next.segments);
    setFuture((items) => items.slice(0, -1));
    setDirty(true);
  };

  const tools = [
    {id: 'undo', label: 'Desfazer', shortcut: 'Ctrl+Z', icon: 'undo', onClick: undo, disabled: !history.length || saving},
    {id: 'redo', label: 'Refazer', shortcut: 'Ctrl+Shift+Z', icon: 'redo', onClick: redo, disabled: !future.length || saving},
    'divider',
    {id: 'split', label: 'Dividir no cursor', shortcut: 'Ctrl+B', icon: 'split', onClick: split, disabled: !canSplitHere},
    {id: 'delete-left', label: 'Excluir à esquerda do cursor', shortcut: 'Q', icon: 'deleteLeft', onClick: deleteLeft, disabled: !canSplitHere},
    {id: 'delete-right', label: 'Excluir à direita do cursor', shortcut: 'W', icon: 'deleteRight', onClick: deleteRight, disabled: !activeSegment},
    {id: 'delete', label: 'Excluir bloco selecionado', shortcut: 'Delete', icon: 'trash', onClick: deleteSelected, disabled: !selectedBlock || segments.length < 2, danger: true},
  ];

  useEffect(() => {
    shortcuts.current = (event) => {
      if (!clip || loading || saving) return false;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const second = Math.max(1, Math.round(fps));
      if (key === ' ') togglePlay();
      else if (key === 'arrowleft') stepFrames(event.shiftKey ? -second : -1);
      else if (key === 'arrowright') stepFrames(event.shiftKey ? second : 1);
      else if (key === 'home') seekToFrame(0);
      else if (key === 'end') seekToFrame(totalFrames - 1);
      else if (mod && key === 'b') split();
      else if (mod && key === 'z') { if (event.shiftKey) redo(); else undo(); }
      else if (mod && key === 'y') redo();
      else if (mod || event.altKey) return false;
      else if (key === 'q') deleteLeft();
      else if (key === 'w') deleteRight();
      else if (key === 'delete' || key === 'backspace') deleteSelected();
      else if (key === 'i') markIn();
      else if (key === 'o') markOut();
      else return false;
      return true;
    };
  });

  useEffect(() => {
    const onKeyDown = (event) => { if (shortcuts.current?.(event)) event.preventDefault(); };
    // Evita que o Espaço também "clique" no botão que estiver focado.
    const onKeyUp = (event) => { if (event.key === ' ' && event.target.closest?.('button')) event.preventDefault(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const save = async () => {
    if (!clip || !dirty) return;
    const message = removedDuration > 0.01
      ? `Salvar e recortar ${formatTime(removedDuration)} do vídeo e do áudio?`
      : 'Salvar a transcrição editada?';
    if (!window.confirm(message)) return;
    pause();
    setSaving(true);
    try {
      const result = await api(`/api/clips/${clip.id}/save`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, ranges}),
      });
      setNotice(result.labels === 'missing'
        ? {type: 'error', text: `Vídeo, áudio e texto salvos.${LABELS_MISSING}`}
        : {type: 'success', text: 'Vídeo, áudio, texto e labels salvos.'});
      setRevision((value) => value + 1);
      loadLibrary(library.page);
    } catch (error) { setNotice({type: 'error', text: error.message}); }
    finally { setSaving(false); }
  };

  const deleteClip = async () => {
    if (!clip || !window.confirm(`Excluir ${clip.id}.mp4, .wav e .txt?`)) return;
    pause();
    setSaving(true);
    try {
      const result = await api(`/api/clips/${clip.id}`, {method: 'DELETE'});
      const removed = 'Clipe e arquivos associados removidos. Uma cópia foi enviada à lixeira do dataset.';
      setNotice(result.labels === 'missing'
        ? {type: 'error', text: `${removed}${LABELS_MISSING}`}
        : {type: 'success', text: `${removed} A linha do CSV de labels também foi removida.`});
      setClip(null);
      setSelected(null);
      await loadLibrary(library.page);
    } catch (error) { setNotice({type: 'error', text: error.message}); }
    finally { setSaving(false); }
  };

  const toggleDone = async () => {
    if (!clip || marking) return;
    const done = !clip.done;
    if (done && dirty && !window.confirm('Há alterações não salvas. Marcar como concluído mesmo assim?')) return;
    setMarking(true);
    try {
      const result = await api(`/api/clips/${clip.id}/done`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({done}),
      });
      setClip((value) => value?.id === result.id ? {...value, done: result.done, doneAt: result.doneAt} : value);
      setNotice({type: 'success', text: done ? `${clip.id} marcado como concluído.` : `${clip.id} voltou para os pendentes.`});
      await loadLibrary(library.page);
    } catch (error) { setNotice({type: 'error', text: error.message}); }
    finally { setMarking(false); }
  };

  const chooseClip = (id) => {
    if (dirty && !window.confirm('Descartar as alterações ainda não salvas?')) return;
    setSelected(id);
  };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">V</span><span>VISEMA <b>STUDIO</b></span></div>
      <div className="topbar-center">Editor de segmentos</div>
      <div className="top-actions">
        {clip && !loading && <button
          className={`button done-toggle ${clip.done ? 'on' : ''}`} onClick={toggleDone} disabled={marking}
          aria-pressed={clip.done} title={clip.done ? 'Clique para voltar o segmento para os pendentes' : 'Marcar este segmento como concluído'}
        ><Icon>✓</Icon> {clip.done ? 'Concluído' : 'Marcar como concluído'}</button>}
        <button className="button ghost" onClick={undo} disabled={!history.length || saving}><Icon>↶</Icon> Desfazer</button>
        <button className="button ghost" onClick={redo} disabled={!future.length || saving}><Icon>↷</Icon> Refazer</button>
        <button className="button primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Processando…' : 'Salvar alterações'}</button>
      </div>
    </header>

    <aside className="library">
      <div className="library-heading">
        <div><span className="eyebrow">BIBLIOTECA</span><h1>Segmentos</h1></div>
        <span className="count" title="Segmentos concluídos">{library.doneCount.toLocaleString('pt-BR')} / {library.clipCount.toLocaleString('pt-BR')}</span>
      </div>
      <div className="progress-bar" role="progressbar" aria-label="Segmentos concluídos" aria-valuemin={0} aria-valuemax={library.clipCount} aria-valuenow={library.doneCount}>
        <span style={{width: `${library.clipCount ? (library.doneCount / library.clipCount) * 100 : 0}%`}} />
      </div>
      <form className="search" onSubmit={(event) => { event.preventDefault(); setSearch(query); loadLibrary(1, query); }}>
        <Icon>⌕</Icon><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome ou texto…" />
      </form>
      <div className="status-tabs" role="tablist" aria-label="Filtrar por situação">
        {STATUS_FILTERS.map((filter) => {
          const count = filter.id === 'done' ? library.doneCount
            : filter.id === 'pending' ? library.clipCount - library.doneCount : library.clipCount;
          return <button
            key={filter.id} role="tab" aria-selected={statusFilter === filter.id}
            className={statusFilter === filter.id ? 'active' : ''} onClick={() => changeStatusFilter(filter.id)}
          >{filter.label} <span>{count.toLocaleString('pt-BR')}</span></button>;
        })}
      </div>
      <div className="clip-list">
        {library.items.map((item, index) => <button
          className={`clip-card ${selected === item.id ? 'active' : ''} ${item.done ? 'done' : ''}`}
          key={item.id} onClick={() => chooseClip(item.id)}
        >
          <span className="clip-index">{String((library.page - 1) * 48 + index + 1).padStart(2, '0')}</span>
          <span className="clip-copy"><strong>{item.id}</strong><small>{item.text || 'Sem transcrição'}</small></span>
          {item.done ? <span className="clip-check" title="Concluído" aria-label="Concluído">✓</span> : <span className="clip-arrow">›</span>}
        </button>)}
        {!library.items.length && <p className="clip-empty">
          {statusFilter === 'pending' && !search ? 'Nenhum segmento pendente. Tudo concluído!' : 'Nenhum segmento encontrado.'}
        </p>}
      </div>
      <div className="pagination">
        <button onClick={() => loadLibrary(library.page - 1)} disabled={library.page <= 1}>←</button>
        <span>{library.page} / {library.pages}</span>
        <button onClick={() => loadLibrary(library.page + 1)} disabled={library.page >= library.pages}>→</button>
      </div>
    </aside>

    {!clip || loading ? (loading ? <main className="empty-state"><div className="loader" /><p>Carregando segmento…</p></main> : <EmptyEditor />) : <main className="workspace">
      <section className="preview-panel panel">
        <div className="panel-title">
          <div><span className="status-dot" /> PREVIEW SINCRONIZADO</div>
          <span>
            {clip.done && <b className="done-badge" title={clip.doneAt ? `Concluído em ${new Date(clip.doneAt).toLocaleString('pt-BR')}` : undefined}>✓ CONCLUÍDO</b>}
            {clip.id}.mp4
          </span>
        </div>
        <div className="stage">
          <video
            ref={setVideoElement} muted playsInline preload="auto"
            src={`/media/${clip.id}/video?v=${revision}`}
          />
          <audio ref={setAudioElement} src={`/media/${clip.id}/audio?v=${revision}`} preload="auto" />
          <button className="stage-play" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Reproduzir'}>{playing ? 'Ⅱ' : '▶'}</button>
        </div>
        <div className="transport">
          <button onClick={() => stepFrames(-Math.round(fps))} title="Voltar 1 segundo (Shift+←)">−1s</button>
          <button onClick={() => stepFrames(-1)} title="Quadro anterior (←)" aria-label="Quadro anterior">◂</button>
          <button className="play" onClick={togglePlay} title="Reproduzir/pausar (Espaço)">{playing ? 'Ⅱ' : '▶'}</button>
          <button onClick={() => stepFrames(1)} title="Próximo quadro (→)" aria-label="Próximo quadro">▸</button>
          <button onClick={() => stepFrames(Math.round(fps))} title="Avançar 1 segundo (Shift+→)">+1s</button>
          <span className="timecode">{formatTimecode(currentFrame, fps)} <i>/</i> {formatTimecode(totalFrames, fps)}</span>
          <span
            className={`frame-lock ${frameLocked ? 'locked' : ''}`}
            title={frameLocked ? 'O quadro exibido é exatamente o do cursor.' : `Exibindo o quadro ${presentedFrame === null ? '—' : presentedFrame + 1}`}
            data-current-frame={currentFrame} data-presented-frame={presentedFrame ?? ''}
          >Quadro {currentFrame + 1}/{totalFrames}</span>
          <label className="volume"><span>◖</span><input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
        </div>
      </section>

      <section className="transcript-panel panel">
        <div className="panel-title"><div>TRANSCRIÇÃO</div><span>{wordCount} palavras</span></div>
        <textarea value={text} onChange={(event) => { setText(event.target.value); setDirty(true); }} spellCheck="true" aria-label="Transcrição do clipe" />
        <p className="hint"><span>◎</span> Ao remover um trecho, as palavras daquele momento também são removidas proporcionalmente.</p>
      </section>

      <section className="timeline-panel panel">
        <div className="timeline-header">
          <div><span className="eyebrow">LINHA DO TEMPO</span><h2>Corte sincronizado</h2></div>
          <div className="summary"><span><i className="kept" />Mantido {formatTime(resultDuration)}</span><span><i className="removed" />Removido {formatTime(removedDuration)}</span></div>
        </div>
        <Timeline
          fps={fps} totalFrames={totalFrames} segments={segments} selectedId={selectedSegment}
          currentFrame={currentFrame} selection={selection} tools={tools}
          onSeek={seekToFrame} onScrubStart={pause} onSelectSegment={setSelectedSegment}
        />
        <div className="cut-controls">
          <label>ENTRADA <input type="number" min="0" max={duration} step={1 / fps} value={Number(frameToTime(selection.start, fps).toFixed(3))} onChange={(event) => setSelectionSeconds('start', event.target.value)} /></label>
          <button className="mark" onClick={markIn} title="Tecla I">Marcar entrada</button>
          <span className="cut-arrow">→</span>
          <label>SAÍDA <input type="number" min="0" max={duration} step={1 / fps} value={Number(frameToTime(selection.end, fps).toFixed(3))} onChange={(event) => setSelectionSeconds('end', event.target.value)} /></label>
          <button className="mark" onClick={markOut} title="Tecla O (inclui o quadro atual)">Marcar saída</button>
          <button className="button danger" onClick={removeSelection}><Icon>✂</Icon> Remover intervalo</button>
        </div>
      </section>

      <footer className="danger-zone">
        <div><strong>Excluir clipe completo</strong><span>Remove o MP4, WAV e TXT associados.</span></div>
        <button onClick={deleteClip} disabled={saving}>Excluir clipe</button>
      </footer>
    </main>}

    {notice && <div className={`toast ${notice.type}`} role="status"><span>{notice.type === 'success' ? '✓' : '!'}</span>{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
  </div>;
}

export default App;
