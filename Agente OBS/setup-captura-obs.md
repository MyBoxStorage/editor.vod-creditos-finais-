# Setup de captura — OBS para CLIP.VOD (camada 1)

Documento de referência para configurar o OBS. Destinado ao usuário e a qualquer agente que
venha a ajudar na configuração do OBS. Os parâmetros aqui não são preferência estética: eles
definem o que a camada 1 do CLIP.VOD espera receber como entrada.

Hardware alvo: Ryzen 7 5700X (16 threads), 32 GB RAM, RTX 5060 Ti (NVENC Blackwell, 8ª geração),
Windows 11 Pro. Disco: sem restrição declarada pelo usuário.

---

## 0. LEIA ANTES DE COMEÇAR — regras de trabalho

Esta seção é para o agente que vai conduzir a configuração. Ela existe porque há erros aqui que
**não têm volta**: se forem cometidos, só se descobre depois da live, com o material já gravado
e inaproveitável.

### 0.1 Duas sessões separadas, nesta ordem

**Sessão 1 — captura (esta primeiro, sempre).** Só os parâmetros técnicos deste documento:
codec, controle de taxa, faixas de áudio, Source Record, espaço de cor, FPS, resolução. É
verificável objetivamente por `ffprobe` e não admite preferência estética.

**Sessão 2 — layout e identidade visual.** Cenas, overlays, alertas, transições, enquadramento
de câmera, fontes, cores. É iterativo e subjetivo.

**Não misture as duas.** Um ajuste de layout feito no meio da configuração de captura pode
alterar uma cena e quebrar a gravação limpa do gameplay sem que ninguém perceba — e o erro só
aparece semanas depois, num clipe com overlay queimado no meio do frame.

Entre as duas sessões: **grave 10 minutos de teste e valide** com o checklist da seção 8. Isso
cria um baseline funcional. Se a sessão 2 quebrar alguma coisa, existe um estado conhecido bom
para comparar.

### 0.2 A regra que não pode ser violada em nenhuma das sessões

**A cena usada para GRAVAR o gameplay é limpa.** Sem overlay, sem alerta, sem webcam, sem chat,
sem moldura, sem marca d'água, sem contador de seguidores, sem nada sobreposto ao jogo.

Overlays e elementos visuais vão na cena de **transmissão**, que é o que vai para a Twitch/Kick.
A gravação local é outra coisa e serve a outro propósito.

**Por quê:** o corte vertical 9:16 aproveita a faixa central do frame — exatamente onde a maioria
dos overlays fica. Pixel queimado no arquivo não pode ser removido depois. Um overlay bonito na
live vira uma tarja inútil atravessando todos os clipes verticais daquela sessão.

Se a configuração de layout exigir mexer nas cenas, **verifique ao final que a cena de gravação
continua limpa** e diga isso explicitamente ao usuário.

### 0.3 Ordem de prioridade quando houver conflito

Se um ajuste de layout ou de performance entrar em conflito com um parâmetro deste documento,
**este documento vence** — e o agente deve dizer ao usuário o que está em conflito em vez de
escolher sozinho.

Se a máquina não aguentar (frames descartados na live), a ordem para reduzir carga é:

1. Baixar o preset do **Source Record** (facecam) — de P6 para P5 ou P4
2. Baixar a resolução da **facecam**
3. Baixar o preset da **gravação principal** — de P6 para P5
4. Só em último caso, baixar a resolução da gravação principal de 1440p para 1080p

**Nunca** resolva carga desligando faixas de áudio, ligando VFR, ou queimando o layout na
gravação para "economizar uma saída".

### 0.4 Verificar frames descartados

O Source Record grava um segundo vídeo em paralelo com a gravação principal. A RTX 5060 Ti
aguenta, mas isso precisa ser confirmado, não assumido.

Durante o teste de 10 minutos, acompanhe `Ver → Estatísticas` no OBS e confirme:
- frames perdidos por atraso de render: **0**
- frames perdidos por codificação: **0**
- frames descartados na rede (só afeta a live, não a gravação): próximo de 0

Se houver perda, aplique a ordem de redução da seção 0.3.

