const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;
let configSolicitada = { timeframe: 'M1', mercado: 'OTC' };
let ativosIgnoradosLista = [];

global.definirConfiguracao = (config) => {
    configSolicitada = config;
    console.log(`🤖 Cérebro atualizado: Foco em ${config.timeframe} | Mercado ${config.mercado}`);
};

global.resetarAtivos = () => {
    ativosIgnoradosLista = [];
    ultimoAtivoEnviado = null;
};

async function iniciarBotServidor(window, tokenSsid) {
    if (!tokenSsid) return console.error("❌ Token não configurado.");
    console.log("⏳ Iniciando SDK no servidor...");
    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;
        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;

        console.log("✅ SDK inicializado! O Cérebro de Confluência Profissional está ativo.");

        setInterval(async () => {
            if (!isBuscando && global.buscando) {
                await buscarAnaliseServidor();
            }
        }, 15000);
    } catch (error) {
        console.error("❌ Erro ao conectar no servidor:", error.message);
    }
}

// --- MATEMÁTICA DOS INDICADORES ---
function calcularEMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const k = 2 / (period + 1);
    let ema = dados.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dados.length; i++) ema = dados[i] * k + ema * (1 - k);
    return ema;
}

function calcularRSI(closes, period = 14) {
    if (closes.length < period) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calcularADX(highs, lows, closes, period = 14) {
    if (closes.length < period) return { adx: 0, plusDI: 0, minusDI: 0 };
    let trs = [], plusDMs = [], minusDMs = [];
    for (let i = 1; i < closes.length; i++) {
        const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
        trs.push(tr);
        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];
        plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    const avgTR = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgPlusDM = plusDMs.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgMinusDM = minusDMs.slice(-period).reduce((a, b) => a + b, 0) / period;
    const plusDI = avgTR === 0 ? 0 : (avgPlusDM / avgTR) * 100;
    const minusDI = avgTR === 0 ? 0 : (avgMinusDM / avgTR) * 100;
    const dx = (plusDI + minusDI) === 0 ? 0 : Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    return { adx: dx, plusDI, minusDI };
}

function calcularATR(highs, lows, closes, period = 14) {
    if (closes.length < period + 1) return 0;
    let trs = [];
    for (let i = 1; i < closes.length; i++) {
        const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
        trs.push(tr);
    }
    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// --- O NOVO CÉREBRO: CONFLUÊNCIA PROFISSIONAL ---
function analisarGraficoComEstrategias(candles) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);
    const atual = candles[candles.length - 1];
    const anterior = candles[candles.length - 2];

    // 1. Cálculo dos Indicadores Base
    const ema50 = calcularEMA(closes, 50);
    const ema200 = calcularEMA(closes, 200);
    const rsi = calcularRSI(closes, 14);
    const atr = calcularATR(highs, lows, closes, 14);
    const adxData = calcularADX(highs, lows, closes, 14);

    // 2. Definição do Viés (Filtro Macro)
    let vies = null;
    if (ema50 > ema200 && atual.close > ema200) vies = "CALL";
    if (ema50 < ema200 && atual.close < ema200) vies = "PUT";

    // Se não houver uma tendência clara definida pelas EMAs, o robô ignora o ativo.
    if (!vies) return null;

    const forcaTendencia = adxData.adx;
    let sinalEncontrado = null;

    // --- CENÁRIO A: TENDÊNCIA FORTE (ADX > 25) -> Seguir o Fluxo com Pullback ---
    if (forcaTendencia > 25) {
        // Lógica: Se o viés é de alta (CALL), e a vela anterior fechou abaixo da EMA50, mas a atual fechou acima, é um sinal de continuação da tendência.
        if (vies === "CALL" && anterior.close < ema50 && atual.close > ema50) {
            sinalEncontrado = { direcao: "CALL", estrategia: "Tendência (Pullback EMA50)", confianca: 90 };
        }
        if (vies === "PUT" && anterior.close > ema50 && atual.close < ema50) {
            sinalEncontrado = { direcao: "PUT", estrategia: "Tendência (Pullback EMA50)", confianca: 90 };
        }
    }

    // --- CENÁRIO B: MERCADO LATERAL (ADX < 20) -> Reversão em Exaustão ---
    else if (forcaTendencia < 20) {
        const rangeVela = atual.max - atual.min;
        // Define um "Spike" como uma vela com um range 2x maior que o ATR.
        const isSpike = rangeVela > (atr * 2); 

        if (isSpike) {
            const corpo = Math.abs(atual.close - atual.open);
            const pavioSuperior = atual.max - Math.max(atual.open, atual.close);
            const pavioInferior = Math.min(atual.open, atual.close) - atual.min;

            // Sinal de VENDA (PUT): Spike de alta com pavio superior grande (rejeição) e RSI em sobrecompra.
            if (atual.close > atual.open && pavioSuperior > corpo && rsi > 65) {
                sinalEncontrado = { direcao: "PUT", estrategia: "Reversão (Spike de Exaustão)", confianca: 88 };
            }
            // Sinal de COMPRA (CALL): Spike de baixa com pavio inferior grande (rejeição) e RSI em sobrevenda.
            if (atual.close < atual.open && pavioInferior > corpo && rsi < 35) {
                sinalEncontrado = { direcao: "CALL", estrategia: "Reversão (Spike de Exaustão)", confianca: 88 };
            }
        }
    }

    return sinalEncontrado;
}

