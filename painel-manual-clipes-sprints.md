# Painel Manual de Edição de Clipes — Plano de Sprints (Cursor-ready)

## Por que essa mudança

O pipeline atual roda tudo automático até o export (transcrição do VOD inteiro → varredura
semântica → ranking → corte → legenda burn-in → export). Problema identificado: a legenda de
cada clipe reaproveita os timestamps da transcrição do VOD inteiro, e esse mapeamento acumula
erro/drift ao longo do vídeo, gerando legendas sem nexo com o áudio do clipe.

Mudança de arquitetura: o pipeline automático para em "candidatos marcados" (equivalente ao
Checkpoint 3 de hoje: start/end sugerido + score + reason, SEM cortar, legendar ou exportar
nada ainda). A partir daí, tudo é decisão manual no painel, clipe por clipe.

Regra de ouro pra resolver a legenda: **nunca reaproveitar transcript do VOD inteiro para gerar
legenda de um clipe**. Sempre que o usuário confirmar um trecho final (depois de trim), extrai
esse trecho como um arquivo de áudio isolado (ffmpeg) e roda Whisper SÓ nele, do zero, com
timestamps relativos a esse arquivo. Isso elimina o drift.

---

## Sprint A — Backend: parar pipeline em "candidatos marcados"

**Objetivo:** o endpoint que hoje faz ranking + export completo passa a apenas persistir os
candidatos (start/end/score/reason) no banco, sem tocar em ffmpeg nem Whisper.

### Prompt para o Cursor — Sprint A

```
Leia backend/src/routes e backend/src/services antes de editar qualquer coisa.

Objetivo: separar o que hoje é "CHECKPOINT 4" (ranking + export automático) em duas etapas
independentes.

1. Crie/ajuste a rota POST /vod/:vodId/mark-candidates que:
   - Roda o ranking (claudeHighlightRanker) nos candidatos aprovados.
   - Persiste cada candidato na tabela `candidates` (ou crie a tabela se não existir) com:
     id, vodId, start, end, score, reason, origin, status ("marked"), createdAt.
   - NÃO chama ffmpeg, NÃO chama Whisper, NÃO exporta nada.
   - Retorna a lista de candidatos salvos.

2. Deixe a lógica antiga de export automático completo (corte + legenda + burn-in) intacta em
   um service separado, mas REMOVA a chamada automática dela do fluxo do checkpoint. Ela vai ser
   reaproveitada nos sprints seguintes, só que disparada manualmente por clipe, com parâmetros
   vindos do painel (não mais "tudo igual pra todos os clipes").

Se qualquer parte do fluxo atual não estiver clara antes de mexer, pare e me pergunte.
```

---

## Sprint B — Backend: endpoint de trim + preview (sem legenda ainda)

**Objetivo:** dado um candidato marcado, o usuário pode ajustar start/end manualmente e gerar
um preview do corte cru (sem legenda), pra confirmar que o trecho está certo antes de gastar
processamento com transcrição.

### Prompt para o Cursor — Sprint B

```
Leia backend/src/services/*.ts relacionados a ffmpeg antes de editar.

Crie a rota POST /candidates/:id/trim-preview que:
1. Recebe { start, end } (em segundos, podem ser diferentes do start/end original sugerido).
2. Corta esse trecho do source.mp4 do VOD (ffmpeg, sem re-encode pesado, usar -c copy quando
   possível para ser rápido, com fallback para re-encode se o corte não bater em keyframe).
3. Salva em backend/data/{vodId}/previews/{candidateId}.mp4
4. Atualiza o registro do candidato com o start/end ajustado (mas mantém o original em outro
   campo, tipo originalStart/originalEnd, para o usuário poder resetar).
5. Retorna a URL/path do preview gerado.

Não gere legenda nem faça split vertical aqui — só o corte cru pra preview rápido.
```

---

## Sprint C — Backend: transcrição isolada do trecho final (fix da legenda)

**Objetivo:** este é o sprint que resolve o problema relatado. Gera a legenda SÓ para o trecho
já confirmado pelo usuário, com Whisper rodando isolado nesse arquivo.

### Prompt para o Cursor — Sprint C

```
Leia backend/src/services relacionados a transcrição (Whisper) antes de editar.

Crie a rota POST /candidates/:id/transcribe-clip que:
1. Pega o arquivo já cortado (previews/{candidateId}.mp4 ou o start/end confirmado).
2. Extrai o áudio desse trecho isolado (ffmpeg, wav ou formato que o Whisper espera).
3. Roda faster-whisper SÓ nesse arquivo isolado (não reaproveita transcript do VOD inteiro),
   com device cuda, timestamps por palavra, gerando timestamps relativos ao início desse
   arquivo (0 a duração do clipe).
4. Salva o resultado em backend/data/{vodId}/transcripts/{candidateId}.json
5. Gera o .ass/.srt a partir desse transcript isolado.
6. Retorna o transcript pro painel poder mostrar/revisar o texto antes de queimar no vídeo.

Isso substitui o uso do transcript do VOD inteiro para fins de legenda. O transcript do VOD
inteiro continua existindo só para a varredura semântica (Checkpoint 3), nunca mais para
legenda final.
```

