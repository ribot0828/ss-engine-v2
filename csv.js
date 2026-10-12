// CSVエクスポート（Excel用・BOM付きCRLF）
import { LOGIC_VERSION } from './logic.js?v=5.45.0';

const CSV_HEADER = "日付,開催場所,レース名,コース詳細,グレード・頭数,馬番,馬名,購入時人気,購入時オッズ,評価,購入時期待値,購入時クラス,近走監査,最終確定人気,最終確定オッズ,最終確定期待値,最終確定クラス,着順,MAO,実行フラグ,単勝払戻,ワイド払戻,馬連払戻,三連複払戻,三連単払戻,発走時刻,オッズ最終更新時刻,天候,馬場状態,走破タイム,着差,上がり3F,通過順,ロジックVer\r\n";

// CSVを破壊する文字（改行、カンマ）をスペースに置換する
const sanitize = (val) => {
    if (val === null || val === undefined) return "-";
    return String(val).replace(/[\r\n,]/g, ' ').trim();
};

// オッズ最終更新時刻を "YYYY-MM-DD HH:mm" 形式（ローカル時刻）に整形
const formatUpdatedAt = (d) => {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "-";
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 1レース分の行（ヘッダーなし）を返す
function buildRaceRows({ raceName, venueStr, courseInfo, gradeStr, dateStr, horses, lastResultData, raceStartTime, oddsUpdatedAt, raceWeather, raceBaba }) {
    const getPay = (key) => {
        if (lastResultData && lastResultData.payouts && lastResultData.payouts[key]) {
            const arr = lastResultData.payouts[key];
            if (Array.isArray(arr)) {
                return arr.map(item => `${item.combo}: ${item.amount}円`).join(' / ');
            }
            // 古い履歴データへの後方互換性（単一の文字列の場合）
            return String(arr).replace(/円/g, "円 ").replace(/,/g, '').trim();
        }
        return "-";
    };
    const tanshoPay = getPay('単勝');
    const widePay = getPay('ワイド');
    const umarenPay = getPay('馬連');
    const sanrenPay = getPay('3連複');
    const sanrentanPay = getPay('3連単');
    const oddsUpdatedAtStr = formatUpdatedAt(oddsUpdatedAt);

    // 履歴(JSON)を経由すると Infinity/NaN は null になる（オッズ0の取消・除外馬のMAOなど）。数値以外は「-」にする
    const num = (v, digits, fallback = "-") => (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(digits) : fallback;

    let rows = "";
    [...horses].sort((a, b) => a.umaban - b.umaban).forEach(h => {
        const rawRow = [
            dateStr, venueStr, raceName, courseInfo, gradeStr, h.umaban, h.name,
            h.popular || "-", h.odds ? num(h.odds, 1, "0.0") : "0.0",
            h.rank, h.ev ? num(h.ev, 3, "0.000") : "0.000", h.cls || "N",
            // 近走監査ステータス
            (h.cls === 'X' || h.cls === 'D1') ? (h.passedStrikerValidation ? "○" : "×") : "-",
            h.finalPopular || "-",
            (h.finalOdds && h.finalOdds > 0) ? num(h.finalOdds, 1) : "-",
            num(h.finalEv, 3),
            h.finalCls || "-",
            h.placing || "-",
            (h.mao !== 999) ? num(h.mao, 1) : "-",
            h.amberPassed ? "○" : "×",
            tanshoPay, widePay, umarenPay, sanrenPay, sanrentanPay,
            raceStartTime || "-", oddsUpdatedAtStr, raceWeather || "-", raceBaba || "-",
            h.resultTime || "-", h.resultMargin || "-", h.resultAgari || "-", h.resultPassage || "-",
            LOGIC_VERSION
        ];
        rows += rawRow.map(item => sanitize(item)).join(',') + "\r\n";
    });
    return rows;
}

function downloadCsv(content, filename) {
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // スマホのブラウザは即時解放するとダウンロードが失敗することがあるため遅らせる
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function exportCsv(ctx) {
    downloadCsv(CSV_HEADER + buildRaceRows(ctx), `SS-Engine_${ctx.raceName}-${ctx.dateStr}.csv`);
}

// 複数レースを1ファイルにまとめて出力（analyzerは行単位でレースを識別するので1ファイルでよい）
export function exportCsvMulti(ctxList, filename) {
    downloadCsv(CSV_HEADER + ctxList.map(buildRaceRows).join(''), filename);
}