async function buscarAnaliseServidor() {
    if (!sdk || !global.buscando) return;
    isBuscando = true;

    console.log(`🔎 [ROBÔ] Executando Análise com Cérebro de Confluência (Lendo 100 velas)...`);

    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        const now = sdk.currentTime();

        let ativosFiltrados = actives.filter(a => {
            const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
            const estaAberto = a.canBeBoughtAt(now);
            const jaFoiMostrado = ativosIgnoradosLista.includes(a.ticker);
            return mercadoOk && estaAberto && !jaFoiMostrado;
        });

        if (ativosFiltrados.length === 0) {
            ativosIgnoradosLista = [];
            ativosFiltrados = actives.filter(a => (configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC')) && a.canBeBoughtAt(now));
        }
        let melhoresSinais = [];

        for (let i = 0; i < ativosFiltrados.length; i += 5) {
            if (!global.buscando) break;
            const lote = ativosFiltrados.slice(i, i + 5);

            const res = await Promise.all(lote.map(async (ativo) => {
                const seconds = configSolicitada.timeframe === 'M5' ? 300 : 60;
                const layer = await sdk.realTimeChartDataLayer(ativo.id, seconds);
                const count = 100;
                const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (count * seconds));

                if (!candles || candles.length < 50) return null;

                const resultado = analisarGraficoComEstrategias(candles);

                if (resultado) {
                    // Formata o nome para ficar legível
                    let nomeBonito = ativo.ticker.replace('-OTC', ' (OTC)');
                    return {
                        ativo: nomeBonito,
                        tickerReal: ativo.ticker,
                        timeframe: configSolicitada.timeframe,
                        direcao: resultado.direcao,
                        confianca: resultado.confianca,
                        estrategia: resultado.estrategia,
                        mercado: configSolicitada.mercado,
                        horario: getHoraProximaVela(),
                        id: Date.now()
                    };
                }
                return null;
            }));
            melhoresSinais = melhoresSinais.concat(res.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0 && global.buscando) {
            melhoresSinais.sort((a, b) => b.confianca - a.confianca);
            const campeao = melhoresSinais[0];
            ativosIgnoradosLista.push(campeao.tickerReal); // Adiciona o ticker original à lista de ignorados
            ultimoAtivoEnviado = campeao.tickerReal;

            console.log(`🏆 [SINAL] ${campeao.ativo} | ${campeao.direcao} | ${campeao.estrategia} (Confiança: ${campeao.confianca}%)`);
            if (global.adicionarSinal) global.adicionarSinal(campeao);
        } else if (global.buscando) {
            console.log(`⚠️ Nenhum setup de alta probabilidade encontrado com o Cérebro de Confluência. Retentando...`);
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

function getHoraProximaVela() {
    const agora = new Date();
    const proximoMinuto = Math.floor(agora.getTime() / 60000) * 60000 + 60000;
    return new Date(proximoMinuto).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

module.exports = { iniciarBotServidor };