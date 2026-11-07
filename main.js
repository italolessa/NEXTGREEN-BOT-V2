// --- FORÇA A IGNORAR ERROS DE SSL NO NODE.JS (DEVE SER A PRIMEIRA LINHA) ---
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

require('events').EventEmitter.defaultMaxListeners = 0;

const { iniciarBot, executarOrdemReal, buscarAnaliseManual, pararBusca, resetarFiltros, aumentarRelaxamento } = require('./backend/bot');

app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('log-level', '3');

let mainWindow;
let loginWindow;
let welcomeWindow;
let appStore;
const SESSION_FILE = path.join(app.getPath('userData'), 'sessao.json');
const HISTORICO_FILE = path.join(__dirname, 'historico_sinais.json');

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (url.includes('polariumbroker.com') || url.includes('quadcode.tech')) {
        event.preventDefault();
        callback(true);
    } else {
        callback(false);
    }
});

// --- Rotas para ler e limpar o Histórico ---
ipcMain.handle('ler-historico', async () => {
    try {
        if (fs.existsSync(HISTORICO_FILE)) {
            const data = fs.readFileSync(HISTORICO_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Erro ao ler histórico:", error);
    }
    return [];
});

ipcMain.handle('limpar-historico', async () => {
    try {
        if (fs.existsSync(HISTORICO_FILE)) {
            fs.unlinkSync(HISTORICO_FILE); // Apaga o arquivo
            return { success: true };
        }
        return { success: true, message: "Arquivo já estava vazio." };
    } catch (error) {
        console.error("Erro ao limpar histórico:", error);
        return { success: false, error: error.message };
    }
});

// --- 1. Cria a Tela de Boas-Vindas (login.html) ---
function createWelcomeWindow() {
    welcomeWindow = new BrowserWindow({
        width: 400, height: 600, resizable: false, autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    welcomeWindow.loadFile('login.html');
    
    welcomeWindow.on('closed', () => {
        if (!mainWindow || mainWindow.isDestroyed()) app.quit();
    });
}

// --- 2. Cria o Painel do Robô (index.html) ---
function createMainWindow(tokenSsid) {
  mainWindow = new BrowserWindow({
    width: 1200, height: 850, resizable: true, autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  
  mainWindow.loadFile('index.html');
  
  mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      iniciarBot(mainWindow, tokenSsid);
  });
}

// --- 3. Abre a Janela da Polarium ---
function abrirJanelaLogin(dadosLogin) {
    session.defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers']
    });

    loginWindow = new BrowserWindow({
        width: 500, height: 700, title: "Autenticando Polarium...", autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    loginWindow.webContents.session.setCertificateVerifyProc((req, cb) => cb(0));
    loginWindow.loadURL('https://trade.polariumbroker.com/traderoom');

    let tentativas = 0;
    const intervalPreencher = setInterval(() => {
        if (!loginWindow || loginWindow.isDestroyed()) return;
        tentativas++;

        const scriptPreencher = `
            (function() {
                let emailInput = document.querySelector('input[type="email"]') || document.querySelector('input[name="email"]');
                let passInput = document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');

                if (emailInput && passInput) {
                    if (!emailInput.value && "${dadosLogin.email}") {
                        emailInput.value = "${dadosLogin.email}";
                        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    if (!passInput.value && "${dadosLogin.senha}") {
                        passInput.value = "${dadosLogin.senha}";
                        passInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    window.__nextgreen_preenchido = true; 
                }
            })();
        `;

        loginWindow.webContents.executeJavaScript(scriptPreencher).then(() => {
            loginWindow.webContents.executeJavaScript('window.__nextgreen_preenchido').then((concluido) => {
                if (concluido) clearInterval(intervalPreencher); 
            }).catch(() => {});
        }).catch(() => {});

        if (tentativas >= 30) clearInterval(intervalPreencher); 
    }, 500);

    loginWindow.on('closed', () => clearInterval(intervalPreencher));

    loginWindow.webContents.on('did-navigate', async (event, url) => {
        if (url.includes('/traderoom')) {
            try {
                const cookies = await loginWindow.webContents.session.cookies.get({ domain: '.polariumbroker.com' });
                const tokenCookie = cookies.find(c => c.name.includes('ssid') || c.name.includes('token') || c.name.includes('session'));

                if (tokenCookie) {
                    console.log("✅ Login concluído! Token capturado.");
                    fs.writeFileSync(SESSION_FILE, JSON.stringify({ ssid: tokenCookie.value }), 'utf-8');
                    
                    if (dadosLogin.lembrar) {
                        appStore.set('tokenSalvo', tokenCookie.value);
                    } else {
                        appStore.delete('tokenSalvo');
                    }

                    if (loginWindow) loginWindow.close();
                    if (welcomeWindow) welcomeWindow.close();
                    createMainWindow(tokenCookie.value);
                }
            } catch (err) { console.error(err); }
        }
    });
}

app.whenReady().then(async () => {
    const { default: Store } = await import('electron-store');
    appStore = new Store();
    console.log("✅ electron-store carregado com sucesso!");
    createWelcomeWindow();
});

// --- Comunicação com o Frontend (IPC) ---
ipcMain.on('verificar-login-salvo', (event) => {
    const temLogin = appStore.has('tokenSalvo');
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
        welcomeWindow.webContents.send('status-login-salvo', temLogin);
    }
});

ipcMain.on('iniciar-login', (event, dados) => abrirJanelaLogin(dados));

ipcMain.on('login-automatico', () => {
    const tokenSalvo = appStore.get('tokenSalvo');
    if (tokenSalvo) {
        console.log("🔓 Iniciando login automático...");
        if (welcomeWindow) welcomeWindow.close();
        createMainWindow(tokenSalvo);
    } else {
        console.log("❌ Nenhum token salvo encontrado.");
    }
});

ipcMain.on('buscar-ativo', (event, config) => buscarAnaliseManual(config));
ipcMain.on('aprovar-sinal', (event, dadosSinal) => executarOrdemReal(dadosSinal));

ipcMain.on('parar-busca', () => { pararBusca(); aumentarRelaxamento(); });
ipcMain.on('resetar-filtros', () => resetarFiltros());

ipcMain.on('fazer-logout', async () => {
    appStore.delete('tokenSalvo');
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    if (mainWindow) mainWindow.close();
    await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
    createWelcomeWindow();
});

app.on('window-all-closed', () => { 
    if (process.platform !== 'darwin') app.quit(); 
});