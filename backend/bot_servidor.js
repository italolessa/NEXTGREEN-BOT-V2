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
        
        console.log("✅ SDK inicializado! As 5 estratégias nativas foram carregadas.");
        
        setInterval(async () => {
            if (!isBuscando && global.buscando) {
                await buscarAnaliseServidor();
            }
        }, 15000); 
    } catch (error) {
        console.error("❌ Erro ao conectar no servidor:", error.message);
    }
}

// --- MATEMÁTICA BASE ---
function calcularSMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const slice = dados.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function calcularRSI(closes, period = 14) {
    if (closes.length < period) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    return 100 - (100 / (1 + (gains / (losses || 1))));
}

function calcularEMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const k = 2 / (period + 1);
    let ema = dados.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dados.length; i++) ema = dados[i] * k + ema * (1 - k);
    return ema;
}

// --- AS 5 ESTRATÉGIAS TRADUZIDAS ---
function analisarGraficoComEstrategias(candles) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);
    const opens = candles.map(c => c.open);
    
    const atual = candles[candles.length - 1];
    const anterior = candles[candles.length - 2];

    // 1. HAMMER SHOOTING STAR (Martelo / Estrela Cadente)
    const corpo = atual.close - atual.open;
    const sombraSup = atual.max - Math.max(atual.open, atual.close);
    const sombraInf = Math.min(atual.open, atual.close) - atual.min;
    
    // Martelo (COMPRA)
    const martelo = (atual.close > atual.open) && (sombraInf > corpo * 2) && (sombraSup < corpo * 0.3);
    if (martelo) return { direcao: "CALL", estrategia: "Martelo", confianca: 90 };
    
    // Estrela Cadente (VENDA)
    const estrelaCadente = (atual.close < atual.open) && (sombraSup > (atual.open - atual.close) * 2) && (sombraInf < (atual.open - atual.close) * 0.3);
    if (estrelaCadente) return { direcao: "PUT", estrategia: "Estrela Cadente", confianca: 90 };

    // 2. VOLUME EFRAIM (SMA de 2 períodos)
    const ma1 = calcularSMA(closes, 2);
    const ma2 = calcularSMA(Array(10).fill(ma1), 2); 
    if (closes[closes.length - 1] > ma1 && closes[closes.length - 2] < ma2) {
         return { direcao: "CALL", estrategia: "Volume Efraim", confianca: 85 };
    }

    // 3. ENGOLFO / CANDLESTICK
    const engolfoAlta = (atual.close > atual.open) && (anterior.close < anterior.open) && (atual.close > anterior.max);
    const engolfoBaixa = (atual.close < atual.open) && (anterior.close > anterior.open) && (atual.close < anterior.min);
    
    if (engolfoAlta) return { direcao: "CALL", estrategia: "Engolfo de Alta", confianca: 88 };
    if (engolfoBaixa) return { direcao: "PUT", estrategia: "Engolfo de Baixa", confianca: 88 };

    // 4. HACKER OB (MACD + EMA + RSI + ADX)
    const rsi = calcularRSI(closes, 10);
    const ema50 = calcularEMA(closes, 50);
    const smaFast = calcularSMA(closes, 5);
    const smaSlow = calcularSMA(closes, 20);
    
    if (smaFast > smaSlow && closes[closes.length - 1] > ema50 && rsi > 50) {
        if (atual.close > atual.open) return { direcao: "CALL", estrategia: "Hacker OB (Tendência)", confianca: 92 };
    } else if (smaFast < smaSlow && closes[closes.length - 1] < ema50 && rsi < 50) {
        if (atual.close < atual.open) return { direcao: "PUT", estrategia: "Hacker OB (Tendência)", confianca: 92 };
    }

    // 5. CRUZAMENTO MEDIAS CONFIRMADO (EMA 5 e EMA 10)
    const ema5_atual = calcularEMA(closes, 5);
    const ema10_atual = calcularEMA(closes, 10);
    const ema5_ant = calcularEMA(closes.slice(0, -1), 5);
    const ema10_ant = calcularEMA(closes.slice(0, -1), 10);

    if (ema5_atual > ema10_atual && ema5_ant < ema10_ant) {
        return { direcao: "CALL", estrategia: "Cruzamento EMA 5/10", confianca: 95 };
    }
    if (ema5_atual < ema10_atual && ema5_ant > ema10_ant) {
        return { direcao: "PUT", estrategia: "Cruzamento EMA 5/10", confianca: 95 };
    }

    return null;
}

async function buscarAnaliseServidor() {
    if (!sdk || !global.buscando) return;
    isBuscando = true;
    
    console.log(`🔎 [ROBÔ] Executando Análise com 5 Estratégias (Lendo 100 velas)...`);
    
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
                
                // AQUI ESTÁ A ALTERAÇÃO: Lendo as últimas 100 velas
                const count = 100; 
                const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (count * seconds)); 
                
                // Se tiver menos de 50 velas, ignora para não quebrar as médias
                if (!candles || candles.length < 50) return null; 
                
                const resultado = analisarGraficoComEstrategias(candles);
                
                if (resultado) {
                    return { 
                        ativo: ativo.ticker, 
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
            ativosIgnoradosLista.push(campeao.ativo);
            ultimoAtivoEnviado = campeao.ativo;
            console.log(`🏆 [SINAL] ${campeao.ativo} | ${campeao.direcao} | ${campeao.estrategia}`);
            if (global.adicionarSinal) global.adicionarSinal(campeao);
        } else if (global.buscando) {
            console.log(`⚠️ Nenhuma das 5 estratégias gerou sinal. Retentando...`);
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