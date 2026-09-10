# Estratégia de Crescimento Gol Quadrado — Revisão 2
**Base: rodada 3 (01/09/2026). Revisão 2 em 01/09/2026.**
Continuação de `HANDOFF-AGENTE-ESTRATEGIA-CRESCIMENTO-GOL-QUADRADO.md` (rodadas 1 e 2).
Não substitui o handoff — leia os dois juntos.

**Para o próximo agente:** seção 2 é decisão travada (não reabra sem motivo).
Seção 3 é a tese competitiva (leia antes de propor qualquer clipe). Seção 4 são
as regras operacionais já resolvidas — é daqui que sai o calendário. Seção 5 é a
pesquisa com fonte. Seções 6 a 8 são conformidade, contas e correções. Seção 9 é
o que continua em aberto.

---

## 1. O que mudou na Revisão 2

Revisão feita depois de uma auditoria da rodada 3. Cinco mudanças de decisão,
quatro acréscimos, uma remoção, e uma renumeração. Nada de pesquisa foi
descartado — só reorganizado e, em três pontos, contradito por leitura mais
cuidadosa da própria pesquisa que já estava aqui.

| # | Mudança | Motivo |
|---|---|---|
| 1 | 10 contas registradas, **4 operadas** no dia 1 | Custo de aquecimento + resposta a comentário não cabe em 20h/semana solo; e a fonte do "3-4x mais rápido" argumenta a favor de concentração, não de divisão em 3 nichos simultâneos (5.9) |
| 2 | Conta principal em **modo dormente** por 60 dias | Talk/resenha é o formato mais difícil de crescer a frio; afinidade com a pessoa é consequência do clipe, não pré-requisito |
| 3 | Medição **não** é adiada (só a instrumentação do CLIP.VOD é) | Analytics nativo entrega retenção de graça desde o primeiro post; sem isso não existe laço de correção |
| 4 | Bilibili reduzido a **handle reservado**, sem cadência | Operação BR abriu em 19/08/2026 — público lusófono ~zero por construção; e "sem custo extra" é falso (custa upload, espaçamento, moderação) |
| 5 | Política de mute de terceiro **ampliada** | Matchmaking em jogo de terror traz menor de idade; voz de criança em clipe é risco de política em qualquer plataforma |
| + | Seção 3 nova — tese competitiva substituta | A rodada 3 refutou "ninguém posta isso em PT" mas nunca escreveu o que entra no lugar |
| + | Seção 6 nova — conformidade de multistream | Três regras da Twitch tocam o overlay diretamente; é warning/suspensão, não penalidade algorítmica |
| + | 4.1 — preset de duração por plataforma | Estava resolvido na rodada 2 e sumiu do documento; sem virar preset a pesquisa foi jogada fora |
| + | 2.8 — lista "não quero parecer" convertida em restrição | Gaules/Cerol/Allanzoka nunca reapareceram depois de coletados |
| ~ | Numeração linear | Na rodada 3 as subseções 2.15–2.17 apareciam depois da seção 3 e 4.1–4.3 depois da seção 6; referência cruzada entre agentes quebrava |

---

## 2. Decisões travadas

### 2.1 Arquitetura de contas — 10 registradas, 4 operadas

**Registrar os 10 handles agora** (custa nada e protege o nome). **Operar 4.**

Ativas no dia 1:
- 3 satélites do **nicho 1 (terror cooperativo / 1ª pessoa)** — TikTok, YouTube
  Shorts, Instagram Reels, mesmo conteúdo editado por plataforma, sem marca
  d'água.
- 1 conta **principal** (`Gol Quadrado`), em modo dormente (ver 2.2).

Reservadas, criadas mas sem publicar:
- 3 satélites do **nicho 2 (gestão/loja)** — entram quando o nicho 1 tiver 3-4
  semanas de dado próprio.
- 3 satélites do **nicho 3** — ainda não nomeado, reservado conforme o roadmap
  render.

*Decisão original da rodada 3 era operar as 10 desde o início. Substituída pelo
seguinte cálculo, feito com números do próprio documento:* aquecimento de 15-20
min/dia por conta (5.11) × 9 satélites = 2h-3h/dia só navegando; mais espaçamento
de 3-4h entre posts dentro da mesma conta (5.6); mais 10 caixas de comentário,
contra o caso que este documento elege como achado mais forte, onde o que virou o
jogo foi responder todo comentário em até 45 minutos (5.9). Não cabe em
20h/semana solo, e o gargalo aparece na semana 3 — depois de o aquecimento já ter
sido pago.

O achado de que criador que domina um gênero cresce 3-4x mais rápido que
generalista (5.9) valida **consistência de nicho por conta**, não rodar três
nichos ao mesmo tempo. Três nichos simultâneos dão a cada um um terço da produção
e um terço da constância — que é a variável que a fonte diz causar o crescimento.

