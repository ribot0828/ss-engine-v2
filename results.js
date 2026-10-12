// レース結果の取得・紐づけ（手動合体と一括取得の共通処理）
import { analyzeRace } from './logic.js?v=5.45.0';

// 履歴の保存URLから netkeiba の結果ページURLを導く。導けなければ null
// - netkeiba: race_id=12桁 をそのまま使う
// - JRA公式スマホ版: CNAME の22桁 = 01 + 場2 + 年4 + 回2 + 日目2 + R2 + 開催日8
//   netkeiba race_id = 年4 + 場2 + 回2 + 日目2 + R2（2026-10-12 実ページで照合済み）
export function deriveResultUrl(url) {
    if (!url) return null;
    const nk = url.match(/race_id=(\d{12})/);
    if (nk) return `https://race.netkeiba.com/race/result.html?race_id=${nk[1]}`;
    const jra = url.match(/sw01d[a-z]{2}(\d{22})/i);
    if (jra) {
        const d = jra[1];
        const raceId = d.slice(4, 8) + d.slice(2, 4) + d.slice(8, 10) + d.slice(10, 12) + d.slice(12, 14);
        return `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
    }
    return null;
}

// 着順と単勝払戻が出ていれば「確定済み」とみなす（発走前・確定前の結果ページは対象外）
export function isResultReady(data) {
    if (!data || data.error || !Array.isArray(data.horses)) return false;
    const hasPlacing = data.horses.some(h => /^\d+$/.test(String(h.placing || '').trim()));
    const tansho = data.payouts && data.payouts['単勝'];
    return hasPlacing && !!tansho && (!Array.isArray(tansho) || tansho.length > 0);
}

// 取得した結果が本当にこのレースのものか（馬名の一致率で確認。別レースへの誤紐づけ防止）
export function resultMatchesRace(horses, data) {
    const names = new Set((horses || []).map(h => String(h.name || '').trim()).filter(Boolean));
    if (names.size === 0) return true; // 馬名が無い古い履歴は判定不能のため通す
    const hit = (data.horses || []).filter(h => names.has(String(h.name || '').trim())).length;
    return hit >= Math.ceil(names.size / 2);
}

// 履歴に保存する結果データ（馬リストは各馬に合体済みなので持たない）
export function slimResult(data) {
    if (!data) return null;
    return {
        payouts: data.payouts || {},
        start_time: data.start_time || "",
        weather: data.weather || "",
        baba: data.baba || "",
        date_info: data.date_info || "",
        course_info: data.course_info || "",
        grade_info: data.grade_info || "",
        fetchedAt: Date.now()
    };
}

// 「G3 16頭」のように頭数が付いた表記から頭数部分を外す
export const stripHeadcount = (s) => String(s || '').replace(/\s*\d+頭\s*$/, '').trim();

// 結果の馬データを出馬表側の馬に合体し、確定オッズで最終解析（finalEv / finalCls）を付ける。
// horses は破壊的に更新する。戻り値は合体できた頭数
export function mergeResultIntoHorses(horses, data, isGradeRace, courseInfo) {
    let mergedCount = 0;
    data.horses.forEach(resHorse => {
        const target = horses.find(h => h.umaban === resHorse.umaban);
        if (target) {
            target.placing = resHorse.placing || "";
            target.finalOdds = parseFloat(resHorse.odds) || 0;
            target.finalPopular = resHorse.popular || "";
            // タイム・着差・後3F・コーナー通過順（既存プロパティとの衝突回避のためresult接頭辞）
            target.resultTime = resHorse.time || "";
            target.resultMargin = resHorse.margin || "";
            target.resultAgari = resHorse.agari || "";
            target.resultPassage = resHorse.passage || "";
            mergedCount++;
        }
    });

    // 確定オッズベースで最終解析を実行
    const tempHorses = JSON.parse(JSON.stringify(horses));
    tempHorses.forEach(h => {
        if (h.finalOdds !== undefined) h.odds = parseFloat(h.finalOdds) || 0;
    });
    const tempRes = analyzeRace(tempHorses, isGradeRace, courseInfo);
    horses.forEach(h => {
        const fh = tempRes.horses.find(x => x.umaban === h.umaban);
        if (fh) {
            h.finalEv = fh.ev;
            h.finalCls = fh.cls;
        }
    });
    return mergedCount;
}

// 結果のグレード表記と頭数から「G3 16頭」形式のグレード欄を作る
export function buildGradeValue(resultGrade, currentGrade, headcount) {
    let base = "";
    if (resultGrade && resultGrade !== "一般" && resultGrade.trim() !== "") base = resultGrade.trim();
    else base = stripHeadcount(currentGrade);
    return `${base ? base + " " : ""}${headcount}頭`.trim();
}

// 履歴の1レース分に結果を適用した新しい項目を返す（一括取得用）
export function applyResultToItem(item, data) {
    const horses = JSON.parse(JSON.stringify(item.horses || []));
    let courseInfo = item.courseInfo || "";
    if (data.course_info && (courseInfo === "" || courseInfo.includes("不明"))) courseInfo = data.course_info;
    mergeResultIntoHorses(horses, data, item.isGradeRace || false, courseInfo);
    return {
        horses,
        courseInfo,
        dateInfo: data.date_info || item.dateInfo || "",
        raceStartTime: data.start_time || item.raceStartTime || "",
        raceWeather: data.weather || item.raceWeather || "",
        raceBaba: data.baba || item.raceBaba || "",
        gradeInfo: buildGradeValue(data.grade_info, item.gradeInfo, horses.length),
        result: slimResult(data),
        isExported: false
    };
}

// 結果が紐づいているか
export function hasResult(item) {
    return !!(item && item.result && (item.horses || []).some(h => /^\d+$/.test(String(h.placing || '').trim())));
}

// レース日（YYYY-MM-DD）。無ければ保存時刻の日付
export function raceDateOf(item) {
    const m = String(item.dateInfo || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(item.timestamp || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 結果を取りに行ってよいか（未来のレース・発走10分前後のレース・30日より古いものは対象外）
export function isResultDue(item, now = new Date()) {
    if (hasResult(item)) return false;
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const date = raceDateOf(item);
    if (date > today) return false;
    if ((now - new Date(`${date}T00:00:00`)) > 30 * 86400000) return false;
    if (date === today && /^\d{1,2}:\d{2}$/.test(item.raceStartTime || '')) {
        const [hh, mm] = item.raceStartTime.split(':').map(Number);
        const start = new Date(now);
        start.setHours(hh, mm, 0, 0);
        if (now - start < 10 * 60000) return false; // 発走後10分未満はまだ確定していない
    }
    return true;
}
