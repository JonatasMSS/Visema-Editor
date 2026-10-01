// Operações da linha do tempo em quadros inteiros. Um segmento é {id, start, end}
// com `end` exclusivo, portanto todo corte cai exatamente numa fronteira de quadro.

export const DEFAULT_FPS = 25;

let lastId = 0;
export const createSegmentId = () => `seg-${++lastId}`;

export const frameToTime = (frame, fps) => frame / fps;

// Quadro exibido no instante `time` (o intervalo [f/fps, (f+1)/fps) pertence a f).
export const frameAtTime = (time, fps) => Math.floor(time * fps + 1e-6);

// Instante usado para buscar um quadro no <video>. Pausado, o meio do intervalo evita
// que arredondamentos de ponto flutuante mostrem o quadro anterior. Reproduzindo, um
// deslocamento mínimo mantém o quadro na tela pela duração inteira dele.
export const seekTimeForFrame = (frame, fps, offset = 0.5) => (frame + offset) / fps;
export const PLAYBACK_SEEK_OFFSET = 0.02;

export function clampFrame(frame, totalFrames) {
  return Math.max(0, Math.min(Math.max(0, totalFrames - 1), Math.round(frame)));
}

export function formatTimecode(frame, fps) {
  const safe = Math.max(0, Math.round(frame));
  const seconds = Math.floor((safe + 1e-6) / fps);
  const frames = Math.max(0, safe - Math.round(seconds * fps));
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}:${pad(frames)}`;
}

export function createSegments(totalFrames) {
  return totalFrames > 0 ? [{id: createSegmentId(), start: 0, end: totalFrames}] : [];
}

export const segmentAt = (segments, frame) => segments.find((segment) => frame >= segment.start && frame < segment.end);

export const isKept = (segments, frame) => Boolean(segmentAt(segments, frame));

export const nextSegmentAfter = (segments, frame) => segments.find((segment) => segment.start > frame);

export const keptFrames = (segments) => segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);

export function playableFrame(segments, frame) {
  if (isKept(segments, frame)) return frame;
  return nextSegmentAfter(segments, frame)?.start ?? segments[0]?.start ?? 0;
}

// Divide o segmento sob o quadro: o quadro atual passa a ser o primeiro do bloco da direita.
export function splitAt(segments, frame) {
  const target = segmentAt(segments, frame);
  if (!target || frame <= target.start) return null;
  return segments.flatMap((segment) => segment === target
    ? [{...segment, end: frame}, {id: createSegmentId(), start: frame, end: segment.end}]
    : [segment]);
}

// Remove [start, end) mantendo as divisões existentes. O pedaço que sobra de um
// segmento conserva o id dele, para que a seleção sobreviva a um corte lateral.
export function removeFrames(segments, start, end) {
  if (end <= start) return segments;
  return segments.flatMap((segment) => {
    if (end <= segment.start || start >= segment.end) return [segment];
    const parts = [];
    if (segment.start < start) parts.push({...segment, end: start});
    if (end < segment.end) parts.push({id: parts.length ? createSegmentId() : segment.id, start: end, end: segment.end});
    return parts;
  });
}

// Intervalo que "Excluir à esquerda" remove: do início do bloco até o quadro atual (exclusivo).
export function deleteLeftRange(segments, frame) {
  const target = segmentAt(segments, frame);
  return target && frame > target.start ? {start: target.start, end: frame} : null;
}

// Intervalo que "Excluir à direita" remove: do quadro atual (inclusivo) até o fim do bloco.
export function deleteRightRange(segments, frame) {
  const target = segmentAt(segments, frame);
  return target ? {start: frame, end: target.end} : null;
}

// Intervalos mantidos em segundos, com blocos adjacentes (divisões) fundidos.
export function toTimeRanges(segments, fps) {
  const merged = [];
  for (const {start, end} of segments) {
    const last = merged.at(-1);
    if (last && start === last.end) last.end = end;
    else merged.push({start, end});
  }
  return merged.map(({start, end}) => ({start: frameToTime(start, fps), end: frameToTime(end, fps)}));
}

// Passos da régua: o maior com rótulos legíveis e o menor traço que ainda divide o maior.
export function rulerSteps(pxPerFrame, fps, minLabelSpacing = 72, minTickSpacing = 6) {
  const rate = Math.max(1, Math.round(fps));
  const steps = [
    ...[1, 2, 5, 10].filter((step) => step < rate),
    ...[1, 2, 5, 10, 15, 30, 60, 120, 300].map((seconds) => seconds * rate),
  ];
  const major = steps.find((step) => step * pxPerFrame >= minLabelSpacing) ?? steps.at(-1);
  const minor = steps.find((step) => major % step === 0 && step * pxPerFrame >= minTickSpacing) ?? major;
  return {major, minor};
}

export function tickLabel(frame, fps) {
  const rate = Math.max(1, Math.round(fps));
  if (frame % rate) return `${frame % rate}f`;
  return formatTimecode(frame, fps).slice(0, 5);
}
