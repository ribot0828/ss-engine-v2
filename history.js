// localStorage を用いたレース履歴の管理
const STORAGE_KEY = 'ss_engine_history';
const MAX_HISTORY = 20;

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

export function saveHistory(item) {
    const existingIdx = raceHistory.findIndex(h => h.url === item.url);
    if (existingIdx >= 0) {
        raceHistory[existingIdx] = item;
    } else {
        raceHistory.unshift(item);
        if (raceHistory.length > MAX_HISTORY) raceHistory.pop();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raceHistory));
}

export function deleteHistory(url) {
    raceHistory = raceHistory.filter(h => h.url !== url);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raceHistory));
}

export function markExported(url) {
    const existingIdx = raceHistory.findIndex(h => h.url === url);
    if (existingIdx >= 0) {
        raceHistory[existingIdx].isExported = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(raceHistory));
        return true;
    }
    return false;
}
