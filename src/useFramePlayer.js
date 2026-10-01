import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {
  clampFrame,
  frameAtTime,
  frameToTime,
  isKept,
  nextSegmentAfter,
  PLAYBACK_SEEK_OFFSET,
  playableFrame,
  seekTimeForFrame,
} from './timeline.js';

const supportsFrameCallback = typeof HTMLVideoElement !== 'undefined'
  && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

// Controla vídeo + áudio em quadros inteiros.
// - `currentFrame` é a posição do cursor (fonte da verdade da interface).
// - `presentedFrame` é o quadro que o navegador realmente pintou, lido por
//   requestVideoFrameCallback; quando os dois coincidem, a imagem está travada no quadro.
// - Buscas são coalescidas: enquanto uma busca está em andamento, só o alvo mais
//   recente é guardado e aplicado no `seeked`. Arrastar rápido nunca enfileira buscas
//   obsoletas e a imagem acompanha o cursor.
// - Ao atravessar um trecho removido, a reprodução pausa, busca o próximo bloco e só
//   retoma quando o primeiro quadro dele foi pintado: buscar com o vídeo rodando às
//   vezes descarta esse quadro.
export function useFramePlayer({video, audio, fps, totalFrames, segments, onError}) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [presentedFrame, setPresentedFrame] = useState(null);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef(0);
  const seekRef = useRef({target: 0, requested: null, inFlight: false});
  const jumpingRef = useRef(false);
  const live = useRef({fps, totalFrames, segments, onError});

  useLayoutEffect(() => { live.current = {fps, totalFrames, segments, onError}; });

  const setFrame = useCallback((frame) => {
    frameRef.current = frame;
    setCurrentFrame(frame);
  }, []);

  const writeSeek = useCallback((frame) => {
    const state = seekRef.current;
    state.target = frame;
    if (audio) audio.currentTime = frameToTime(frame, live.current.fps);
    // Sem metadados o navegador não dispara `seeked`; a busca é aplicada em `loadedmetadata`.
    if (!video || state.inFlight || video.readyState === 0) return;
    state.inFlight = true;
    state.requested = frame;
    const offset = video.paused && !jumpingRef.current ? undefined : PLAYBACK_SEEK_OFFSET;
    video.currentTime = seekTimeForFrame(frame, live.current.fps, offset);
  }, [video, audio]);

  const pause = useCallback(() => {
    if (!video) return;
    const wasPlaying = !video.paused;
    jumpingRef.current = false;
    video.pause();
    audio?.pause();
    setPlaying(false);
    if (wasPlaying) {
      // Encaixa no quadro em exibição para que o próximo passo parta de um quadro inteiro.
      const frame = clampFrame(frameAtTime(video.currentTime, live.current.fps), live.current.totalFrames);
      setFrame(frame);
      writeSeek(frame);
    }
  }, [video, audio, setFrame, writeSeek]);

  const seekToFrame = useCallback((frame) => {
    jumpingRef.current = false;
    if (video && !video.paused) {
      video.pause();
      audio?.pause();
      setPlaying(false);
    }
    const next = clampFrame(frame, live.current.totalFrames);
    setFrame(next);
    writeSeek(next);
  }, [video, audio, setFrame, writeSeek]);

  const stepFrames = useCallback((delta) => seekToFrame(frameRef.current + delta), [seekToFrame]);

  const play = useCallback(async () => {
    const {segments: kept} = live.current;
    if (!video || !kept.length) return;
    jumpingRef.current = false;
    let start = playableFrame(kept, frameRef.current);
    // No último quadro mantido, reinicia do começo como os editores de vídeo fazem.
    if (start === kept.at(-1).end - 1 && start === frameRef.current) start = kept[0].start;
    setFrame(start);
    writeSeek(start);
    try {
      await Promise.all([video.play(), audio?.play()]);
      setPlaying(true);
    } catch (error) {
      if (error?.name !== 'AbortError') live.current.onError?.('O navegador bloqueou a reprodução do áudio.');
    }
  }, [video, audio, setFrame, writeSeek]);

  const togglePlay = useCallback(
    () => (video && (!video.paused || jumpingRef.current) ? pause() : play()),
    [video, pause, play],
  );

  useEffect(() => {
    seekRef.current = {target: 0, requested: null, inFlight: false};
    jumpingRef.current = false;
    setFrame(0);
    setPresentedFrame(null);
    setPlaying(false);
    if (!video) return undefined;

    let resumeTimer = 0;
    const resumeJump = () => {
      clearTimeout(resumeTimer);
      if (!jumpingRef.current) return;
      jumpingRef.current = false;
      Promise.all([video.play(), audio?.play()]).catch(() => setPlaying(false));
    };

    const onPresented = (frame, mediaTime) => {
      const {segments: kept, totalFrames: total} = live.current;
      const safe = clampFrame(frame, total);
      setPresentedFrame(safe);
      if (jumpingRef.current && !video.seeking && safe === seekRef.current.target) return resumeJump();
      if (video.paused || video.seeking) return;
      setFrame(safe);
      if (audio && !audio.paused && Math.abs(audio.currentTime - mediaTime) > 0.15) audio.currentTime = mediaTime;
      // Ainda dentro de um trecho mantido e o próximo quadro também será exibido.
      if (isKept(kept, safe) && isKept(kept, safe + 1)) return;
      const next = nextSegmentAfter(kept, safe);
      if (!next) return pause();
      jumpingRef.current = true;
      video.pause();
      audio?.pause();
      setFrame(next.start);
      writeSeek(next.start);
    };

    const onSeeked = () => {
      const state = seekRef.current;
      state.inFlight = false;
      if (!supportsFrameCallback) setPresentedFrame(frameAtTime(video.currentTime, live.current.fps));
      if (state.target !== state.requested) return writeSeek(state.target);
      // Sem requestVideoFrameCallback, ou se o quadro não for repintado, retoma mesmo assim.
      if (jumpingRef.current) resumeTimer = setTimeout(resumeJump, supportsFrameCallback ? 120 : 0);
    };
    const onLoaded = () => {
      seekRef.current.inFlight = false;
      writeSeek(seekRef.current.target);
    };
    const onEnded = () => pause();
    const onPause = () => { if (!jumpingRef.current) setPlaying(false); };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('ended', onEnded);
    video.addEventListener('pause', onPause);

    let handle = 0;
    if (supportsFrameCallback) {
      const tick = (_now, metadata) => {
        // mediaTime é o PTS exato do quadro pintado, então o arredondamento é seguro.
        onPresented(Math.round(metadata.mediaTime * live.current.fps), metadata.mediaTime);
        handle = video.requestVideoFrameCallback(tick);
      };
      handle = video.requestVideoFrameCallback(tick);
    } else {
      const poll = () => {
        if (!video.paused) onPresented(frameAtTime(video.currentTime, live.current.fps), video.currentTime);
        handle = requestAnimationFrame(poll);
      };
      handle = requestAnimationFrame(poll);
    }

    return () => {
      clearTimeout(resumeTimer);
      if (supportsFrameCallback) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('pause', onPause);
    };
  }, [video, audio, pause, setFrame, writeSeek]);

  return {
    currentFrame,
    presentedFrame,
    playing,
    frameLocked: !playing && presentedFrame === currentFrame,
    seekToFrame,
    stepFrames,
    play,
    pause,
    togglePlay,
  };
}