---

## Sprint D — Backend: opções de export (qualidade, velocidade, merge)

**Objetivo:** endpoint único de export que aplica as escolhas do usuário.

### Prompt para o Cursor — Sprint D

```
Leia o service de export/ffmpeg existente antes de editar.

Crie a rota POST /candidates/:id/export que recebe:
{
  useSubtitles: boolean,
  subtitleRange: { start, end } | null,  // opcional, subset do clipe se quiser legendar só parte
  quality: "draft" | "hd" | "max",       // presets de bitrate/resolução, defina valores razoáveis
  speed: number,                          // ex: 0.5 a 2.0, 1.0 = normal
  preset: "vertical-split-9x16" | "original" | outros presets já existentes no projeto
}

Fluxo:
1. Parte do clipe já cortado/confirmado (previews/{candidateId}.mp4).
2. Se speed != 1.0, aplica filtro de velocidade no ffmpeg (ajustando também o pitch do áudio
   pra não ficar "esquilo" ou "grave demais" -- usar atempo em cascata se necessário para
   valores fora do range 0.5-2.0 nativo do atempo).
3. Se useSubtitles for true, queima a legenda gerada no Sprint C (recortando o .ass se
   subtitleRange for diferente do clipe inteiro).
4. Aplica o preset de corte/formatação escolhido.
5. Exporta com o bitrate/resolução do preset de quality escolhido.
6. Salva em prontos/{runId}/{candidateId}_final.mp4 e marca status do candidato como "exported".

Crie também a rota POST /candidates/merge que recebe uma lista ordenada de candidateIds e:
1. Concatena os clipes já exportados (ou já cortados, se ainda não exportados individualmente)
   na ordem informada, usando ffmpeg concat.
2. Gera um novo arquivo mesclado em prontos/{runId}/merged_{timestamp}.mp4
3. Trata o caso de os clipes terem resoluções/codecs diferentes (normalizar antes de concatenar
   se necessário).

Se algo sobre os presets de qualidade não estiver especificado com valores exatos, pare e me
pergunte quais bitrates/resoluções usar antes de implementar com valores inventados.
```

---

## Sprint E — Frontend: painel de candidatos marcados

**Objetivo:** tela que lista os candidatos do Sprint A, sem nenhuma ferramenta de edição ainda,
só visualização e seleção.

### Prompt para o Cursor — Sprint E

```
Leia frontend/app (ou pages, conforme a estrutura atual) antes de criar qualquer componente.

Crie a página de candidatos marcados que:
1. Busca GET /vod/:vodId/candidates e lista cada um com: score, reason, start/end original,
   thumbnail (gerar um frame do meio do trecho via ffmpeg se ainda não existir endpoint pra isso
   -- se não existir, pare e me avise antes de criar mais um endpoint novo).
2. Permite selecionar um candidato pra abrir o editor detalhado (vai ser implementado no
   Sprint F).
3. Mostra status de cada candidato (marked / trimmed / transcribed / exported).

Não implemente ainda o player com timeline arrastável -- isso é o próximo sprint. Esta tela é
só a lista/dashboard inicial.
```

---

## Sprint F — Frontend: editor detalhado por clipe

**Objetivo:** a tela principal onde todas as ferramentas de edição ficam disponíveis pra um
candidato selecionado.

### Prompt para o Cursor — Sprint F

```
Leia o componente de lista criado no Sprint E antes de editar.

Crie o editor detalhado do candidato com:
1. Player de vídeo com timeline e handles arrastáveis de start/end (chama trim-preview do
   Sprint B ao soltar o handle, debounced pra não spammar o backend).
2. Botão "Transcrever este trecho" que chama transcribe-clip (Sprint C) e mostra o texto
   resultante pro usuário revisar (permitir edição manual de texto antes de queimar, se o
   Whisper ainda errar alguma palavra).
3. Seletor de range de legenda dentro do clipe (pode ser o clipe inteiro ou um subset).
4. Seletor de qualidade de export (draft/hd/max).
5. Seletor de velocidade (slider ou input, 0.5x a 2x).
6. Botão "Exportar" que chama /candidates/:id/export (Sprint D) com todas as escolhas acima.
7. Modo de seleção múltipla (checkbox nos candidatos da lista do Sprint E) + botão "Juntar
   selecionados" que abre uma tela simples de reordenar (drag to reorder) e confirma o merge
   (chama /candidates/merge do Sprint D).

Se a biblioteca de player de vídeo com timeline arrastável ainda não estiver instalada no
projeto, pare e me pergunte antes de escolher e instalar uma (não instale nada sozinho).
```

---

## Ordem de execução recomendada

Sprint A → B → C → D (backend primeiro, testável via Postman/curl antes do frontend existir)
→ E → F (frontend por cima do que já está funcionando).

Regras fixas de sempre: ler antes de editar, edição cirúrgica, nunca inventar contexto, não
instalar nada sozinho, parar se algo não estiver claro.