### 0.5 O que o agente deve entregar ao final da sessão 1

1. Confirmação, item por item, de que os parâmetros das seções 3 a 5 foram aplicados.
2. O resultado do checklist da seção 8, rodado sobre um arquivo de teste real.
3. Confirmação explícita de que a cena de gravação está limpa.
4. As estatísticas de frames do teste.
5. Qualquer parâmetro que não foi possível aplicar, e por quê — declarado, nunca contornado em
   silêncio.

---

## 1. Por que gravar local em vez de usar o VOD da Twitch

O corte vertical 9:16 descarta cerca de dois terços da largura do frame. De um 1080p sobram
608 px de largura úteis; de 1440p, 810 px; de 4K, 1215 px. O VOD da Twitch chega já reencodado
e comprimido pela plataforma, então recortar dele significa ampliar pixel degradado e reencodar
de novo no export — três gerações de perda concentradas exatamente no pedaço que sobrevive.

Decisão: **gravação local do OBS é a fonte canônica da camada 1. O VOD da Twitch é fallback.**

---

## 2. O que gravar — três saídas separadas

| Saída | Conteúdo | Como |
|---|---|---|
| **Gameplay** | Só o jogo, **sem overlays, sem alertas, sem webcam, sem chat** | Gravação principal do OBS, a partir de uma cena limpa |
| **Facecam** | Só a webcam, resolução nativa | Plugin `obs-source-record` na fonte da câmera |
| **Áudio** | 4 faixas separadas | Faixas de áudio dentro do arquivo de gameplay |

**Por que gameplay limpo:** overlays queimados no frame não podem ser removidos depois, e ocupam
justamente a área que o corte vertical preserva. A camada 1 recebe imagem limpa e o editor decide
o enquadramento.

**Por que facecam separada:** permite montar o layout vertical no editor em vez de herdar o layout
da live — facecam maior no topo, gameplay embaixo, ou facecam aparecendo só nos momentos de
reação. Sem isso, o enquadramento da live vira uma decisão irreversível.

---

## 3. Parâmetros de vídeo — gravação principal (gameplay)

`Configurações → Saída → Modo de saída: Avançado → aba Gravação`

| Campo | Valor | Nota |
|---|---|---|
| Tipo | Saída padrão | — |
| Formato de gravação | **MKV** (Matroska) | Sobrevive a queda de energia sem corromper. Nunca gravar direto em MP4. |
| Remux automático para MP4 | **Desligado** | O remux automático do OBS pode descartar faixas de áudio extras. Remuxar manualmente (seção 7). |
| Codificador de vídeo | **NVIDIA NVENC HEVC** | AV1 também é válido na 5060 Ti e comprime melhor, mas o ffmpeg do projeto precisa ser validado com AV1 antes de adotar. **Padrão: HEVC.** |
| Controle de taxa | **CQP** | Qualidade constante. Nunca CBR para gravação local. |
| CQ / Nível CQP | **18** | Faixa aceitável 16–20. Menor = melhor e maior. |
| Preset | **P6 (Slower)** | P7 se a GPU tiver folga durante a live. |
| Tuning | **High Quality** | — |
| Multipass | **Two passes (quarter resolution)** | — |
| Perfil | **main** | — |
| Look-ahead | Ligado | — |
| Psycho Visual Tuning | Ligado | — |
| Max B-frames | 2 | — |

`Configurações → Vídeo`

| Campo | Valor |
|---|---|
| Resolução base | nativa do monitor |
| Resolução de saída (gravação) | **2560x1440** mínimo |
| Filtro de redimensionamento | Lanczos |
| FPS | **60**, valor **fixo** — nunca FPS fracionário nem VFR |

`Configurações → Avançado`

| Campo | Valor | Por quê |
|---|---|---|
| Espaço de cor | **Rec. 709** | — |
| Faixa de cor | **Parcial (Limited)** | Full range causa cor lavada ou estourada ao passar pelo ffmpeg. |
| Formato de cor | NV12 (8-bit) | — |
| **HDR** | **Desligado** | Gravação HDR exige tone mapping no pipeline e distorce as cores dos presets de momento. Gravar SDR. |

