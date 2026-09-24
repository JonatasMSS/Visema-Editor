import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  keptDuration,
  playableTime,
  removeTranscriptForRange,
  subtractRange,
} from './editor.js';

const formatTime = (seconds = 0) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${(safe % 60).toFixed(2).padStart(5, '0')}`;
};

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

function App() {
  const [library, setLibrary] = useState({items: [], page: 1, pages: 1, total: 0});
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [clip, setClip] = useState(null);
  const [text, setText] = useState('');
  const [ranges, setRanges] = useState([]);
  const [selection, setSelection] = useState({start: 0, end: 0});
  const [history, setHistory] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [revision, setRevision] = useState(0);
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  const loadLibrary = useCallback(async (page = 1, term = search) => {
    try {
      const data = await api(`/api/clips?page=${page}&limit=48&query=${encodeURIComponent(term)}`);
      setLibrary(data);
      if (!selected && data.items[0]) setSelected(data.items[0].id);
    } catch (error) { setNotice({type: 'error', text: error.message}); }
  }, [search, selected]);

  useEffect(() => { loadLibrary(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setLoading(true);
    setPlaying(false);
    api(`/api/clips/${selected}`).then((data) => {
      if (!active) return;
      setClip(data);
      setText(data.text);
      setRanges([{start: 0, end: data.duration}]);
      setSelection({start: 0, end: data.duration});
      setCurrentTime(0);
      setHistory([]);
      setDirty(false);
      setLoading(false);
    }).catch((error) => {
      if (active) { setNotice({type: 'error', text: error.message}); setLoading(false); }
    });
    return () => { active = false; };
  }, [selected, revision]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const duration = clip?.duration || 0;
  const resultDuration = keptDuration(ranges);
  const removedDuration = Math.max(0, duration - resultDuration);
  const wordCount = useMemo(() => text.trim() ? text.trim().split(/\s+/u).length : 0, [text]);

  const syncSeek = (time) => {
    const safe = Math.max(0, Math.min(duration, Number(time)));
    if (videoRef.current) videoRef.current.currentTime = safe;
    if (audioRef.current) audioRef.current.currentTime = safe;
    setCurrentTime(safe);
  };

  const pause = () => {
    videoRef.current?.pause();
    audioRef.current?.pause();
    setPlaying(false);
  };

  const togglePlay = async () => {
    if (!videoRef.current || !audioRef.current || !ranges.length) return;
    if (playing) return pause();
    const start = playableTime(currentTime, ranges);
    syncSeek(start);
    try {
      await Promise.all([videoRef.current.play(), audioRef.current.play()]);
      setPlaying(true);
    } catch { setNotice({type: 'error', text: 'O navegador bloqueou a reprodução do áudio.'}); }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const activeRange = ranges.find((range) => video.currentTime >= range.start - 0.02 && video.currentTime < range.end - 0.02);
    if (!activeRange && !video.paused) {
      const next = ranges.find((range) => range.start > video.currentTime);
      if (!next) return pause();
      syncSeek(next.start);
      video.play();
      audioRef.current?.play();
      return;
    }
    if (audioRef.current && Math.abs(audioRef.current.currentTime - video.currentTime) > 0.18) {
      audioRef.current.currentTime = video.currentTime;
    }
    setCurrentTime(video.currentTime);
  };

  const checkpoint = () => setHistory((items) => [...items, {text, ranges: ranges.map((range) => ({...range}))}].slice(-20));

  const removeSelection = () => {
    if (selection.end - selection.start < 0.04) {
      return setNotice({type: 'error', text: 'Marque um intervalo com pelo menos 0,04 segundo.'});
    }
    const nextRanges = subtractRange(ranges, selection.start, selection.end);
    if (!nextRanges.length) {
      return setNotice({type: 'error', text: 'Para remover tudo, use “Excluir clipe”.'});
    }
    checkpoint();
    setText(removeTranscriptForRange(text, ranges, selection.start, selection.end));
    setRanges(nextRanges);
    setDirty(true);
    pause();
    syncSeek(playableTime(selection.end, nextRanges));
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setText(previous.text);
    setRanges(previous.ranges);
    setHistory((items) => items.slice(0, -1));
    setDirty(true);
  };

  const save = async () => {
    if (!clip || !dirty) return;
    const message = removedDuration > 0.01
      ? `Salvar e recortar ${formatTime(removedDuration)} do vídeo e do áudio?`
      : 'Salvar a transcrição editada?';
    if (!window.confirm(message)) return;
    pause();
    setSaving(true);
    try {
      await api(`/api/clips/${clip.id}/save`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, ranges}),
      });
      setNotice({type: 'success', text: 'Vídeo, áudio e texto salvos com o mesmo nome.'});
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
      await api(`/api/clips/${clip.id}`, {method: 'DELETE'});
      setNotice({type: 'success', text: 'Clipe e arquivos associados removidos. Uma cópia foi enviada à lixeira do dataset.'});
      setClip(null);
      setSelected(null);
      await loadLibrary(library.page);
    } catch (error) { setNotice({type: 'error', text: error.message}); }
    finally { setSaving(false); }
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
        <button className="button ghost" onClick={undo} disabled={!history.length || saving}><Icon>↶</Icon> Desfazer</button>
        <button className="button primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Processando…' : 'Salvar alterações'}</button>
      </div>
    </header>

    <aside className="library">
      <div className="library-heading">
        <div><span className="eyebrow">BIBLIOTECA</span><h1>Segmentos</h1></div>
        <span className="count">{library.total.toLocaleString('pt-BR')}</span>
      </div>
      <form className="search" onSubmit={(event) => { event.preventDefault(); setSearch(query); loadLibrary(1, query); }}>
        <Icon>⌕</Icon><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome ou texto…" />
      </form>
      <div className="clip-list">
        {library.items.map((item, index) => <button
          className={`clip-card ${selected === item.id ? 'active' : ''}`}
          key={item.id} onClick={() => chooseClip(item.id)}
        >
          <span className="clip-index">{String((library.page - 1) * 48 + index + 1).padStart(2, '0')}</span>
          <span className="clip-copy"><strong>{item.id}</strong><small>{item.text || 'Sem transcrição'}</small></span>
          <span className="clip-arrow">›</span>
        </button>)}
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
          <span>{clip.id}.mp4</span>
        </div>
        <div className="stage">
          <video
            ref={videoRef} muted playsInline
            src={`/media/${clip.id}/video?v=${revision}`}
            onTimeUpdate={handleTimeUpdate} onEnded={pause}
          />
          <audio ref={audioRef} src={`/media/${clip.id}/audio?v=${revision}`} preload="auto" />
          <button className="stage-play" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Reproduzir'}>{playing ? 'Ⅱ' : '▶'}</button>
        </div>
        <div className="transport">
          <button onClick={() => syncSeek(playableTime(currentTime - 1, ranges))}>−1s</button>
          <button className="play" onClick={togglePlay}>{playing ? 'Ⅱ' : '▶'}</button>
          <button onClick={() => syncSeek(playableTime(currentTime + 1, ranges))}>+1s</button>
          <span className="timecode">{formatTime(currentTime)} <i>/</i> {formatTime(duration)}</span>
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
        <div className="ruler">{[0, .25, .5, .75, 1].map((part) => <span key={part} style={{left: `${part * 100}%`}}>{formatTime(duration * part)}</span>)}</div>
        <div className="timeline" onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          syncSeek(((event.clientX - rect.left) / rect.width) * duration);
        }}>
          <div className="track removed-track" />
          {ranges.map((range, index) => <div className="kept-range" key={`${range.start}-${range.end}`} style={{left: `${range.start / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%`}}><span>{index + 1}</span></div>)}
          <div className="selection-range" style={{left: `${selection.start / duration * 100}%`, width: `${(selection.end - selection.start) / duration * 100}%`}} />
          <div className="playhead" style={{left: `${currentTime / duration * 100}%`}}><b /></div>
        </div>
        <input className="scrubber" aria-label="Posição atual" type="range" min="0" max={duration} step="0.01" value={currentTime} onChange={(event) => syncSeek(event.target.value)} />
        <div className="cut-controls">
          <label>ENTRADA <input type="number" min="0" max={duration} step="0.01" value={selection.start.toFixed(2)} onChange={(event) => setSelection((value) => ({...value, start: Math.min(Number(event.target.value), value.end)}))} /></label>
          <button className="mark" onClick={() => setSelection((value) => ({...value, start: Math.min(currentTime, value.end)}))}>Marcar entrada</button>
          <span className="cut-arrow">→</span>
          <label>SAÍDA <input type="number" min="0" max={duration} step="0.01" value={selection.end.toFixed(2)} onChange={(event) => setSelection((value) => ({...value, end: Math.max(Number(event.target.value), value.start)}))} /></label>
          <button className="mark" onClick={() => setSelection((value) => ({...value, end: Math.max(currentTime, value.start)}))}>Marcar saída</button>
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
