// SS-Engine Ver.5.22 Core Logic

const SCORE_MAP = {
    'S': 100, 'A': 65, 'B': 40, 'C': 20, 'D': 10, 'E': 3, 'F': 0.5
};

// 小数点第3位以下切り捨て (厳密な生データ比較を維持)
function truncateTo3(val) {
    return Math.floor(val * 1000 + 1e-9) / 1000;
}

export function analyzeRace(horses, isGradeRace = false) {
    if (!horses || horses.length === 0) return null;

    // 1. 各馬のスコアと予想勝率、期待値の計算
    let totalScore = 0;
    horses.forEach(h => {
        h.score = (h.odds > 0) ? (SCORE_MAP[h.rank] || 0) : 0;
        totalScore += h.score;
    });

    horses.forEach(h => {
        h.winRate = (totalScore > 0 && h.odds > 0) ? h.score / totalScore : 0;
        h.rawEv = h.winRate * h.odds;
        h.ev = truncateTo3(h.rawEv);
        h.cls = null; // Class
    });

    // 2. クラス分類 (Refined-Definitions)
    horses.forEach(h => {
        const { rank, ev, winRate } = h;
        
        // Place-Core
        if (rank === 'S' && ev < 0.700) h.cls = 'S0';
        else if (rank === 'S' && ev >= 0.700 && ev <= 0.999) h.cls = 'S1';
        else if (rank === 'S' && ev >= 1.200 && ev <= 1.499) h.cls = 'S2';
        else if (rank === 'B' && ev <= 0.500) h.cls = 'B0+';
        else if (rank === 'A' && ev < 0.600) h.cls = 'A0';
        else if (rank === 'B' && ev > 0.500 && ev <= 0.900) h.cls = 'B0';
        else if (rank === 'A' && ev >= 0.600 && ev <= 0.899) h.cls = 'A1'; // < 0.900 is <=0.899 if trunc 3
        else if (rank === 'C' && winRate >= 0.05 && ev < 1.000) h.cls = 'C0';
        
        // Win-Core
        else if (rank === 'D' && ev >= 3.000 && ev <= 3.999) h.cls = 'X';
        else if (rank === 'B' && ev >= 1.500 && ev <= 1.999) h.cls = 'B2'; // < 2.000 is <=1.999
        else if (rank === 'B' && ev >= 1.100 && ev <= 1.350) h.cls = 'B1';
        else if (rank === 'B' && ev >= 2.000 && ev <= 4.500) h.cls = 'B3';
        else if (rank === 'A' && ev >= 1.000 && ev <= 1.250) h.cls = 'A2';
        else if (rank === 'D' && ev >= 1.300 && ev <= 1.999) h.cls = 'D1';
        else h.cls = 'N';
    });

    // 3. SS密度と推奨度の判定
    const targetSet = new Set(['S', 'A', 'B', 'D']);
    let ssTargetCount = 0;
    horses.forEach(h => {
        if (h.ev >= 1.300 && targetSet.has(h.rank)) {
            ssTargetCount++;
        }
    });
    
    const activeHorsesCount = horses.filter(h => h.odds > 0).length;
    const denom = Math.max(12, activeHorsesCount);
    const ssDensity = truncateTo3(ssTargetCount / denom);

    const axisCandidatesSet = new Set(['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'C0']);
    const hasS0S1 = horses.some(h => h.cls === 'S0' || h.cls === 'S1');
    const axisCandidates = horses.filter(h => axisCandidatesSet.has(h.cls));
    const hasAxis = axisCandidates.length > 0;

    let recommendation = '';
    if (ssDensity >= 0.250 && hasS0S1) recommendation = '🔥🔥🔥 (SSS)';
    else if (ssDensity >= 0.250 && hasAxis) recommendation = '🔥🔥 (SS)';
    else if (ssDensity >= 0.150) recommendation = '🔥 (S)';
    else recommendation = '⚠️ (Low)';

    let skipReason = null;
    const requiredDensity = isGradeRace ? 0.100 : 0.150;
    if (!hasAxis) skipReason = '軸不在（単勝のみ執行可）';
    else if (ssDensity < requiredDensity) skipReason = `低密度 (SS密度 ${ssDensity} < ${requiredDensity})`;

    // タイブレークソート関数群
    const sortAttack = (a, b) => {
        if (a.ev !== b.ev) {
            if (Math.abs(a.ev - b.ev) <= 0.100) {
                return b.umaban - a.umaban; // 馬番大きい方優先
            }
            return a.ev - b.ev; // EV低い方
        }
        return b.umaban - a.umaban;
    };

    const sortDefense = (a, b) => {
        if (a.umaban !== b.umaban) return a.umaban - b.umaban; // 内枠優先
        return a.ev - b.ev;
    };
    
    const sortN = (a, b) => {
        if (a.winRate !== b.winRate) return b.winRate - a.winRate; // 勝率高い方
        return b.umaban - a.umaban; // 馬番大きい方
    };

    // 4. MAO計算
    const defenseClasses = new Set(['S0', 'S1', 'S2', 'B0+', 'A0', 'B0', 'A1', 'C0']);
    const attackClasses1 = new Set(['B1', 'B2', 'B3', 'A2']); // Buffer 1.2
    const attackClassesX = new Set(['X']); // 3.0, Buffer 1.0
    const attackClassesD1 = new Set(['D1']); // 1.0, Buffer 1.0

    horses.forEach(h => {
        if (defenseClasses.has(h.cls)) h.maoRaw = 0.50 / h.winRate;
        else if (attackClasses1.has(h.cls)) h.maoRaw = 0.90 / h.winRate;
        else if (attackClassesX.has(h.cls)) h.maoRaw = 3.00 / h.winRate;
        else if (attackClassesD1.has(h.cls)) h.maoRaw = 1.00 / h.winRate;
        else h.maoRaw = 999;
        
        h.mao = truncateTo3(h.maoRaw);

        // Amber Audit
        if (attackClassesX.has(h.cls) || attackClassesD1.has(h.cls)) {
            h.amberPassed = h.odds >= h.mao;
        } else if (defenseClasses.has(h.cls) || attackClasses1.has(h.cls)) {
            h.amberPassed = h.odds >= (h.mao * 1.2);
        } else {
            h.amberPassed = false;
        }
    });

    // 5. 投資プロトコル計算
    // ① 単勝 (WIN) - Kelly基準に基づく安定型序列（A・B評価重視）
    const WIN_PRIORITY = ['A2', 'B1', 'B3', 'B2', 'D1', 'X', 'B0+'];
    const strikerWallFilter = (h) => {
        if (h.umaban >= 13 && (h.cls === 'A1' || h.cls === 'S2' || h.cls === 'A0')) return false;
        
        // フェーズ4.5: 近走監査 (Striker Validation)
        // X, D1 は手動チェックがONの場合のみ単勝対象とする
        if (h.cls === 'X' || h.cls === 'D1') {
            if (!h.passedStrikerValidation) return false;
        }
        
        return true;
    };
    
    let strikerCandidates = [];
    for (const pCls of WIN_PRIORITY) {
        let matching = horses.filter(h => h.cls === pCls && strikerWallFilter(h));
        matching.sort(sortAttack);
        strikerCandidates.push(...matching);
    }
    
    // MAO Passed only
    const winTargets = strikerCandidates.filter(h => h.amberPassed).slice(0, 2);

    // ② ワイド (Insurance) 
    // ユーザ指定により軸不在時は単勝のみ
    let wideTargets = [];
    let sanrenpuku = { axis: null, row2: [], row3: [] };

    if (hasAxis && !skipReason) {
        // Axis selection: S0 > S1 > S2 > A0 > B0+ > A1 > C0
        const axisPrio = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'C0'];
        let axisHorse = null;
        for (const pCls of axisPrio) {
            let matching = horses.filter(h => h.cls === pCls);
            if (matching.length > 0) {
                matching.sort(sortDefense);
                axisHorse = matching[0];
                break;
            }
        }

        sanrenpuku.axis = axisHorse;

        // Wide candidates:
        let wideOpponents = [...winTargets];
        if (wideOpponents.length === 0) {
            // 単勝不在または不的中リスク => C0優先採用
            let c0s = horses.filter(h => h.cls === 'C0');
            c0s.sort(sortDefense);
            if (c0s.length > 0) wideOpponents.push(c0s[0]);
        }

        wideOpponents.slice(0, 2).forEach(opp => {
            wideTargets.push({ axis: axisHorse, opp: opp });
        });

        // ③ 三連複
        // 2nd line
        const defPrio = ['S0', 'S1', 'S2', 'A0', 'A1', 'B0+']; 
        let row2Def = [];
        for (const pCls of defPrio) {
            let matching = horses.filter(h => h.cls === pCls && h.umaban !== axisHorse.umaban);
            matching.sort(sortDefense);
            row2Def.push(...matching);
        }
        
        // S系優先（S0,S1,S2はすでにdefPrioの最初にあるのでOK）
        row2Def = row2Def.slice(0, 2);

        // 三連複2列目（攻撃枠）- 波乱狙いの攻撃型序列（X・D重視、単勝とは独立）
        const TRIO_ATTACK_PRIORITY = ['B1', 'B2', 'X', 'D1', 'B3', 'A2'];
        let row2Atk = [];
        for (const pCls of TRIO_ATTACK_PRIORITY) {
            let matching = horses.filter(h => h.cls === pCls && h.umaban !== axisHorse.umaban);
            matching.sort(sortAttack);
            row2Atk.push(...matching);
        }
        row2Atk = row2Atk.slice(0, 1);

        sanrenpuku.row2 = [...row2Def, ...row2Atk];

        // 3rd line
        let row3Set = new Set(sanrenpuku.row2.map(h => h.umaban));
        
        let addRow3 = (hList) => {
            for (const h of hList) {
                if (h.umaban !== axisHorse.umaban && !row3Set.has(h.umaban)) {
                    row3Set.add(h.umaban);
                }
            }
        };

        // All S rank
        addRow3(horses.filter(h => h.rank === 'S'));
        // All Strikers
        addRow3(horses.filter(h => TRIO_ATTACK_PRIORITY.includes(h.cls)));
        // Remaining
        let remC0 = horses.filter(h => h.cls === 'C0');
        remC0.sort(sortDefense);
        addRow3(remC0);
        
        let remN = horses.filter(h => !row3Set.has(h.umaban) && h.umaban !== axisHorse.umaban);
        remN.sort(sortN);
        addRow3(remN);

        let row3Arr = Array.from(row3Set).map(uma => horses.find(h => h.umaban === uma));
        
        // 厳密には序列順に並べる。「2列目全馬、S全馬、Striker全馬、C0、N...」の順番。
        // 上記addRow3順で追加しているのでSetから配列化すれば元の意図に近いが順序を厳密化。
        let finalRow3 = [];
        let r3Add = (cond) => {
            horses.filter(cond).forEach(h => {
                if (row3Set.has(h.umaban) && !finalRow3.some(f => f.umaban === h.umaban)) {
                    finalRow3.push(h);
                }
            });
        };
        r3Add(h => sanrenpuku.row2.some(r2 => r2.umaban === h.umaban));
        r3Add(h => h.rank === 'S');
        
        for(let c of TRIO_ATTACK_PRIORITY) { r3Add(h => h.cls === c); }
        r3Add(h => h.cls === 'C0');
        remN.forEach(h => {
             if (row3Set.has(h.umaban) && !finalRow3.some(f => f.umaban === h.umaban)) finalRow3.push(h);
        });

        sanrenpuku.row3 = finalRow3.slice(0, 10);
    }

    return {
        ssDensity,
        recommendation,
        skipReason,
        winTargets,
        wideTargets,
        sanrenpuku,
        horses
    };
}
