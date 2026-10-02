import express from 'express';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {datasetRoot, historyDir, labelsDir, root, textDir, tokenizerFiles, trashDir, videoDir} from './config.mjs';
import {createLabelsStore, loadTokenizer, normalizeTranscript} from './labels.mjs';
import {probeVideo} from './media.mjs';
import {createProgressStore} from './progress.mjs';

const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 4173);
const idPattern = /^segmento_\d+$/;
const busy = new Set();
const progress = createProgressStore(path.join(datasetRoot, '.progress.json'));
const labels = createLabelsStore(labelsDir, {folder: path.basename(videoDir)});
const app = express();

app.use(express.json({limit: '2mb'}));

function pathsFor(id) {
  if (!idPattern.test(id)) throw new Error('Identificador inválido.');
  return {
    video: path.join(videoDir, `${id}.mp4`),
    audio: path.join(videoDir, `${id}.wav`),
    text: path.join(textDir, `${id}.txt`),
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide: true});
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} encerrou com código ${code}: ${stderr.slice(-1500)}`)));
  });
}

// Converte os intervalos (em segundos) para quadros inteiros e funde os adjacentes,
// que surgem quando um bloco foi apenas dividido na linha do tempo.
function validatedRanges(input, {fps, frames}) {
  if (!Array.isArray(input)) throw new Error('Intervalos inválidos.');
  const toFrame = (seconds) => Math.max(0, Math.min(frames, Math.round(seconds * fps)));
  const ranges = input
    .map(({start, end}) => ({start: Number(start), end: Number(end)}))
    .filter(({start, end}) => Number.isFinite(start) && Number.isFinite(end))
    .map(({start, end}) => ({startFrame: toFrame(start), endFrame: toFrame(end)}))
    .filter(({startFrame, endFrame}) => endFrame > startFrame)
    .sort((a, b) => a.startFrame - b.startFrame);

  if (!ranges.length) throw new Error('O clipe não pode ser salvo sem nenhum trecho. Exclua o clipe inteiro.');
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.startFrame < last.endFrame) throw new Error('Há intervalos sobrepostos.');
    if (last && range.startFrame === last.endFrame) last.endFrame = range.endFrame;
    else merged.push({...range});
  }
  return merged.map(({startFrame, endFrame}) => ({startFrame, endFrame, start: startFrame / fps, end: endFrame / fps}));
}

// O vídeo é cortado por índice de quadro, imune a arredondamento de tempo;
// o áudio usa os mesmos limites convertidos para segundos.
function filterGraph(ranges, kind) {
  const chain = ranges.map(({startFrame, endFrame, start, end}, index) => (
    kind === 'video'
      ? `[0:v]trim=start_frame=${startFrame}:end_frame=${endFrame},setpts=PTS-STARTPTS[v${index}]`
      : `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`
  ));
  const inputs = ranges.map((_, index) => `[${kind === 'video' ? 'v' : 'a'}${index}]`).join('');
  chain.push(`${inputs}concat=n=${ranges.length}:v=${kind === 'video' ? 1 : 0}:a=${kind === 'audio' ? 1 : 0}[out]`);
  return chain.join(';');
}

async function renderMedia(input, output, ranges, kind) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input];
  args.push('-filter_complex', filterGraph(ranges, kind), '-map', '[out]');
  if (kind === 'video') {
    args.push('-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart');
  } else {
    args.push('-c:a', 'pcm_s16le');
  }
  args.push(output);
  await run('ffmpeg', args);
}

// Copia o trio e, se houver, a linha do segmento nos labels, num CSV com o nome do original.
async function snapshot(id, files, destinationRoot, label) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const destination = path.join(destinationRoot, stamp, id);
  await fs.mkdir(destination, {recursive: true});
  for (const file of Object.values(files)) {
    if (existsSync(file)) await fs.copyFile(file, path.join(destination, path.basename(file)));
  }
  if (label) await fs.writeFile(path.join(destination, path.basename(label.file)), `${label.line}\n`, 'utf8');
  return destination;
}

// O modelo só é carregado no primeiro salvamento; uma falha permite tentar de novo.
let tokenizer = null;
function tokenize(text) {
  tokenizer ??= loadTokenizer(tokenizerFiles).catch((error) => {
    tokenizer = null;
    throw new Error(`Não foi possível carregar o SentencePiece (${tokenizerFiles.model}): ${error.message}`);
  });
  return tokenizer.then((encode) => encode(text));
}

async function replaceFile(temporary, target) {
  const old = `${target}.replacing`;
  await fs.rm(old, {force: true});
  await fs.rename(target, old);
  try {
    await fs.rename(temporary, target);
    await fs.rm(old, {force: true});
  } catch (error) {
    if (!existsSync(target)) await fs.rename(old, target);
    throw error;
  }
}

app.get('/api/clips', async (request, response, next) => {
  try {
    const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(12, Number.parseInt(request.query.limit, 10) || 48));
    const query = String(request.query.query || '').trim().toLocaleLowerCase('pt-BR');
    const status = ['done', 'pending'].includes(request.query.status) ? request.query.status : 'all';
    const [entries, done] = await Promise.all([fs.readdir(videoDir), progress.load()]);
    const names = entries
      .filter((name) => name.endsWith('.mp4'))
      .map((name) => path.basename(name, '.mp4'))
      .sort();
    const doneCount = names.filter((id) => done[id]).length;
    let filtered = status === 'all' ? names : names.filter((id) => Boolean(done[id]) === (status === 'done'));
    if (query) {
      const matches = await Promise.all(filtered.map(async (id) => {
        if (id.toLocaleLowerCase('pt-BR').includes(query)) return id;
        const text = await fs.readFile(path.join(textDir, `${id}.txt`), 'utf8').catch(() => '');
        return text.toLocaleLowerCase('pt-BR').includes(query) ? id : null;
      }));
      filtered = matches.filter(Boolean);
    }
    const start = (page - 1) * limit;
    const items = await Promise.all(filtered.slice(start, start + limit).map(async (id) => ({
      id,
      text: (await fs.readFile(path.join(textDir, `${id}.txt`), 'utf8').catch(() => '')).slice(0, 150),
      done: Boolean(done[id]),
    })));
    response.json({
      items, page, pages: Math.max(1, Math.ceil(filtered.length / limit)), total: filtered.length,
      doneCount, clipCount: names.length,
    });
  } catch (error) { next(error); }
});

app.get('/api/clips/:id', async (request, response, next) => {
  try {
    const files = pathsFor(request.params.id);
    if (!existsSync(files.video) || !existsSync(files.audio) || !existsSync(files.text)) {
      return response.status(404).json({error: 'Clipe incompleto ou inexistente.'});
    }
    const [text, {duration, fps, frames}, done] = await Promise.all([
      fs.readFile(files.text, 'utf8'),
      probeVideo(files.video),
      progress.load(),
    ]);
    const doneAt = done[request.params.id] ?? null;
    response.json({id: request.params.id, text, duration, fps, frames, done: Boolean(doneAt), doneAt});
  } catch (error) { next(error); }
});

app.get('/media/:id/:kind', (request, response, next) => {
  try {
    const files = pathsFor(request.params.id);
    const file = request.params.kind === 'video' ? files.video : request.params.kind === 'audio' ? files.audio : null;
    if (!file) return response.status(404).end();
    response.sendFile(file);
  } catch (error) { next(error); }
});

app.post('/api/clips/:id/save', async (request, response, next) => {
  const id = request.params.id;
  if (busy.has(id)) return response.status(409).json({error: 'Este clipe já está sendo processado.'});
  busy.add(id);
  const temporary = [];
  try {
    const files = pathsFor(id);
    if (!existsSync(files.video) || !existsSync(files.audio) || !existsSync(files.text)) {
      return response.status(404).json({error: 'Clipe incompleto ou inexistente.'});
    }
    const video = await probeVideo(files.video);
    const ranges = validatedRanges(request.body.ranges, video);
    const text = normalizeTranscript(request.body.text ?? '');
    if (Buffer.byteLength(text, 'utf8') > 1_000_000) throw new Error('O texto excede 1 MB.');
    if (!text) throw new Error('A transcrição não pode ficar vazia. Para descartar o segmento, exclua o clipe.');
    const tokens = await tokenize(text);
    const keptFrames = ranges.reduce((sum, range) => sum + range.endFrame - range.startFrame, 0);
    const editedDuration = keptFrames / video.fps;
    const mediaChanged = ranges.length !== 1 || ranges[0].startFrame !== 0 || ranges[0].endFrame !== video.frames;
    const nonce = `${process.pid}-${Date.now()}`;
    const outputs = {
      video: path.join(videoDir, `.${id}-${nonce}.mp4`),
      audio: path.join(videoDir, `.${id}-${nonce}.wav`),
      text: path.join(textDir, `.${id}-${nonce}.txt`),
    };
    temporary.push(...Object.values(outputs));
    await fs.writeFile(outputs.text, text, 'utf8');
    if (mediaChanged) {
      await Promise.all([
        renderMedia(files.video, outputs.video, ranges, 'video'),
        renderMedia(files.audio, outputs.audio, ranges, 'audio'),
      ]);
      // A contagem vai para o CSV; um vídeo com outro número de quadros não é aceito.
      const rendered = await probeVideo(outputs.video);
      if (rendered.frames !== keptFrames) {
        throw new Error(`O vídeo recortado ficou com ${rendered.frames} quadros, mas eram esperados ${keptFrames}.`);
      }
    }
    await snapshot(id, files, historyDir, await labels.find(id));
    if (mediaChanged) {
      await replaceFile(outputs.video, files.video);
      await replaceFile(outputs.audio, files.audio);
    }
    await replaceFile(outputs.text, files.text);
    const label = await labels.update(id, {frames: keptFrames, tokens}).catch((error) => {
      throw new Error(`Mídia e texto foram salvos, mas o CSV de labels não foi atualizado: ${error.message}`);
    });
    response.json({ok: true, duration: editedDuration, labels: label ? 'updated' : 'missing'});
  } catch (error) { next(error); }
  finally {
    busy.delete(id);
    await Promise.all(temporary.map((file) => fs.rm(file, {force: true}).catch(() => {})));
  }
});

app.put('/api/clips/:id/done', async (request, response, next) => {
  try {
    const id = request.params.id;
    const files = pathsFor(id);
    if (typeof request.body?.done !== 'boolean') throw new Error('Informe "done" como verdadeiro ou falso.');
    if (!existsSync(files.video)) return response.status(404).json({error: 'Clipe inexistente.'});
    const doneAt = await progress.setDone(id, request.body.done);
    response.json({id, done: Boolean(doneAt), doneAt});
  } catch (error) { next(error); }
});

app.delete('/api/clips/:id', async (request, response, next) => {
  try {
    const id = request.params.id;
    const files = pathsFor(id);
    if (busy.has(id)) return response.status(409).json({error: 'Este clipe está sendo processado.'});
    if (!Object.values(files).some(existsSync)) return response.status(404).json({error: 'Clipe inexistente.'});
    const destination = await snapshot(id, files, trashDir, await labels.find(id));
    await Promise.all(Object.values(files).map((file) => fs.rm(file, {force: true})));
    const label = await labels.remove(id).catch((error) => {
      throw new Error(`O clipe foi excluído, mas a linha do CSV de labels não foi removida: ${error.message}`);
    });
    await progress.setDone(id, false);
    response.json({ok: true, recoverableAt: destination, labels: label ? 'removed' : 'missing'});
  } catch (error) { next(error); }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(400).json({error: error.message || 'Erro inesperado.'});
});

if (production) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*splat', (_request, response) => response.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const {createServer: createViteServer} = await import('vite');
  const vite = await createViteServer({server: {middlewareMode: true}, appType: 'spa'});
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Visema Studio disponível em http://localhost:${port}`);
  console.log(`Dataset: ${datasetRoot}`);
});
