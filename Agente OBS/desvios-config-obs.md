# Desvios da configuração de captura — vs. setup-captura-obs.md

Documento complementar ao normativo `setup-captura-obs.md`. Registra pontos onde a configuração
real da máquina do SHEIK diverge do que o documento original especificava, o motivo técnico, e o
que isso muda para quem consome as gravações (camada 1 do CLIP.VOD).

Este arquivo é vivo: cada vez que surgir um desvio real desse tipo durante a Sessão 1 ou 2, ele
é adicionado aqui, não decidido em silêncio.

---

## Desvio 1 — Resolução de gravação: 1080p nativo, não 1440p

**Data:** 2026-08-31

**O que o documento original pedia (seção 3):**

| Campo | Valor especificado |
|---|---|
| Resolução base | nativa do monitor |
| Resolução de saída (gravação) | 2560x1440 mínimo |

**O que a máquina real tem:** o monitor do SHEIK é **nativo 1920x1080** — confirmado em
`Configurações do Windows → Sistema → Tela → Resolução de tela`, onde 1920x1080 é a opção mais
alta disponível, marcada como "Recomendável".

**Por que isso é uma contradição, não só um número diferente:** o documento pede simultaneamente
"resolução base = nativa do monitor" (1080p, nesse caso) e "saída = 2560x1440". Cumprir os dois
ao mesmo tempo exige que o OBS faça *upscale* do canvas de 1080p para 1440p antes de codificar.
Upscale não recupera detalhe que não existe na fonte — ele interpola. O resultado seria um
arquivo maior, mais carga de GPU/codificação, e **nenhum ganho real de nitidez**.

**Decisão tomada com o usuário:** gravar nativo, sem upscale.

| Campo | Valor aplicado |
|---|---|
| Resolução base | 1920x1080 |
| Resolução de saída (gravação) | 1920x1080 |

**Impacto direto no corte vertical 9:16 (relevante para a camada 1 e o editor):**

O documento original (seção 1) calcula a largura útil que sobra depois do corte vertical 9:16
para cada resolução de origem:

| Origem | Largura útil do corte 9:16 |
|---|---|
| 1080p (aplicado aqui) | **608 px** |
| 1440p (especificação original, não usada) | 810 px |
| 4K | 1215 px |

**A partir de agora, 608 px de largura é o caso normal para este rig, não um caso de borda.**
Qualquer processamento da camada 1 ou do editor que assuma pixels equivalentes a uma origem
1440p (810 px) está assumindo um número que este rig não produz. Se em algum momento o SHEIK
trocar de monitor para um nativo 1440p ou maior, este desvio deixa de se aplicar e a
especificação original do documento volta a valer sem alteração.

**O que NÃO muda:**

- FPS continua 60, fixo, CFR — parâmetro independente de resolução.
- Facecam (Source Record, seção 4) grava na resolução nativa da câmera, não do monitor —
  não afetada por este desvio.
- Codec, CQP 18, preset P6, faixas de áudio, espaço de cor, tudo da seção 3 em diante continua
  valendo exatamente como especificado, só a resolução muda.

**Nota para o agente/dev da camada 1:** ao construir qualquer heurística de enquadramento ou
qualidade que dependa da largura da faixa central do frame original, use 608 px como baseline
para este usuário, não 810 px. Se o produto for genérico (outros streamers, outras resoluções),
essa largura precisa ser lida do próprio arquivo (`ffprobe`), nunca assumida como constante.

---

## Desvio 2 — Facecam grava a 30fps, não 60fps

**Data:** 2026-08-31

**O que o documento original previa (seção 4):** *"resolução nativa da câmera (1080p60 se
suportado)"*, com fallback explícito já escrito no próprio documento: *"Se a câmera não faz 60
fps nativos, gravar em 30 e deixar o editor lidar com a diferença."*

**Este não é um desvio por contradição — é a aplicação do fallback que o documento já previu.**
Registro aqui só para deixar explícito e fácil de achar, sem precisar caçar dentro da seção 4.

**Câmera real:** dispositivo identificado como "USB Camera" (classe Camera do Windows, único
dispositivo de vídeo conectado). Resolução máxima real: **1920x1080**. Nessa resolução, a lista
de FPS disponíveis no driver da câmera não inclui 60 — as opções eram 30, 29.97 (NTSC), 25, entre
outras menores. **30 é o teto real da câmera em 1080p.**

