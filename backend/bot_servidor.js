const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;

let configSolicitada = { timeframe: 'M1', mercado: 'OTC' };

global.definirConfiguracao = (config) => {
    configSolicitada = config;
    ultimoAtivoEnviado = null; 
    console.log(`🤖 Cérebro atualizado: Foco em ${config.timeframe} | Mercado ${config.mercado}`);
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

function calcularEMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const k = 2 / (period + 1);
    let ema = dados.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dados.length; i++) {
        ema = dados[i] * k + ema * (1 - k);
    }
    return ema;
}

async function buscarAnaliseServidor() {
    if (!sdk || !global.buscando) return;
    isBuscando = true;
    
    console.log(`🔎 [SERVIDOR] Buscando Cruzamento de EMAs (${configSolicitada.timeframe} - ${configSolicitada.mercado})...`);
    
    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        const now = sdk.currentTime();
        
        let ativosFiltrados = actives.filter(a => {
            // Filtra por OTC ou Aberto
            const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
            
            // --- A MÁGICA AQUI: Verifica se o ativo está aberto e disponível para compra AGORA ---
            const estaAberto = a.canBeBoughtAt(now);

            return mercadoOk && estaAberto;
        });
        
        let melhoresSinais = [];

        for (let i = 0; i < ativosFiltrados.length; i += 5) {
            if (!global.buscando) break;
            const lote = ativosFiltrados.slice(i, i + 5);
            const res = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo, configSolicitada.mercado, configSolicitada.timeframe)));
            melhoresSinais = melhoresSinais.concat(res.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0 && global.buscando) {
            melhoresSinais.sort((a, b) => b.score - a.score);
            const campeao = melhoresSinais[0];
            const agora = Date.now();
            
            if (campeao.ativo === ultimoAtivoEnviado && (agora - tempoUltimoEnvio) < 60000) {
                // Ignora repetição
            } else {
                ultimoAtivoEnviado = campeao.ativo;
                tempoUltimoEnvio = agora;
                console.log(`🏆 [SINAL] ${campeao.ativo} | ${campeao.direcao} | Entrar às: ${campeao.horario}`);
                if (global.adicionarSinal) {
                    global.adicionarSinal(campeao);
                }
            }
        } else if (global.buscando) {
            console.log(`⚠️ Nenhum cruzamento de EMA válido ou ativos fechados. Retentando...`);
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

        const closes = candles.map(c => c.close);
        const hlc3 = candles.map(c => (c.max + c.min + c.close) / 3);

        const check = verificarCruzamento(closes, hlc3);

        if (check) {
            return { 
                ativo: active.ticker, 
                timeframe: timeframe, 
                direcao: check, 
                score: 95, 
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

function verificarCruzamento(closes, hlc3) {
    const emab = calcularEMA(closes, 200); 
    const emac_atual = calcularEMA(hlc3, 14);
    const emad_atual = calcularEMA(hlc3, 34);
    const emac_anterior = calcularEMA(hlc3.slice(0, -1), 14);
    const emad_anterior = calcularEMA(hlc3.slice(0, -1), 34);
    const closeAtual = closes[closes.length - 1];
    const close3 = closes[closes.length - 4];

    if ((emac_anterior < emad_anterior) && (emac_atual > emad_atual) && (closeAtual > emab) && (closeAtual > close3)) return "CALL";
    if ((emac_anterior > emad_anterior) && (emac_atual < emad_atual) && (closeAtual < emab) && (closeAtual < close3)) return "PUT";
    return null;
}

function getHoraProximaVela() {
    const agora = new Date();
    const proximoMinuto = Math.floor(agora.getTime() / 60000) * 60000 + 60000;
    
    return new Date(proximoMinuto).toLocaleTimeString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit', second: '2-digit' 
    });
}

module.exports = { iniciarBotServidor };