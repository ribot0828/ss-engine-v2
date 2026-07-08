// CSVエクスポート（Excel用・BOM付きCRLF）
import { LOGIC_VERSION } from './logic.js?v=5.38.0';

export function exportCsv({ raceName, venueStr, courseInfo, gradeStr, dateStr, horses, lastResultData, raceStartTime, oddsUpdatedAt, raceWeather, raceBaba }) {
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

    let csvContent = '\uFEFF';
    csvContent += "日付,開催場所,レース名,コース詳細,グレード・頭数,馬番,馬名,購入時人気,購入時オッズ,評価,購入時期待値,購入時クラス,近走監査,最終確定人気,最終確定オッズ,最終確定期待値,最終確定クラス,着順,MAO,実行フラグ,単勝払戻,ワイド払戻,馬連払戻,三連複払戻,三連単払戻,発走時刻,オッズ最終更新時刻,天候,馬場状態,走破タイム,着差,上がり3F,通過順,ロジックVer\r\n";

    // ▼ 追加: CSVを破壊する文字（改行、カンマ）をスペースに置換する関数
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
    const oddsUpdatedAtStr = formatUpdatedAt(oddsUpdatedAt);

    horses.sort((a, b) => a.umaban - b.umaban).forEach(h => {
        const rawRow = [
            dateStr, venueStr, raceName, courseInfo, gradeStr, h.umaban, h.name,
            h.popular || "-", h.odds ? h.odds.toFixed(1) : "0.0",
            h.rank, h.ev ? h.ev.toFixed(3) : "0.000", h.cls || "N",
            // 近走監査ステータス
            (h.cls === 'X' || h.cls === 'D1') ? (h.passedStrikerValidation ? "○" : "×") : "-",
            h.finalPopular || "-",
            (h.finalOdds && h.finalOdds > 0) ? h.finalOdds.toFixed(1) : "-",
            (h.finalEv !== undefined && h.finalEv !== "-") ? h.finalEv.toFixed(3) : "-",
            h.finalCls || "-",
            h.placing || "-",
            (h.mao !== undefined && h.mao !== 999) ? h.mao.toFixed(1) : "-",
            h.amberPassed ? "○" : "×",
            tanshoPay, widePay, umarenPay, sanrenPay, sanrentanPay,
            raceStartTime || "-", oddsUpdatedAtStr, raceWeather || "-", raceBaba || "-",
            h.resultTime || "-", h.resultMargin || "-", h.resultAgari || "-", h.resultPassage || "-",
            LOGIC_VERSION
        ];
        // ▼ 変更: 全要素をサニタイズしてからカンマ区切りにする
        const safeRow = rawRow.map(item => sanitize(item));
        csvContent += safeRow.join(',') + "\r\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `SS-Engine_${raceName}-${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