### 2.2 Conta principal — dormente por 60 dias

Formato definido: resenha/talk/facecam sem gameplay específico — o "amplificado
dele" falando. Isso continua sendo o destino do funil, mas **não recebe produção
nos primeiros 60 dias**. Ela existe, tem bio e foto, publica o melhor corte da
semana e o aviso de live, e absorve o tráfego das satélites.

Motivo: talk-head de um desconhecido é o formato mais difícil que existe para
crescer a frio — a afinidade com a pessoa é o que faz talk funcionar, e ela é
consequência do clipe, não pré-requisito. O formato talk entra quando já houver
gente que sabe quem ele é.

### 2.3 Modelo de produção — lote com fila, não just-in-time

Primeiro nicho recebe produção máxima antes de qualquer postagem: 2 a 3 dias de
"produção hardcore" antes do primeiro post, avaliação por sensação própria, não
checklist fixo. Depois alterna: produz muito no nicho seguinte, volta para
reabastecer o anterior, sempre deixando pasta de conteúdo pronto para postar sem
pressão.

O aquecimento de conta (5.11) roda **em paralelo** a esses 2-3 dias, sem custo de
tempo extra.

### 2.4 Medição — o que é adiado e o que não é

**Adiado:** instrumentação de métrica dentro do CLIP.VOD. A ferramenta ainda não
foi testada com conteúdo real, e medir tempo de edição por clipe agora não faz
sentido. Vira prioridade quando o fluxo estiver fluido.

**Não adiado:** leitura de retenção. O analytics nativo do TikTok e do YouTube
Studio entrega taxa de conclusão e duração média assistida por vídeo, de graça,
desde o primeiro post. **Rotina fixa: 20 minutos, uma vez por semana**, anotando
por clipe: duração publicada, taxa de conclusão, duração média assistida.

Sem isso, o plano fica com avaliação por sensação e **zero sinal externo** — ou
seja, nenhum laço de correção nas primeiras semanas. O caso Eklipse (5.9), que
este documento elege como o argumento mais forte que encontrou, é exatamente
sobre alguém que olhou a retenção dos próprios cinco melhores vídeos, viu 35%
contra 12%, e cortou tudo que não performava. Sensação escolhe o que produzir;
dado corta o que não funciona.

Complementar, já topado pelo streamer: cronometrar manualmente um ciclo completo
(VOD bruto → clipe postado) nas primeiras semanas, para ter um número real de
minutos por clipe. É o que calibra a cadência.

### 2.5 Live — multistream real, Twitch + Kick desde o dia 1

Sem exclusividade, sem contrato. A que performar melhor vira foco depois. Nenhuma
das duas é tratada como motor de descoberta (5.7) — são destino que já tem que
estar pronto quando o tráfego das satélites chegar. **Ver seção 6 antes de subir
a primeira live: há três regras da Twitch que tocam o overlay.**

### 2.6 Bilibili — handle reservado, sem cadência

Criar a conta e reservar o nome agora. **Sem cadência de postagem, revisitar em
60 dias.**

*Decisão original da rodada 3 era publicar o mesmo conteúdo lá desde o início,
"sem custo extra de produção". Duas objeções:* a operação brasileira abriu em
19/08/2026 (5.10), então o público lusófono na plataforma é aproximadamente zero
por construção; e "sem custo extra" é falso — cada plataforma adicional custa
upload, espaçamento, moderação e atenção, que é o recurso escasso. A
oportunidade de pioneiro continua existindo; ela só não compete com o nicho 1
pela semana do streamer.

### 2.7 Matchmaking com estranhos — sem barreira pro streamer, mute reativo pro terceiro

A live é caótica do início ao fim por natureza. Sem filtro na fala/reação do
próprio streamer — isso é o estilo.

Para o jogador aleatório: **sem corte preventivo**, mas com mute cirúrgico
naquele trecho específico se ele falar algo que gere risco real de política de
plataforma. Lista ampliada nesta revisão:
- discurso de ódio pesado
- dado pessoal
- ameaça
- **voz identificável de menor de idade** *(acréscimo da Revisão 2 — matchmaking
  em jogo de terror popular vai trazer criança, e isso é risco de política em
  qualquer plataforma para onde o clipe for, inclusive desmonetização e remoção)*

**Implicação de produto não registrada antes:** Shift At Midnight é co-op online
de até três jogadores, e o matchmaking é global. O parceiro aleatório vai falar
inglês na maior parte das vezes. Isso não inviabiliza nada, mas muda o produto: o
humor deixa de ser "cliente que conversa" e passa a ser, em boa parte dos clipes,
"eu surtando enquanto o gringo não entende nada". É bom material — mas tem que
estar no plano de propósito, e o gancho precisa funcionar sem depender de o
espectador entender a fala do terceiro.

### 2.8 Restrições de formato — o que ele NÃO quer parecer

