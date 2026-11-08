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

// --- LEITOR DE ARQUIVOS QCS/LUA ---
function carregarEstrategiasQCS() {
    const pasta = path.join(__dirname, '..', 'estrategias_txt');
    const estrategias = [];
    if (!fs.existsSync(pasta)) return estrategias;

    const arquivos = fs.readdirSync(pasta);
    for (const arquivo of arquivos) {
        if (arquivo.endsWith('.txt')) {
            const conteudo = fs.readFileSync(path.join(pasta, arquivo), 'utf-8');
            // Verifica se parece um script (ignora arquivos vazios)
            if (conteudo.trim().length > 10) {
                estrategias.push({ nome: arquivo.replace('.txt', ''), codigo: conteudo });
            }
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

// --- EXECUTOR DO SCRIPT QCS (LUA) ---
async function executarScriptQCS(codigoLua, candles) {
    const factory = new LuaFactory();
    const lua = await factory.createEngine();

    try {
        // Prepara os dados das velas para o script Lua
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.max);
        const lows = candles.map(c => c.min);
        const opens = candles.map(c => c.open);

        // Define as variáveis globais que o script QCS espera ler
        lua.global.set('close', closes);
        lua.global.set('high', highs);
        lua.global.set('low', lows);
        lua.global.set('open', opens);

        // Cria uma função para o script chamar quando quiser dar o sinal
        let sinalGerado = null;
        lua.global.set('plot_signal', (direcao) => {
            sinalGerado = direcao; 
        });
        
        // Cria uma variável global para o script escrever o resultado (caso ele use print)
        lua.global.set('print', (msg) => {
            if (msg === 'CALL' || msg === 'PUT') sinalGerado = msg;
        });

        // Executa o código real do arquivo .txt no motor Lua
        await lua.doString(codigoLua);

        // Se o script gerou um sinal, retorna
        if (sinalGerado === 'CALL' || sinalGerado === 'PUT') {
            return { direcao: sinalGerado };
        }
        
        // Se o script não chamar as funções, tentamos ler uma variável global "signal"
        const sinalFinal = lua.global.get('signal');
        if (sinalFinal === 'CALL' || sinalFinal === 'PUT' || sinalFinal === 1 || sinalFinal === -1) {
            return { direcao: sinalFinal === 1 ? 'CALL' : 'PUT' };
        }

        return null;

    } catch (err) {
        // Se o script tiver erro de sintaxe (ex: função nativa não existe), ignora
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
        console.log("⚠️ Nenhum arquivo .txt encontrado na pasta!");
        isBuscando = false;
        return;
    }

    console.log(`🔎 [ROBÔ] Executando ${arquivosQCS.length} scripts QCS/Lua...`);
    
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
                if (!candles || candles.length < 50) return null;
                
                // Roda o código QCS de cada arquivo para o ativo
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