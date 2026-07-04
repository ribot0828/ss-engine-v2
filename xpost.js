// Xポスト用テンプレート文面の生成
// クラス別実績データ（SS-Analyzer検証結果ハードコード）
export const CLASS_STATS = {
    'A0':  { n: 140, winRate: '27.9%', placeRate: '58.6%', winROI: '75.1%' },
    'A1':  { n: 170, winRate: '15.3%', placeRate: '45.3%', winROI: '68.9%' },
    'A2':  { n: 71,  winRate: '16.9%', placeRate: '40.8%', winROI: '116.6%' },
    'A3':  { n: 20,  winRate: '30.0%', placeRate: '45.0%', winROI: '314.0%' },
    'B0':  { n: 274, winRate: '9.9%',  placeRate: '41.2%', winROI: '65.3%' },
    'B0+': { n: 167, winRate: '22.2%', placeRate: '56.9%', winROI: '75.4%' },
    'B1':  { n: 125, winRate: '11.2%', placeRate: '29.6%', winROI: '129.2%' },
    'B2':  { n: 79,  winRate: '11.4%', placeRate: '24.1%', winROI: '182.0%' },
    'B3':  { n: 287, winRate: '5.6%',  placeRate: '17.8%', winROI: '132.8%' },
    'D1':  { n: 119, winRate: '4.2%',  placeRate: '8.4%',  winROI: '294.4%' },
    'S0':  { n: 87,  winRate: '36.8%', placeRate: '75.9%', winROI: '75.9%' },
    'S1':  { n: 44,  winRate: '25.0%', placeRate: '59.1%', winROI: '98.2%' },
    'S2':  { n: 7,   winRate: '14.3%', placeRate: '71.4%', winROI: '65.7%' },
    'X':   { n: 91,  winRate: '2.2%',  placeRate: '4.4%',  winROI: '361.4%' },
};

export function buildXPostText(raceName, result) {
    const rec = result.recommendation;

    let xLines = [];
    xLines.push(`SS-ENGINE 出力 ▪ ${raceName}`);
    xLines.push(`推奨度 ${rec}`);
    xLines.push('');

    // 単勝セクション
    if (result.winTargets.length > 0) {
        xLines.push('━━ 単勝 ━━');
        result.winTargets.forEach(h => {
            xLines.push(`${h.umaban} ${h.name} [${h.cls}] EV ${h.ev.toFixed(2)} / ${h.odds.toFixed(1)}倍`);
            const st = CLASS_STATS[h.cls];
            if (st) {
                xLines.push(`  class[${h.cls}] n=${st.n} 勝率${st.winRate} 単勝回収${st.winROI}`);
            }
        });
    } else {
        xLines.push('━━ 単勝 ━━');
        xLines.push('対象馬なし');
    }

    // 軸（複勝）セクション
    if (!result.skipReason && result.sanrenpuku.axis) {
        xLines.push('');
        xLines.push('━━ 軸（複勝）━━');
        const ax = result.sanrenpuku.axis;
        xLines.push(`${ax.umaban} ${ax.name} [${ax.cls}]`);
        const st = CLASS_STATS[ax.cls];
        if (st) {
            xLines.push(`  class[${ax.cls}] n=${st.n} 勝率${st.winRate} 複勝率${st.placeRate}`);
        }
    }

    xLines.push('');
    xLines.push('#競馬 #SS_ENGINE');

    return xLines.join('\n');
}