**Valor aplicado:**

| Fonte | Resolução | FPS |
|---|---|---|
| Gravação principal (gameplay) | 1920x1080 | 60, fixo (CFR) |
| Facecam (Source Record) | 1920x1080 | **30**, fixo (CFR) — não 29.97, valor limpo |

**Impacto para o editor:** os dois arquivos (gameplay e facecam) **não têm o mesmo FPS**. Isso é
esperado e coberto pelo documento. Ao montar o layout vertical (camada 2), o editor precisa
tratar isso como sincronização de dois clipes com frame rate diferente a partir do mesmo
timestamp de início — não como frames faltando ou corrompidos. Duração total dos dois arquivos
deve bater (diferença aceitável < 1s, conforme checklist da seção 8), mesmo com contagem de
frames diferente.

---

## Desvio 3 — Áudio do jogo isolado via Captura de aplicativo, não via exclusão do Discord

**Data:** 2026-08-31

**O que o documento original pedia (seção 5.0):** manter o áudio do jogo na faixa 3 vindo da
fonte "Áudio do desktop" (mixagem geral do sistema), e **excluir o Discord dessa mixagem** no
nível do Windows, roteando a saída do Discord para um dispositivo de áudio diferente do que a
"Áudio do desktop" captura.

**Por que isso não é viável direto nesta máquina:** o SHEIK tem **um único dispositivo de saída
de áudio real conectado** (fone USB). Rotear o Discord para "outro dispositivo" sem perder o
áudio dele no ouvido exige um dispositivo de saída virtual (ex: cabo de áudio virtual tipo
VB-Cable) — software adicional, fora do que o documento previa, que exigiria uma decisão de
download separada.

**Solução aplicada — mesma fonte de captura, usada duas vezes, na origem:**

Em vez de depender da "Áudio do desktop" (mixagem geral) para a faixa 3 e excluir o Discord dela,
usamos a fonte nativa do OBS **"Captura de áudio de aplicativo"** (que já seria usada pro Discord,
conforme o documento) **também para o jogo** — cada uma apontando para um processo específico,
capturado direto na origem, antes de qualquer mixagem do Windows.

| Faixa | Fonte usada | Como configurado |
|---|---|---|
| 1 (backup) | Áudio do desktop | Mix completo do sistema, sem alteração |
| 2 (voz) | Mic/Aux | Sem alteração |
| 3 (jogo) | **Captura de áudio de aplicativo → processo do jogo** | Novo — substitui a dependência de "Áudio do desktop" |
| 4 (Discord) | **Captura de áudio de aplicativo → processo do Discord** | Conforme o documento já prescrevia |
| 5 (alertas/música) | Sem alteração | — |

**Resultado prático é idêntico ao que o documento buscava:** faixa 3 só com jogo, faixa 4 só com
Discord, sem duplicação entre as duas, sem risco de cancelamento de fase — só que chegando lá
capturando cada processo na origem, em vez de capturar tudo misturado e depois excluir uma parte
no nível do Windows. Nenhum software adicional foi necessário.

**O que NÃO muda:** o mapeamento final de faixas (seção 5) continua idêntico ao documento —
1 mix/backup, 2 voz, 3 jogo, 4 Discord, 5 alertas. Só o mecanismo de captura da faixa 3 mudou.

**Limitação prática:** a fonte "Captura de áudio de aplicativo" só lista processos que já estão
rodando no momento em que a fonte é criada no OBS. Isso significa que a faixa 3 (jogo) só pode
ser configurada de verdade com o jogo já aberto — diferente da faixa 4 (Discord), que já estava
rodando durante a configuração desta sessão.

**Limitação adicional, importante para o dia a dia — não é por sessão, é por jogo (.exe):** a
fonte fica amarrada ao processo escolhido no momento da configuração (ex: `Discord.exe`, ou o
`.exe` do jogo). Trocar de jogo para um executável diferente **não é detectado automaticamente**
— a fonte continua "procurando" o processo antigo e a faixa 3 fica muda até o usuário reabrir as
propriedades da fonte e reselecionar o novo processo no campo "Janela" (jogo precisa já estar
aberto para aparecer na lista).

