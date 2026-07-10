// /api/index への fetch 共通化
export async function fetchRaceData(url, options = {}) {
    const { errorMsg = null, checkDataError = true } = options;
    const res = await fetch(`/api/index?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
        throw new Error(errorMsg || `データの取得に失敗しました (エラーコード: ${res.status})`);
    }
    const data = await res.json();
    if (checkDataError && data.error) throw new Error(data.error);
    return data;
}

// 「福島11R」のような場名＋レース番号の入力かどうかを判定
const VENUE_NAMES = ["札幌", "函館", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"];
export function isVenueRacePattern(text) {
    if (!text) return false;
    const t = text.trim();
    if (/^https?:\/\//i.test(t)) return false;
    return VENUE_NAMES.some(v => t.includes(v)) && /[0-9０-９]/.test(t);
}

// 場名＋レース番号からnetkeibaのURLを解決
export async function resolveRaceUrl(query) {
    const res = await fetch(`/api/index?resolve=${encodeURIComponent(query)}`);
    if (!res.ok) {
        throw new Error(`レースURLの解決に失敗しました (エラーコード: ${res.status})`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}
