// localStorage を用いたレース履歴の管理
const STORAGE_KEY = 'ss_engine_history';
// 2026-10-12: 旧上限20件は「古い順に黙って捨てる」方式だったため、3日開催で未出力の土曜分が消えた。
// 上限を広げ、上限超過・容量超過のときに捨てるのは【CSV出力済み】の古いものだけにする。
// 未出力のレースは自動では絶対に削除しない（容量が足りなければエラーで知らせる）。
const MAX_HISTORY = 400;

let raceHistory = [];

export function loadHistory() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            raceHistory = JSON.parse(saved);
        }
    } catch (e) {}
    return raceHistory;
}

export function getHistory() {
    return raceHistory;
}

export function getHistoryItem(url) {
    return raceHistory.find(h => h.url === url) || null;
}

// raceHistory は新しい順（先頭が最新）。出力済みのうち最も古いもの＝末尾側から探す
const oldestExportedIndex = () => {
    for (let i = raceHistory.length - 1; i >= 0; i--) {
        if (raceHistory[i].isExported) return i;
    }
    return -1;
};

function persist() {
    while (raceHistory.length > MAX_HISTORY) {
        const idx = oldestExportedIndex();
        if (idx < 0) break; // 未出力しか無いなら上限を超えても保持する
        raceHistory.splice(idx, 1);
    }
    for (;;) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(raceHistory));
            return;
        } catch (e) {
            // 容量超過: 出力済みの古いものから1件ずつ捨てて再試行
            const idx = oldestExportedIndex();
            if (idx < 0) {
                throw new Error('ブラウザの保存容量がいっぱいです。未出力のレースをCSVに出力してから、古い履歴を削除してください。');
            }
            raceHistory.splice(idx, 1);
        }
    }
}

export function saveHistory(item) {
    const existingIdx = raceHistory.findIndex(h => h.url === item.url);
    if (existingIdx >= 0) {
        const prev = raceHistory[existingIdx];
        // 結果データ(result)は渡されなければ既存を引き継ぐ。
        // 出力済みフラグは「保存し直した＝内容が変わった」とみなして従来どおり解除する。
        raceHistory[existingIdx] = {
            ...item,
            result: item.result !== undefined ? item.result : prev.result,
            isExported: item.isExported === true
        };
    } else {
        raceHistory.unshift(item);
    }
    persist();
}

// 既存項目の一部だけを更新する（結果の一括取得用）
export function updateHistoryItem(url, patch) {
    const idx = raceHistory.findIndex(h => h.url === url);
    if (idx < 0) return false;
    raceHistory[idx] = { ...raceHistory[idx], ...patch };
    persist();
    return true;
}

export function deleteHistory(url) {
    raceHistory = raceHistory.filter(h => h.url !== url);
    persist();
}

export function markExported(url) {
    return markExportedMany([url]) > 0;
}

export function markExportedMany(urls) {
    const set = new Set(urls);
    let count = 0;
    raceHistory.forEach(h => {
        if (set.has(h.url)) {
            h.isExported = true;
            count++;
        }
    });
    if (count > 0) persist();
    return count;
}
