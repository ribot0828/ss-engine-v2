// SS-Engine Ver.5.22 Core Logic

export const LOGIC_VERSION = "v5.34";

const SCORE_MAP = {
    'S': 100, 'A': 65, 'B': 40, 'C': 20, 'D': 10, 'E': 3, 'F': 0.5
};

// 攻撃系優先度（単勝 WIN_PRIORITY と三連複 TRIO_ATTACK_PRIORITY は同一のため統合）[10] Kelly比 D1>B1
const ATTACK_PRIORITY = ['A3', 'B2', 'A2', 'D1', 'B1', 'B3'];
// 防御系優先度（axisPrio / defPrio / defenseClasses は同一の並びのため統合）
const DEFENSE_PRIORITY = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
const DEFENSE_SET = new Set(DEFENSE_PRIORITY);

// 単勝ユニット配分表（推奨度レベル × クラス別）[8][9] Low推奨度は全スキップ(0U)
// 2026-07-19: SSS列をSS水準へ縮小（live SSS回収64.8%/n=29。h11復帰条件あり）
const UNIT_TABLE = {
    'A3': { SSS: 5, SS: 5, S: 5, Low: 0 },
    'B2': { SSS: 2, SS: 2, S: 2, Low: 0 }, // [9] B2適正化
    'A2': { SSS: 2, SS: 2, S: 2, Low: 0 }, // SSS/SS/S共通
    'B1': { SSS: 1, SS: 1, S: 1, Low: 0 }, // [8] B1は全推奨度1U固定
    'D1': { SSS: 1, SS: 1, S: 1, Low: 0 }, // 1U固定（Kellyのfloor）
    'B3': { SSS: 1, SS: 1, S: 1, Low: 0 },
};

// 小数点第3位以下切り捨て (厳密な生データ比較を維持)
function truncateTo3(val) {
    return Math.floor(val * 1000 + 1e-9) / 1000;
}

// コース詳細文字列から芝/ダを判定（先に出現した方。analyzer.js surfaceOfRow 移植）
function surfaceOfCourse(courseInfo) {
    const s = courseInfo || "";
    const iT = s.indexOf('芝');
    const iD = s.indexOf('ダ');
    if (iT >= 0 && (iD < 0 || iT < iD)) return '芝';
    if (iD >= 0) return 'ダ';
    return '-';
}
// コース詳細文字列から距離mを抽出（analyzer.js distanceOfRow 移植）
function distanceOfCourse(courseInfo) {
    const s = courseInfo || "";
    let m = s.match(/(\d{3,4})\s*m/);
    if (m) return parseInt(m[1], 10);
    m = s.match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : 0;
}

