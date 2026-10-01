import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {formatTimecode, rulerSteps, tickLabel} from './timeline.js';

const GUTTER = 14;
const MAX_PX_PER_FRAME = 36;
const FRAME_GRID_PX = 6;
const EDGE_SCROLL_PX = 28;

const ICONS = {
  undo: <path d="M6 4 3 7l3 3M3.5 7H10a3 3 0 0 1 0 6H8" />,
  redo: <path d="m10 4 3 3-3 3M12.5 7H6a3 3 0 0 0 0 6h2" />,
  split: <><path d="M8 1.5v13" strokeDasharray="2 1.6" /><path d="M2.5 4H5.5v8h-3M13.5 4h-3v8h3" /></>,
  deleteLeft: <><path d="M11.5 1.5v13" /><path d="M7.5 4h-4v8h4" /><path d="m4.8 6.6 2.8 2.8m0-2.8L4.8 9.4" /></>,
  deleteRight: <><path d="M4.5 1.5v13" /><path d="M8.5 4h4v8h-4" /><path d="m8.4 6.6 2.8 2.8m0-2.8L8.4 9.4" /></>,
  trash: <path d="M2.5 4.5h11M6.5 4.5V2.8h3v1.7M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5" />,
  zoomOut: <path d="M3.5 8h9" />,
  zoomIn: <path d="M3.5 8h9M8 3.5v9" />,
  fit: <path d="M2.5 6V3h3M10.5 3h3v3M13.5 10v3h-3M5.5 13h-3v-3" />,
};

export function TimelineIcon({name}) {
  return <svg className="tl-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>;
}

// Botões da barra não roubam o foco, assim Espaço e as setas continuam no editor.
const keepFocus = (event) => event.preventDefault();

