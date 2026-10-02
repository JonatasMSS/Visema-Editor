import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Caminhos compartilhados pelo servidor e pelo script de reprocessamento dos labels.
export const root = path.dirname(fileURLToPath(import.meta.url));
export const datasetRoot = path.resolve(process.env.DATASET_ROOT || path.join(root, 'dataset_root'));
export const videoDir = path.join(datasetRoot, 'ptbr', 'ptbr_video_seg24s');
export const textDir = path.join(datasetRoot, 'ptbr', 'ptbr_text_seg24s');
export const labelsDir = path.join(datasetRoot, 'labels');
export const historyDir = path.join(datasetRoot, '.history');
export const trashDir = path.join(datasetRoot, '.trash');

// SentencePiece usado na criação do dataset (auto_avsr_pt/saida_tokenizer).
export const tokenizerFiles = {
  model: path.resolve(process.env.SP_MODEL || path.join(root, 'tokenizer', 'unigram5000_pt.model')),
  units: path.resolve(process.env.SP_UNITS || path.join(root, 'tokenizer', 'unigram5000_pt_units.txt')),
};