export function analyzeRace(horses, isGradeRace = false, courseInfo = "") {
    if (!horses || horses.length === 0) return null;

    // フェールセーフ: odds / rank の欠損・型異常を補正
    horses.forEach(h => {
        if (h.odds === undefined || h.odds === null || isNaN(h.odds)) h.odds = 0;
        else h.odds = parseFloat(h.odds) || 0;
        if (!h.rank || !SCORE_MAP[h.rank]) h.rank = 'B';
    });

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
        
        // Win-Core
        // 2026-07-14 [h2] X購入停止: D評価EV3.000-3.999のX分類を廃止しN扱い（analyzer.js 382ec0e 整合）
        else if (rank === 'B' && ev >= 1.500 && ev <= 1.699) h.cls = 'B2';
        else if (rank === 'B' && ev >= 1.100 && ev <= 1.350) h.cls = 'B1';
        else if (rank === 'B' && ev >= 2.000 && ev <= 4.500) h.cls = 'B3';
        else if (rank === 'A' && ev >= 1.500 && ev <= 1.699) h.cls = 'A3'; // A3: analyzer.jsに整合（旧1.999→1.699。バックテスト検証レンジに一致）
        else if (rank === 'A' && ev >= 1.000 && ev <= 1.250) h.cls = 'A2';
        else if (rank === 'D' && ev >= 1.300 && ev <= 1.799) h.cls = 'D1';
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

    const hasS0S1 = horses.some(h => h.cls === 'S0' || h.cls === 'S1');
    const axisCandidates = horses.filter(h => DEFENSE_SET.has(h.cls));
    const hasAxis = axisCandidates.length > 0;

    let recommendation = '';
    if (ssDensity >= 0.250 && hasS0S1) recommendation = '🔥🔥🔥 (SSS)';
    else if (ssDensity >= 0.250 && hasAxis) recommendation = '🔥🔥 (SS)';
    else if (ssDensity >= 0.150) recommendation = '🔥 (S)';
    else recommendation = '⚠️ (Low)';

    // Low推奨度は全スキップ（単勝・三連複とも0U）
    const isLow = recommendation.includes('Low');
    // S推奨度は三連複スキップ（単勝のみ執行）
    const isSRec = recommendation.includes('(S)') && !recommendation.includes('SS');
    // 2026-07-14 [h3] SSS推奨度は三連複スキップ（実運用SSS三連複=0%/25R。単勝のみ執行）
    const isSSSRec = recommendation.includes('SSS');

    let skipReason = null;
    const requiredDensity = isGradeRace ? 0.100 : 0.150;
    if (!hasAxis) skipReason = '軸不在（単勝のみ執行可）';
    else if (isSSSRec) skipReason = 'SSS推奨度（三連複スキップ・単勝のみ執行）';
    else if (isSRec) skipReason = 'S推奨度（単勝のみ執行）';
    else if (ssDensity < requiredDensity) skipReason = `低密度 (SS密度 ${ssDensity} < ${requiredDensity})`;

    // タイブレークソート関数群
    const sortAttack = (a, b) => {
        if (a.ev !== b.ev) {
            if (Math.abs(a.ev - b.ev) <= 0.100) {
                return a.umaban - b.umaban; // 馬番小さい順（内枠優先）
            }
            return a.ev - b.ev; // EV低い順（昇順）
        }
        return a.umaban - b.umaban;
    };

    const sortDefense = (a, b) => {
        return a.ev - b.ev; // 例外排除、EV低い順（昇順）のみ
    };

    const sortN = (a, b) => {
        if (a.winRate !== b.winRate) return b.winRate - a.winRate; // 勝率高い方
        return b.umaban - a.umaban; // 馬番大きい方
    };

    // 優先度ピック処理の共通ヘルパー: priorityList の各クラスを順に filter→sort→push
    const pickByPriority = (horsesList, priorityList, sortFn, filterFn = () => true) => {
        let result = [];
        for (const pCls of priorityList) {
            let matching = horsesList.filter(h => h.cls === pCls && filterFn(h));
            matching.sort(sortFn);
            result.push(...matching);
        }
        return result;
    };

    // 4. MAO計算
    const defenseClasses = DEFENSE_SET;
    const attackClasses1 = new Set(['A3', 'B1', 'B2', 'B3', 'A2']); // Buffer 1.2
    const attackClassesD1 = new Set(['D1']); // 1.0, Buffer 1.0

    horses.forEach(h => {
        if (defenseClasses.has(h.cls)) h.maoRaw = 0.60 / h.winRate; // Ver.5.3: 防御系係数 0.50→0.60（三連複軸の観測精度向上。単勝P&L影響ゼロ）
        else if (attackClasses1.has(h.cls)) h.maoRaw = 0.90 / h.winRate;
        else if (attackClassesD1.has(h.cls)) h.maoRaw = 1.70 / h.winRate; // 2026-07-19: D1係数 1.50→1.70（live回収76.2%による引き締め。※2.00はD1のEV上限1.799を超え全滅となるため1.70。実質約57倍下限）
        else h.maoRaw = 999;

        h.mao = truncateTo3(h.maoRaw);

        // Amber Audit
        if (attackClassesD1.has(h.cls)) {
            h.amberPassed = h.odds >= h.mao;
        } else if (defenseClasses.has(h.cls) || attackClasses1.has(h.cls)) {
            h.amberPassed = h.odds >= (h.mao * 1.2);
        } else {
            h.amberPassed = false;
        }
    });

    // 5. 投資プロトコル計算
    // ① 単勝 (WIN) - Kelly基準に基づく安定型序列（A・B評価重視）
    const strikerWallFilter = (h) => {
        if (h.umaban >= 13 && (h.cls === 'A1' || h.cls === 'S2' || h.cls === 'A0')) return false;

        // フェーズ4.5: 近走監査 (Striker Validation)
        // D1 は手動チェックがONの場合のみ単勝対象とする
        if (h.cls === 'D1') {
            if (!h.passedStrikerValidation) return false;
        }

        return true;
    };

    const strikerCandidates = isLow ? [] : pickByPriority(horses, ATTACK_PRIORITY, sortAttack, strikerWallFilter);

    // MAO Passed only (Low推奨度は空配列=全スキップ)
    const winTargets = strikerCandidates.filter(h => h.amberPassed).slice(0, 2);

    // ユニット配分（推奨度レベル×クラス別。旧 logic.js 側の h.unit（死にデータ）を廃止し、
    // 従来 app.js renderResults 側で計算していた表を正として一本化）
    let recLevel = 'Low';
    if (recommendation.includes('SSS')) recLevel = 'SSS';
    else if (recommendation.includes('SS')) recLevel = 'SS';
    else if (recommendation.includes('(S)')) recLevel = 'S';

    // 2026-07-14 [h5/h6] ダ1401m+・重賞はユニット半減（最低1U維持。analyzer.js getUnits 整合）
    const isDirtLong = surfaceOfCourse(courseInfo) === 'ダ' && distanceOfCourse(courseInfo) >= 1401;
    winTargets.forEach(h => {
        const row = UNIT_TABLE[h.cls];
        let u = row ? row[recLevel] : 0;
        if (u > 0 && (isGradeRace || isDirtLong)) u = Math.max(1, Math.floor(u / 2));
        h.unit = u;
    });

    // ② ワイド (Insurance) 
    // ユーザ指定により軸不在時は単勝のみ
    let wideTargets = [];
    let sanrenpuku = { axis: null, row2: [], combos: [] };

    if (hasAxis && !skipReason && !isLow) {
        // Axis selection
        let axisHorse = null;
        for (const pCls of DEFENSE_PRIORITY) {
            let matching = horses.filter(h => h.cls === pCls);
            if (matching.length > 0) {
                matching.sort(sortDefense);
                axisHorse = matching[0];
                break;
            }
        }

        sanrenpuku.axis = axisHorse;

        // Wide candidates: Ver.5.29にてワイド生成は無効化（オフ）
        let wideOpponents = [];

        // ③ 三連複（軸1頭ながし方式）[12]
        // 相手(row2): Place-Core系から防御ソートで最大2頭 + Win-Core系から攻撃ソートで最大1頭
        const notAxis = (h) => h.umaban !== axisHorse.umaban;
        let row2Def = pickByPriority(horses, DEFENSE_PRIORITY, sortDefense, notAxis);
        row2Def = row2Def.slice(0, 2); // 最大2頭

        let row2Atk = pickByPriority(horses, ATTACK_PRIORITY, sortAttack, notAxis); // [10] D1>B1
        row2Atk = row2Atk.slice(0, 1); // 最大1頭

        // 相手（最大3頭・軸/重複を除外）
        let mates = [];
        for (const h of [...row2Def, ...row2Atk]) {
            if (h.umaban !== axisHorse.umaban && !mates.some(m => m.umaban === h.umaban)) {
                mates.push(h);
            }
        }
        sanrenpuku.row2 = mates;

        // 買い目生成: 軸を必ず含み、相手から2頭 = 軸 × C(相手,2)。網は撤廃。上限3点
        let combos = [];
        for (let i = 0; i < mates.length; i++) {
            for (let j = i + 1; j < mates.length; j++) {
                combos.push([axisHorse.umaban, mates[i].umaban, mates[j].umaban].sort((a, b) => a - b));
            }
        }
        // 相手1頭以下なら買い目なし（実質スキップ）
        sanrenpuku.combos = combos; // 各要素=[a,b,c]昇順。最大3点

        // 自己検査: 全買い目に軸を含む & 点数<=3
        if (combos.some(c => !c.includes(axisHorse.umaban))) console.error('[三連複] 軸欠落の買い目を検出');
        if (combos.length > 3) console.error('[三連複] 点数が3を超過');
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