---

## 4. Parâmetros de vídeo — facecam (plugin Source Record)

Plugin: `obs-source-record` (instalar separadamente).
Aplicar como **filtro** na fonte da webcam: `botão direito na fonte → Filtros → + → Source Record`.

| Campo | Valor |
|---|---|
| Modo de gravação | **Record while recording** (inicia junto com a gravação principal) |
| Codificador | NVENC HEVC, CQP 18, preset P6 |
| Resolução | nativa da câmera (1080p60 se suportado) |
| Áudio | **nenhum** — o áudio vive todo no arquivo principal |
| Caminho | mesma pasta da gravação principal |

Se a câmera não faz 60 fps nativos, gravar em 30 e deixar o editor lidar com a diferença.

---

## 5. Parâmetros de áudio — cinco faixas

`Configurações → Saída → Gravação → Faixas de áudio: marcar 1, 2, 3, 4 e 5`

| Faixa | Conteúdo | Papel no editor |
|---|---|---|
| **1** | Mix completo | Backup e conferência. Nunca usado no corte. |
| **2** | **Microfone (voz), isolado** | **Fonte da detecção de silêncio e da transcrição.** Faixa crítica. |
| **3** | Áudio do jogo | Vai junto com a voz no clipe final, com volume próprio. |
| **4** | **Discord (voz dos amigos), isolado** | Segunda fonte de transcrição. Ver 5.0 abaixo. |
| **5** | Alertas e música | Normalmente descartado no corte. |

### 5.0 Discord em faixa própria (importante)

O foco principal do usuário são lives de simulador jogando sozinho. Mas algumas vezes ele joga
FPS com amigos no Discord, e essas lives também são gravadas.

**Problema encontrado em uso real:** hoje o Discord é capturado dentro do "Áudio do desktop",
junto com o áudio do jogo. A voz dos amigos chega enterrada em tiro, motor e música — e o Whisper
simplesmente não transcreve. Num clipe de teste, 3,5 segundos de fala de um amigo foram
completamente perdidos, e a legenda anterior ficou congelada na tela nesse intervalo.

**Solução:**

1. Criar uma fonte **Captura de saída de aplicativo** apontando exclusivamente para o Discord.
2. Atribuir essa fonte à **faixa 4** (mais a faixa 1 de backup).
3. **Excluir o Discord da captura de áudio do desktop.** Se ele continuar ali, será gravado duas
   vezes, e o cancelamento de fase pode degradar as duas cópias.
4. Manter o áudio do jogo na faixa 3, agora limpo.

Configurar isso uma vez resolve para sempre. **Em lives solo a faixa 4 fica vazia e não atrapalha
nada** — o editor simplesmente não encontra voz ali e ignora.

A transcrição do editor usa **faixa 2 + faixa 4** como fontes de voz, e ignora jogo e alertas.

Atribuição por fonte: `Mixer de áudio → engrenagem da fonte → Propriedades avançadas de áudio →
marcar apenas a faixa correspondente + a faixa 1`.

`Configurações → Saída → Áudio` e `Configurações → Áudio`:

| Campo | Valor |
|---|---|
| Taxa de amostragem | **48 kHz** |
| Canais | Estéreo |
| Codec de gravação | **PCM 24-bit** se o formato permitir; senão **AAC 320 kbps** |
| Monitoramento | Desligado em todas as fontes (evita eco duplicado na gravação) |

**Filtros no microfone:** manter leves. Supressão de ruído leve e um gate suave são aceitáveis.
**Não** aplicar compressor pesado, limitador agressivo nem noise suppression por IA na faixa de
gravação — isso engole respiros e picos que a detecção de silêncio e os presets de momento usam
como sinal.

---

### 5.2 A faixa de voz é a base da detecção de reação — trate como crítica

Esta subseção existe para dar o peso correto à faixa 2. Ela não é uma conveniência: **é o sinal
principal de todo o sistema de detecção de bons momentos do editor.**

**Decisão do usuário:** ele vai configurar a voz para se sobressair ao jogo na mixagem geral.
Isso é intencional e ajuda duplamente — melhora a live e torna os picos de reação exagerada
inconfundíveis na faixa isolada.

