import {spawn} from 'node:child_process';

const parseRate = (value) => {
  const [numerator, denominator = 1] = String(value || '').split('/').map(Number);
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
};

// Duração, taxa de quadros e número de quadros do primeiro fluxo de vídeo.
export async function probeVideo(file) {
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate,r_frame_rate,nb_frames,duration:format=duration',
      '-of', 'json', file,
    ], {windowsHide: true});
    let output = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(output)
      : reject(new Error(stderr || 'Não foi possível ler a duração.')));
  });
  const info = JSON.parse(stdout);
  const stream = info.streams?.[0] ?? {};
  const fps = parseRate(stream.avg_frame_rate) ?? parseRate(stream.r_frame_rate) ?? 25;
  const duration = Number.parseFloat(info.format?.duration ?? stream.duration);
  const frames = Number.parseInt(stream.nb_frames, 10) || Math.round(duration * fps);
  if (!Number.isFinite(duration) || !frames) throw new Error('Não foi possível ler a duração.');
  return {duration, fps, frames};
}