Referências positivas: **Bistecone, Smzinho, LilVinicim.**
Referências negativas: **Gaules, Cerol, Allanzoka.**

Convertido em restrição operacional nesta revisão (a lista negativa nunca tinha
sido usada): **não** construir o plano em cima de live-maratona de
comentarista/mesa, **não** propor formato que dependa de comunidade grande já
existente, **não** propor conteúdo cuja graça esteja na figura pública já
conhecida em vez de no clipe. O eixo é humor, edição e cultura de clipe.

### 2.9 Checklist de publicação — critério dele

Ele mesmo avalia se o clipe está bom o suficiente antes de postar. Não force
checklist formal de publicação em cima disso. *(A rotina de 2.4 não é checklist
de publicação — é leitura pós-publicação, coisa diferente.)*

---

## 3. Tese competitiva — o que entra no lugar de "ninguém posta isso"

**Este é o item que a rodada 3 deixou faltando.** A seção 8 corrige o fato
(Quarantine Zone e Shift At Midnight não são terra de ninguém em português), mas
nunca escreve o que substitui a vantagem que se presumia existir. Sem essa linha,
cada agente futuro reinventa uma diferente.

A pergunta que precisa de resposta escrita: **por que alguém assiste Gol Quadrado
em vez dos canais brasileiros que já postaram Shift At Midnight em julho?**

Proposta, para o streamer confirmar ou reescrever com as palavras dele:

> A vantagem não é o jogo — é a pessoa e o corte. Os canais BR que pegaram a onda
> de julho postaram gameplay comentado em série longa. Gol Quadrado posta o
> **momento**, com reação de rosto no primeiro frame, identidade visual
> reconhecível sem som (retrovisor, paleta, logo), e nenhum contexto exigido do
> espectador. O concorrente real não é o canal que jogou o mesmo jogo — é o
> próximo vídeo do feed.

Isso não é filosofia: é o que dita gancho (5.2), escolha de clipe, bio (7.3) e o
que se corta fora. Assim que estiver aprovado, ele vira o critério de "isso é
conteúdo de Gol Quadrado ou não".

---

## 4. Regras operacionais já resolvidas — daqui sai o calendário

### 4.1 Duração — preset por plataforma, não número único
*(Resolvido na rodada 2, ausente da rodada 3, reinserido aqui.)*

Não existe duração ótima única; o sinal difere por plataforma.

| Destino | Alvo | Motivo |
|---|---|---|
| YouTube Shorts | **30-45s** | Watch time substituiu swipe rate; Short de 15s precisa de ~100% de retenção para passar a barreira de tempo absoluto, um de 35s passa com ~65%. Sub-15s perdeu alcance em 2026 |
| TikTok | **livre, otimizar conclusão** | Taxa de conclusão é o sinal mais forte; acima de ~50% a distribuição cresce independentemente da duração |
| Reação/comédia (qualquer plataforma) | **18-25s** | Setup + punchline, rewatch natural |
| Corte de diálogo/troca longa | **30-45s** | Uma troca só, cortar antes de divagar |

Método de calibração: cortar **o mesmo momento** em duas durações, ler taxa de
conclusão e duração média após ~5 dias (não pico de views), rechecar
trimestralmente. Depende da rotina de 2.4.

**Ação para o CLIP.VOD:** isso deve virar preset de exportação por plataforma,
não decisão manual por clipe.

### 4.2 Gancho — cold-open, rosto no primeiro frame
Abrir com a piada/premissa/momento mais extremo e desenrolar o contexto depois
(5.2). Para conteúdo sem gancho de ação clássico, reação de webcam no primeiro
frame funciona melhor que esperar o jogo entregar ação. Janela: ~1,2s no TikTok,
~2s no Shorts.

### 4.3 Loop — final conecta com o início
Desenhar o fim para fluir de volta ao começo faz o espectador reassistir sem
perceber; replay conta como visualização extra e empurra retenção acima de 100%
(5.3). Método: gravar o final antes, encaixar logo após o começo na mesma sessão,
mover na timeline. Combina com o cold-open: se o colapso do NPC no fim ecoa o tom
do início, o replay vem de graça. Vídeo mais curto faz loop melhor.

### 4.4 Legenda — queimada, com palavra-chave, dentro da zona segura
- **Queimada (burn-in), não nativa.** Legenda queimada também é indexada, via
  OCR — não é "só a nativa que conta pra busca" (5.4).
- **Palavra-chave de nicho na legenda**, não transcrição literal: palavra-chave
  nos primeiros 150 caracteres da legenda de texto, texto na tela nos primeiros
  2-3 segundos, palavra-chave falada logo no início (5.5).
- **Zona segura:** canvas 1080×1920, área segura ~1080×1420. Topo ~140px tem as
  abas; faixa inferior ~1/4 da tela tem usuário/legenda/ícones; lateral direita
  tem a coluna de ações. Legenda mais alta e centralizada no TikTok do que no
  Reels — reaproveitar posicionamento entre plataformas sem ajustar é erro comum
  (5.5).
