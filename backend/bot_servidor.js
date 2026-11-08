const fs = require('fs');
const path = require('path');
const { LuaFactory } = require('wasmoon');

const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;

let configSolicitada = { timeframe: 'M1', mercado: 'OTC' };
let ativosIgnoradosLista = [];

function carregarEstrategiasQCS() {
    const pasta = path.join(__dirname, '..', 'estrategias_txt');
    const estrategias = [];
    if (!fs.existsSync(pasta)) return estrategias;

    const arquivos = fs.readdirSync(pasta);
    for (const arquivo of arquivos) {
        if (arquivo.endsWith('.txt')) {
            const conteudo = fs.readFileSync(path.join(pasta, arquivo), 'utf-8');
            estrategias.push({ nome: arquivo.replace('.txt', ''), codigo: conteudo });
        }
    }
    return estrategias;
}

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
        
        const listaQCS = carregarEstrategiasQCS();
        console.log(`📚 O robô encontrou ${listaQCS.length} arquivos QCS/Lua para executar.`);
        
        setInterval(async () => {
            if (!isBuscando && global.buscando) {
                await buscarAnaliseServidor();
            }
        }, 15000); 
    } catch (error) {
        console.error("❌ Erro ao conectar no servidor:", error.message);
    }
}

// --- MATEMÁTICA BASE PARA O DICIONÁRIO LUA ---
function calcSMA(arr, period) {
    if (arr.length < period) return arr[arr.length - 1];
    const slice = arr.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period = 14) {
    if (closes.length < period) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    return 100 - (100 / (1 + (gains / (losses || 1))));
}

// --- EXECUTOR DO SCRIPT QCS COM DICIONÁRIO ---
async function executarScriptQCS(codigoLua, candles) {
    const factory = new LuaFactory();
    const lua = await factory.createEngine();

    try {
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.max);
        const lows = candles.map(c => c.min);

        let sinalGerado = null;

        // DICIONÁRIO DE FUNÇÕES DA QUADCODE (MOCK)
        const apiMock = {
            sma: (arr, period) => calcSMA(arr, period),
            rsi: (arr, period) => calcRSI(arr, period),
            crossover: (a, b) => a > b, // Simplificação
            crossunder: (a, b) => a < b,
            plot_signal: (direcao) => { sinalGerado = direcao; },
            input: (name, defaultVal) => defaultVal,
            instrument: () => "ATIVO_ATUAL",
            close: closes,
            high: highs,
            low: lows,
            open: candles.map(c => c.open)
        };

        // Injeta o dicionário no ambiente Lua
        for (const [key, func] of Object.entries(apiMock)) {
            lua.global.set(key, func);
        }

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), 2000)
        );

        // Tenta rodar o script. Se der erro de sintaxe do Lua, ignoramos.
        try {
            await Promise.race([lua.doString(codigoLua), timeoutPromise]);
        } catch (e) {
            return null; 
        }

        if (sinalGerado) {
            return { direcao: sinalGerado, estrategia: "QCS Executado" };
        }
        return null;

    } catch (err) {
        return null; 
    } finally {
        lua.global.close(); 
    }
}

async function buscarAnaliseServidor() {
    if (!sdk || !global.buscando) return;
    isBuscando = true;
    
    const arquivosQCS = carregarEstrategiasQCS();

    if (arquivosQCS.length === 0) {
        isBuscando = false;
        return;
    }

    console.log(`🔎 [ROBÔ] Executando ${arquivosQCS.length} scripts QCS...`);
    
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
                const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (250 * seconds)); 
                if (!candles || candles.length < 210) return null;
                
                for (let est of arquivosQCS) {
                    const resultado = await executarScriptQCS(est.codigo, candles);
                    if (resultado) {
                        return { 
                            ativo: ativo.ticker, 
                            timeframe: configSolicitada.timeframe, 
                            direcao: resultado.direcao, 
                            confianca: 95,
                            estrategia: `QCS: ${est.nome}`,
                            mercado: configSolicitada.mercado, 
                            horario: getHoraProximaVela(), 
                            id: Date.now() 
                        };
                    }
                }
                return null;
            }));
            melhoresSinais = melhoresSinais.concat(res.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0 && global.buscando) {
            const campeao = melhoresSinais[0];
            ativosIgnoradosLista.push(campeao.ativo);
            ultimoAtivoEnviado = campeao.ativo;
            console.log(`🏆 [SINAL QCS] ${campeao.ativo} | ${campeao.direcao} | ${campeao.estrategia}`);
            if (global.adicionarSinal) global.adicionarSinal(campeao);
        } else if (global.buscando) {
            console.log(`⚠️ Nenhum script QCS gerou sinal. Retentando...`);
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