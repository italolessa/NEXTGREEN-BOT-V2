// --- URL CORRETA E ESTÁVEL DA POLARIUM ---
const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 

let sdk;
let isBuscando = false;

async function iniciarBotServidor(window, tokenSsid, timeframe) {
    if (!tokenSsid) return console.error("❌ ERRO: Token não configurado.");

    console.log(`⏳ Iniciando SDK no servidor... Estratégia isolada: ${timeframe}`);
    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;

        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;
        
        console.log("✅ SDK inicializado! Iniciando varredura a cada 30s...");
        
        // O loop passa o timeframe escolhido para a análise
        setInterval(async () => {
            if (!isBuscando) {
                await buscarAnaliseServidor(timeframe);
            }
        }, 30000);

    } catch (error) {
        console.error("❌ Erro ao conectar no servidor:", error.message);
    }
}

// --- MATEMÁTICA DOS INDICADORES ---
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
        const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
        trs.push(tr);
        const upMove = highs[i] - highs[i-1];
        const downMove = lows[i-1] - lows[i];
        plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    const avgTR = trs.slice(-period).reduce((a,b)=>a+b,0) / period;
    const avgPlusDM = plusDMs.slice(-period).reduce((a,b)=>a+b,0) / period;
    const avgMinusDM = minusDMs.slice(-period).reduce((a,b)=>a+b,0) / period;
    const plusDI = avgTR === 0 ? 0 : (avgPlusDM / avgTR) * 100;
    const minusDI = avgTR === 0 ? 0 : (avgMinusDM / avgTR) * 100;
    const dx = (plusDI + minusDI) === 0 ? 0 : Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    return { adx: dx, plusDI, minusDI };
}

// --- VARREDURA ---
async function buscarAnaliseServidor(timeframe) {
    if (!sdk) return;
    isBuscando = true;
    console.log(`🔎 [SERVIDOR] Iniciando varredura (${timeframe}) no mercado OTC...`);
    
    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        
        let ativosFiltrados = actives.filter(a => a.ticker.includes('-OTC'));
        let melhoresSinais = [];

        for (let i = 0; i < ativosFiltrados.length; i += 5) {
            const lote = ativosFiltrados.slice(i, i + 5);
            const resultadosLote = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo, timeframe)));
            melhoresSinais = melhoresSinais.concat(resultadosLote.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0) {
            melhoresSinais.sort((a, b) => b.score - a.score);
            const campeao = melhoresSinais[0];
            
            console.log(`🏆 [SINAL ENCONTRADO] ${campeao.ativo} | ${campeao.direcao} | RSI: ${campeao.rsi} | ADX: ${campeao.adx} | Score: ${campeao.score}% | Hora: ${campeao.horario}`);
        } else {
            console.log(`⚠️ Nenhum ativo com setup no momento (${timeframe}). Mercado calmo.`);
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

// --- ANÁLISE DE ATIVO (FOCADA NO TIMEFRAME ESCOLHIDO) ---
async function analisarAtivoServidor(active, timeframe) {
    try {
        // Define o tamanho do candle: 60s para M1 ou 300s para M5
        const candleSize = timeframe === 'M5' ? 300 : 60;
        const tempoHistorico = timeframe === 'M5' ? (60 * 60) : (15 * 60); // Pega mais histórico se for M5

        const layer = await sdk.realTimeChartDataLayer(active.id, candleSize);
        const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - tempoHistorico); 

        if (!candles || candles.length < 5) return null;

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.max);
        const lows = candles.map(c => c.min);

        const rsi = calcularRSI(closes);
        const { adx, plusDI, minusDI } = calcularADX(highs, lows, closes);

        let direcao = null;
        let score = 0;

        // Regra isolada: usa apenas os dados do timeframe escolhido
        if (adx > 20 && plusDI > minusDI && rsi < 45) {
            direcao = "CALL";
            score = Math.min(99, Math.floor(70 + (45 - rsi) + (adx / 4)));
        } else if (adx > 20 && minusDI > plusDI && rsi > 55) {
            direcao = "PUT";
            score = Math.min(99, Math.floor(70 + (rsi - 55) + (adx / 4)));
        }

        if (!direcao) return null;

        const proximoMinuto = Math.floor(Date.now() / 60000) * 60000 + 60000;
        const horaEntrada = new Date(proximoMinuto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return {
            ativo: active.ticker,
            direcao: direcao,
            rsi: rsi.toFixed(1),
            adx: adx.toFixed(1),
            score: score,
            horario: horaEntrada
        };

    } catch (e) {
        return null;
    }
}

module.exports = { iniciarBotServidor };