- **Ação para o CLIP.VOD:** margem como regra técnica dura por preset de
  plataforma, e a faixa central de ~608px de largura útil (handoff, seção 4)
  precisa ser cruzada com a zona segura **de cada plataforma**, não validada uma
  vez pensando só em TikTok.

### 4.5 Hashtag e áudio
- **3-5 hashtags:** uma ampla, duas-três de nicho, uma de marca. Mais que isso
  dilui a categorização (5.5).
- **Áudio original**, que é o caso natural aqui (voz e reação própria): demora
  mais para pegar tração mas tem vida útil ilimitada e favorece reconhecimento de
  marca; som de tendência satura em 1-3 semanas (5.6).
- **Música de fundo nunca abafa a voz** — áudio limpo aparece entre os fatores
  mais citados para retenção sustentada.

### 4.6 Espaçamento e volume
- **3-4h entre posts na mesma conta.** Postar em sequência rápida faz um vídeo
  competir com o outro pela mesma leva de teste (5.6).
- **1 a 4 posts/dia por conta**; acima de 4-5 entra fadiga e risco de sinal de
  spam.
- **20-30 min entre TikTok/Shorts/Reels** do mesmo corte, em vez de simultâneo.
- **Contradição não resolvida:** uma fonte (Eklipse) sustenta que postar mais não
  é penalizado, cada clipe sendo teste de distribuição independente. Fontes de
  qualidade parecida discordam. Tratar espaçamento como a aposta mais segura, sem
  tratá-lo como unânime.
- **Com a arquitetura reduzida a 4 contas (2.1), isso passa a caber num dia
  normal** — era um dos gargalos do desenho de 10 contas.

### 4.7 Mesmo corte em contas e plataformas diferentes
Não há penalidade por postar o mesmo vídeo em TikTok, Instagram e YouTube — as
plataformas não trocam dado de duplicidade (5.4). O que derruba alcance: marca
d'água de outra plataforma, legenda copy-paste idêntica, áudio nativo do TikTok
reusado no Reels. **Nunca baixar vídeo já postado para resubir em outra
plataforma** — sempre subir o arquivo mestre exportado do editor.

Risco real fica dentro da **mesma** plataforma: arquivo idêntico + legenda
idêntica + hashtag idêntica + mesmo horário em duas contas do mesmo nicho faz
elas competirem entre si. Variar capa/primeiro frame, ângulo de legenda, som e
horário se isso acontecer.

### 4.8 Comentário
Fixar comentário não tem efeito medido em nenhum levantamento de 2026 e o recurso
parece estar sendo descontinuado de forma inconsistente (5.6). O que tem dado
real: legenda com pergunta gera ~26% mais comentários; responder comentário com
vídeo cria conteúdo novo linkado de volta ao original. **Rotina recomendada:
responder comentário rápido nas primeiras horas** — é a variável que o caso da
seção 5.9 aponta como decisiva, e com 4 contas ela é executável.

### 4.9 Stitch/Duet — alavanca pontual, não pilar
Conteúdo com Stitch/Duet alcança público 30-50% maior em média que vídeo avulso,
por herdar sobreposição de audiência (5.8). Mas é reagir ao vídeo de **outra
pessoa** dentro do mecanismo nativo — diferente do que o canal já faz. Aplicação
real: Stitch ocasional em cima de trailer oficial do jogo ou de momento viral de
outro criador no mesmo título, para pescar quem já está procurando aquele jogo.
Tática pontual.

---

## 5. Pesquisa — fonte e data

### 5.1 Fase de teste prejudica conta nova? (prioridade 1 do handoff)
Não existe período de calibração com prazo fixo nem penalidade permanente
documentada. O que existe: o TikTok em 2026 dá peso à consistência de nicho no
nível da conta — quem posta consistentemente sobre um tema constrói score de
autoridade de nicho com distribuição mais confiável; conta com mistura de tema
tem distribuição por vídeo menos previsível (Metadata Reactor, abr/2026; Darkroom
Agency, jun/2026 — cita 45% menos alcance para quem posta em 3+ temas não
relacionados). É diluição autocorretiva, não trava permanente.

Ressalva: fontes de 2026 (MSN/Stacker, abr/2026) indicam que o TikTok teria
encerrado o impulso extra de exposição para conta nova — o "colchão de teste de
graça" que existia até 2024 estaria mais fraco.

Como a arquitetura segrega por nicho, o risco fica estruturalmente baixo — cada
conta carrega um tema só.

### 5.2 Gancho para reação/colapso de NPC
Criadores de comédia que performam bem no TikTok em 2026 invertem o ritmo do
stand-up: abrem com a piada/premissa/momento mais extremo e desenrolam o contexto
depois — cold-open comedy (Viryze, mai/2026). Para conteúdo sem gancho de ação
clássico, reação de webcam no primeiro frame funciona melhor que esperar o jogo
entregar ação (Eklipse, mai/2026). Confirma a decisão do handoff de que o facecam
entra no corte vertical.

