process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const Store = require('electron-store');
const store = new Store();
app.commandLine.appendSwitch('ignore-certificate-errors');

let mainWindow;
let loginWindow;
let welcomeWindow;
let pollingInterval;

const SESSION_FILE = path.join(app.getPath('userData'), 'sessao.json');
// ⚠️ COLOQUE A URL DO SEU RENDER AQUI (sem a barra no final)
const RENDER_URL = 'https://nextgreen-bot-v2.onrender.com'; 

// --- FUNÇÕES DE TOKEN ---
function getTokenSalvo() {
    try { 
        if (fs.existsSync(SESSION_FILE)) {
            return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8')).ssid; 
        }
    } catch (e) { return null; } 
    return null;
}

function salvarToken(ssid) {
    try { 
        fs.writeFileSync(SESSION_FILE, JSON.stringify({ ssid }), 'utf-8'); 
    } catch (e) {}
}

function apagarToken() {
    try { 
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); 
    } catch (e) {}
}

// --- BUSCA NA NUVEM ---
function iniciarPollingSinais() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        try {
            const resposta = await axios.get(`${RENDER_URL}/api/sinais`);
            if (resposta.data && resposta.data.length > 0) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('novo-sinal', resposta.data[0]);
                }
            }
        } catch (error) {}
    }, 5000);
}

// --- TELAS ---
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

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800, resizable: true, autoHideMenuBar: true, show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    mainWindow.loadFile('index.html');
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        iniciarPollingSinais();
    });
}

function abrirJanelaLogin(dadosLogin) {
    session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb'] });
    loginWindow = new BrowserWindow({
        width: 500, height: 700, title: "Login Polarium", autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    loginWindow.webContents.session.setCertificateVerifyProc((req, cb) => cb(0));
    loginWindow.loadURL('https://trade.polariumbroker.com/traderoom');
    
    loginWindow.webContents.on('did-navigate', async (event, url) => {
        if (url.includes('/traderoom')) {
            try {
                const cookies = await loginWindow.webContents.session.cookies.get({ domain: '.polariumbroker.com' });
                const tokenCookie = cookies.find(c => c.name.includes('ssid') || c.name.includes('token'));
                
                if (tokenCookie) {
                    console.log("✅ Login concluído no PC! Token capturado.");
                    salvarToken(tokenCookie.value);
                    
                    // --- A MÁGICA ACONTECE AQUI ---
                    // Envia o token novo para o servidor no Render
                    try {
                        console.log("📡 Enviando o novo Token para a nuvem (Render)...");
                        await axios.post(`${RENDER_URL}/api/atualizar-token`, { token: tokenCookie.value });
                        console.log("✅ Nuvem atualizada com o novo Token! O robô já pode operar.");
                    } catch (err) {
                        console.error("⚠️ Falha ao enviar token para o Render. Verifique a RENDER_URL.", err.message);
                    }
                    // -------------------------------

                    if (loginWindow) loginWindow.close();
                    if (welcomeWindow) welcomeWindow.close();
                    createMainWindow();
                }
            } catch (err) { console.error(err); }
        }
    });
}

// --- INICIALIZAÇÃO ---
app.whenReady().then(() => { createWelcomeWindow(); });

// --- COMUNICAÇÃO ---
ipcMain.on('verificar-login-salvo', (event) => {
    const temLogin = getTokenSalvo() !== null;
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
        welcomeWindow.webContents.send('status-login-salvo', temLogin);
    }
});

ipcMain.on('iniciar-login', (event, dados) => abrirJanelaLogin(dados));

ipcMain.on('login-automatico', async () => { 
    if (welcomeWindow) welcomeWindow.close(); 
    
    // Se ele entrou automático, também garante que o Render tem o token atual
    const tokenSalvo = getTokenSalvo();
    if (tokenSalvo) {
        try {
            console.log("📡 Enviando Token salvo para a nuvem (Render)...");
            await axios.post(`${RENDER_URL}/api/atualizar-token`, { token: tokenSalvo });
            console.log("✅ Nuvem atualizada com o Token salvo!");
        } catch(e) {}
    }
    createMainWindow(); 
});

ipcMain.on('configurar-busca', async (event, config) => {
    try {
        await axios.post(`${RENDER_URL}/api/configurar`, config);
        if (mainWindow) mainWindow.webContents.send('config-salva');
    } catch (e) { console.log("Erro ao enviar config:", e.message); }
});

ipcMain.on('fazer-logout', () => {
    apagarToken();
    if (mainWindow) mainWindow.close();
    createWelcomeWindow();
});

app.on('window-all-closed', () => { 
    if (process.platform !== 'darwin') app.quit(); 
});