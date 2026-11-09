const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let configSolicitada = { timeframe: 'M1', mercado: 'OTC' };
let ativosIgnoradosLista = [];
let sinaisParaAvaliar = [];

// LISTA NEGRA: Ações, Índices e Empresas que NÃO queremos operar
const ACOES_E_INDICES_PROIBIDOS = [
    'AAPL', 'APPLE', 'MSFT', 'MICROSOFT', 'TSLA', 'TESLA', 'AMZN', 'AMAZON', 
    'GOOGL', 'GOOGLE', 'META', 'FACEBOOK', 'NFLX', 'NETFLIX', 'NVDA', 'NVIDIA', 
    'INTC', 'INTEL', 'IBM', 'FORD', 'OPENAI', 'SPACEX', 'ANTHROPIC', 'DAX', 
    'S&P', 'SP500', 'NASDAQ', 'US100', 'US30', 'DOWJONES', 'JP225', 
    'COCA', 'PEPSI', 'MCDONALD', 'BOEING', 'PFIZER', 'JOHNSON'
];

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

        console.log("✅ SDK inicializado! Cérebro Supremo (Filtro Anti-Ações) ativo.");

        setInterval(async () => {
            if (!isBuscando && global.buscando) {
                await buscarAnaliseServidor();
            }
        }, 10000);

        setInterval(async () => {
            await verificarResultados();
        }, 10000);

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
    if (closes.length < period) return { adx: 0 };
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
    return { adx: dx };
}

function converterParaHeikinAshi(candles) {
    let haCandles = [];
    for (let i = 0; i < candles.length; i++) {
        const close = (candles[i].open + candles[i].max + candles[i].min + candles[i].close) / 4;
        let open;
        if (i === 0) {
            open = (candles[i].open + candles[i].close) / 2;
        } else {
            open = (haCandles[i - 1].open + haCandles[i - 1].close) / 2;
        }
        haCandles.push({
            open: open,
            close: close,
            max: Math.max(candles[i].max, open, close),
            min: Math.min(candles[i].min, open, close)
        });
    }
    return haCandles;
}


// --- O CÉREBRO SUPREMO (MÚLTIPLOS MOTORES) ---
function analisarGraficoComEstrategias(candles) {
    // --- MOTOR 1: TENDÊNCIA (Emas + RSI) ---
    const closes = candles.map(c => c.close);
    const rsi = calcularRSI(closes);
    const ema9 = calcularEMA(closes, 9);
    const ema21 = calcularEMA(closes, 21);
    const atual = candles[candles.length - 1];
    const anterior = candles[candles.length - 2];

    // Sinal de tendência: Emas cruzadas e RSI confirma
    if (ema9 > ema21 && anterior.close < anterior.open && atual.close > atual.open && rsi > 50) {
        return { direcao: "CALL", estrategia: "Tendência (EMA+RSI)", confianca: 92 };
    }
    if (ema9 < ema21 && anterior.close > anterior.open && atual.close < atual.open && rsi < 50) {
        return { direcao: "PUT", estrategia: "Tendência (EMA+RSI)", confianca: 92 };
    }

    // --- MOTOR 2: CONSOLIDAÇÃO (Bollinger + ADX) ---
    const adxData = calcularADX(candles.map(c=>c.max), candles.map(c=>c.min), closes);
    if (adxData.adx < 20) { // Se o mercado está lateral
        const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const desvioPadrao = Math.sqrt(closes.slice(-20).reduce((acc, val) => acc + Math.pow(val - sma20, 2), 0) / 20);
        const bandaSuperior = sma20 + (desvioPadrao * 2);
        const bandaInferior = sma20 - (desvioPadrao * 2);

        // Reversão na banda
        if (atual.max > bandaSuperior && atual.close < bandaSuperior) {
            return { direcao: "PUT", estrategia: "Consolidação (Bollinger)", confianca: 88 };
        }
        if (atual.min < bandaInferior && atual.close > bandaInferior) {
            return { direcao: "CALL", estrategia: "Consolidação (Bollinger)", confianca: 88 };
        }
    }

    // --- MOTOR 3: HEIKIN ASHI (Tendência Forte) ---
    const haCandles = converterParaHeikinAshi(candles);
    const haAtual = haCandles[haCandles.length - 1];
    const haAnterior = haCandles[haCandles.length - 2];
    const haAnterior2 = haCandles[haCandles.length - 3];

    // 3 velas HA verdes + RSI forte
    if (haAtual.close > haAtual.open && haAnterior.close > haAnterior.open && haAnterior2.close > haAnterior2.open && rsi > 60) {
         return { direcao: "CALL", estrategia: "Heikin Ashi (Tendência)", confianca: 95 };
    }
    // 3 velas HA vermelhas + RSI fraco
    if (haAtual.close < haAtual.open && haAnterior.close < haAnterior.open && haAnterior2.close < haAnterior2.open && rsi < 40) {
         return { direcao: "PUT", estrategia: "Heikin Ashi (Tendência)", confianca: 95 };
    }
    
    return null;
}