### 5.3 Loop
Múltiplas fontes independentes, incluindo dado de YouTube Analytics (Virvid,
fev/2026; VoidRuns, jun/2026): final desenhado para fluir de volta ao começo faz
o espectador reassistir sem perceber; replay conta como visualização extra e
sinal de retenção acima de 100%, pesando mais que visualização única.

### 5.4 Legenda queimada e duplicação entre plataformas
Legenda queimada é indexada via OCR — o TikTok lê o vídeo por ASR, OCR de texto
na tela, análise visual de cena e metadado de áudio (ALM Corp, mar/2026;
OpusClip, abr/2026; VSubtitle, mai/2026). Vantagens práticas da queimada: a
nativa tem precisão limitada, não é exportável e não sobrevive fora do app.
Estudo de fornecedor (OpusClip, 13,5 milhões de clipes) reporta 80,2% dos clipes
de tier viral usando burn-in — número a tratar com ressalva por ser comercial,
mas a direção bate com o resto. **Valida o que o CLIP.VOD já faz.**

Duplicação entre plataformas não é penalizada (Socialync, TokPortal, jan/jun
2026); Adam Mosseri confirmou publicamente que editar fora do app não é
penalizado no Instagram, só marca d'água visível (RouteNote, mar/2025).

### 5.5 Descoberta por texto, hashtag e zona segura
Legenda, texto na tela via OCR e fala captada carregam peso igual ou maior que
hashtag para descoberta em 2026; otimizar palavra-chave na legenda pode aumentar
visibilidade em 20-40% (Postr, Sendcove, 2026). Hashtag: 3-5, consenso forte
(MeetEdgar, Sked Social, Postr, Sendcove, 2026).

Zona segura do TikTok, múltiplas fontes convergindo nos mesmos números (Kreatli,
fev/2026; Tareno, abr/2026; Creamate, jul/2026; Blitzcut, jun/2026): canvas
1080×1920, área segura ~1080×1420, topo ~140px, faixa inferior ~1/4 da tela,
coluna de ações à direita, posicionamento diferente no Reels.

### 5.6 Espaçamento, comentário fixado, áudio
Espaçamento 3-4h e limite prático de 1-4 posts/dia: consenso forte (JoinBrands,
EzUGC, Conbersa, 2026); 20-30 min entre plataformas (InfluenceFlow, mar/2026).
Comentário fixado sem efeito medido em 2026, checado contra Buffer, Socialinsider,
Metricool e Dash Social (TTS Vibes, ~ago/2026); legenda com pergunta gera 26,19%
mais comentários (Metricool, 2,3 milhões de posts, jan-fev/2026); responder com
vídeo cria conteúdo derivado (Conbersa, abr/2026). Áudio original vs. tendência:
área com muito número solto e contraditório (+47%, +58%, sem metodologia — tratar
com ceticismo); o padrão confiável entre fontes (Vibesdrop, abr/2026; Conbersa,
mar/jun 2026) é tendência satura em 1-3 semanas, original demora mas tem vida
útil ilimitada.

### 5.7 Onde postar primeiro, e Kick/Twitch como descoberta
Consenso forte, múltiplas fontes independentes (Posteverywhere, Heropost, Digital
Applied, Conbersa, 2026): para crescimento de zero seguidores, **TikTok > YouTube
Shorts > Reels**. TikTok tem distribuição por grafo de interesse pura (conta nova
pode viralizar sem seguidor); Shorts tem ~74% das views vindo de não-inscritos e
cauda longa via busca (TikTok e Reels decaem em 48h, Shorts continua rankeando
por meses); Reels é o mais difícil do zero porque prioriza sinal de comunidade
existente.

Kick como descoberta: **continua sem dado duro de terceiro** (Streams Charts /
SullyGnome) — o handoff pedia e não foi encontrado. O que apareceu aponta que a
descoberta de canal zero no Kick depende de constância e cross-promoção
(mediamister.com, nov/2025), estruturalmente parecido com a limitação da Twitch.
Bate com a decisão de tratar as duas como destino, não como aposta de descoberta.

Contexto de mercado BR (Negócios e Games, ~fim de ago/2026): Twitch segue
referência de live no Brasil; YouTube é o repositório principal de conteúdo
editado e gera a receita publicitária mais estável; Kick cresce pela divisão de
receita mais vantajosa, pressionando as concorrentes.

### 5.8 Stitch/Duet
Conteúdo com Stitch/Duet alcança público 30-50% maior em média que vídeo avulso,
segundo o Creator Portal do TikTok (via Conbersa, jun/2026); análise da Later
associa Stitch/Duet ao menos 2x/semana a crescimento de seguidor 28% mais rápido
(SocialCal, jun/2026).

