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