**O que depende diretamente da qualidade desta faixa:**

| Recurso do editor | Depende de |
|---|---|
| Detecção de reação (sugestões de bom momento) | volume relativo, subida de tom, ritmo de fala, riso — tudo medido na faixa 2 |
| Corte de vazio (jump cut) | intervalos sem fala na faixa 2 |
| Transcrição e legendas animadas | faixa 2 + faixa 4 |
| Ducking automático da música | detecção de fala na faixa 2 |

Se a faixa 2 vier contaminada com áudio de jogo, **todos os quatro degradam ao mesmo tempo**, e o
usuário só descobre depois de horas de material gravado.

**Requisitos inegociáveis da faixa 2:**

1. **Somente o microfone.** Nenhuma outra fonte atribuída, nem parcialmente.
2. **Sem vazamento do jogo.** Se o usuário usa alto-falante em vez de fone, o microfone capta o
   jogo e a faixa deixa de ser limpa. Nesse caso, avisar explicitamente: **fone é obrigatório**
   para o sistema funcionar como projetado.
3. **Sem processamento pesado.** Compressor forte, limitador agressivo e supressão de ruído por IA
   achatam justamente os picos que marcam a reação exagerada. É o pico que o detector procura.
   Gate suave e supressão leve são aceitáveis.
4. **Sem normalização automática** de qualquer tipo na gravação.
5. **Ganho ajustado para o grito, não para a fala normal.** Se o ganho estiver alto demais, o
   grito satura e vira uma linha reta — o detector perde exatamente o momento mais importante.
   Ajuste para que a fala normal fique por volta de −18 dB e o grito não passe de −3 dB.

**Verificação obrigatória antes da primeira live real:** grave 2 minutos falando normal, depois
gritando, depois rindo. Extraia a faixa 2 isolada e confirme, ouvindo:
- nenhum som de jogo audível
- o grito não está saturado nem cortado
- a diferença de volume entre fala normal e grito é claramente perceptível

Comando para extrair a faixa 2 e conferir:
```
ffmpeg -i gravacao.mkv -map 0:a:1 -c copy faixa2_voz.wav
```
(o índice pode variar; confira antes com `ffprobe -show_streams -select_streams a gravacao.mkv`)

**Ordem de dependência do projeto — informe isto ao usuário:** a calibração da detecção de reação
só pode ser feita depois de existir uma gravação real com as faixas separadas. Um setup malfeito
aqui obriga a recalibrar tudo depois. Vale gastar tempo nesta seção.

## 5.1 Marcadores de capítulo — atalhos do streamdeck (decisão fechada)

O usuário usa um tablet como streamdeck. Durante a live, ao perceber um bom momento, ele aperta
um botão e aquele instante precisa chegar ao editor.

**Decisão: marcador de capítulo, NÃO recorte de replay buffer.**

Motivo: recortar durante a live geraria arquivos duplicados de material que já está sendo
gravado, dobraria o uso de disco, causaria pico de I/O no meio da transmissão, e obrigaria o
usuário a decidir a duração no calor do momento. O marcador é apenas um timestamp dentro do
arquivo, custa nada, e a decisão de duração acontece depois, com calma, no editor.

### Como configurar

- OBS 30.2 ou superior tem **Add Chapter Marker** nativo, com atalho configurável em
  `Configurações → Atalhos`.
- Funciona com gravação em **MKV** (já é o formato definido na seção 3).
- Mapear o atalho para um botão do streamdeck.
- Os marcadores são lidos depois com `ffprobe -show_chapters arquivo.mkv`.

### PROIBIÇÃO CRÍTICA

**Nunca ligar a divisão automática de arquivo** (`Automatic File Splitting`).

Existe um bug conhecido a partir do OBS 32.0.0: depois da primeira divisão, os marcadores de
capítulo recebem timestamp errado — um marcador aos 5 minutos do segundo arquivo aparece como
15 minutos, posição que nem existe naquele arquivo. Isso inutiliza todos os marcadores da sessão.