### 5.9 Nicho, reação e prazo realista
- Reação com facecam bate gameplay puro por 2-5x de engajamento em média (Viryze,
  mar/2026) — valida a aposta central do canal.
- Criador que domina um gênero/jogo específico cresce 3-4x mais rápido em
  seguidor que generalista (mesma fonte) — **valida consistência de nicho por
  conta; não valida operar três nichos ao mesmo tempo (ver 2.1).**
- **Caso prático (Eklipse, abr/2026):** criador de Apex, 800 seguidores, 3 meses
  postando de forma inconsistente. Analisou os próprios 5 melhores vídeos: clipe
  de clutch 1v3 batia 35% de conclusão, montagem de movimento mal passava de 12%.
  Parou de postar qualquer outra coisa, só clutch por 30 dias, respondendo todo
  comentário em até 45 minutos. Em 6 semanas: 8.200 seguidores. O tipo de clipe
  não mudou — a consistência mudou. **É o argumento mais forte a favor da rotina
  de 2.4 e do volume de contas de 2.1.**
- Prazo realista (Eklipse): 45-90 dias para 10 mil seguidores postando diário
  dentro de nicho fechado; zero a 100 mil leva 6-12 meses; quem pula consistência
  de nicho trava ou leva 2-3 anos. **Calibrar expectativa, não é promessa.**

*Ressalva de método:* a busca disponível não indexa Reddit/fórum de forma
profunda — boa parte do que voltava era blog SEO reembalado. O mais próximo de
prática real veio de blog de ferramenta de clipping com caso nomeado (Eklipse,
Cut.Pro).

### 5.10 Bilibili
Operação oficial no Brasil começou em **19/08/2026**, com interface em português,
sem exigência de verificação de identidade para cadastro, e dublagem automática
por IA que traduz áudio de criadores de qualquer país (Times Brasil/CNBC,
TechTudo, Einerd, ago/2026). Antes disso, a exigência de passaporte para
estrangeiro já havia caído e o app internacional foi relançado (Eastleigh Voice,
CineD, AllBlogThings, ~fim de ago/2026). Empresa contratando gestor de comunidade
em São Paulo.

Programa de incentivo: elegibilidade com 1.000 seguidores **ou** 100 mil
visualizações acumuladas, mais verificação de identidade, conteúdo original e
conta de criador. Receita varia por visualização, tempo de exibição, curtidas,
comentários, compartilhamentos, favoritos, presentes virtuais e patrocínio — sem
valor fixo por mil views.

**Continua sem case de criador lusófono documentado** — é lançamento de dias
atrás. Ver decisão 2.6.

### 5.11 Aquecimento de conta (5-10 dias antes do primeiro post)
Múltiplas fontes independentes convergem, incluindo Cut.Pro (fonte brasileira já
confiável nas rodadas anteriores): usar a conta como pessoa real por 5-10 dias
antes de postar — assistir, curtir, comentar, seguir dentro do nicho-alvo, sem
publicar — dá sinal de interesse antes do primeiro vídeo. Motivo técnico
consistente: conta que só publica sem consumir parece bot, e isso derruba alcance
de cara; aquecer também treina o Para Você da própria conta.

Sobre "follower-first testing" (vídeo novo testado primeiro com quem já segue):
padrão amplamente relatado por criador em 2026, mas **não confirmado oficialmente
pelo TikTok** — é modelo reconstruído de analytics (SocialBoostDigital). Para
conta genuinamente zero o mecanismo nem entra em jogo: o vídeo cai direto no
teste por interesse com estranho. O aquecimento é o que substitui, antes do
primeiro seguidor existir, o que "seguidor" faria depois.

**Com 4 contas ativas (2.1), o aquecimento custa 45-60 min/dia por 5-10 dias, em
paralelo aos 2-3 dias de produção hardcore** — em vez das 2h-3h/dia que 9
satélites exigiriam.

*Descartadas de propósito: buycheapestfollowers.com e zefoy.net.pk — vendem
seguidor falso e têm interesse comercial em inflar o problema. Comprar
seguidor/engajamento quebra o próprio sinal que o aquecimento tenta construir.*

---

## 6. Conformidade de multistream — checar antes da primeira live
*(Seção nova na Revisão 2.)*

A Twitch removeu a exclusividade em **outubro de 2023**: Partners e Affiliates
podem transmitir para Twitch, YouTube, Facebook, Kick e outras plataformas
simultaneamente, sem cláusula de exclusividade e sem restrição de qual
plataforma. Mas a Seção 11 dos Termos impõe **três condições** ao broadcast da
Twitch:

1. **Paridade de qualidade.** A experiência na Twitch tem que ser pelo menos tão
   boa quanto nas outras plataformas, incluindo como você interage com o chat da
   Twitch. Enviar versão de qualidade inferior para a Twitch não é permitido.
