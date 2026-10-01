# Visema Studio

Editor local de segmentos audiovisuais para datasets compostos por um vídeo, um áudio e uma transcrição textual com o mesmo nome-base.

O projeto trabalha diretamente com a estrutura atual de `dataset_root`: cada `segmento_XXXXX.mp4` é associado ao `segmento_XXXXX.wav` e ao `segmento_XXXXX.txt`. A interface permite localizar e visualizar o segmento, reproduzir vídeo e áudio em sincronia, editar a transcrição, remover intervalos e excluir o trio completo.

> **Atenção:** o editor altera arquivos do dataset. Antes de substituir ou excluir conteúdo, ele cria uma cópia de segurança local, mas ainda é recomendável manter um backup externo do dataset.

## Sumário

- [Funcionalidades](#funcionalidades)
- [Organização dos arquivos](#organização-dos-arquivos)
- [Tecnologias e decisões](#tecnologias-e-decisões)
- [Requisitos](#requisitos)
- [Instalação e execução](#instalação-e-execução)
- [Como usar](#como-usar)
- [Como o corte funciona](#como-o-corte-funciona)
- [Como o texto é sincronizado](#como-o-texto-é-sincronizado)
- [Salvamento, histórico e exclusão](#salvamento-histórico-e-exclusão)
- [Labels: comportamento atual](#labels-comportamento-atual)
- [Configuração](#configuração)
- [Scripts disponíveis](#scripts-disponíveis)
- [API local](#api-local)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Testes](#testes)
- [Limitações conhecidas](#limitações-conhecidas)
- [Solução de problemas](#solução-de-problemas)
- [Possíveis evoluções](#possíveis-evoluções)

## Funcionalidades

### Biblioteca de segmentos

- Lista os arquivos `.mp4` existentes em `dataset_root/ptbr/ptbr_video_seg24s`.
- Exibe 48 segmentos por página.
- Permite pesquisar pelo identificador ou por um trecho da transcrição.
- Mostra uma prévia textual de cada segmento.
- Solicita confirmação antes de trocar de segmento quando existem alterações não salvas.

### Acompanhamento de progresso

- O botão **Marcar como concluído**, no topo do editor, registra que o segmento já foi revisado; clicar de novo em **Concluído** o devolve para os pendentes.
- Segmentos concluídos aparecem na biblioteca com um ✓ e um selo **CONCLUÍDO** no preview.
- As abas **Pendentes**, **Concluídos** e **Todos** filtram a biblioteca e mostram quantos itens há em cada situação. A aba inicial é **Pendentes**, então o editor abre direto no próximo segmento não revisado; a última aba escolhida fica lembrada no navegador.
- O contador `concluídos / total` e a barra abaixo do título mostram o avanço geral.
- Marcar como concluído com alterações ainda não salvas pede confirmação.
- O registro fica em `dataset_root/.progress.json` (`{"done": {"segmento_00001": "<data ISO>"}}`), sobrevive a recarregamentos e pode ser editado ou apagado manualmente. Excluir um clipe remove também a marcação dele.

### Preview sincronizado

- Exibe o vídeo do arquivo `.mp4`.
- Reproduz o áudio do arquivo `.wav` simultaneamente.
- Corrige diferenças perceptíveis entre as posições do vídeo e do áudio durante a reprodução.
- Permite pausar, avançar ou retroceder um segundo ou um único quadro.
- Mostra a posição como timecode `MM:SS:QQ` (minutos, segundos, quadros) e o número do quadro.
- Indica com um ponto verde quando o quadro pintado pelo navegador é exatamente o quadro do cursor.
- Permite navegar pelo clipe arrastando o cursor da linha do tempo.
- Permite ajustar o volume do WAV sem alterar o arquivo original.
- Durante a prévia, ignora os intervalos já marcados para remoção.

O sistema usa o WAV como fonte de áudio. O MP4 esperado pelo dataset pode conter apenas a faixa de vídeo.

### Edição da transcrição

- O texto completo pode ser editado diretamente.
- O editor mostra a quantidade atual de palavras.
- Ao remover um intervalo audiovisual, tenta remover as palavras correspondentes àquele momento.
- A edição é salva em UTF-8 no arquivo `.txt` associado.

### Linha do tempo por blocos

Inspirada no CapCut, a linha do tempo trabalha em quadros inteiros: o cursor, as divisões e os cortes sempre caem numa fronteira de quadro.

| Ferramenta | Atalho | Efeito |
| --- | --- | --- |
| Dividir | `Ctrl+B` | Divide o bloco sob o cursor; o quadro atual passa a ser o primeiro do bloco da direita. |
| Excluir à esquerda | `Q` | Remove do início do bloco até o quadro anterior ao cursor. |
| Excluir à direita | `W` | Remove do quadro atual até o fim do bloco. |
| Excluir selecionado | `Delete` / `Backspace` | Remove o bloco selecionado (clique num bloco para selecioná-lo). |
| Desfazer / Refazer | `Ctrl+Z` / `Ctrl+Shift+Z` ou `Ctrl+Y` | Navega pelo histórico de edições. |

Navegação:

- arraste o cursor (alça branca), a régua ou um bloco para percorrer o vídeo; a imagem acompanha o arraste;
- `←` / `→` voltam ou avançam um quadro; com `Shift`, um segundo;
- `Home` / `End` vão ao primeiro ou ao último quadro;
- `Espaço` reproduz ou pausa;
- `I` / `O` marcam entrada e saída;
- `Ctrl` + roda do mouse, ou o controle de zoom, ampliam a linha do tempo até o modo **Quadro a quadro**, em que cada quadro aparece como uma célula e o quadro atual fica destacado.

Os atalhos ficam desativados enquanto o foco está na transcrição ou num campo numérico.

Dividir um bloco não altera a mídia por si só: blocos adjacentes são fundidos ao salvar.

### Corte de segmentos

- Permite definir uma marca de entrada e uma marca de saída.
- As marcas podem ser digitadas ou capturadas na posição atual da reprodução.
- Permite remover mais de um intervalo antes de salvar.
- Exibe quais partes serão mantidas e quais serão removidas.
- Mostra as durações totais mantida e removida.
- Impede salvar um segmento sem nenhum trecho. Para remover tudo, deve-se usar **Excluir clipe**.
- Exige que o intervalo removido tenha pelo menos um quadro.
- A saída inclui o quadro exibido no momento da marcação, como em editores de vídeo.

### Exclusão completa

A opção **Excluir clipe** remove em conjunto:

- `segmento_XXXXX.mp4`;
- `segmento_XXXXX.wav`;
- `segmento_XXXXX.txt`.

Antes da remoção, os três arquivos são copiados para `dataset_root/.trash`.

## Organização dos arquivos

A estrutura padrão esperada é:

```text
dataset_root/
├── labels/
│   ├── ptbr_train_transcript_lengths_seg24s.csv
│   ├── ptbr_val_transcript_lengths_seg24s.csv
│   └── ptbr_test_transcript_lengths_seg24s.csv
└── ptbr/
    ├── ptbr_text_seg24s/
    │   ├── segmento_00001.txt
    │   ├── segmento_00002.txt
    │   └── ...
    └── ptbr_video_seg24s/
        ├── segmento_00001.mp4
        ├── segmento_00001.wav
        ├── segmento_00002.mp4
        ├── segmento_00002.wav
        └── ...
```

O nome-base precisa seguir o formato `segmento_` seguido por um ou mais números. Exemplos válidos:

```text
segmento_00001
segmento_00231
segmento_123456
```

A biblioteca é montada a partir dos `.mp4`. Ao abrir um item, o backend verifica se também existem o WAV e o TXT correspondentes. Se o trio estiver incompleto, o segmento não poderá ser editado e a API retornará um erro.

Os diretórios abaixo são criados automaticamente durante o uso:

```text
dataset_root/
├── .history/   # versões anteriores aos salvamentos
└── .trash/     # arquivos removidos pela exclusão completa
```

## Tecnologias e decisões

| Componente | Tecnologia | Responsabilidade |
| --- | --- | --- |
| Interface | React | Biblioteca, preview, texto e linha do tempo |
| Build e desenvolvimento | Vite | Servidor de desenvolvimento e bundle de produção |
| Backend local | Express | Leitura do dataset, streaming e salvamento |
| Processamento audiovisual | FFmpeg | Corte, concatenação e codificação |
| Inspeção de mídia | FFprobe | Leitura da duração dos clipes |
| Testes | `node:test` | Verificação da lógica de intervalos e texto |

O projeto não usa Remotion porque o trabalho principal é cortar arquivos existentes, não renderizar composições React quadro a quadro. FFmpeg executa esse processamento diretamente, com menor complexidade e sem depender de um navegador para produzir os arquivos finais.

## Requisitos

- Windows, Linux ou macOS com suporte ao Node.js e FFmpeg.
- Node.js 20 ou superior.
- npm.
- FFmpeg e FFprobe disponíveis no `PATH`.
- Navegador moderno.
- Espaço livre para os arquivos processados e o histórico.

O projeto foi desenvolvido e validado com Node.js `22.x`, npm `10.x` e FFmpeg `8.x`. Versões equivalentes mais recentes devem funcionar, mas não foram testadas individualmente.

### Verificar as ferramentas

```powershell
node --version
npm --version
ffmpeg -version
ffprobe -version
```

Todos os comandos devem retornar uma versão.

## Instalação e execução

### Desenvolvimento

Na pasta do projeto:

```powershell
npm install
npm run dev
```

Abra `http://localhost:4173`.

No desenvolvimento, o Express carrega o Vite como middleware. Uma única execução inicia a interface e a API.

### Produção local

Gere a interface otimizada e inicie o servidor:

```powershell
npm run build
npm start
```

O comando `npm start` espera que `dist` já tenha sido gerado por `npm run build`.

## Como usar

### 1. Selecionar um segmento

1. Abra o editor no navegador.
2. Escolha um item na biblioteca lateral.
3. Use a busca para localizá-lo pelo nome ou pelo conteúdo do TXT.
4. Aguarde o carregamento do vídeo, áudio e transcrição.

### 2. Revisar o conteúdo

1. Use o botão de reprodução para iniciar MP4 e WAV juntos.
2. Arraste o cursor da linha do tempo ou clique na régua para navegar.
3. Use `−1s` e `+1s` para ajustes rápidos, e `◂` / `▸` (ou as setas do teclado) para andar quadro a quadro.
4. Corrija a transcrição diretamente no campo de texto quando necessário.

### 3. Marcar um intervalo para remoção

1. Posicione a reprodução no começo do trecho indesejado.
2. Clique em **Marcar entrada**.
3. Posicione a reprodução no final do trecho.
4. Clique em **Marcar saída**.
5. Confira os tempos numéricos.
6. Clique em **Remover intervalo**.

Também é possível digitar os tempos diretamente. O corte ainda não é gravado no disco nessa etapa: a interface apenas atualiza a prévia, os intervalos e a transcrição em memória.

### 4. Remover outros intervalos

Repita a marcação quantas vezes forem necessárias. A linha do tempo representa:

- verde: blocos mantidos, numerados e com sua duração;
- vermelho hachurado: trechos removidos;
- contorno branco grosso: bloco selecionado;
- moldura branca: intervalo de entrada e saída;
- linha branca com alça: cursor de reprodução.

Para cortes rápidos, prefira as ferramentas de bloco: posicione o cursor e use `Ctrl+B`, `Q`, `W` ou selecione um bloco e pressione `Delete`.

### 5. Desfazer um corte

Use **Desfazer** para voltar ao estado anterior à última divisão ou remoção, e **Refazer** para reaplicá-la.

O histórico de desfazer:

- existe apenas na memória da página;
- mantém no máximo 20 estados;
- cobre divisões e remoções ainda não salvas;
- não registra cada caractere digitado;
- é reiniciado ao carregar ou salvar o segmento;
- não desfaz um salvamento concluído.

Para reverter um salvamento concluído, restaure manualmente uma versão de `.history`.

### 6. Salvar

1. Clique em **Salvar alterações**.
2. Confira a duração que será removida.
3. Confirme a operação.
4. Aguarde o término do FFmpeg.

Depois do salvamento:

- MP4, WAV e TXT continuam com seus nomes originais;
- MP4 e WAV passam a conter somente os trechos mantidos;
- a versão anterior do trio é preservada em `.history`;
- o segmento é recarregado com sua nova duração.

Se somente o texto foi alterado, o FFmpeg não é executado e apenas o TXT é substituído. Mesmo assim, uma cópia do trio anterior é armazenada no histórico.

### 7. Excluir o segmento inteiro

1. Clique em **Excluir clipe** no final da tela.
2. Confirme a exclusão do MP4, WAV e TXT.
3. O trio deixa de aparecer na biblioteca.

Os arquivos são copiados para `.trash` antes de serem removidos dos diretórios ativos.

## Como o corte funciona

O backend recebe uma lista ordenada dos intervalos que devem ser mantidos. Os limites são convertidos para quadros inteiros com a taxa de quadros lida pelo `ffprobe`, e intervalos adjacentes são fundidos. Para cada intervalo:

1. o vídeo é recortado com `trim=start_frame=…:end_frame=…`, por índice de quadro e sem depender de arredondamento de tempo;
2. seus timestamps são reiniciados com `setpts`;
3. os trechos de vídeo são concatenados;
4. o WAV é processado separadamente com `atrim` e `asetpts`;
5. os trechos de áudio são concatenados na mesma ordem.

O vídeo final usa:

```text
codec: libx264
CRF: 18
preset: medium
áudio incorporado no MP4: removido
faststart: habilitado
```

O áudio final usa WAV PCM de 16 bits (`pcm_s16le`).

Os cortes são reencodificados. Isso permite respeitar tempos que não coincidem com keyframes, mas consome CPU e não preserva o fluxo de vídeo bit a bit.

## Como o texto é sincronizado

Os TXT atuais não contêm timestamps de palavras. Portanto, o editor não sabe o instante exato em que cada palavra foi pronunciada.

Ao remover um intervalo, ele faz uma estimativa:

1. separa a transcrição atual em palavras;
2. distribui as palavras uniformemente pela duração ainda mantida;
3. estima o instante central de cada palavra;
4. remove as palavras cujo instante estimado está no intervalo excluído.

Essa associação é somente proporcional. Ela serve como ponto de partida para revisão humana, mas não substitui alinhamento forçado, timestamps por palavra ou uma nova transcrição automática.

Se a fala tiver pausas longas, mudanças de velocidade ou palavras concentradas em parte do clipe, o texto removido pode não corresponder exatamente ao áudio cortado. Revise o TXT antes de salvar.

## Salvamento, histórico e exclusão

### Histórico de salvamento

Antes de substituir os arquivos ativos, o backend copia o trio original para:

```text
dataset_root/.history/<data-e-hora>/<identificador>/
```

Exemplo:

```text
dataset_root/.history/2026-09-24T15-10-02-115Z/segmento_00001/
├── segmento_00001.mp4
├── segmento_00001.wav
└── segmento_00001.txt
```

Cada salvamento cria uma pasta. O editor não elimina versões antigas automaticamente.

### Lixeira de exclusão

Antes de excluir completamente, o backend copia o trio para:

```text
dataset_root/.trash/<data-e-hora>/<identificador>/
```

Depois remove MP4, WAV e TXT dos diretórios ativos.

### Restauração manual

Ainda não existe restauração na interface. Para recuperar uma versão:

1. pare o servidor;
2. localize a versão em `.history` ou `.trash`;
3. confirme que os três arquivos pertencem ao mesmo snapshot;
4. copie MP4 e WAV para `ptbr/ptbr_video_seg24s`;
5. copie o TXT para `ptbr/ptbr_text_seg24s`;
6. reinicie o servidor.

Se já existirem arquivos ativos com o mesmo nome, preserve uma cópia deles antes da restauração.

### Substituição dos arquivos

Cada arquivo é substituído por meio de um arquivo temporário no mesmo diretório. O original passa brevemente a usar o sufixo `.replacing`; depois o resultado recebe o nome original.

Essa proteção é individual. O conjunto MP4/WAV/TXT não usa uma única transação de filesystem. Uma falha extrema entre as três substituições pode deixar arquivos de versões diferentes nos diretórios ativos. O snapshot em `.history` permite recuperar manualmente essa situação.

## Labels: comportamento atual

> **Os CSVs em `dataset_root/labels` não são lidos nem modificados pelo editor.**

| Operação | MP4 | WAV | TXT | CSV de labels |
| --- | --- | --- | --- | --- |
| Editar somente o texto | Mantido | Mantido | Atualizado | Não atualizado |
| Remover um intervalo | Recortado | Recortado | Atualizado | Não atualizado |
| Excluir o clipe | Removido | Removido | Removido | Linha não removida |

Os CSVs atuais contêm o caminho, um comprimento e uma sequência de IDs de tokens. Para atualizá-los corretamente é necessário executar exatamente o mesmo tokenizer, vocabulário, normalização e regras de particionamento usados na criação do dataset original.

Consequências:

- editar o TXT pode deixar comprimento e tokens desatualizados;
- cortar mídia pode deixar metadados derivados inconsistentes;
- excluir um segmento deixa uma referência órfã no CSV correspondente;
- `.history` e `.trash` não guardam versões dos CSVs, pois eles não são alterados.

Antes de usar o dataset editado em treinamento ou avaliação, regenere os labels com o pipeline original. Não presuma que os CSVs continuam consistentes depois de uma edição.

## Configuração

### `DATASET_ROOT`

Por padrão, o backend procura o dataset em `<pasta-do-projeto>/dataset_root`.

Para usar outro diretório, defina `DATASET_ROOT` antes de iniciar:

```powershell
$env:DATASET_ROOT = "D:\datasets\meu_dataset"
npm run dev
```

Em Bash:

```bash
DATASET_ROOT=/dados/meu_dataset npm run dev
```

O diretório ainda precisa conter as subpastas fixas:

```text
ptbr/ptbr_video_seg24s
ptbr/ptbr_text_seg24s
```

### `PORT`

A porta padrão é `4173`.

```powershell
$env:PORT = "5000"
npm run dev
```

Em Bash:

```bash
PORT=5000 npm run dev
```

## Scripts disponíveis

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia Express e Vite em desenvolvimento |
| `npm run build` | Gera a interface otimizada em `dist` |
| `npm start` | Serve a API e o conteúdo já compilado |
| `npm test` | Executa os testes da lógica de edição |

## API local

A interface usa uma API HTTP fornecida pelo próprio servidor.

### Listar segmentos

```http
GET /api/clips?page=1&limit=48&query=termo
```

| Parâmetro | Padrão | Limites | Descrição |
| --- | --- | --- | --- |
| `page` | `1` | mínimo `1` | Página solicitada |
| `limit` | `48` | de `12` a `100` | Itens por página |
| `query` | vazio | — | Busca no identificador e nos TXTs |

Resposta resumida:

```json
{
  "items": [{"id": "segmento_00001", "text": "Início da transcrição..."}],
  "page": 1,
  "pages": 45,
  "total": 2131
}
```

### Ler um segmento

```http
GET /api/clips/segmento_00001
```

```json
{
  "id": "segmento_00001",
  "text": "Transcrição completa",
  "duration": 23.88,
  "fps": 25,
  "frames": 597
}
```

### Marcar como concluído

```http
PUT /api/clips/segmento_00001/done
Content-Type: application/json

{"done": true}
```

```json
{"id": "segmento_00001", "done": true, "doneAt": "2026-10-01T23:15:00.000Z"}
```

A listagem aceita `status=pending|done|all`, inclui `done` em cada item e devolve `doneCount` e `clipCount` (totais sem filtro). A leitura de um segmento também traz `done` e `doneAt`.

### Acessar a mídia

```http
GET /media/segmento_00001/video
GET /media/segmento_00001/audio
```

### Salvar texto e intervalos mantidos

```http
POST /api/clips/segmento_00001/save
Content-Type: application/json
```

```json
{
  "text": "Texto revisado",
  "ranges": [
    {"start": 0, "end": 4.5},
    {"start": 7.2, "end": 12.8}
  ]
}
```

Os intervalos representam as partes **mantidas**, não as removidas. Precisam ser válidos, não podem se sobrepor e são processados em ordem cronológica.

Resposta:

```json
{"ok": true, "duration": 10.1}
```

### Excluir o trio

```http
DELETE /api/clips/segmento_00001
```

```json
{
  "ok": true,
  "recoverableAt": ".../dataset_root/.trash/.../segmento_00001"
}
```

### Erros

Em caso de falha, a API normalmente responde com status `400`, `404` ou `409`:

```json
{"error": "Descrição do problema"}
```

O status `409` indica que o mesmo segmento já está sendo processado.

## Estrutura do projeto

```text
.
├── index.html             # entrada HTML
├── package.json           # dependências e scripts
├── package-lock.json      # versões das dependências
├── server.mjs             # API, FFmpeg, histórico e servidor
├── progress.mjs           # registro de segmentos concluídos (.progress.json)
├── progress.test.mjs      # testes do registro de progresso
├── vite.config.js         # configuração do Vite/React
├── src/
│   ├── App.jsx            # interface e fluxo principal
│   ├── Timeline.jsx       # linha do tempo: blocos, régua, cursor e zoom
│   ├── useFramePlayer.js  # reprodução e busca quadro a quadro (vídeo + WAV)
│   ├── timeline.js        # operações de blocos em quadros e timecode
│   ├── timeline.test.js   # testes da lógica de quadros e blocos
│   ├── editor.js          # operações de intervalos e texto
│   ├── editor.test.js     # teste da lógica de edição
│   ├── main.jsx           # inicialização do React
│   └── styles.css         # apresentação visual
├── dataset_root/          # dados locais; ignorados pelo Git
└── dist/                  # build; ignorado pelo Git
```

## Testes

```powershell
npm test
```

Os testes confirmam que um intervalo interno é retirado da lista de trechos mantidos com as palavras estimadas dentro dele, e cobrem a lógica de quadros: ida e volta tempo → quadro em várias taxas, divisão, exclusão à esquerda/direita, exclusão de bloco, fusão de blocos adjacentes, timecode e régua.

A precisão quadro a quadro também foi conferida num navegador real com uma cópia isolada de um segmento a 25 fps: os pixels exibidos após setas, arraste e cliques com zoom foram comparados com os quadros extraídos pelo FFmpeg; a reprodução atravessou um trecho removido sem exibir quadros dele; e o MP4 salvo continha exatamente os quadros mantidos.

Para verificar o bundle de produção:

```powershell
npm run build
```

Durante o desenvolvimento inicial, o fluxo de integração foi validado com uma cópia isolada de um segmento: dois intervalos foram concatenados, MP4 e WAV terminaram com a mesma duração, o TXT foi atualizado, o histórico foi criado e a exclusão conjunta foi confirmada.

## Limitações conhecidas

### Alinhamento textual aproximado

Não há timestamps por palavra. A remoção textual é proporcional e pode selecionar palavras diferentes das realmente pronunciadas. A revisão humana é necessária.

### Labels não são atualizados

Os CSVs de `dataset_root/labels` permanecem inalterados. Consulte [Labels: comportamento atual](#labels-comportamento-atual).

### Formato de dataset fixo

As subpastas `ptbr/ptbr_video_seg24s` e `ptbr/ptbr_text_seg24s`, as extensões e o prefixo `segmento_` estão definidos no backend. Não há tela de importação.

### Um trio por segmento

Não há múltiplas faixas, legendas, imagens, efeitos, transições ou sobreposições. O editor trabalha com um MP4, um WAV e um TXT por identificador.

### Sem reordenação

Os trechos mantidos continuam em ordem cronológica. Não é possível arrastar e reordenar partes.

### Codec de saída fixo

O vídeo sempre é recodificado em H.264 com `libx264`; o áudio, em PCM de 16 bits. A interface não oferece outros codecs ou contêineres.

### MP4 final sem áudio incorporado

O backend usa `-an` ao gerar o MP4. O áudio final existe apenas no WAV associado, conforme a organização atual do dataset.

### Duração baseada no MP4

A duração de referência vem do MP4. O editor pressupõe que o WAV está alinhado e tem duração compatível; não verifica divergências automaticamente.

### Sem waveform ou miniaturas

A linha do tempo representa blocos mantidos, removidos e selecionados, sem miniaturas do vídeo.

### Linha do tempo em tempo de origem

Os blocos ficam na posição original do clipe e os trechos removidos continuam visíveis como lacunas; diferentemente do CapCut, os blocos seguintes não se deslocam para preencher o espaço. A reprodução pula as lacunas.

### Desfazer limitado

**Desfazer** cobre cortes ainda não salvos, não cada alteração textual. Depois de salvar, a reversão depende do histórico em disco.

### Restauração manual

`.history` e `.trash` são acessíveis apenas pelo filesystem. Não há seletor de versões na interface.

### Crescimento do armazenamento

Não existe limpeza automática. Cada salvamento copia o trio para `.history`, e cada exclusão mantém uma cópia em `.trash`. O uso de disco pode crescer rapidamente.

### Operação não transacional entre os três arquivos

MP4, WAV e TXT são substituídos individualmente. Uma interrupção entre as substituições pode exigir restauração manual.

### Processamento local e bloqueio em memória

O servidor impede um segundo salvamento do mesmo identificador enquanto o primeiro está em andamento. O bloqueio não é persistente e desaparece ao reiniciar o processo.

### Pesquisa sem índice

A busca textual lê transcrições para encontrar correspondências. Isso atende alguns milhares de segmentos, mas pode ficar lento em datasets muito grandes.

### Sem autenticação

A API não possui login ou autorização. Foi criada para uso local. Não exponha a porta à internet ou a uma rede não confiável.

### Uso por uma pessoa

Não existe controle de colaboração entre navegadores, usuários ou várias instâncias do servidor.

### Sem gerenciamento de splits e metadados

O editor não move segmentos entre treino, validação e teste, não atualiza tokens e não recalcula metadados derivados.

### Cobertura de testes pequena

A lógica central possui teste automatizado, mas interface, API completa e combinações de codecs ainda não têm uma suíte abrangente.

## Solução de problemas

### FFmpeg ou FFprobe não encontrado

Um sintoma comum é `spawn ffmpeg ENOENT`. Instale o FFmpeg, adicione seus executáveis ao `PATH`, reabra o terminal e confirme:

```powershell
ffmpeg -version
ffprobe -version
```

### O segmento aparece, mas não abre

A biblioteca é formada pelos MP4. Confirme que o trio existe com o mesmo nome-base:

```text
ptbr/ptbr_video_seg24s/segmento_XXXXX.mp4
ptbr/ptbr_video_seg24s/segmento_XXXXX.wav
ptbr/ptbr_text_seg24s/segmento_XXXXX.txt
```

Confira também as permissões de leitura.

### O salvamento falha

Verifique:

- se FFmpeg e FFprobe estão no `PATH`;
- se há espaço para o arquivo temporário e o snapshot;
- se o processo tem permissão de escrita;
- se MP4, WAV e TXT ainda existem;
- se outro salvamento está em andamento;
- se os arquivos não estão bloqueados por outro programa.

Os originais só começam a ser substituídos depois que os resultados temporários foram gerados com sucesso.

### O áudio não acompanha o vídeo

O editor pressupõe que os arquivos começam no mesmo instante. Confira as durações:

```powershell
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "caminho\segmento_00001.mp4"
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "caminho\segmento_00001.wav"
```

Divergências existentes na origem não são corrigidas automaticamente.

### A porta já está em uso

```powershell
$env:PORT = "4174"
npm run dev
```

Depois acesse `http://localhost:4174`.

### A página de produção não abre

Gere `dist` antes de usar `npm start`:

```powershell
npm run build
npm start
```

### O texto removido não corresponde à fala

Esse comportamento pode ocorrer sem timestamps. Reproduza o resultado, revise o TXT manualmente e só então salve.

### O dataset ocupa cada vez mais espaço

Revise `dataset_root/.history` e `dataset_root/.trash`. Remova apenas snapshots dispensáveis e mantenha um backup externo antes da limpeza.

## Possíveis evoluções

Recursos que não existem atualmente, mas podem ser adicionados se o fluxo exigir:

- integração com o tokenizer original para regenerar labels;
- timestamps por palavra com alinhamento forçado;
- visualização da forma de onda;
- handles arrastáveis para entrada e saída;
- restauração de snapshots pela interface;
- limpeza configurável de histórico e lixeira;
- comparação automática das durações de MP4 e WAV;
- fila persistente de processamento;
- suporte a outros diretórios, idiomas e nomes;
- importação de segmentos;
- testes de API e interface;
- autenticação para uso fora da máquina local.

Esses itens não fazem parte da versão atual.

## Licença

Nenhuma licença de distribuição foi definida neste repositório. Antes de redistribuir o projeto ou o dataset, adicione uma licença apropriada e confirme os direitos de uso das mídias e transcrições.