**Procedimento para trocar o jogo capturado na faixa 3:**
1. Abrir o jogo novo primeiro (precisa estar rodando).
2. No OBS, painel Fontes → clicar na fonte "Captura de áudio de aplicativo" que aponta pro jogo
   → botão "Propriedades".
3. Abrir o dropdown "Janela" e selecionar o processo do jogo novo.
4. Fechar. Nenhum outro parâmetro (faixas, filtros, resto da configuração) precisa ser tocado.

Isso é o custo prático de ter evitado instalar um cabo de áudio virtual (ver decisão acima). Para
o uso principal do usuário (simulador, solo, mesmo executável sempre) isso não gera atrito depois
da configuração inicial. Gera atrito só nas sessões com jogo diferente (ex: FPS com amigos).

**Alternativa considerada e descartada, para registro:** o usuário cogitou instalar VB-Cable pra
excluir o Discord da "Áudio do desktop" de vez, deixando essa fonte cobrir qualquer jogo
automaticamente. Ao investigar o mecanismo real, ficou claro que VB-Cable sozinho não resolve —
ele exige escolher entre "ouvir o Discord" e "mantê-lo fora da Áudio do desktop", não as duas
coisas ao mesmo tempo (o truque de "Escutar este dispositivo" reintroduz o Discord na captura,
anulando o propósito). A solução completa exigiria Voicemeeter (mixer virtual completo, com
matriz de roteamento própria), considerado complexidade desproporcional ao ganho — mantém-se a
solução por Captura de aplicativo (acima), com o atrito manual documentado e aceito.

---

## Desvio 4 — Facecam: áudio roteado pra Trilha 6 (silenciosa), não deixado em "Nenhum"

**Data:** 2026-08-31

**O que o documento original previa (seção 4):** "Áudio: nenhum", sem detalhar o mecanismo.

**Interpretação inicial testada e reprovada:** deixar "Áudio Distinto" desmarcado no filtro Source
Record da webcam, com a Trilha exibida (inativa) como "Nenhum". Resultado real: o áudio embutido
da câmera USB continuava presente no arquivo — contrariando a seção 4.

**Causa técnica** (confirmada lendo o código-fonte real do plugin, `source-record.c`, GitHub
`exeldro/obs-source-record`): com `different_audio` falso, o valor interno `audio_track` é forçado
a `0`, e esse valor aciona um callback que usa o campo "Fonte" se preenchido, ou senão cai para a
fonte-pai do filtro — a própria webcam. Esse caminho nunca produz silêncio.

**Solução aplicada:**

| Campo | Valor |
|---|---|
| Áudio Distinto | Marcado |
| Trilha de Áudio | **Trilha 6** (nenhuma fonte do setup usa essa trilha — mix vazio) |
| Fonte | Vazio (só é lido quando Trilha = Nenhum, não é o caso) |

**Validação real:** `ffmpeg -af volumedetect` no arquivo de teste — `mean_volume` e `max_volume`
idênticos em `-91.0 dB`, assinatura de silêncio digital puro, não "áudio baixo".

**Impacto para o editor:** o `_facecam.mkv` tem uma faixa de áudio presente no container, porém
silenciosa (não ausente). Checagens automáticas que só testam "existe stream de áudio" vão vê-la
como presente — se precisar distinguir programaticamente, medir amplitude, não só presença.

---

## Desvio 5 — Facecam: metadata de FPS do arquivo incorreta (declara 60fps, entrega 30fps reais)

**Data:** 2026-08-31

**Não é erro de configuração** — o campo "Framerate: 30.00 fps (/2)" do filtro Source Record está
correto e os frames são entregues a 30fps de verdade.

**Observado:** `ffprobe -show_streams` no `_facecam.mkv` reporta `r_frame_rate` e
`avg_frame_rate` como `60/1`, mesmo com o filtro configurado para 30fps.

**Confirmação do conteúdo real (não só a metadata):** `ffprobe -count_frames` deu exatamente 530
frames num arquivo de 17.684s de duração real (por PTS) → 530 / 17.684 ≈ 29.97fps. Se fosse
realmente 60fps, o esperado seriam ~1061 frames no mesmo intervalo.

