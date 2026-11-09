const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let configSolicitada = { timeframe: 'M1', mercado: 'OTC' };
let ativosIgnoradosLista = [];
let sinaisParaAvaliar = []; 

// --- LISTA BRANCA DE ATIVOS REAIS DA CORRETORA ---
const listaPermitida = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
    'EURGBP', 'EURJPY', 'GBPJPY', 'AUDCAD', 'EURAUD', 'EURCHF', 'AUDJPY', 'CHFJPY',
    'CADJPY', 'NZDJPY', 'GBPCHF', 'GBPAUD', 'GBPCAD', 'AUDNZD', 'EURNZD',
    'USDSEK', 'USDMXN', 'USDZAR', 'USDTHB', 'USDSGD',
    'BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'SOLUSD', 'BNBUSD', 'DOGEUSD',
    'XAUUSD', 'XAGUSD', 'US100', 'US500', 'US30', 'GER30', 'UK100',
    'AAPL', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NVDA', 'NFLX'
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

        console.log("✅ SDK inicializado! Filtro de Ativos Permitidos e EMA9 ativados.");

        // Loop de busca de sinais
        setInterval(async () => {
            if (!isBuscando && global.buscando) {
                await buscarAnaliseServidor();
            }
        }, 15000);

        // Loop de checagem de resultados (Auto-Avaliação)
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

// --- O CÉREBRO SNIPER HÍBRIDO (COM FILTRO EMA 9) ---
function analisarGraficoComEstrategias(candles, nomeAtivo) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);
    
    const atual = candles[candles.length - 1];
    const spike = candles[candles.length - 2]; 
    
    const rsi = calcularRSI(closes, 14);
    const atr = calcularATR(highs, lows, closes, 14);
    const adxData = calcularADX(highs, lows, closes, 14);
    
    // MÉDIAS MÓVEIS: Curto Prazo (9) e Médio Prazo (50)
    const ema9 = calcularEMA(closes, 9); 
    const ema50 = calcularEMA(closes, 50); 

    const horaAtual = new Date().getHours();
    if (horaAtual < 8 || horaAtual >= 18) return null; 

    const forcaTendencia = adxData.adx;
    let sinalEncontrado = null;

    // ESTRATÉGIA 1: TENDÊNCIA FORTE (Pullback)
    if (forcaTendencia > 25) {
        // CALL: Só entra se o preço estiver acima da EMA 9 (maré de curto prazo é de alta)
        if (spike.close < ema50 && atual.close > ema50 && atual.close > atual.open && atual.close > ema9) {
            sinalEncontrado = { direcao: "CALL", estrategia: "Tendência (Pullback Compra)", confianca: 90 };
        }
        // PUT: Só entra se o preço estiver abaixo da EMA 9 (maré de curto prazo é de baixa)
        if (spike.close > ema50 && atual.close < ema50 && atual.close < atual.open && atual.close < ema9) {
            sinalEncontrado = { direcao: "PUT", estrategia: "Tendência (Pullback Venda)", confianca: 90 };
        }
    }

    // ESTRATÉGIA 2: SPIKE REVERSAL
    if (!sinalEncontrado && forcaTendencia < 20) {
        const rangeSpike = spike.max - spike.min;
        const isSpike = rangeSpike > (atr * 2); 

        if (isSpike) {
            const corpoSpike = Math.abs(spike.close - spike.open);
            const pavioSuperior = spike.max - Math.max(spike.open, spike.close);
            const pavioInferior = Math.min(spike.open, spike.close) - spike.min;

            // PUT: Preço tem que estar abaixo ou na EMA 9. Se estiver voando, bloqueia.
            if (spike.close > spike.open && pavioSuperior > corpoSpike && rsi > 65 && atual.close < atual.open && atual.close < spike.close && atual.close <= ema9) {
                sinalEncontrado = { direcao: "PUT", estrategia: "Spike Reversal (Venda)", confianca: 92 };
            }
            // CALL: Preço tem que estar acima ou na EMA 9.
            if (spike.close < spike.open && pavioInferior > corpoSpike && rsi < 35 && atual.close > atual.open && atual.close > spike.close && atual.close >= ema9) {
                sinalEncontrado = { direcao: "CALL", estrategia: "Spike Reversal (Compra)", confianca: 92 };
            }
        }
    }
    return sinalEncontrado;
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
            
            // MÁGICA DO FILTRO WHITELIST
            const tickerLimpo = a.ticker.replace('-OTC', '').toUpperCase();
            const estaNaListaPermitida = listaPermitida.includes(tickerLimpo);

            return mercadoOk && estaAberto && !jaFoiMostrado && estaNaListaPermitida;
        });

        if (ativosFiltrados.length === 0) {
            ativosIgnoradosLista = [];
            ativosFiltrados = actives.filter(a => {
                const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
                const tickerLimpo = a.ticker.replace('-OTC', '').toUpperCase();
                return mercadoOk && a.canBeBoughtAt(now) && listaPermitida.includes(tickerLimpo);
            });
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

                const resultado = analisarGraficoComEstrategias(candles, ativo.ticker);

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
            
            // Trava de tempo para não mandar sinal no final da vela
            if (segundosRestantes >= 15) {
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

// --- FUNÇÃO DE AUTO-AVALIAÇÃO (WIN/LOSS) COM RETRY ---
async function verificarResultados() {
    if (!sdk || sinaisParaAvaliar.length === 0) return;
    
    const agora = new Date();
    const segundosAgora = agora.getSeconds();
    
    // Roda entre os segundos 15 e 25 para dar tempo da Polarium processar
    if (segundosAgora < 15 || segundosAgora > 25) return; 

    const sinaisParaRemover = [];

    for (let i = 0; i < sinaisParaAvaliar.length; i++) {
        const sinal = sinaisParaAvaliar[i];
        let sucesso = false;
        
        for (let tentativa = 1; tentativa <= 2; tentativa++) {
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
                    sucesso = true;
                    break; 
                }
            } catch (e) {
                if (tentativa === 2) {
                    console.log(`❌ [AVALIAÇÃO] Erro definitivo ao buscar dados de ${sinal.ativo}. Removendo.`);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        sinaisParaRemover.push(i);
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