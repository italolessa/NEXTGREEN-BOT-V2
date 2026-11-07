const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 

let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;

async function iniciarBotServidor(window, tokenSsid) {
    if (!tokenSsid) return console.error("❌ Token não configurado.");

    console.log("⏳ Iniciando SDK no servidor...");
    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;

        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;
        
        console.log("✅ SDK inicializado! Aguardando comando de busca do App...");
        
        // O Loop infinito que verifica a cada 30s
        setInterval(async () => {
            if (!isBuscando) {
                await buscarAnaliseServidor();
            }
        }, 30000);

    } catch (error) {
        console.error("❌ Erro ao conectar no servidor:", error.message);
    }
}

// --- MATEMÁTICA DAS MÉDIAS MÓVEIS EXPONENCIAIS (EMA) ---
function calcularEMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const k = 2 / (period + 1);
    let ema = dados.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dados.length; i++) {
        ema = dados[i] * k + ema * (1 - k);
    }
    return ema;
}

// --- VARREDURA ---
async function buscarAnaliseServidor() {
    if (!sdk) return;
    if (!global.buscando) return; // <--- A MÁGICA AQUI: Só busca se o App mandar
    
    isBuscando = true;
    console.log(`🔎 [SERVIDOR] Ativado! Buscando cruzamento de EMAs (M1 e M5)...`);
    
    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        
        // Filtra todos os ativos OTC e abertos
        let ativosOtc = actives.filter(a => a.ticker.includes('-OTC'));
        let ativosAberto = actives.filter(a => !a.ticker.includes('-OTC'));

        let melhoresSinais = [];

        // Analisa OTC
        for (let i = 0; i < ativosOtc.length; i += 5) {
            if (!global.buscando) break; // Para se o usuário cancelar
            const lote = ativosOtc.slice(i, i + 5);
            const resultadosLote = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo, 'OTC')));
            melhoresSinais = melhoresSinais.concat(resultadosLote.filter(r => r !== null));
        }

        // Analisa Aberto
        if (global.buscando) {
            for (let i = 0; i < ativosAberto.length; i += 5) {
                if (!global.buscando) break;
                const lote = ativosAberto.slice(i, i + 5);
                const resultadosLote = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo, 'ABERTO')));
                melhoresSinais = melhoresSinais.concat(resultadosLote.filter(r => r !== null));
            }
        }

        if (melhoresSinais.length > 0 && global.buscando) {
            melhoresSinais.sort((a, b) => b.score - a.score);
            const campeao = melhoresSinais[0];
            const agora = Date.now();
            
            // Trava para não repetir o mesmo ativo na mesma vela
            if (campeao.ativo === ultimoAtivoEnviado && (agora - tempoUltimoEnvio) < 60000) {
                console.log(`⏳ [IGNORADO] ${campeao.ativo} (Aguardando nova vela)`);
            } else {
                ultimoAtivoEnviado = campeao.ativo;
                tempoUltimoEnvio = agora;
                
                console.log(`🏆 [SINAL ${campeao.timeframe}] ${campeao.ativo} | ${campeao.direcao} | ${campeao.mercado} | Confiança: ${campeao.score}% | Hora: ${campeao.horario}`);
                
                // Envia o sinal para a API (que o app vai ler)
                if (global.adicionarSinal) {
                    global.adicionarSinal(campeao);
                    global.buscando = false; // Desliga a busca após enviar o sinal
                }
            }
        } else if (global.buscando) {
            console.log("⚠️ Nenhum cruzamento de EMA válido. O robô continua buscando a cada 30s...");
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

// --- FUNÇÃO AUXILIAR PARA ANALISAR UM TIMEFRAME ESPECÍFICO ---
async function analisarTimeframe(active, timeframe, seconds) {
    try {
        const layer = await sdk.realTimeChartDataLayer(active.id, seconds);
        const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (250 * seconds)); 

        if (!candles || candles.length < 210) return null;

        const closes = candles.map(c => c.close);
        const hlc3 = candles.map(c => (c.max + c.min + c.close) / 3);

        const closeAtual = closes[closes.length - 1];
        const close3 = closes[closes.length - 4];

        const emab = calcularEMA(closes, 200); 
        const emac_atual = calcularEMA(hlc3, 14);
        const emad_atual = calcularEMA(hlc3, 34);
        
        const emac_anterior = calcularEMA(hlc3.slice(0, -1), 14);
        const emad_anterior = calcularEMA(hlc3.slice(0, -1), 34);

        const ENC = (emac_anterior < emad_anterior) && (emac_atual > emad_atual);
        const ENV = (emac_anterior > emad_anterior) && (emac_atual < emad_atual);

        let direcao = null;
        let score = 0;

        const sinal_compra = ENC && (closeAtual > emab) && (emac_atual > emad_atual) && (closeAtual > close3);
        const sinal_venda = ENV && (closeAtual < emab) && (emac_atual < emad_atual) && (closeAtual < close3);

        if (sinal_venda) {
            direcao = "PUT"; score = 95;
        } else if (sinal_compra) {
            direcao = "CALL"; score = 95;
        }

        if (!direcao) return null;

        const proximoMinuto = Math.floor(Date.now() / 60000) * 60000 + 60000;
        const horaEntrada = new Date(proximoMinuto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return { ativo: active.ticker, timeframe: timeframe, direcao: direcao, score: score, horario: horaEntrada };

    } catch (e) {
        return null;
    }
}

// --- ANÁLISE DE ATIVO (CHAMA M1 E M5) ---
async function analisarAtivoServidor(active, mercado) {
    try {
        const [resultadoM1, resultadoM5] = await Promise.all([
            analisarTimeframe(active, 'M1', 60),
            analisarTimeframe(active, 'M5', 300)
        ]);

        const sinais = [];
        if (resultadoM1) sinais.push({...resultadoM1, mercado: mercado, id: Date.now()});
        if (resultadoM5) sinais.push({...resultadoM5, mercado: mercado, id: Date.now()});
        
        return sinais.length > 0 ? sinais[0] : null; 
    } catch (e) {
        return null;
    }
}

module.exports = { iniciarBotServidor };