**Causa técnica (inferência fundamentada, não confirmada por leitura direta de código):** o
divisor de framerate ("/2") provavelmente descarta metade dos frames antes de codificar, sem
reescrever o `r_frame_rate` do cabeçalho, que continua herdando o valor do canvas global (60fps,
seção 3).

**Impacto para o editor (camada 1 do CLIP.VOD) — crítico:** qualquer cálculo de duração ou
contagem de frames usando `r_frame_rate × nb_frames` erra por um fator de ~2x em arquivos
`_facecam.mkv`. A camada 1 deve sempre calcular duração/tempo por timestamp real (PTS/DURATION do
container), nunca multiplicando frame rate declarado pela contagem de frames, especificamente
para arquivos do Source Record com divisor de framerate ativo.

---

## Desvio 6 — Marcador de capítulo abandonado (não funciona em MKV) — substituído por Replay Buffer

**Data:** 2026-08-31

**O que o documento original previa (seção 5.1):** action "Create Record Chapter" via
WebSocket/Companion, verificável depois com `ffprobe -show_chapters`.

**Teste real:** botão configurado no Companion (módulo OBS Studio, action `Create Record
Chapter`), acionado durante gravação ativa. Resultado: `ffprobe -show_chapters` no arquivo
principal retornou array de capítulos **vazio**.

**Causa técnica confirmada** (post oficial do blog da OBS Project, "Writing an MP4 Muxer for Fun
and Profit"): marcadores de capítulo são recurso **exclusivo do formato Hybrid MP4** (introduzido
no OBS 30.2). O muxer do MKV padrão — formato escolhido para a gravação principal (seção 3), por
segurança contra crash — nunca implementou suporte a capítulos. Não é bug de configuração, é
limitação do formato.

**Opção considerada e descartada:** trocar a gravação principal para Hybrid MP4. Descartada por
risco documentado — issue aberta e não resolvida no repositório oficial do OBS (`#13374`,
`obsproject/obs-studio`, relatada em 32.0.4, próxima da versão instalada 32.2.1) descreve
**corrupção de dados no Hybrid MP4** especificamente com múltiplas faixas de áudio + divisão
automática por tempo. O setup usa 5 faixas de áudio (seção 5) — risco não compensa o ganho de um
recurso de conveniência, numa seção (3) já fechada e validada.

**Solução aplicada:** Replay Buffer nativo do OBS — recurso anterior e independente do Hybrid
MP4, funciona normalmente em MKV. Em vez de um marcador de timestamp dentro do arquivo principal,
o operador aciona "Salvar Replay" e o OBS grava os últimos N segundos como **arquivo separado,
pronto** — resultado mais direto para o pipeline do CLIP.VOD (clipe isolado, não um índice para
caçar depois num arquivo de horas).

**Status:** implementado e testado nesta sessão. Botão "GRAVAR" no Companion executa em sequência:
abre o OBS via atalho `.lnk` (que já inicia a gravação) → `internal: Wait` de 8000ms (tempo pro
WebSocket do OBS ficar disponível) → `OBS_Studio: Start Replay Buffer`. Botão separado "CLIPAR"
executa `OBS_Studio: Save Replay Buffer`.

**Validação real:** teste completo do zero (OBS fechado → botão GRAVAR) confirmou gravação e
buffer ativos após os 8s de espera (print do painel Controles do OBS, "Interromper buffer de
repetição" em azul). Botão CLIPAR gerou `Replay <timestamp>.mkv` separado dos arquivos de
gravação principal — confirmado via `ffprobe -show_format`: `nb_streams: 6` (1 vídeo + 5 áudio,
mapeamento completo da seção 5 preservado) e duração de 67.934s, batendo com o tempo real que o
buffer esteve ativo antes do save (~68s, contas batendo com os horários de log).

**Impacto para o editor:** descartar qualquer expectativa de capítulos MKV como sinal de "momento
bom". A camada de ingestão do CLIP.VOD deve, em vez disso, esperar arquivos de replay separados
(nome de arquivo com timestamp próprio, fora do arquivo de gravação principal) como sinal de
"clipe candidato marcado pelo streamer em tempo real". Padrão de nome confirmado:
`Replay <CCYY>-<MM>-<DD> <hh>-<mm>-<ss>.mkv`, mesma pasta da gravação principal
(`C:\Users\pc\Videos`), mesmo mapeamento de 5 faixas de áudio do arquivo principal.
