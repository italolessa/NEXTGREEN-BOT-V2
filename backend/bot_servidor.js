// --- URL CORRETA E ESTÁVEL DA POLARIUM ---
const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 

let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;

async function iniciarBotServidor(window, tokenSsid) {
    if (!tokenSsid) {
        console.error("❌ ERRO: Token (POLARIUM_TOKEN) não configurado.");
        return;
    }

    console.log("⏳ Iniciando SDK no servidor...");
    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;

        // Conecta na Polarium
        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;
        
        console.log("✅ SDK inicializado no servidor! Iniciando varredura contínua a cada 30s...");
        
        // Inicia a busca em loop infinito (a cada 30 segundos)
        setInterval(async () => {
            if (!isBuscando) {
                await buscarAnaliseServidor();
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

// NOVO: Regressão Linear (O segredo do site original)
function calcularRegressao(closes) {
    let n = closes.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i; sumY += closes[i]; sumXY += i * closes[i]; sumX2 += i * i;
    }
    let slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope; 
}

// NOVO: Balance of Power (BOP) - Mede a força da compra vs venda
function calcularBOP(candles) {
    let bopSum = 0;
    for (let i = 1; i <= 14; i++) {
        let c = candles[candles.length - i];
        let high = c.max, low = c.min, close = c.close, open = c.open;
        if ((high - low) !== 0) {
            bopSum += (close - open) / (high - low);
        }
    }
    return bopSum / 14;
}

// --- VARREDURA ADAPTADA ---
async function buscarAnaliseServidor() {
    if (!sdk) return;
    isBuscando = true;
    console.log(`🔎 [SERVIDOR] Iniciando varredura no mercado OTC...`);
    
    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        
        // Filtra todos os ativos OTC
        let ativosFiltrados = actives.filter(a => a.ticker.includes('-OTC'));

        let melhoresSinais = [];

        for (let i = 0; i < ativosFiltrados.length; i += 5) {
            const lote = ativosFiltrados.slice(i, i + 5);
            const resultadosLote = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo)));
            melhoresSinais = melhoresSinais.concat(resultadosLote.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0) {
            melhoresSinais.sort((a, b) => b.score - a.score);
            const campeao = melhoresSinais[0];
            
            // --- TRAVA DE REPETIÇÃO ---
            const agora = Date.now();
            if (campeao.ativo === ultimoAtivoEnviado && (agora - tempoUltimoEnvio) < 60000) {
                console.log(`⏳ [IGNORADO] ${campeao.ativo} (Aguardando fechamento da vela anterior)`);
            } else {
                ultimoAtivoEnviado = campeao.ativo;
                tempoUltimoEnvio = agora;
                
                console.log(`🏆 [SINAL ENCONTRADO] ${campeao.ativo} | ${campeao.direcao} | RSI: ${campeao.rsi} | ADX: ${campeao.adx} | Confiança: ${campeao.score}% | Hora: ${campeao.horario}`);
            }
        } else {
            console.log("⚠️ Nenhum ativo com setup no momento. O mercado está calmo.");
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

// --- ANÁLISE DE ATIVO ---
async function analisarAtivoServidor(active) {
    try {
        const layerM1 = await sdk.realTimeChartDataLayer(active.id, 60);
        const candlesM1 = await layerM1.fetchAllCandles(Math.floor(Date.now() / 1000) - (15 * 60)); 

        if (!candlesM1 || candlesM1.length < 15) return null;

        const closesM1 = candlesM1.map(c => c.close);
        const highsM1 = candlesM1.map(c => c.max);
        const lowsM1 = candlesM1.map(c => c.min);

        const rsiM1 = calcularRSI(closesM1);
        const { adx: adxM1, plusDI: plusDI_M1, minusDI: minusDI_M1 } = calcularADX(highsM1, lowsM1, closesM1);
        const slope = calcularRegressao(closesM1);
        const bop = calcularBOP(candlesM1);

        let direcao = null;
        let score = 0;

        // --- A LÓGICA DE CONFLUÊNCIA (Baseada no site original) ---
        if (adxM1 > 20) { 
            // SINAL DE COMPRA (CALL)
            if (slope < 0 && rsiM1 < 45 && bop > 0.1 && plusDI_M1 > minusDI_M1) { 
                direcao = "CALL";
                score = Math.min(99, Math.floor(75 + (45 - rsiM1) + (adxM1 / 3)));
            } 
            // SINAL DE VENDA (PUT)
            else if (slope > 0 && rsiM1 > 55 && bop < -0.1 && minusDI_M1 > plusDI_M1) { 
                direcao = "PUT";
                score = Math.min(99, Math.floor(75 + (rsiM1 - 55) + (adxM1 / 3)));
            }
        }

        if (!direcao) return null;

        const proximoMinuto = Math.floor(Date.now() / 60000) * 60000 + 60000;
        const horaEntrada = new Date(proximoMinuto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return {
            ativo: active.ticker,
            direcao: direcao,
            rsi: rsiM1.toFixed(1),
            adx: adxM1.toFixed(1),
            score: score,
            horario: horaEntrada
        };

    } catch (e) {
        return null; 
    }
}

module.exports = { iniciarBotServidor };