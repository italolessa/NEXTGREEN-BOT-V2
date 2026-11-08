const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;

let configSolicitada = { timeframe: 'M1', mercado: 'OTC' };
let ativosIgnoradosLista = []; // NOVA MEMÓRIA: Guarda todos os ativos já mostrados

global.definirConfiguracao = (config) => {
    configSolicitada = config;
    console.log(`🤖 Cérebro atualizado: Foco em ${config.timeframe} | Mercado ${config.mercado}`);
};

// Função para limpar a lista de bloqueio quando o usuário pedir
global.resetarAtivos = () => {
    ativosIgnoradosLista = [];
    ultimoAtivoEnviado = null;
    console.log("🧹 Memória de ativos limpa. O robô pode buscar qualquer ativo novamente.");
};

async function iniciarBotServidor(window, tokenSsid) {
    if (!tokenSsid) return console.error("❌ Token não configurado.");
    console.log("⏳ Iniciando SDK no servidor...");
    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;
        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;
        console.log("✅ SDK inicializado! Aguardando comando...");
        
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

function analisarGraficoComEstrategias(candles) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);
    const atual = candles[candles.length - 1];
    const anterior = candles[candles.length - 2];

    const rsi = calcularRSI(closes);
    const { adx } = calcularADX(highs, lows, closes);
    
    // Estratégia 1: Tendência (EMAs)
    if (adx > 25) {
        const hlc3 = candles.map(c => (c.max + c.min + c.close) / 3);
        const ema200 = calcularEMA(closes, 200);
        const ema14 = calcularEMA(hlc3, 14);
        const ema34 = calcularEMA(hlc3, 34);
        const ema14_ant = calcularEMA(hlc3.slice(0, -1), 14);
        const ema34_ant = calcularEMA(hlc3.slice(0, -1), 34);

        const cruzouAlta = (ema14_ant < ema34_ant) && (ema14 > ema34) && (atual.close > ema200);
        const cruzouBaixa = (ema14_ant > ema34_ant) && (ema14 < ema34) && (atual.close < ema200);

        if (cruzouAlta) return { direcao: "CALL", estrategia: "Tendência (EMAs)", confianca: 95 };
        if (cruzouBaixa) return { direcao: "PUT", estrategia: "Tendência (EMAs)", confianca: 95 };
    }

    // Estratégia 2: Engolfo (Wyckoff)
    if (adx < 20) {
        const engolfoAlta = (atual.close > atual.open) && (anterior.close < anterior.open) && (atual.close > anterior.max);
        const engolfoBaixa = (atual.close < atual.open) && (anterior.close > anterior.open) && (atual.close < anterior.min);
        
        if (engolfoAlta && rsi < 50) return { direcao: "CALL", estrategia: "Engolfo Wyckoff", confianca: 90 };
        if (engolfoBaixa && rsi > 50) return { direcao: "PUT", estrategia: "Engolfo Wyckoff", confianca: 90 };
    }

    // Estratégia 3: RSI + Pavio (Exaustão)
    const corpo = Math.abs(atual.close - atual.open);
    const pavioInferior = Math.min(atual.open, atual.close) - atual.min;
    const pavioSuperior = atual.max - Math.max(atual.open, atual.close);

    if (rsi < 30 && pavioInferior > corpo * 1.5) return { direcao: "CALL", estrategia: "Reversão (RSI + Pavio)", confianca: 88 };
    if (rsi > 70 && pavioSuperior > corpo * 1.5) return { direcao: "PUT", estrategia: "Reversão (RSI + Pavio)", confianca: 88 };

    return null;
}

async function buscarAnaliseServidor() {
    if (!sdk || !global.buscando) return;
    isBuscando = true;
    
    console.log(`🔎 [ROBÔ] Buscando ativos (Ignorando ${ativosIgnoradosLista.length} já vistos)...`);
    
    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        const now = sdk.currentTime();
        
        // Filtra os ativos, removendo os que já estão na lista de ignorados
        let ativosFiltrados = actives.filter(a => {
            const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
            const estaAberto = a.canBeBoughtAt(now);
            const jaFoiMostrado = ativosIgnoradosLista.includes(a.ticker);

            return mercadoOk && estaAberto && !jaFoiMostrado;
        });
        
        // Se todos os ativos do mercado já foram vistos, limpa a lista para recomeçar o ciclo
        if (ativosFiltrados.length === 0) {
            console.log("♻️ Todos os ativos já foram vistos. Reiniciando o ciclo de busca...");
            ativosIgnoradosLista = []; // Limpa a lista
            // Re-filtra agora com a lista limpa
            ativosFiltrados = actives.filter(a => {
                const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
                return mercadoOk && a.canBeBoughtAt(now);
            });
        }

        let melhoresSinais = [];

        for (let i = 0; i < ativosFiltrados.length; i += 5) {
            if (!global.buscando) break;
            const lote = ativosFiltrados.slice(i, i + 5);
            const res = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo, configSolicitada.mercado, configSolicitada.timeframe)));
            melhoresSinais = melhoresSinais.concat(res.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0 && global.buscando) {
            melhoresSinais.sort((a, b) => b.confianca - a.confianca);
            const campeao = melhoresSinais[0];
            
            // Adiciona o novo campeão à lista de ignorados
            ativosIgnoradosLista.push(campeao.ativo);
            ultimoAtivoEnviado = campeao.ativo;
            
            console.log(`🏆 [SINAL] ${campeao.ativo} | ${campeao.direcao} | ${campeao.estrategia}`);
            if (global.adicionarSinal) global.adicionarSinal(campeao);
            
        } else if (global.buscando) {
            console.log(`⚠️ Nenhum setup encontrado nos ativos restantes. Retentando...`);
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

async function analisarAtivoServidor(active, mercado, timeframe) {
    try {
        const seconds = timeframe === 'M5' ? 300 : 60; 
        const layer = await sdk.realTimeChartDataLayer(active.id, seconds);
        const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (250 * seconds)); 
        
        if (!candles || candles.length < 210) return null;

        const resultado = analisarGraficoComEstrategias(candles);

        if (resultado) {
            return { 
                ativo: active.ticker, 
                timeframe: timeframe, 
                direcao: resultado.direcao, 
                confianca: resultado.confianca, 
                estrategia: resultado.estrategia,
                mercado: mercado, 
                horario: getHoraProximaVela(), 
                id: Date.now() 
            };
        }
        return null;
    } catch (e) {
        return null;
    }
}

function getHoraProximaVela() {
    const agora = new Date();
    const proximoMinuto = Math.floor(agora.getTime() / 60000) * 60000 + 60000;
    return new Date(proximoMinuto).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

module.exports = { iniciarBotServidor };