const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 

let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;

async function iniciarBotServidor(window, tokenSsid) {
    if (!tokenSsid) return console.error("❌ Token não configurado.");

    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;
        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;
        
        console.log("✅ SDK inicializado! Aguardando comando...");
        
        setInterval(async () => {
            if (!isBuscando) await buscarAnaliseServidor();
        }, 30000);

    } catch (error) { console.error("❌ Erro:", error.message); }
}

function calcularEMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const k = 2 / (period + 1);
    let ema = dados.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dados.length; i++) ema = dados[i] * k + ema * (1 - k);
    return ema;
}

async function buscarAnaliseServidor() {
    if (!sdk || !global.buscando) return;
    isBuscando = true;
    
    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        
        let ativosOtc = actives.filter(a => a.ticker.includes('-OTC'));
        let ativosAberto = actives.filter(a => !a.ticker.includes('-OTC'));

        let melhoresSinais = [];

        // Analisa OTC
        for (let i = 0; i < ativosOtc.length; i += 5) {
            if (!global.buscando) break;
            const lote = ativosOtc.slice(i, i + 5);
            const res = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo, 'OTC')));
            melhoresSinais = melhoresSinais.concat(res.filter(r => r !== null));
        }

        // Analisa Aberto
        if (global.buscando) {
            for (let i = 0; i < ativosAberto.length; i += 5) {
                if (!global.buscando) break;
                const lote = ativosAberto.slice(i, i + 5);
                const res = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo, 'ABERTO')));
                melhoresSinais = melhoresSinais.concat(res.filter(r => r !== null));
            }
        }

        if (melhoresSinais.length > 0 && global.buscando) {
            melhoresSinais.sort((a, b) => b.score - a.score);
            const campeao = melhoresSinais[0];
            const agora = Date.now();
            
            if (campeao.ativo === ultimoAtivoEnviado && (agora - tempoUltimoEnvio) < 60000) {
                // Ignora repetição de vela
            } else {
                ultimoAtivoEnviado = campeao.ativo;
                tempoUltimoEnvio = agora;
                console.log(`🏆 [SINAL] ${campeao.ativo} | ${campeao.direcao}`);
                if (global.adicionarSinal) global.adicionarSinal(campeao);
            }
        }
    } catch (error) { console.error("❌ Erro:", error.message); } 
    finally { isBuscando = false; }
}

async function analisarAtivoServidor(active, mercado) {
    try {
        const layerM1 = await sdk.realTimeChartDataLayer(active.id, 60);
        const candlesM1 = await layerM1.fetchAllCandles(Math.floor(Date.now() / 1000) - (250 * 60)); 
        const layerM5 = await sdk.realTimeChartDataLayer(active.id, 300);
        const candlesM5 = await layerM5.fetchAllCandles(Math.floor(Date.now() / 1000) - (250 * 300)); 

        if (!candlesM1 || candlesM1.length < 210 || !candlesM5 || candlesM5.length < 210) return null;

        const closesM1 = candlesM1.map(c => c.close);
        const hlc3M1 = candlesM1.map(c => (c.max + c.min + c.close) / 3);
        const closesM5 = candlesM5.map(c => c.close);
        const hlc3M5 = candlesM5.map(c => (c.max + c.min + c.close) / 3);

        const checkM1 = verificarCruzamento(closesM1, hlc3M1);
        const checkM5 = verificarCruzamento(closesM5, hlc3M5);

        if (checkM1) return { ativo: active.ticker, timeframe: 'M1', direcao: checkM1, score: 95, mercado, horario: getHora(), id: Date.now() };
        if (checkM5) return { ativo: active.ticker, timeframe: 'M5', direcao: checkM5, score: 95, mercado, horario: getHora(), id: Date.now() };
        return null;
    } catch (e) { return null; }
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

function getHora() {
    const proximoMinuto = Math.floor(Date.now() / 60000) * 60000 + 60000;
    return new Date(proximoMinuto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

module.exports = { iniciarBotServidor };