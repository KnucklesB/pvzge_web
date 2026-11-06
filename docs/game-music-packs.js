// Platform bridge for the game's 0.16.14 music-pack format.
export function prepareMusicPack(files) {
    const manifestFile = files.find(file => file.path === 'pack.json');
    if (!manifestFile) throw new Error('pack.json is required at the folder root');
    return manifestFile.blob.text().then(text => {
        const manifest = JSON.parse(text);
        if (typeof manifest.id !== 'string' || !/^[\w.-]+$/.test(manifest.id) || ['.', '..'].includes(manifest.id)) throw new Error('Invalid music pack id');
        for (const key of ['musicFeatures', 'worldMusic', 'audio']) {
            if (manifest[key] != null && (typeof manifest[key] !== 'object' || Array.isArray(manifest[key]))) throw new Error(`Invalid ${key}`);
        }
        const audioFiles = {};
        for (const relativePath of Object.values(manifest.audio || {})) {
            if (typeof relativePath !== 'string' || relativePath.split(/[\\/]/).some(part => !part || part === '.' || part === '..') || relativePath.includes(':')) throw new Error('Invalid audio path');
            const file = files.find(file => file.path === relativePath.replaceAll('\\', '/'));
            if (!file) throw new Error(`Missing audio: ${relativePath}`);
            audioFiles[relativePath] = file.blob;
        }
        return { manifest, audioFiles };
    });
}

export function initializeMusicPacks(host = window) {
    let database;
    const listeners = new Set();
    const urls = new Map();
    const openDatabase = () => database ||= new Promise((resolve, reject) => {
        const request = host.indexedDB.open('pvzge-music-packs', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('packs', { keyPath: 'manifest.id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    async function request(mode, action) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('packs', mode);
            const operation = action(transaction.objectStore('packs'));
            transaction.oncomplete = () => resolve(operation.result);
            transaction.onabort = transaction.onerror = () => reject(transaction.error);
        });
    }
    function changed() {
        for (const url of urls.values()) URL.revokeObjectURL(url);
        urls.clear();
        for (const listener of listeners) listener();
    }
    const api = host.electronAPI ||= {};
    api.listMusicPacks = async () => (await request('readonly', store => store.getAll())).map(({ manifest }) => ({ ...manifest, dir: manifest.id }));
    api.getMusicPackAudioUrl = async (id, path) => {
        const key = JSON.stringify([id, path]);
        if (!urls.has(key)) {
            const pack = await request('readonly', store => store.get(id));
            if (!pack?.audioFiles[path]) throw new Error(`Missing audio: ${path}`);
            urls.set(key, URL.createObjectURL(pack.audioFiles[path]));
        }
        return urls.get(key);
    };
    api.onMusicPackChanged = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    let dialog;
    api.closeMusicPackWindow = () => { dialog?.close(); dialog?.remove(); dialog = null; };
    api.openMusicPackWindow = async (language = 'en') => {
        api.closeMusicPackWindow();
        const zh = language === 'zh';
        dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', zh ? '音乐包' : 'Music Packs');
        dialog.innerHTML = `<style>
.pvzge-music-packs {color:#eee;background:#202020;border:1px solid #555;border-radius:12px;padding:20px;width:min(640px,85vw);max-height:80vh;font:16px system-ui;}
.pvzge-music-packs::backdrop {background:#0009;}
.pvzge-music-packs header {display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:16px;}
.pvzge-music-packs h2 {margin:0;font-size:22px;}
.pvzge-music-packs button {font:inherit;color:inherit;background:#333;border:1px solid #777;border-radius:6px;padding:7px 12px;cursor:pointer;}
.pvzge-music-packs li {display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid #555;}
.pvzge-music-packs ul {list-style:none;padding:0;}
.pvzge-music-packs output {display:block;margin-top:12px;white-space:pre-wrap;}
</style><header><h2>${zh ? '音乐包' : 'Music Packs'}</h2><button data-close>${zh ? '关闭' : 'Close'}</button></header><button data-import>${zh ? '导入音乐包文件夹' : 'Import music pack folder'}</button><ul></ul><output role="status"></output>`;
        const current = dialog;
        current.className = 'pvzge-music-packs';
        const status = current.querySelector('output');
        const report = error => { status.textContent = error.message || String(error); };
        const refresh = async () => {
            const list = current.querySelector('ul');
            list.replaceChildren();
            for (const pack of await api.listMusicPacks()) {
                const row = document.createElement('li');
                const title = document.createElement('span');
                title.textContent = `${pack.name || pack.id} · ${pack.version || pack.id}`;
                const remove = document.createElement('button');
                remove.textContent = zh ? '移除' : 'Remove';
                remove.onclick = async () => {
                    try { await request('readwrite', store => store.delete(pack.id)); changed(); await refresh(); }
                    catch (error) { report(error); }
                };
                row.append(title, remove); list.append(row);
            }
        };
        current.querySelector('[data-close]').onclick = api.closeMusicPackWindow;
        current.querySelector('[data-import]').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.webkitdirectory = true; input.multiple = true;
            input.onchange = async () => {
                try {
                    const files = [...input.files].map(blob => ({ path: blob.webkitRelativePath.split('/').slice(1).join('/'), blob }));
                    if (!files.length) return;
                    const pack = await prepareMusicPack(files);
                    await request('readwrite', store => store.put(pack));
                    changed(); await refresh();
                    status.textContent = `${zh ? '已导入' : 'Imported'}: ${pack.manifest.id}`;
                } catch (error) { report(error); }
            };
            input.click();
        };
        for (const event of ['keydown', 'keyup']) current.addEventListener(event, event => event.stopPropagation());
        document.body.append(current); current.showModal();
        try { await refresh(); } catch (error) { report(error); }
    };
    return api;
}
