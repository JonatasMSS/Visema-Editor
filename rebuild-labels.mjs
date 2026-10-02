// Reprocessa todos os CSVs de labels a partir dos arquivos atuais do dataset:
// recalcula os IDs do SentencePiece de cada TXT e o número de quadros de cada MP4.
//
//   npm run labels                 atualiza os CSVs (com cópia prévia em .history)
//   npm run labels -- --check      só relata as divergências; sai com código 1 se houver
//   npm run labels -- --prune      também remove linhas cujos arquivos não existem mais
import fs from 'node:fs/promises';
import path from 'node:path';
import {datasetRoot, historyDir, labelsDir, textDir, tokenizerFiles, videoDir} from './config.mjs';
import {csvFiles, loadTokenizer, normalizeTranscript, parseRow, readCsv, writeCsv} from './labels.mjs';
import {probeVideo} from './media.mjs';

const check = process.argv.includes('--check');
const prune = process.argv.includes('--prune');
const folder = path.basename(videoDir);

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({length: limit}, worker));
  return results;
}

const exists = (file) => fs.access(file).then(() => true, () => false);

const tokenize = await loadTokenizer(tokenizerFiles);
const files = await csvFiles(labelsDir);
if (!files.length) throw new Error(`Nenhum CSV encontrado em ${labelsDir}.`);

const listed = new Set();
const stats = {rows: 0, tokens: 0, frames: 0, orphans: 0, pruned: 0, invalid: 0, unnormalized: 0};
const orphans = [];
const changed = [];
const results = [];

for (const file of files) {
  const lines = await readCsv(file);
  const next = await mapLimit(lines, 8, async (line) => {
    const row = parseRow(line);
    if (!row) { stats.invalid += 1; return line; }
    stats.rows += 1;
    const [dataset, rel, frames, tokens] = row;
    const id = path.posix.basename(rel, '.mp4');
    listed.add(id);
    const video = path.join(datasetRoot, dataset, rel);
    const text = path.join(textDir, `${id}.txt`);
    if (!rel.startsWith(`${folder}/`) || !(await exists(video)) || !(await exists(text))) {
      stats.orphans += 1;
      orphans.push(`${path.basename(file)}: ${rel}`);
      if (prune) { stats.pruned += 1; return null; }
      return line;
    }
    const transcript = await fs.readFile(text, 'utf8');
    const normalized = normalizeTranscript(transcript);
    if (normalized !== transcript) stats.unnormalized += 1;
    const newTokens = tokenize(normalized);
    const newFrames = String((await probeVideo(video)).frames);
    if (newTokens !== tokens) stats.tokens += 1;
    if (newFrames !== frames) stats.frames += 1;
    if (newTokens !== tokens || newFrames !== frames) changed.push(`${path.basename(file)}: ${id}`);
    return [dataset, rel, newFrames, newTokens].join(',');
  });
  results.push({file, lines, updated: next.filter((line) => line !== null)});
}

const unlisted = (await fs.readdir(videoDir))
  .filter((name) => name.endsWith('.mp4'))
  .map((name) => path.basename(name, '.mp4'))
  .filter((id) => !listed.has(id))
  .sort();

console.log(`Linhas lidas: ${stats.rows} em ${files.length} CSVs.`);
console.log(`Tokens desatualizados: ${stats.tokens}. Quadros desatualizados: ${stats.frames}.`);
for (const entry of changed.slice(0, 20)) console.log(`  ~ ${entry}`);
if (changed.length > 20) console.log(`  … e mais ${changed.length - 20}.`);
console.log(`Linhas sem MP4 ou TXT: ${stats.orphans}${prune ? ` (${stats.pruned} removidas)` : ' (use --prune para removê-las)'}.`);
for (const entry of orphans.slice(0, 5)) console.log(`  - ${entry}`);
if (orphans.length > 5) console.log(`  … e mais ${orphans.length - 5}.`);
if (unlisted.length) console.log(`Clipes fora de todos os CSVs (split desconhecido, não adicionados): ${unlisted.join(', ')}.`);
if (stats.unnormalized) console.log(`TXT fora da normalização (tokenizados já normalizados): ${stats.unnormalized}.`);
if (stats.invalid) console.log(`Linhas com formato inválido mantidas sem alteração: ${stats.invalid}.`);

const dirty = results.filter(({lines, updated}) => (
  updated.length !== lines.length || updated.some((line, index) => line !== lines[index])
));
if (check) {
  const consistent = !dirty.length && !stats.orphans;
  console.log(consistent ? 'Os CSVs estão consistentes.' : 'Os CSVs precisam ser atualizados.');
  process.exitCode = consistent ? 0 : 1;
} else if (dirty.length) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backup = path.join(historyDir, stamp, 'labels');
  await fs.mkdir(backup, {recursive: true});
  for (const {file, updated} of dirty) {
    await fs.copyFile(file, path.join(backup, path.basename(file)));
    await writeCsv(file, updated);
  }
  console.log(`${dirty.length} CSV(s) atualizados. Cópia anterior em ${backup}.`);
} else {
  console.log('Nada a atualizar.');
}