Se a divisão automática estiver ligada por qualquer motivo, **desligue** e informe o usuário.

### Janela que o editor monta a partir do marcador

Chamando de **T** o instante em que o botão foi apertado, o editor cria um trecho de
**exatamente 1 minuto**:

- **início do trecho:** T − 40 segundos
- **fim do trecho:** T + 20 segundos

Os 40 segundos antes existem porque a reação acontece antes do aperto: o usuário reage, a cena
termina, e só então ele aperta. Os 20 segundos depois cobrem o desfecho.

Nada além disso. Sem seleção inicial reduzida, sem compensação adicional. O ajuste fino acontece
na camada 1, onde a seleção não é destrutiva.

Esses três números são configuráveis no editor. O agente de OBS não precisa fazer nada sobre
eles além de garantir que o marcador seja gravado no instante correto.

### Verificação

Depois de configurar, gravar 2 minutos de teste apertando o atalho duas vezes e rodar:

```
ffprobe -show_chapters -v quiet -print_format json arquivo.mkv
```

Confirmar que aparecem dois capítulos, com timestamps correspondentes aos instantes em que o
botão foi apertado.

---

## 6. Sincronia entre os arquivos

Requisito absoluto: **os três arquivos precisam começar no mesmo instante.**

- Iniciar tudo com o botão único **Iniciar gravação** do OBS. O Source Record em modo
  "Record while recording" acompanha automaticamente.
- **Não usar Replay Buffer** como fonte da camada 1 — ele tem offset próprio.
- **Não pausar a gravação** no meio da live. Pausar cria descompasso entre o arquivo principal e
  o do Source Record.
- Se precisar interromper, parar e iniciar uma nova gravação (a camada 1 aceita várias gravações
  da mesma sessão).

---

## 7. Nomenclatura e pós-processamento

Padrão de nome (facilita o upload na camada 1):

```
AAAA-MM-DD_jogo_gameplay.mkv
AAAA-MM-DD_jogo_facecam.mkv
```

Remux manual para MP4 preservando todas as faixas, sem reencodar (instantâneo):

```
ffmpeg -i entrada.mkv -map 0 -c copy saida.mp4
```

O `-map 0` é obrigatório — sem ele o ffmpeg leva só a primeira faixa de áudio.

---

## 8. Validação — conferir depois da primeira live de teste

```
ffprobe -hide_banner -show_streams -select_streams a entrada.mkv
```

Checklist:
- [ ] 4 faixas de áudio presentes
- [ ] faixa 2 contém **apenas** a voz (ouvir isolada)
- [ ] vídeo em 2560x1440, 60 fps, CFR (não VFR)
- [ ] `color_range=tv`, `color_space=bt709`
- [ ] facecam existe, mesma duração do gameplay (diferença aceitável: menos de 1 segundo)
- [ ] gameplay sem nenhum overlay queimado

---

## 9. O que a camada 1 do CLIP.VOD precisa suportar (requisito de produto)

Consequência direta deste setup, a ser respeitada no desenvolvimento:

1. Upload de **múltiplos arquivos por sessão**, com papéis nomeados: `gameplay`, `facecam`,
   e faixas de áudio (`voz`, `jogo`, `extras`).
2. As faixas de áudio podem chegar de dois jeitos: **extraídas do MKV do gameplay** (caminho
   padrão) ou como **arquivos separados** enviados pelo usuário. Os dois precisam funcionar.
3. Detecção automática de multi-track: se o arquivo tem 4 faixas, o app identifica e pergunta
   qual é a voz, propondo a faixa 2 como padrão.
4. **Fallback obrigatório:** arquivo único de faixa única (VOD da Twitch). Nesse caso a detecção
   de silêncio usa os intervalos entre falas do Whisper em vez do volume da faixa de voz.
5. A camada 1 reproduz as fontes **sincronizadas como se fossem um vídeo só**, e o corte propaga
   o mesmo intervalo de tempo para todas as fontes ao criar um trecho na camada 2.
6. A camada 2 recebe as fontes ainda separadas — o enquadramento (posição e tamanho da facecam
   sobre o gameplay) é decisão do editor, não da gravação.