function Timeline({fps, totalFrames, segments, selectedId, currentFrame, selection, tools, onSeek, onScrubStart, onSelectSegment}) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const dragRef = useRef(null);
  const anchorRef = useRef({px: null, frame: 0});
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [scrubbing, setScrubbing] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    setWidth(viewport.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const fitPx = width > 0 && totalFrames > 0 ? (width - GUTTER * 2) / totalFrames : 0;
  const maxZoom = fitPx > 0 ? Math.max(1, MAX_PX_PER_FRAME / fitPx) : 1;
  const effectiveZoom = Math.min(zoom, maxZoom);
  const pxPerFrame = fitPx * effectiveZoom;
  const contentWidth = totalFrames * pxPerFrame;
  const {major, minor} = rulerSteps(pxPerFrame || 1, fps);
  anchorRef.current.frame = currentFrame;

  // Ao mudar o zoom, o cursor permanece no mesmo ponto da tela.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = anchorRef.current;
    const previous = anchor.px;
    anchor.px = pxPerFrame;
    if (!viewport || !previous || previous === pxPerFrame) return;
    const offset = anchor.frame * previous - viewport.scrollLeft;
    viewport.scrollLeft = anchor.frame * pxPerFrame - offset;
  }, [pxPerFrame]);

  // Durante a reprodução ou passos por teclado, mantém o cursor visível.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || dragRef.current || effectiveZoom <= 1) return;
    const x = GUTTER + currentFrame * pxPerFrame;
    const left = viewport.scrollLeft;
    if (x < left + GUTTER || x > left + viewport.clientWidth - GUTTER) {
      viewport.scrollLeft = x - viewport.clientWidth * 0.15;
    }
  }, [currentFrame, pxPerFrame, effectiveZoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((value) => Math.min(maxZoom, Math.max(1, Math.min(value, maxZoom) * Math.exp(-event.deltaY * 0.002))));
    };
    viewport.addEventListener('wheel', onWheel, {passive: false});
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [maxZoom]);

  const frameAtClientX = (clientX) => {
    const rect = contentRef.current.getBoundingClientRect();
    const frame = Math.round((clientX - rect.left) / pxPerFrame);
    return Math.max(0, Math.min(totalFrames - 1, frame));
  };

  const emitDrag = () => {
    const drag = dragRef.current;
    if (!drag || !pxPerFrame) return;
    const frame = frameAtClientX(drag.clientX);
    if (frame !== drag.frame) {
      drag.frame = frame;
      onSeek(frame);
    }
  };

  const startScrub = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart();
    dragRef.current = {pointerId: event.pointerId, clientX: event.clientX, frame: null, raf: 0};
    setScrubbing(true);
    emitDrag();
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    const viewport = viewportRef.current.getBoundingClientRect();
    if (event.clientX > viewport.right - EDGE_SCROLL_PX) viewportRef.current.scrollLeft += event.clientX - (viewport.right - EDGE_SCROLL_PX);
    if (event.clientX < viewport.left + EDGE_SCROLL_PX) viewportRef.current.scrollLeft -= (viewport.left + EDGE_SCROLL_PX) - event.clientX;
    // Um pedido de busca por quadro de animação, mesmo com mouses de 1000 Hz.
    if (!drag.raf) drag.raf = requestAnimationFrame(() => { drag.raf = 0; emitDrag(); });
  };

  const endScrub = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelAnimationFrame(drag.raf);
    drag.clientX = event.clientX;
    emitDrag();
    dragRef.current = null;
    setScrubbing(false);
  };

  const ticks = [];
  for (let frame = 0; frame <= totalFrames && pxPerFrame > 0; frame += major) ticks.push(frame);
  const zoomPosition = maxZoom > 1 ? Math.log(effectiveZoom) / Math.log(maxZoom) : 0;
  const setZoomPosition = (position) => setZoom(maxZoom ** Math.max(0, Math.min(1, position)));
  const playheadX = currentFrame * pxPerFrame;

  return <div className="tl">
    <div className="tl-toolbar">
      <div className="tl-tools" role="toolbar" aria-label="Ferramentas da linha do tempo">
        {tools.map((tool, index) => tool === 'divider'
          ? <span className="tl-divider" key={`divider-${index}`} />
          : <button
            key={tool.id} type="button" className={`tl-tool ${tool.danger ? 'danger' : ''}`}
            title={`${tool.label} (${tool.shortcut})`} aria-label={tool.label}
            disabled={tool.disabled} onMouseDown={keepFocus} onClick={tool.onClick}
          ><TimelineIcon name={tool.icon} /></button>)}
      </div>
      <div className="tl-zoom">
        <span className="tl-zoom-readout">{pxPerFrame >= FRAME_GRID_PX ? 'Quadro a quadro' : `${effectiveZoom.toFixed(1)}×`}</span>
        <button type="button" className="tl-tool" title="Diminuir zoom (Ctrl + roda)" aria-label="Diminuir zoom" onMouseDown={keepFocus} onClick={() => setZoomPosition(zoomPosition - 0.1)} disabled={zoomPosition <= 0}><TimelineIcon name="zoomOut" /></button>
        <input type="range" min="0" max="1" step="0.01" value={zoomPosition} onChange={(event) => setZoomPosition(Number(event.target.value))} aria-label="Zoom da linha do tempo" disabled={maxZoom <= 1} />
        <button type="button" className="tl-tool" title="Aumentar zoom (Ctrl + roda)" aria-label="Aumentar zoom" onMouseDown={keepFocus} onClick={() => setZoomPosition(zoomPosition + 0.1)} disabled={zoomPosition >= 1}><TimelineIcon name="zoomIn" /></button>
        <button type="button" className="tl-tool" title="Ajustar à largura" aria-label="Ajustar à largura" onMouseDown={keepFocus} onClick={() => setZoom(1)} disabled={effectiveZoom <= 1}><TimelineIcon name="fit" /></button>
      </div>
    </div>

    <div className="tl-viewport" ref={viewportRef} onPointerMove={onPointerMove} onPointerUp={endScrub} onPointerCancel={endScrub}>
      <div
        className={`tl-content ${pxPerFrame >= FRAME_GRID_PX ? 'frame-grid' : ''} ${scrubbing ? 'scrubbing' : ''}`}
        ref={contentRef}
        style={{width: contentWidth, '--frame-px': `${pxPerFrame}px`, '--minor-px': `${minor * pxPerFrame}px`}}
      >
        <div className="tl-ruler" onPointerDown={startScrub}>
          {ticks.map((frame) => <span className="tl-tick" key={frame} style={{left: frame * pxPerFrame}}>{tickLabel(frame, fps)}</span>)}
        </div>

        <div className="tl-track" onPointerDown={(event) => { onSelectSegment(null); startScrub(event); }}>
          {segments.map((segment, index) => {
            const blockWidth = (segment.end - segment.start) * pxPerFrame;
            return <div
              key={segment.id}
              className={`tl-segment ${segment.id === selectedId ? 'selected' : ''}`}
              style={{left: segment.start * pxPerFrame, width: blockWidth}}
              onPointerDown={(event) => { event.stopPropagation(); onSelectSegment(segment.id); startScrub(event); }}
            >
              {blockWidth > 54 && <span className="tl-segment-label"><b>{index + 1}</b>{formatTimecode(segment.end - segment.start, fps)}</span>}
            </div>;
          })}
          {selection && <div className="tl-marks" style={{left: selection.start * pxPerFrame, width: (selection.end - selection.start) * pxPerFrame}} />}
        </div>

        <div className="tl-playhead" style={{transform: `translateX(${playheadX}px)`}}>
          {pxPerFrame >= FRAME_GRID_PX && <span className="tl-frame-cell" />}
          <span
            className="tl-playhead-handle" role="slider" tabIndex={-1}
            aria-label="Cursor da linha do tempo" aria-valuemin={0} aria-valuemax={totalFrames - 1}
            aria-valuenow={currentFrame} aria-valuetext={formatTimecode(currentFrame, fps)}
            onPointerDown={startScrub}
          />
          {scrubbing && <span className="tl-playhead-time">{formatTimecode(currentFrame, fps)}</span>}
        </div>
      </div>
    </div>
  </div>;
}

export default Timeline;