async function buscarAnaliseServidor() {
    if (!sdk || !global.buscando) return;
    isBuscando = true;

    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        const now = sdk.currentTime();

        let ativosFiltrados = actives.filter(a => {
            const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
            const estaAberto = a.canBeBoughtAt(now);
            const jaFoiMostrado = ativosIgnoradosLista.includes(a.ticker);
            
            // FILTRO ANTI-AÇÕES E ÍNDICES
            let ehProibido = false;
            for (let palavra of ACOES_E_INDICES_PROIBIDOS) {
                if (a.ticker.toUpperCase().includes(palavra)) {
                    ehProibido = true;
                    break;
                }
            }

            return mercadoOk && estaAberto && !jaFoiMostrado && !ehProibido;
        });

        if (ativosFiltrados.length === 0) {
            ativosIgnoradosLista = [];
            ativosFiltrados = actives.filter(a => {
                const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
                let ehProibido = false;
                for (let palavra of ACOES_E_INDICES_PROIBIDOS) {
                    if (a.ticker.toUpperCase().includes(palavra)) { ehProibido = true; break; }
                }
                return mercadoOk && a.canBeBoughtAt(now) && !ehProibido;
            });
        }
        
        let melhoresSinais = [];

        for (let i = 0; i < ativosFiltrados.length; i += 5) {
            if (!global.buscando) break;
            const lote = ativosFiltrados.slice(i, i + 5);

            const res = await Promise.all(lote.map(async (ativo) => {
                const seconds = configSolicitada.timeframe === 'M5' ? 300 : 60;
                const layer = await sdk.realTimeChartDataLayer(ativo.id, seconds);
                const count = 50; // Otimização: lendo 50 velas
                const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (count * seconds));

                if (!candles || candles.length < 30) return null;

                const resultado = analisarGraficoComEstrategias(candles);

                if (resultado) {
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
                        id: Date.now(),
                        status: "PENDENTE"
                    };
                }
                return null;
            }));
            melhoresSinais = melhoresSinais.concat(res.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0 && global.buscando) {
            melhoresSinais.sort((a, b) => b.confianca - a.confianca);
            const campeao = melhoresSinais[0];
            
            const agora = new Date();
            const segundosRestantes = 60 - agora.getSeconds();
            
            if (segundosRestantes >= 10) {
                ativosIgnoradosLista.push(campeao.tickerReal);
                ultimoAtivoEnviado = campeao.tickerReal;
                console.log(`\n🏆 [SINAL] ${campeao.ativo} | ${campeao.direcao} | ${campeao.estrategia} | Entrada: ${campeao.horario}`);
                
                sinaisParaAvaliar.push(campeao); 
                
                if (global.adicionarSinal) global.adicionarSinal(campeao);
            }
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

// --- AUTO-AVALIAÇÃO ---
async function verificarResultados() {
    if (!sdk || sinaisParaAvaliar.length === 0) return;
    const agora = new Date();
    if (agora.getSeconds() > 10) return; 

    const sinaisParaRemover = [];
    for (let i = 0; i < sinaisParaAvaliar.length; i++) {
        const sinal = sinaisParaAvaliar[i];
        try {
            const seconds = sinal.timeframe === 'M5' ? 300 : 60;
            const layer = await sdk.realTimeChartDataLayer(sinal.tickerReal, seconds);
            const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (5 * seconds));

            if (candles && candles.length >= 2) {
                const velaFechada = candles[candles.length - 2];
                let result = "EMPATE";
                if (sinal.direcao === "CALL" || sinal.direcao === "COMPRA") {
                    if (velaFechada.close > velaFechada.open) result = "WIN";
                    else if (velaFechada.close < velaFechada.open) result = "LOSS";
                } else if (sinal.direcao === "PUT" || sinal.direcao === "VENDA") {
                    if (velaFechada.close < velaFechada.open) result = "WIN";
                    else if (velaFechada.close > velaFechada.open) result = "LOSS";
                }

                sinal.status = result;
                console.log(`📊 [RESULTADO] ${sinal.ativo} | ${sinal.direcao} | ${result}`);
                if (global.adicionarSinal) global.adicionarSinal(sinal);
                sinaisParaRemover.push(i);
            }
        } catch (e) {
            sinaisParaRemover.push(i);
        }
    }

    for (let i = sinaisParaRemover.length - 1; i >= 0; i--) {
        sinaisParaAvaliar.splice(sinaisParaRemover[i], 1);
    }
}

function getHoraProximaVela() {
    const agora = new Date();
    const proximoMinuto = Math.floor(agora.getTime() / 60000) * 60000 + 60000;
    return new Date(proximoMinuto).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

module.exports = { iniciarBotServidor };