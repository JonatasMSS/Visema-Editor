import express from 'express';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const datasetRoot = path.resolve(process.env.DATASET_ROOT || path.join(root, 'dataset_root'));
const videoDir = path.join(datasetRoot, 'ptbr', 'ptbr_video_seg24s');
const textDir = path.join(datasetRoot, 'ptbr', 'ptbr_text_seg24s');
const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 4173);
const idPattern = /^segmento_\d+$/;
const busy = new Set();
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

async function durationOf(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', file,
    ], {windowsHide: true});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(Number.parseFloat(stdout))
      : reject(new Error(stderr || 'Não foi possível ler a duração.')));
  });
}

function validatedRanges(input, duration) {
  if (!Array.isArray(input)) throw new Error('Intervalos inválidos.');
  const ranges = input
    .map(({start, end}) => ({start: Number(start), end: Number(end)}))
    .filter(({start, end}) => Number.isFinite(start) && Number.isFinite(end))
    .map(({start, end}) => ({
      start: Math.max(0, Math.min(duration, start)),
      end: Math.max(0, Math.min(duration, end)),
    }))
    .filter(({start, end}) => end - start >= 0.04)
    .sort((a, b) => a.start - b.start);

  if (!ranges.length) throw new Error('O clipe não pode ser salvo sem nenhum trecho. Exclua o clipe inteiro.');
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) throw new Error('Há intervalos sobrepostos.');
  }
  return ranges;
}

function filterGraph(ranges, kind) {
  const chain = ranges.map(({start, end}, index) => (
    kind === 'video'
      ? `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`
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

async function snapshot(id, files, destinationRoot) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const destination = path.join(destinationRoot, stamp, id);
  await fs.mkdir(destination, {recursive: true});
  for (const file of Object.values(files)) {
    if (existsSync(file)) await fs.copyFile(file, path.join(destination, path.basename(file)));
  }
  return destination;
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
    const names = (await fs.readdir(videoDir))
      .filter((name) => name.endsWith('.mp4'))
      .map((name) => path.basename(name, '.mp4'))
      .sort();
    let filtered = names;
    if (query) {
      const matches = await Promise.all(names.map(async (id) => {
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
    })));
    response.json({items, page, pages: Math.max(1, Math.ceil(filtered.length / limit)), total: filtered.length});
  } catch (error) { next(error); }
});

app.get('/api/clips/:id', async (request, response, next) => {
  try {
    const files = pathsFor(request.params.id);
    if (!existsSync(files.video) || !existsSync(files.audio) || !existsSync(files.text)) {
      return response.status(404).json({error: 'Clipe incompleto ou inexistente.'});
    }
    const [text, duration] = await Promise.all([
      fs.readFile(files.text, 'utf8'),
      durationOf(files.video),
    ]);
    response.json({id: request.params.id, text, duration});
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
    const duration = await durationOf(files.video);
    const ranges = validatedRanges(request.body.ranges, duration);
    const text = String(request.body.text ?? '');
    if (Buffer.byteLength(text, 'utf8') > 1_000_000) throw new Error('O texto excede 1 MB.');
    const editedDuration = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    const mediaChanged = ranges.length !== 1 || ranges[0].start > 0.01 || Math.abs(ranges[0].end - duration) > 0.04;
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
    }
    await snapshot(id, files, path.join(datasetRoot, '.history'));
    if (mediaChanged) {
      await replaceFile(outputs.video, files.video);
      await replaceFile(outputs.audio, files.audio);
    }
    await replaceFile(outputs.text, files.text);
    response.json({ok: true, duration: editedDuration});
  } catch (error) { next(error); }
  finally {
    busy.delete(id);
    await Promise.all(temporary.map((file) => fs.rm(file, {force: true}).catch(() => {})));
  }
});

app.delete('/api/clips/:id', async (request, response, next) => {
  try {
    const id = request.params.id;
    const files = pathsFor(id);
    if (busy.has(id)) return response.status(409).json({error: 'Este clipe está sendo processado.'});
    if (!Object.values(files).some(existsSync)) return response.status(404).json({error: 'Clipe inexistente.'});
    const destination = await snapshot(id, files, path.join(datasetRoot, '.trash'));
    await Promise.all(Object.values(files).map((file) => fs.rm(file, {force: true})));
    response.json({ok: true, recoverableAt: destination});
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
