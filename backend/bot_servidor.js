const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let configSolicitada = { timeframe: 'M1', mercado: 'OTC' };
let ativosIgnoradosLista = [];
let sinaisParaAvaliar = [];

// LISTA DE PALAVRAS PROIBIDAS (Ações e Empresas)
const ACOES_PROIBIDAS = [
    'TESLA', 'FORD', 'OPENAI', 'SPACEX', 'ANTHROPIC', 'APPLE', 'MICROSOFT', 
    'AMAZON', 'GOOGLE', 'META', 'NETFLIX', 'NVIDIA', 'INTEL', 'IBM', 
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

        console.log("✅ SDK inicializado! Modo Turbo ativado (Apenas Moedas/Criptos).");

        // Busca a cada 10 segundos (mais rápido)
        setInterval(async () => {
            if (!isBuscando && global.buscando) {
                await buscarAnaliseServidor();
            }
        }, 10000);

        // Avaliação a cada 10 segundos
        setInterval(async () => {
            await verificarResultados();
        }, 10000);

    } catch (error) {
        console.error("❌ Erro ao conectar no servidor:", error.message);
    }
}

// --- MATEMÁTICA SIMPLIFICADA ---
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

function calcularATR(highs, lows, closes, period = 14) {
    if (closes.length < period + 1) return 0;
    let trs = [];
    for (let i = 1; i < closes.length; i++) {
        const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
        trs.push(tr);
    }
    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// --- O CÉREBRO SIMPLIFICADO ---
function analisarGraficoComEstrategias(candles) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);
    const atual = candles[candles.length - 1];
    const spike = candles[candles.length - 2]; 
    
    const rsi = calcularRSI(closes, 14);
    const atr = calcularATR(highs, lows, closes, 14);
    const ema50 = calcularEMA(closes, 50); 

    let sinalEncontrado = null;

    // ESTRATÉGIA 1: TENDÊNCIA (Sem filtro de ADX, mais fácil de achar)
    if (spike.close < ema50 && atual.close > ema50 && atual.close > atual.open) {
        sinalEncontrado = { direcao: "CALL", estrategia: "Tendência (Pullback Compra)", confianca: 90 };
    }
    if (spike.close > ema50 && atual.close < ema50 && atual.close < atual.open) {
        sinalEncontrado = { direcao: "PUT", estrategia: "Tendência (Pullback Venda)", confianca: 90 };
    }

    // ESTRATÉGIA 2: SPIKE REVERSAL (Mais permissivo)
    if (!sinalEncontrado) {
        const isSpike = (spike.max - spike.min) > (atr * 1.5); 
        if (isSpike) {
            const corpo = Math.abs(spike.close - spike.open);
            const pavioSup = spike.max - Math.max(spike.open, spike.close);
            const pavioInf = Math.min(spike.open, spike.close) - spike.min;

            if (spike.close > spike.open && pavioSup > corpo && atual.close < atual.open && rsi > 60) {
                sinalEncontrado = { direcao: "PUT", estrategia: "Spike Reversal (Venda)", confianca: 85 };
            }
            if (spike.close < spike.open && pavioInf > corpo && atual.close > atual.open && rsi < 40) {
                sinalEncontrado = { direcao: "CALL", estrategia: "Spike Reversal (Compra)", confianca: 85 };
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
            
            // FILTRO ANTI-AÇÕES: Verifica se o nome do ativo tem alguma palavra proibida
            let ehAcao = false;
            for (let palavra of ACOES_PROIBIDAS) {
                if (a.ticker.toUpperCase().includes(palavra)) {
                    ehAcao = true;
                    break;
                }
            }

            // Só retorna true (permite a análise) se NÃO for ação
            return mercadoOk && estaAberto && !jaFoiMostrado && !ehAcao;
        });

        if (ativosFiltrados.length === 0) {
            ativosIgnoradosLista = [];
            ativosFiltrados = actives.filter(a => {
                const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
                let ehAcao = false;
                for (let palavra of ACOES_PROIBIDAS) {
                    if (a.ticker.toUpperCase().includes(palavra)) { ehAcao = true; break; }
                }
                return mercadoOk && a.canBeBoughtAt(now) && !ehAcao;
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

// --- AUTO-AVALIAÇÃO SIMPLIFICADA (MANTIDA COMO ESTAVA) ---
async function verificarResultados() {
    if (!sdk || sinaisParaAvaliar.length === 0) return;
    
    const agora = new Date();
    const segundosAgora = agora.getSeconds();
    if (segundosAgora < 15 || segundosAgora > 25) return; 

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