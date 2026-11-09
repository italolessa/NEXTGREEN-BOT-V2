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

        console.log("✅ SDK inicializado! Cérebro NextGreen (Confluência Real) ativo.");

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

// --- O CÉREBRO NEXTGREEN CLONADO ---
function analisarGraficoComEstrategias(candles) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);
    const atual = candles[candles.length - 1];
    
    const rsi = calcularRSI(closes, 14);
    const adxData = calcularADX(highs, lows, closes, 14);
    const adx = adxData.adx;
    const atr = calcularATR(highs, lows, closes, 14);
    const ema50 = calcularEMA(closes, 50); 

    let sinalEncontrado = null;

    // 1. ANÁLISE DE CONSISTÊNCIA (Contagem de Velas)
    // Pega as últimas 15 velas (não incluindo a atual que está formando)
    const ultimas15 = candles.slice(-16, -1);
    let verdes = 0, vermelhas = 0;
    for (let c of ultimas15) {
        if (c.close > c.open) verdes++;
        else if (c.close < c.open) vermelhas++;
    }
    const totalVelas = verdes + vermelhas;
    const porcentagemVermelhas = totalVelas > 0 ? (vermelhas / totalVelas) * 100 : 0;
    const porcentagemVerdes = totalVelas > 0 ? (verdes / totalVelas) * 100 : 0;

    // 2. LÓGICA DE SINAL (Baseada na Mesa de Decisão)
    // Exemplo: Queda forte = RSI < 30 e ADX > 25 e maioria das velas vermelhas
    
    // SINAL DE VENDA (PUT)
    if (rsi < 35 && adx > 25 && porcentagemVermelhas > 65) {
        sinalEncontrado = { 
            direcao: "PUT", 
            estrategia: "Confluência (RSI+ADX+Tendência)", 
            confianca: 88 
        };
    }
    
    // SINAL DE COMPRA (CALL)
    if (rsi > 65 && adx > 25 && porcentagemVerdes > 65) {
        sinalEncontrado = { 
            direcao: "CALL", 
            estrategia: "Confluência (RSI+ADX+Tendência)", 
            confianca: 88 
        };
    }

    // 3. FILTRO DE VOLATILIDADE (ATR)
    // Se o ATR for muito baixo, o mercado está morto. Ignora.
    if (sinalEncontrado && atr < (atual.close * 0.0001)) {
        return null;
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
            
            let ehAcao = false;
            for (let palavra of ACOES_PROIBIDAS) {
                if (a.ticker.toUpperCase().includes(palavra)) { ehAcao = true; break; }
            }

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

// --- AUTO-AVALIAÇÃO SIMPLIFICADA ---
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