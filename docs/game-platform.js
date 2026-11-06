const gameDocuments = new Set(['docs/about.en.md', 'docs/about.zh.md', 'docs/update.en.md', 'docs/update.zh.md']);

export async function getGameVersionInfo() {
    const response = await fetch(new URL('app-info.json', document.baseURI));
    if (!response.ok) throw new Error(`Version information HTTP ${response.status}`);
    return response.json();
}

export async function openGameDocument(path, title = '') {
    if (!gameDocuments.has(path)) throw new Error('Unknown game document');
    const response = await fetch(new URL(path, document.baseURI));
    if (!response.ok) throw new Error(`Game document HTTP ${response.status}`);
    const content = await response.text();
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'width:min(900px,90vw);height:80vh;padding:12px;border:1px solid #777;border-radius:12px;background:#202020;color:#eee';
    dialog.setAttribute('aria-label', title);
    const close = document.createElement('button');
    close.textContent = '×'; close.setAttribute('aria-label', 'Close');
    close.style.cssText = 'display:block;margin-left:auto;font-size:24px;color:inherit;background:transparent;border:0;cursor:pointer';
    close.onclick = () => dialog.close();
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    frame.style.cssText = 'width:100%;height:calc(100% - 40px);border:0;background:#202020';
    frame.srcdoc = `<meta charset="utf-8"><base target="_blank"><style>body{color:#eee;background:#202020;font:16px system-ui;padding:12px}a{color:#8cf}</style>${content}`;
    dialog.append(close, frame);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog); dialog.showModal();
}

export function initializeGamePlatform(api) {
    api.getVersionInfo = getGameVersionInfo;
    api.openMarkdownWindow = openGameDocument;
}