2. **Não direcionar espectador para fora.** Você não pode mandar o espectador da
   Twitch sair para o stream concorrente. Na prática: **nada de link do Kick no
   chat ou no overlay da Twitch.** Mencionar que multistreama é permitido;
   linkar, não.
3. **Nada de atividade combinada no vídeo da Twitch**, incluindo chat unificado
   de várias plataformas aparecendo na tela. Ler os chats juntos num painel
   privado seu é permitido; exibir o merge no vídeo, não. *(A aplicação de
   penalidade por chat combinado foi suspensa em fev-mar/2026 depois do caso
   Gigguk, mas a regra escrita continua nos Termos — não construa em cima de uma
   enforcement suspensa.)*

**Ação concreta:** o overlay do Gol Quadrado já é elaborado (alertas de PIX/sub,
painel de metas, retrovisor). Passar uma revisão de conformidade nele antes do
dia 1, especificamente atrás de link/menção do Kick e de qualquer widget de chat
agregado. Isso é warning ou suspensão, não penalidade algorítmica — categoria de
risco diferente de tudo o mais neste documento.

**Registrar para depois:** o Kick reduz o repasse de Partner enquanto você está
ao vivo em plataforma concorrente (StreamsCharts, ~jun/2026, e comparativos de
2026). Irrelevante agora; relevante quando os requisitos de Partner do Kick
entrarem no horizonte (na faixa de 30h de stream, 250 chatters únicos, 25
assinantes ativos, 250 seguidores e 75 espectadores médios simultâneos em 30
dias).

---

## 7. Contas — nomes, bios, handles, aquecimento

### 7.1 Contas de referência para o aquecimento
Busca por criador real e verificado por nicho; resultado parcial, registrado com
honestidade:
- **Terror cooperativo:** `@sev7njogos` (Sev7n Jogos) — conta brasileira
  confirmada, posta sobre R.E.P.O. (mesmo gênero). Bom candidato.
- **Formato/edição, fora do nicho exato:** Bistecone (`@bistecone1`) — serve de
  sinal de "tipo de conteúdo".
- **Gestão/loja:** não foi encontrado criador brasileiro com personalidade de
  reação nesse nicho — só tutorial genérico, a maioria fora do português. Não
  forçar nome: aquecer via hashtag no app (`#tcgcardshopsimulator`,
  `#supermarketsimulator`, `#cardshopsimulator`) e seguir o que aparecer
  organicamente. *(Com a decisão 2.1, isso só é necessário quando o nicho 2
  entrar.)*
- **Descartado:** "Victor Hale" apareceu em página de hashtag sobre Shift At
  Midnight, mas pelo contexto parece ser personagem do jogo, não criador.
- **Descartados de propósito:** CaseOh e KeemSama testaram Shift At Midnight com
  milhões de views, mas são americanos, conteúdo em inglês — seguir conta em
  inglês manda sinal errado de idioma/região para o aquecimento.

### 7.2 Conta antiga de empreendedorismo — reaproveitar ou não
**Pendente de dado que o streamer ainda não passou:** quantos seguidores tem e há
quanto tempo está parada.

Mecanismo, para registro: existem dois resets diferentes. Do lado de quem
assiste: Perfil → Configurações → Preferências de conteúdo → "Atualizar seu feed
Para Você", mais limpar histórico e seguir 10-20 contas do nicho novo — pivota em
24-72h (Hubfluence, Socialync, 2026). Do lado do que a conta distribui: não
reseta instantâneo — postagem consistente dentro do nicho reconstrói o perfil em
2-3 semanas (Multilogin, mar/2026), prazo parecido com o que uma conta nova leva
para os primeiros 5-10 vídeos definirem o nicho.

**Risco que conta nova não tem:** se ainda houver seguidor de empreendedorismo,
postar clipe de jogo para esse público gera pular/não engajar — pior que não ter
seguidor nenhum, porque manda sinal de baixo engajamento cedo em vez do teste
limpo com desconhecido.

**Recomendação condicional:** poucos seguidores ou conta morta → criar nova.
Seguidor real e ativo (milhares, engajamento recente) → vale reaproveitar,
arquivando conteúdo antigo, trocando bio/username/foto antes do primeiro post,
fazendo o reset do lado de quem assiste, e aceitando 2-3 semanas de
recategorização.

### 7.3 Nomes, handles e bios
**Conta principal** — `@golquadrado` não está mais disponível. Ordem de
preferência: `@golquadradooficial` → `@golquadrado.oficial` →
`@golquadradolive`. **Confirmar disponibilidade nas 3 plataformas antes de
criar** — o mesmo handle deve valer em TikTok, Shorts e Reels.

**Satélite terror** (handle definido: `golquadradocortes`) — ativo no dia 1:
- Nome de exibição: **Gol Quadrado Terror**
- Bio: "Turno sozinho. Cliente estranho. Ele não pisca 😨 / terror cooperativo |
  @golquadrado[oficial]"

**Satélite gestão** (handle definido: `golquadradoclip`) — **criado e reservado,
sem publicar** até o nicho 1 ter dado (2.1):
- Nome de exibição: **Gol Quadrado Gestão**
- Bio: "Abri uma loja. Devia ter pensado melhor 🛒 / simulador de gestão |
  @golquadrado[oficial]"

Lógica das bios: primeira linha é gancho em cold-open (abre na tensão, não
explica o conceito — mesma lógica de 4.2, aplicada à bio porque é a primeira
coisa lida antes de decidir seguir); segunda linha carrega a palavra-chave de
nicho que o algoritmo lê (4.4) e fecha o funil para a principal. Ajustar o
`@golquadrado` assim que o handle real for confirmado. Bio do TikTok limita em
torno de 80 caracteres — se cortar, cortar a segunda linha antes da primeira.

---

## 8. Correções e itens descartados

### 8.1 "Competição em português quase nula" no Quarantine Zone — DESCARTAR
Uma lista de roadmap colada na rodada 3 trouxe de volta essa frase para o item 6.
É exatamente a premissa que o handoff, seção 6.1, já havia refutado com fonte: o
jogo tem interface e legenda em PT-BR, mais de 11.527 análises "Muito positivas"
na Steam, vendeu 500 mil+ cópias na primeira semana e tem cobertura editorial
brasileira (Omelete, Press Attack). O resto daquela lista (datas, critérios
técnicos, ordem) parece válido — só essa frase deve ser descartada, a menos que
apareça fonte nova. **Ver seção 3 para o que entra no lugar.**

### 8.2 "14x mais engajamento nativo vs. externo" — DESCARTAR
Rastreado: aparece em fonte única (ALM Corp), que alega dado do próprio TikTok
sem citar fonte primária, link ou metodologia. Nenhuma outra fonte reproduz,
incluindo estudo acadêmico (ACM/CHI 2024, 9,2 milhões de recomendações). E
contradiz o que a Meta confirmou oficialmente para o Instagram (4.7). Estatística
de blog sem lastro. **Não muda nada no fluxo do CLIP.VOD.**

### 8.3 Local Feed do TikTok no Brasil — NÃO disponível
Confirmado via cobertura de lançamento (TikTok Newsroom, TechCrunch, CBS News,
fev/2026): rodou na Europa (Reino Unido, França, Itália, Alemanha, dez/2025) e
depois nos EUA (fev/2026). Nenhuma cobertura até ago/2026 menciona expansão para
Brasil ou América Latina. **Não contar com essa função como alavanca.** O sinal
geral de localização (idioma, região, dispositivo) continua valendo; só a aba
dedicada não chegou.

### 8.4 Reencode penaliza? — mito, mas checar metadado C2PA
Nenhuma fonte encontrada afirma que reprocessar/reencodar carrega penalidade
própria — mesma categoria do comentário fixado. **Mas** o TikTok escaneia o
arquivo atrás de metadado C2PA/XMP e aplica rótulo automático de "conteúdo
gerado/editado por IA" quando encontra, mesmo com a maior parte do vídeo sendo
filmagem real (AuditSocials, mai/2026; nota: sites de remoção de metadado têm
incentivo comercial, mas o mecanismo C2PA é confirmado por fonte de compliance).
O rótulo em si não reduz alcance segundo o próprio TikTok, mas há indício de que
ser flagrado sem se autodeclarar pesa mais que declarar proativamente.

**Ação de baixo custo:** exportar um clipe final e checar com `exiftool` se o
pipeline (ffmpeg, Whisper) deixa resíduo C2PA/XMP. Não deveria, já que nada gera
imagem sintética — mas o rótulo é automático por presença de metadado, não por
julgamento de conteúdo.

---

## 9. Em aberto

1. **Tese competitiva (seção 3)** — aprovar, reescrever ou substituir. Bloqueia
   critério de corte de clipe.
2. **Conta antiga de empreendedorismo (7.2)** — pendente do número de seguidores.
3. **Dado duro de descoberta no Kick para canal zero (5.7)** — Streams Charts,
   SullyGnome ou equivalente. Pedido desde o handoff, ainda não encontrado.
4. **Case de criador lusófono no Bilibili (5.10)** — revisitar em 60 dias junto
   com a decisão 2.6.
5. **Contradição volume vs. espaçamento (4.6)** — fontes de qualidade parecida
   discordando; só se resolve com dado próprio, via rotina de 2.4.
6. **Nicho 3** — não nomeado. Não nomear antes do nicho 1 ter dado.
7. **Revisão de conformidade do overlay (seção 6)** — checagem prática pendente,
   antes da primeira live.
8. **Teste de 2 minutos de gravação no OBS** — pendência técnica mais antiga do
   projeto inteiro (handoff, seção 9). Confirmar se já foi feito.
