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
const RENDER_URL = 'https://nextgreen-bot-v2.onrender.com'; // COLOQUE A SUA URL AQUI

// --- FUNÇÕES DE TOKEN ---
function getTokenSalvo() {
    try { if (fs.existsSync(SESSION_FILE)) return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8')).ssid; } 
    catch (e) { return null; } return null;
}
function salvarToken(ssid) {
    try { fs.writeFileSync(SESSION_FILE, JSON.stringify({ ssid }), 'utf-8'); } catch (e) {}
}
function apagarToken() {
    try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch (e) {}
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
    welcomeWindow.on('closed', () => { if (!mainWindow || mainWindow.isDestroyed()) app.quit(); });
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
                    salvarToken(tokenCookie.value);
                    try {
                        await axios.post(`${RENDER_URL}/api/atualizar-token`, { token: tokenCookie.value });
                    } catch (err) { console.error("Erro ao enviar token", err.message); }

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

// --- ROTAS IPC ---
ipcMain.on('verificar-login-salvo', (event) => {
    const temLogin = getTokenSalvo() !== null;
    if (welcomeWindow && !welcomeWindow.isDestroyed()) welcomeWindow.webContents.send('status-login-salvo', temLogin);
});

ipcMain.on('iniciar-login', (event, dados) => abrirJanelaLogin(dados));

ipcMain.on('login-automatico', async () => { 
    if (welcomeWindow) welcomeWindow.close(); 
    createMainWindow(); 

    const tokenSalvo = getTokenSalvo();
    if (tokenSalvo) {
        try { await axios.post(`${RENDER_URL}/api/atualizar-token`, { token: tokenSalvo }); } 
        catch(e) { console.log("Render offline, mas app abriu."); }
    }
});

// --- ROTAS DE COMANDO PARA O RENDER ---
ipcMain.on('configurar-busca', async (event, config) => {
    try { await axios.post(`${RENDER_URL}/api/configurar`, config); } catch (e) { console.log("Erro na config"); }
});

ipcMain.on('parar-busca', async () => {
    try { await axios.post(`${RENDER_URL}/api/parar`); } catch (e) { console.log("Erro no parar"); }
});

ipcMain.on('resetar-filtros', async () => {
    try { await axios.post(`${RENDER_URL}/api/resetar`); } catch (e) { console.log("Erro no resetar"); }
});

ipcMain.on('fazer-logout', () => {
    apagarToken();
    if (mainWindow) mainWindow.close();
    createWelcomeWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });