/**
 * SS-Analyzer Ultimate v3.0 | アルティメット統合・解析・シミュレーター
 * Core Logic (analyzer.js)
 */

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropzone = document.getElementById('dropzone');
    const fileList = document.getElementById('file-list');
    const integrateBtn = document.getElementById('integrateBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const mainAnalysisView = document.getElementById('main-analysis-view');
    const riskDashboard = document.getElementById('risk-dashboard');
    const analysisResultArea = document.getElementById('analysisResultArea');
    const recommendationResultArea = document.getElementById('recommendationResultArea');
    const simulatorResultArea = document.getElementById('simulatorResultArea');
    const simChartContainer = document.getElementById('simChartContainer');
    const outlierResultArea = document.getElementById('outlierResultArea');
    const geminiOutput = document.getElementById('geminiOutput');
    const geminiExportSection = document.getElementById('geminiExportSection');
    const copyBtn = document.getElementById('copyBtn');
    const toast = document.getElementById('toast');
    const runSimulatorBtn = document.getElementById('runSimulatorBtn');

    // Filters
    const filterVenue = document.getElementById('filter-venue');
    const filterSurface = document.getElementById('filter-surface');
    const filterCondition = document.getElementById('filter-condition');
    const filterDistCat = document.getElementById('filter-dist-cat');

    // State
    let allData = new Map(); 
    let filteredData = [];
    let equityChartInstance = null;
    let simChartInstance = null;
    let availableClasses = [];

    const EXPECTED_HEADERS = [
        "日付", "レース名", "コース詳細", "グレード・頭数", "馬番", "馬名", "購入時人気", "購入時オッズ", 
        "評価", "購入時期待値", "購入時クラス", "最終確定人気", "最終確定オッズ", "最終確定期待値", 
        "最終確定クラス", "着順", "MAO", "実行フラグ", "単勝払戻", "ワイド払戻", "三連複払戻"
    ];

    // --- Data Pre-processing ---
    function parseCourseDetail(detail) {
        if (!detail) return { venue: "-", surface: "-", distance: 0, distCat: "other", condition: "-" };
        
        // Regex pattern for Venue, Surface, Distance, and Condition
        // Example: "中山芝1600外C 良", "東京ダ1400 稍重"
        const regex = /^(?<venue>[^芝ダ障]+)(?<surface>芝|ダ|障)(?<distance>\d+)(?<rest>[^ ]*)( +(?<condition>良|稍重|重|不良))?/;
        const match = detail.match(regex);
        
        if (!match) return { venue: detail.substring(0,2), surface: "-", distance: 0, distCat: "other", condition: "-" };
        
        const g = match.groups;
        const dist = parseInt(g.distance);
        let distCat = "other";
        if (dist <= 1400) distCat = "short";
        else if (dist <= 1800) distCat = "mile";
        else if (dist <= 2200) distCat = "middle";
        else distCat = "long";

        return {
            venue: g.venue,
            surface: g.surface,
            distance: dist,
            distCat: distCat,
            condition: g.condition || "-"
        };
    }

    // --- File Handling ---
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
    dropzone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true; input.accept = '.csv';
        input.onchange = (e) => handleFiles(e.target.files);
        input.click();
    });

    async function handleFiles(files) {
        showToast("読み込み中...");
        for (const file of files) {
            if (file.name.endsWith('.csv')) {
                const results = await parseCSV(file);
                processRows(results.data);
                addFileBadge(file.name, results.data.length);
            }
        }
        populateFilters();
        updateControlPanel();
        showToast("ロード完了");
    }

    function parseCSV(file) {
        return new Promise((resolve) => {
            Papa.parse(file, { header: true, skipEmptyLines: true, complete: (results) => resolve(results) });
        });
    }

    function processRows(rows) {
        rows.forEach(row => {
            const normalizedRow = detectAndMapLegacy(row);
            if (!normalizedRow["レース名"] || !normalizedRow["馬番"]) return;
            
            // Add custom extracted fields
            const ctx = parseCourseDetail(normalizedRow["コース詳細"]);
            Object.assign(normalizedRow, ctx);

            // 近走監査の読み取りとauditStatus付与
            const auditRaw = (normalizedRow["近走監査"] || "").trim();
            if (auditRaw === "✕") {
                normalizedRow.auditStatus = 'NG';
            } else if (auditRaw === "〇") {
                normalizedRow.auditStatus = 'OK';
            } else {
                // 列なし・空欄・"-" → X/D1はOK扱い（後方互換性）
                normalizedRow.auditStatus = 'OK';
            }

            const raceId = getRaceId(normalizedRow);
            const uniqueKey = `${raceId}_${normalizedRow["馬番"]}`;
            allData.set(uniqueKey, normalizedRow);
        });
    }

    function detectAndMapLegacy(row) {
        const isLegacy = row["実際オッズ"] !== undefined || row["最終詳細クラス"] !== undefined;
        if (!isLegacy) return row;
        const mapped = {};
        mapped["日付"] = row["日付"] || "Legacy";
        mapped["レース名"] = row["レース名"];
        mapped["コース詳細"] = row["コース詳細(開催場も含めた)"] || row["コース詳細"] || "";
        mapped["グレード・頭数"] = row["レースグレード"] || "-";
        mapped["馬番"] = row["馬番"];
        mapped["馬名"] = row["馬名"];
        mapped["購入時人気"] = "-";
        mapped["購入時オッズ"] = row["実際オッズ"];
        mapped["評価"] = row["評価"];
        mapped["購入時期待値"] = row["期待値"];
        mapped["購入時クラス"] = row["最終詳細クラス"];
        mapped["最終確定人気"] = "-";
        mapped["最終確定オッズ"] = row["実際オッズ"];
        mapped["最終確定期待値"] = row["期待値"];
        mapped["最終確定クラス"] = row["最終詳細クラス"];
        mapped["着順"] = row["着順"];
        mapped["MAO"] = "-";
        mapped["実行フラグ"] = "-";
        mapped["単勝払戻"] = row["単勝払戻"] || "";
        mapped["ワイド払戻"] = row["ワイド払戻"] || "";
        mapped["三連複払戻"] = row["三連複払戻"] || "";
        mapped["近走監査"] = ""; // Legacy: 監査列なし → processRowsでOK扱いになる
        return mapped;
    }

    function getRaceId(row) {
        return `${row["日付"]}_${row["レース名"]}_${row["コース詳細"]}`;
    }

    function addFileBadge(name, count) {
        const badge = document.createElement('div');
        badge.className = 'status-badge status-info text-xs';
        badge.textContent = `📁 ${name} (${count})`;
        fileList.appendChild(badge);
    }

    function populateFilters() {
        const data = Array.from(allData.values());
        const venues = [...new Set(data.map(d => d.venue))].filter(v => v && v !== "-").sort();
        const conditions = [...new Set(data.map(d => d.condition))].filter(c => c && c !== "-").sort();
        availableClasses = [...new Set(data.map(d => d["最終確定クラス"] || d["購入時クラス"]))].filter(c => c).sort();

        updateSelect(filterVenue, venues);
        updateSelect(filterCondition, conditions);
        populateSimulatorClasses();
    }

    function updateSelect(el, items) {
        const current = el.value;
        el.innerHTML = '<option value="all">すべて</option>';
        items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item; opt.textContent = item;
            el.appendChild(opt);
        });
        el.value = current;
    }

    function populateSimulatorClasses() {
        const containers = ['sim-row1-classes', 'sim-row2-classes', 'sim-row3-classes'];
        containers.forEach(cid => {
            const container = document.getElementById(cid);
            container.innerHTML = '';
            availableClasses.forEach(c => {
                const label = document.createElement('label');
                label.className = 'flex items-center gap-1 cursor-pointer hover:text-blue-400';
                label.innerHTML = `<input type="checkbox" value="${c}" class="rounded bg-slate-800 border-slate-700"> ${c}`;
                container.appendChild(label);
            });
        });
    }

    function updateControlPanel() {
        if (allData.size > 0) {
            integrateBtn.disabled = false;
            analyzeBtn.disabled = false;
            document.getElementById('data-status-badge').textContent = `${allData.size}件ロード済`;
            document.getElementById('data-status-badge').className = 'status-badge bg-green-900 text-green-300';
        }
    }

    // --- Filtering Engine ---
    function applyFilters() {
        const v = filterVenue.value;
        const s = filterSurface.value;
        const c = filterCondition.value;
        const d = filterDistCat.value;

        filteredData = Array.from(allData.values()).filter(row => {
            if (v !== 'all' && row.venue !== v) return false;
            if (s !== 'all' && row.surface !== s) return false;
            if (c !== 'all' && row.condition !== c) return false;
            if (d !== 'all' && row.distCat !== d) return false;
            return true;
        });

        if (filteredData.length > 0) {
            performFullAnalysis();
        }
    }

    [filterVenue, filterSurface, filterCondition, filterDistCat].forEach(el => {
        el.addEventListener('change', applyFilters);
    });

    // --- Analysis ---
    analyzeBtn.addEventListener('click', () => {
        applyFilters();
        mainAnalysisView.classList.remove('hidden');
        riskDashboard.classList.remove('hidden');
        geminiExportSection.classList.remove('hidden');
    });

    function performFullAnalysis() {
        try {
            const rowsWithRank = filteredData.filter(d => d["着順"] && d["着順"].trim() !== "");
            
            const raceMap = {};
            rowsWithRank.forEach(r => {
                const id = getRaceId(r);
                if (!raceMap[id]) raceMap[id] = [];
                raceMap[id].push(r);
            });

            const simulatedRaces = Object.keys(raceMap).map(id => simulateRace(raceMap[id], id));

            const riskStats = calculateRiskMetrics(simulatedRaces);
            renderRiskDashboard(riskStats);

            const classStats = calculateClassStats(rowsWithRank);
            renderClassTable(classStats);

            try {
                renderOddsAuditAnalysis(rowsWithRank);
            } catch (e) {
                console.error("Odds Audit rendering error:", e);
            }

            const recStats = calculateRecommendationStats(simulatedRaces);
            renderRecommendationTable(recStats);

            let amberStats = [];
            try {
                amberStats = calculateAmberStats(simulatedRaces);
                renderAmberReport(amberStats);
            } catch (e) {
                console.error("Amber Report rendering error:", e);
            }

            drawEquityCurve(simulatedRaces);

            initRankEvTabs(rowsWithRank);
            renderRankEvAnalysis('S', rowsWithRank);

            const outliers = detectOutliers(rowsWithRank);
            renderOutliers(outliers);

            const md = generateUltimateMarkdown(riskStats, classStats, recStats, outliers, simulatedRaces);
            geminiOutput.value = md;

            // JSONエクスポートデータの保持
            window.latestSimData = { rowsWithRank, riskStats, classStats, amberStats, recStats, simulatedRaces };

            const jsonBtn = document.getElementById('downloadJsonBtn');
            if (jsonBtn) jsonBtn.classList.remove('hidden');

            const analysisTbl = document.querySelector('#analysisResultArea table');
            if (analysisTbl) makeTableSortable(analysisTbl);

            const recTbl = document.querySelector('#recommendationResultArea table');
            if (recTbl) makeTableSortable(recTbl);

        } catch (e) {
            console.error("Full Analysis Error:", e);
            showToast("解析中にエラーが発生しました。詳細はコンソールを確認してください。");
        }
    }

    const WIN_CORE_CLASSES = ['X', 'B1', 'D1', 'B2', 'B3', 'A2', 'A3'];
    const PLACE_CORE_CLASSES_FULL = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
    const AXIS_CLASSES = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
    const WIN_PRIORITY = ['A3', 'B2', 'A2', 'B1', 'B3', 'D1', 'X'];
    const TRIO_ROW2_DEFENSE = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
    const TRIO_ROW2_ATTACK = ['A3', 'B1', 'B2', 'X', 'D1', 'B3', 'A2'];

    function enrichHorses(horses) {
        let totalScore = 0;
        
        // 1. スコア付与と合計計算
        horses.forEach(h => {
            let score = 0;
            const r = (h["評価"] || "").toUpperCase().trim();
            const odds = parseFloat(h["最終確定オッズ"]) || parseFloat(h["購入時オッズ"]) || 0;
            if (odds > 0) {
                if (r === 'S') score = 100;
                else if (r === 'A') score = 65;
                else if (r === 'B') score = 40;
                else if (r === 'C') score = 20;
                else if (r === 'D') score = 10;
                else if (r === 'E') score = 3;
                else if (r === 'F') score = 0.5;
            }
            h.score = score;
            h.usedOdds = odds;
            totalScore += score;
        });

        // 2. 完全再計算とプロパティ上書き
        horses.forEach(h => {
            h.expectedWinRate = (totalScore > 0 && h.usedOdds > 0) ? h.score / totalScore : 0;
            const rawEv = h.expectedWinRate * h.usedOdds;
            h.calculatedEv = Math.floor(rawEv * 1000 + 1e-9) / 1000;
            
            let cls = 'N';
            const ev = h.calculatedEv;
            const r = (h["評価"] || "").toUpperCase().trim();
            const winRate = h.expectedWinRate;

            if (h.usedOdds > 0) {
                if (r === 'S' && ev < 0.700) cls = 'S0';
                else if (r === 'S' && ev >= 0.700 && ev <= 0.999) cls = 'S1';
                else if (r === 'S' && ev >= 1.200 && ev <= 1.499) cls = 'S2';
                else if (r === 'B' && ev <= 0.500) cls = 'B0+';
                else if (r === 'A' && ev < 0.600) cls = 'A0';
                else if (r === 'B' && ev > 0.500 && ev <= 0.900) cls = 'B0';
                else if (r === 'A' && ev >= 0.600 && ev <= 0.899) cls = 'A1';
                else if (r === 'D' && ev >= 3.000 && ev <= 3.999) cls = 'X';
                else if (r === 'B' && ev >= 1.500 && ev <= 1.699) cls = 'B2';
                else if (r === 'B' && ev >= 1.100 && ev <= 1.350) cls = 'B1';
                else if (r === 'B' && ev >= 2.000 && ev <= 4.500) cls = 'B3';
                else if (r === 'A' && ev >= 1.000 && ev <= 1.250) cls = 'A2';
                else if (r === 'A' && ev >= 1.500 && ev <= 1.999) cls = 'A3';
                else if (r === 'D' && ev >= 1.300 && ev <= 1.799) cls = 'D1';
            }

            let mao = 999;
            if (winRate > 0) {
                if (['S0','S1','S2','A0','B0+','A1','B0'].includes(cls)) mao = 0.50 / winRate;
                else if (['B1', 'B2', 'B3', 'A2', 'A3'].includes(cls)) mao = 0.90 / winRate;
                else if (cls === 'X') mao = 3.00 / winRate;
                else if (cls === 'D1') mao = 1.00 / winRate;
            }

            let amberPass = false;
            if (cls === 'X' || cls === 'D1') {
                amberPass = h.usedOdds >= mao;
            } else if (['S0','S1','S2','A0','B0+','A1','B0','B1','B2','B3','A2', 'A3'].includes(cls)) {
                amberPass = h.usedOdds >= (mao * 1.2);
            }
            h.amberPass = amberPass;
            
            // 後続のシミュレーションがそのまま動くようにCSVの値を強制上書き
            h["最終確定クラス"] = cls;
            h["購入時クラス"] = cls;
            h["最終確定期待値"] = h.calculatedEv;
            h["購入時期待値"] = h.calculatedEv;
        });

        return horses;
    }

    function calculateSSDensity(raceHorses) {
        const qualifiedCount = raceHorses.filter(h => {
            const ev = parseFloat(h["最終確定期待値"]) || parseFloat(h["購入時期待値"]) || 0;
            const rating = (h["評価"] || "").toUpperCase().trim();
            return ev >= 1.300 && ['S', 'A', 'B', 'D'].includes(rating);
        }).length;
        const validCount = raceHorses.filter(h => (parseFloat(h["最終確定オッズ"]) || parseFloat(h["購入時オッズ"]) || 0) > 0).length;
        const denominator = Math.max(12, validCount);
        return qualifiedCount / denominator;
    }

    function determineRecommendation(raceHorses) {
        const density = calculateSSDensity(raceHorses);
        const classes = raceHorses.map(h => (h["最終確定クラス"] || h["購入時クラス"] || "").trim());
        const hasS0orS1 = classes.some(c => c === 'S0' || c === 'S1');
        const hasAxis = classes.some(c => AXIS_CLASSES.includes(c));

        if (density >= 0.250 && hasS0orS1) return 'SSS';
        if (density >= 0.250 && hasAxis) return 'SS';
        if (density >= 0.150) return 'S';
        return 'Low';
    }

    function simulateRace(raceHorses, raceId) {
        raceHorses = enrichHorses(raceHorses);
        const classes = raceHorses.map(h => (h["最終確定クラス"] || h["購入時クラス"] || "").trim());
        const density = calculateSSDensity(raceHorses);
        
        // 優先順位の定数定義（念のため関数内に明記）
        const PLACE_CORE_CLASSES = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
        const WIN_CORE_CLASSES = ['X', 'B1', 'D1', 'B2', 'B3', 'A2', 'A3'];
        const WIN_PRIORITY_LOCAL = ['A3', 'B2', 'A2', 'B1', 'B3', 'D1', 'X'];
        const TRIO_ROW2_DEFENSE_LOCAL = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
        const TRIO_ROW2_ATTACK_LOCAL = ['A3', 'B1', 'B2', 'X', 'D1', 'B3', 'A2'];

        const hasAxis = classes.some(c => PLACE_CORE_CLASSES.includes(c));
        const isGraded = raceHorses[0] && ((raceHorses[0]["グレード・頭数"] || "").includes("G") || (raceHorses[0]["グレード・頭数"] || "").includes("重賞"));
        const minDensity = isGraded ? 0.100 : 0.150;
        const skipTrio = !hasAxis || density < minDensity;

        // 【攻撃ソート関数】EV差が0.100以内なら馬番が小さい方（内枠）を優先、それ以外はEV低を優先
        const attackSort = (a, b) => {
            const evA = parseFloat(a["最終確定期待値"]) || parseFloat(a["購入時期待値"]) || 0;
            const evB = parseFloat(b["最終確定期待値"]) || parseFloat(b["購入時期待値"]) || 0;
            const umA = parseInt(a["馬番"]);
            const umB = parseInt(b["馬番"]);
            
            if (Math.abs(evA - evB) <= 0.100 + 1e-9) {
                return umA - umB; // 馬番が小さい方（内枠）を優先
            } else {
                return evA - evB; // EVが低い方を優先
            }
        };

        // 【防御ソート関数】スコアや枠順の比較は廃止し、純粋にEVが低い方を優先
        const pureEvSort = (a, b) => {
            const evA = parseFloat(a["最終確定期待値"]) || parseFloat(a["購入時期待値"]) || 0;
            const evB = parseFloat(b["最終確定期待値"]) || parseFloat(b["購入時期待値"]) || 0;
            return evA - evB;
        };

        // 【単勝シミュレーション馬選定とAmber検証用グループ分け】
        let finalWinBets = [];
        let amberFailBets = [];
        
        let allWinCandidates = [];
        for (let clsName of WIN_PRIORITY_LOCAL) {
            let cands = raceHorses.filter(h => (h["最終確定クラス"] || h["購入時クラス"] || "").trim() === clsName);
            if (cands.length > 0) {
                cands.sort(attackSort); // 攻撃ソート適用
                for (let h of cands) {
                    const umaban = parseInt(h["馬番"]);
                    // 壁フィルター
                    if (umaban >= 13 && ['A1', 'S2', 'A0'].includes(clsName)) continue;
                    allWinCandidates.push(h);
                }
            }
        }

        // 1. グループA：Amber通過（実購入）
        for (let h of allWinCandidates) {
            if (finalWinBets.length >= 2) break;
            if (h.amberPass) finalWinBets.push(h);
        }

        // 2. グループB：Amber見送り（回避した罠: Amber無視で上位2頭に入るはずだったが弾かれた馬）
        amberFailBets = allWinCandidates.slice(0, 2).filter(h => !h.amberPass);

        // 【三連複シミュレーション買い目選定】
        let finalTrioCombos = [];
        let axisHorse = null;
        let row2 = [];
        let row3 = [];
        let row3Array = [];

        if (!skipTrio) {
            // 軸の選定（優先順位順に探し、同クラスなら防御ソート=純粋EV）
            for (let c of PLACE_CORE_CLASSES) {
                let cands = raceHorses.filter(h => (h["最終確定クラス"] || h["購入時クラス"] || "").trim() === c);
                if (cands.length > 0) {
                    cands.sort(pureEvSort); // 新防御ソート
                    axisHorse = cands[0];
                    break;
                }
            }

            if (axisHorse) {
                // 2列目防衛 (優先順位順に最大2枚)
                let defCount = 0;
                for (let c of TRIO_ROW2_DEFENSE_LOCAL) {
                    if (defCount >= 2) break;
                    let cands = raceHorses.filter(h => h !== axisHorse && (h["最終確定クラス"] || h["購入時クラス"] || "").trim() === c);
                    if (cands.length > 0) {
                        cands.sort(pureEvSort); // 新防御ソート
                        for (let h of cands) {
                            if (defCount >= 2) break;
                            if (!row2.includes(h)) {
                                row2.push(h);
                                defCount++;
                            }
                        }
                    }
                }

                // 2列目攻撃 (優先順位順に最大1枚)
                let atkCount = 0;
                for (let c of TRIO_ROW2_ATTACK_LOCAL) {
                    if (atkCount >= 1) break;
                    let cands = raceHorses.filter(h => h !== axisHorse && (h["最終確定クラス"] || h["購入時クラス"] || "").trim() === c);
                    if (cands.length > 0) {
                        cands.sort(attackSort); // 攻撃ソート
                        for (let h of cands) {
                            if (atkCount >= 1) break;
                            if (!row2.includes(h)) {
                                row2.push(h);
                                atkCount++;
                            }
                        }
                    }
                }

                // 3列目 (網) の構築
                // ソート関数定義
                const sortDefense = pureEvSort; // 新防御ソート
                const sortN = (a, b) => {
                    if (a.expectedWinRate !== b.expectedWinRate) return b.expectedWinRate - a.expectedWinRate;
                    return parseInt(b["馬番"]) - parseInt(a["馬番"]);
                };
                const addToRow3 = (list) => { list.forEach(h => { if (!row3.includes(h)) row3.push(h); }); };
                
                // 1. 2列目の全馬（ソート不要、そのまま追加）
                addToRow3(row2);
                
                // 2. 評価Sの全馬（sortDefense適用）
                let sCands = raceHorses.filter(h => h !== axisHorse && (h["評価"] || "").toUpperCase().trim() === 'S');
                sCands.sort(sortDefense);
                addToRow3(sCands);
                
                // 3. Place-Core系の全馬（sortDefense適用）
                let placeCoreCands = raceHorses.filter(h => h !== axisHorse && PLACE_CORE_CLASSES.includes((h["最終確定クラス"] || h["購入時クラス"] || "").trim()));
                placeCoreCands.sort(sortDefense);
                addToRow3(placeCoreCands);

                // 4. Win-Core系の全馬（attackSort適用）
                let winCoreCands = raceHorses.filter(h => h !== axisHorse && WIN_CORE_CLASSES.includes((h["最終確定クラス"] || h["購入時クラス"] || "").trim()));
                winCoreCands.sort(attackSort);
                addToRow3(winCoreCands);

                // 5. 残りのNクラスの馬（sortN適用）
                let nCands = raceHorses.filter(h => h !== axisHorse && ['N', ''].includes((h["最終確定クラス"] || h["購入時クラス"] || "").trim()));
                nCands.sort(sortN);
                addToRow3(nCands);

                row3Array = row3.slice(0, 10); // 最大10頭

                // 組み合わせの生成
                row2.forEach(h2 => {
                    row3Array.forEach(h3 => {
                        if (h2 !== h3 && h2 !== axisHorse && h3 !== axisHorse) {
                            const trio = [parseInt(axisHorse["馬番"]), parseInt(h2["馬番"]), parseInt(h3["馬番"])].sort((a,b) => a-b).join('-');
                            if (!finalTrioCombos.includes(trio)) finalTrioCombos.push(trio);
                        }
                    });
                });
            }
        }

        // --- Legacy自己検算: 日付が"Legacy"のレースは単勝払戻をオッズから再計算 ---
        const isLegacyRace = raceHorses[0] && (raceHorses[0]["日付"] || "").trim() === "Legacy";

        let actualWinPayoutMap = {};
        let actualTrioPayout = 0;

        if (isLegacyRace) {
            // Legacy期: 1着馬のオッズから単勝払戻を自己検算
            raceHorses.forEach(h => {
                if (parseInt(h["着順"]) === 1) {
                    const odds = parseFloat(h["最終確定オッズ"]) || parseFloat(h["購入時オッズ"]) || 0;
                    if (odds > 0) {
                        actualWinPayoutMap[h["馬番"]] = Math.floor(odds * 100);
                    }
                }
                const tVal = parseFloat(h["三連複払戻"]);
                if (!isNaN(tVal) && tVal > 0) actualTrioPayout = tVal;
            });
        } else {
            // 通常期: CSVから読み取った払戻金をそのまま使用
            raceHorses.forEach(h => {
                const wVal = parseFloat(h["単勝払戻"]);
                if (!isNaN(wVal) && wVal > 0) actualWinPayoutMap[h["馬番"]] = wVal;
                const tVal = parseFloat(h["三連複払戻"]);
                if (!isNaN(tVal) && tVal > 0) actualTrioPayout = tVal;
            });
        }

        let winReturn = 0;
        let amberFailReturn = 0;

        const calcReturn = (h) => {
            if (parseInt(h["着順"]) === 1) {
                const umaban = h["馬番"];
                if (actualWinPayoutMap[umaban]) {
                    return actualWinPayoutMap[umaban];
                } else {
                    return (parseFloat(h["最終確定オッズ"]) || parseFloat(h["購入時オッズ"]) || 0) * 100;
                }
            }
            return 0;
        };

        finalWinBets.forEach(h => { winReturn += calcReturn(h); });
        amberFailBets.forEach(h => { amberFailReturn += calcReturn(h); });

        let trioReturn = 0;
        let trioHit = false;

        if (isLegacyRace) {
            // Legacy期: 三連複払戻データが破損しているため、三連複シミュレーションを完全除外
            // trioReturn = 0, trioInvest = 0 として扱う
        } else {
            // 通常期: 三連複の的中判定と払戻集計
            const winners = raceHorses.filter(h => parseInt(h["着順"]) <= 3).map(h => parseInt(h["馬番"])).sort((a,b) => a-b);
            if (winners.length >= 3) {
                const getCombinations = (arr, k) => {
                    let result = [];
                    const f = (prefix, arr) => {
                        if (prefix.length === k) { result.push(prefix); return; }
                        for (let i = 0; i < arr.length; i++) f([...prefix, arr[i]], arr.slice(i + 1));
                    };
                    f([], arr);
                    return result;
                };
                const combos = getCombinations(winners, 3);
                for (let c of combos) {
                    if (finalTrioCombos.includes(c.join('-'))) {
                        trioHit = true;
                        break;
                    }
                }
                if (trioHit) trioReturn = actualTrioPayout;
            }
        }

        return {
            id: raceId,
            horses: raceHorses,
            rec: determineRecommendation(raceHorses),
            ssDensity: density,
            skipTrio: skipTrio,
            axisHorse: axisHorse,
            row2: row2,
            row3: row3Array,
            finalWinBets: finalWinBets,
            amberFailBets: amberFailBets,
            winInvest: finalWinBets.length * 100,
            winReturn: winReturn,
            amberFailInvest: amberFailBets.length * 100,
            amberFailReturn: amberFailReturn,
            trioInvest: isLegacyRace ? 0 : finalTrioCombos.length * 100,
            trioReturn: trioReturn
        };
    }

    function calculateRiskMetrics(simulatedRaces) {
        let cumulative = 0;
        let peak = 0;
        let maxDD = 0;
        let totalInvest = 0;
        let totalReturn = 0;
        let clvTotal = 0;
        let clvCount = 0;

        const sortedData = [...simulatedRaces].sort((a,b) => a.id.localeCompare(b.id));

        sortedData.forEach(r => {
            const invest = r.winInvest + r.trioInvest;
            const p = r.winReturn + r.trioReturn;
            totalInvest += invest;
            totalReturn += p;
            cumulative += (p - invest);
            if (cumulative > peak) peak = cumulative;
            const dd = peak - cumulative;
            if (dd > maxDD) maxDD = dd;

            r.horses.forEach(h => {
                const fo = parseFloat(h["最終確定オッズ"]);
                const po = parseFloat(h["購入時オッズ"]) || fo;
                if (fo > 0) { clvTotal += (po / fo); clvCount++; }
            });
        });

        return {
            raceCount: simulatedRaces.length,
            horseCount: simulatedRaces.reduce((acc, r) => acc + r.horses.length, 0),
            roi: totalInvest > 0 ? (totalReturn / totalInvest) * 100 : 0,
            mdd: maxDD,
            mddRate: totalInvest > 0 ? (maxDD / totalInvest) * 100 : 0,
            avgClv: clvCount > 0 ? clvTotal / clvCount : 1.0
        };
    }

    function calculateKelly(winRate, avgOdds) {
        const p = winRate / 100;
        const b = avgOdds - 1;
        if (b <= 0) return 0;
        const q = 1 - p;
        const f = (b * p - q) / b;
        return Math.max(0, f * 100);
    }

    function calculateClassStats(data) {
        const groups = {};
        data.forEach(r => {
            let cls = r["最終確定クラス"] || r["購入時クラス"] || "不明";
            // X/D1で監査NGの場合、集計キーを分離
            if ((cls === 'X' || cls === 'D1') && r.auditStatus === 'NG') {
                cls = cls + '(NG)';
            }
            if (!groups[cls]) groups[cls] = [];
            groups[cls].push(r);
        });

        return Object.keys(groups).sort().map(cls => {
            const rows = groups[cls];
            const sample = rows.length;
            const wins = rows.filter(r => parseInt(r["着順"]) === 1).length;
            const top2 = rows.filter(r => parseInt(r["着順"]) <= 2).length;
            const top3 = rows.filter(r => parseInt(r["着順"]) <= 3).length;
            const returns = rows.reduce((acc, r) => acc + (parseInt(r["着順"]) === 1 ? (parseFloat(r["最終確定オッズ"]) * 100) : 0), 0);
            const oddsSum = rows.reduce((acc, r) => acc + (parseFloat(r["最終確定オッズ"]) || 0), 0);
            const avgOdds = oddsSum / sample;
            
            const roi = (returns / (sample * 100)) * 100;
            const winRate = (wins / sample) * 100;
            const kelly = calculateKelly(winRate, avgOdds);

            return {
                cls, sample, wins,
                winRate, 
                top2, top2Rate: (top2 / sample) * 100,
                top3, top3Rate: (top3 / sample) * 100, 
                roi, 
                avgEv: rows.reduce((acc, r) => acc + (parseFloat(r["最終確定期待値"]) || 0), 0) / sample,
                kelly
            };
        });
    }

    function calculateRecommendationStats(simulatedRaces) {
        const order = ['SSS', 'SS', 'S', 'Low'];
        return order.map(rec => {
            const races = simulatedRaces.filter(r => r.rec === rec);
            const raceCount = races.length;
            if (raceCount === 0) return { rec, raceCount: 0, winInvest: 0, winROI: 0, winHits: 0, winBetRaces: 0, trioInvest: 0, trioROI: 0, trioHits: 0, trioBetRaces: 0, totalInvest: 0, totalROI: 0 };

            let winInvest = 0;
            let winReturn = 0;
            let trioInvest = 0;
            let trioReturn = 0;
            let winHits = 0;
            let winBetRaces = 0;
            let trioHits = 0;
            let trioBetRaces = 0;

            races.forEach(r => {
                winInvest += r.winInvest;
                winReturn += r.winReturn;
                trioInvest += r.trioInvest;
                trioReturn += r.trioReturn;
                if (r.winInvest > 0) {
                    winBetRaces++;
                    if (r.winReturn > 0) winHits++;
                }
                if (r.trioInvest > 0) {
                    trioBetRaces++;
                    if (r.trioReturn > 0) trioHits++;
                }
            });

            const winROI = winInvest > 0 ? (winReturn / winInvest) * 100 : 0;
            const trioROI = trioInvest > 0 ? (trioReturn / trioInvest) * 100 : 0;
            const totalInvest = winInvest + trioInvest;
            const totalROI = totalInvest > 0 ? ((winReturn + trioReturn) / totalInvest) * 100 : 0;

            return { rec, raceCount, winInvest, winROI, winHits, winBetRaces, trioInvest, trioROI, trioHits, trioBetRaces, totalInvest, totalROI };
        }).filter(s => s.raceCount > 0);
    }

    function calculateAmberStats(simulatedRaces) {
        let passInvest = 0, passReturn = 0, passHits = 0, passRaces = 0;
        let failInvest = 0, failReturn = 0, failHits = 0, failRaces = 0;

        simulatedRaces.forEach(r => {
            if (r.winInvest > 0) {
                passRaces++;
                passInvest += r.winInvest;
                passReturn += r.winReturn;
                if (r.winReturn > 0) passHits++;
            }
            if (r.amberFailInvest > 0) {
                failRaces++;
                failInvest += r.amberFailInvest;
                failReturn += r.amberFailReturn;
                if (r.amberFailReturn > 0) failHits++;
            }
        });

        return [
            {
                name: '🟢 通過 (実購入)',
                races: passRaces,
                invest: passInvest,
                return: passReturn,
                hits: passHits,
                roi: passInvest > 0 ? (passReturn / passInvest) * 100 : 0
            },
            {
                name: '⚠️ 見送り (回避した罠)',
                races: failRaces,
                invest: failInvest,
                return: failReturn,
                hits: failHits,
                roi: failInvest > 0 ? (failReturn / failInvest) * 100 : 0
            }
        ];
    }

    function renderRecommendationTable(stats) {
        const recColors = { 'SSS': 'text-yellow-300', 'SS': 'text-orange-400', 'S': 'text-blue-400', 'Low': 'text-slate-400' };
        const fmtHitRate = (hits, total) => total > 0 ? `${(hits / total * 100).toFixed(1)}% (${hits}/${total})` : '-';
        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>推奨度</th>
                            <th>レース数</th>
                            <th>単勝投資</th>
                            <th>単勝的中率</th>
                            <th>単勝回収率</th>
                            <th>三連複投資</th>
                            <th>三連複的中率</th>
                            <th>三連複回収率</th>
                            <th>合算投資額</th>
                            <th>合算回収率</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(s => `
                            <tr>
                                <td class="font-bold ${recColors[s.rec] || ''}">${s.rec}</td>
                                <td>${s.raceCount}</td>
                                <td>${s.winInvest.toLocaleString()}円</td>
                                <td>${fmtHitRate(s.winHits, s.winBetRaces)}</td>
                                <td class="${s.winROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.winROI.toFixed(1)}%</td>
                                <td>${s.trioInvest.toLocaleString()}円</td>
                                <td>${fmtHitRate(s.trioHits, s.trioBetRaces)}</td>
                                <td class="${s.trioROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.trioROI.toFixed(1)}%</td>
                                <td>${s.totalInvest.toLocaleString()}円</td>
                                <td class="${s.totalROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.totalROI.toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        recommendationResultArea.innerHTML = html;
    }

    function renderAmberReport(stats) {
        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>判定ステータス</th>
                            <th>対象レース数</th>
                            <th>仮想投資額</th>
                            <th>的中率</th>
                            <th>回収率</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(s => `
                            <tr>
                                <td class="font-bold">${s.name}</td>
                                <td>${s.races}</td>
                                <td>${s.invest.toLocaleString()}円</td>
                                <td>${s.races > 0 ? (s.hits / s.races * 100).toFixed(1) : '0'}% (${s.hits}/${s.races})</td>
                                <td class="${s.roi >= 100 ? 'text-green-400 font-bold' : ''}">${s.roi.toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        document.getElementById('amberReportArea').innerHTML = html;
    }

    // --- 評価ランク用固定EV帯(Bin) 0.1刻み ---
    const RANK_EV_BINS = (() => {
        const bins = [];
        for (let i = 0; i < 30; i++) {
            const min = i / 10;
            const max = (i + 1) / 10;
            bins.push({
                label: `${min.toFixed(1)}〜${(max - 0.01).toFixed(2)}`,
                min: min,
                max: max
            });
        }
        bins.push({ label: "3.0以上", min: 3.0, max: 999.0 });
        return bins;
    })();

    // --- 動的EV帯(Bin)生成ヘルパー ---
    function generateDynamicEvBins(rows) {
        const evValues = rows.map(r => parseFloat(r?.["最終確定期待値"]) || parseFloat(r?.["購入時期待値"]) || 0).filter(v => !isNaN(v));
        if (evValues.length === 0) {
            return [{ label: '0.0〜', min: 0.0, max: 999.0 }];
        }
        const minEvRaw = Math.min(...evValues);
        const maxEvRaw = Math.max(...evValues);

        let minEv = Math.floor(minEvRaw * 10) / 10;
        let maxEv = Math.ceil(maxEvRaw * 10) / 10;
        if (maxEv === minEv) maxEv += 0.1;

        // 異常値対策として最大30ビン（EV差3.0）に制限
        if ((maxEv - minEv) > 3.0) {
            maxEv = minEv + 3.0;
        }

        const evBins = [];
        for (let v = minEv; v < maxEv - 0.001; v += 0.1) {
            const minBound = parseFloat(v.toFixed(1));
            const maxBound = parseFloat((v + 0.1).toFixed(1));
            evBins.push({
                label: `${minBound.toFixed(1)}〜${(maxBound - 0.01).toFixed(2)}`,
                min: minBound,
                max: maxBound
            });
        }
        
        // もし最大値が制限で切られた場合のための最後の受け皿
        if ((maxEvRaw * 10) / 10 > maxEv) {
             evBins.push({
                label: `${maxEv.toFixed(1)}以上`,
                min: maxEv,
                max: 999.0
            });
        }
        
        return evBins;
    }

    // --- JSONエクスポート処理 ---
    function generateAndDownloadJSON() {
        if (!window.latestSimData) {
            showToast('シミュレーションが実行されていません');
            return;
        }
        
        try {
            const { rowsWithRank, classStats, amberStats, recStats, simulatedRaces } = window.latestSimData;
            const totalRaces = parseInt(document.getElementById('stat-race-count')?.textContent || '0') || 0;
            const overallRoi = parseFloat(document.getElementById('stat-overall-roi')?.textContent || '0') || 0;

            // 推奨度別成績
            const recommendationPerformance = {
                "SSS": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0 },
                "SS": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0 },
                "S": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0 },
                "Low": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0 }
            };
            
            if (recStats && Array.isArray(recStats)) {
                recStats.forEach(rs => {
                    const rec = rs?.rec;
                    if (rec && recommendationPerformance[rec]) {
                        recommendationPerformance[rec] = {
                            sampleRaces: rs?.raceCount || 0,
                            hitRate: rs?.totalBetRaces > 0 ? (rs.totalHits / rs.totalBetRaces) * 100 : 0.0,
                            recoveryRate: rs?.totalROI || 0.0,
                            winRecoveryRate: rs?.winROI || 0.0,
                            wideRecoveryRate: 0.0, // ワイドは現在シミュレーション対象外のため0固定
                            trifectaRecoveryRate: rs?.trioROI || 0.0,
                            winHitRate: rs?.winBetRaces > 0 ? (rs.winHits / rs.winBetRaces) * 100 : 0.0,
                            wideHitRate: 0.0,
                            trifectaHitRate: rs?.trioBetRaces > 0 ? (rs.trioHits / rs.trioBetRaces) * 100 : 0.0
                        };
                    }
                });
            }

            // SS密度別成績
            const densityPerformance = {
                "80%以上": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 },
                "70%〜79%": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 },
                "60%〜69%": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 },
                "50%〜59%": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 },
                "50%未満":  { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 }
            };

            (simulatedRaces || []).forEach(r => {
                const d = r?.ssDensity || 0;
                let bin = "50%未満";
                if (d >= 0.8) bin = "80%以上";
                else if (d >= 0.7) bin = "70%〜79%";
                else if (d >= 0.6) bin = "60%〜69%";
                else if (d >= 0.5) bin = "50%〜59%";

                const dp = densityPerformance[bin];
                dp.sampleRaces++;

                const wInv = r?.winInvest || 0;
                const wRet = r?.winReturn || 0;
                const tInv = r?.trioInvest || 0;
                const tRet = r?.trioReturn || 0;
                
                dp._invest += wInv + tInv;
                dp._return += wRet + tRet;
                if (wInv > 0) { dp._betRaces++; if (wRet > 0) dp._hits++; }
                if (tInv > 0) { dp._betRaces++; if (tRet > 0) dp._hits++; }
            });

            Object.keys(densityPerformance).forEach(k => {
                const dp = densityPerformance[k];
                dp.hitRate = dp._betRaces > 0 ? (dp._hits / dp._betRaces) * 100 : 0.0;
                dp.recoveryRate = dp._invest > 0 ? (dp._return / dp._invest) * 100 : 0.0;
                delete dp._hits; delete dp._invest; delete dp._return; delete dp._betRaces;
            });

            // オッズ帯別分析 (X/D1)
            const oddsBinAnalysis = { "D1": [], "X": [] };
            const bins = [
                { label: '10.0未満', min: 0, max: 10.0 },
                { label: '10.0〜19.9', min: 10.0, max: 20.0 },
                { label: '20.0〜29.9', min: 20.0, max: 30.0 },
                { label: '30.0〜39.9', min: 30.0, max: 40.0 },
                { label: '40.0〜49.9', min: 40.0, max: 50.0 },
                { label: '50.0以上', min: 50.0, max: 999999 }
            ];

            ['D1', 'X'].forEach(cls => {
                const clsRows = (rowsWithRank || []).filter(r => (r?.["最終確定クラス"] || r?.["購入時クラス"] || "").trim() === cls);
                bins.forEach(b => {
                    let okCount = 0, okInvest = 0, okReturn = 0, okHits = 0;
                    let ngCount = 0, ngInvest = 0, ngReturn = 0, ngHits = 0;

                    clsRows.forEach(r => {
                        const odds = parseFloat(r?.["最終確定オッズ"]) || parseFloat(r?.["購入時オッズ"]) || 0;
                        if (odds >= b.min && odds < b.max) {
                            const isHit = parseInt(r?.["着順"]) === 1;
                            if (r?.auditStatus === 'NG') {
                                ngCount++;
                                ngInvest += 100;
                                if (isHit) { ngReturn += odds * 100; ngHits++; }
                            } else {
                                okCount++;
                                okInvest += 100;
                                if (isHit) { okReturn += odds * 100; okHits++; }
                            }
                        }
                    });

                    oddsBinAnalysis[cls].push({
                        bin: b.label,
                        auditOK: {
                            samples: okCount,
                            hitRate: okCount > 0 ? (okHits / okCount) * 100 : 0.0,
                            recovery: okInvest > 0 ? (okReturn / okInvest) * 100 : 0.0
                        },
                        auditNG: {
                            samples: ngCount,
                            hitRate: ngCount > 0 ? (ngHits / ngCount) * 100 : 0.0,
                            recovery: ngInvest > 0 ? (ngReturn / ngInvest) * 100 : 0.0
                        }
                    });
                });
            });

            // クラス別成績（馬番詳細付き）
            const classPerformance = (classStats || []).map(c => {
                const isNGClass = c?.cls?.endsWith('(NG)') || false;
                const baseCls = isNGClass ? c.cls.replace('(NG)', '') : (c?.cls || '');
                
                const clsRows = (rowsWithRank || []).filter(r => {
                    const rCls = r?.["最終確定クラス"] || r?.["購入時クラス"] || "";
                    if (isNGClass) {
                        return rCls === baseCls && r?.auditStatus === 'NG';
                    } else {
                        if (baseCls === 'X' || baseCls === 'D1') {
                            return rCls === baseCls && r?.auditStatus !== 'NG';
                        }
                        return rCls === c?.cls;
                    }
                });

                // 馬番別成績
                const gateStats = {};
                clsRows.forEach(r => {
                    const um = parseInt(r?.["馬番"]);
                    if (isNaN(um)) return;
                    const odds = parseFloat(r?.["最終確定オッズ"]) || parseFloat(r?.["購入時オッズ"]) || 0;
                    if (!gateStats[um]) gateStats[um] = { count: 0, win: 0, top3: 0, invest: 0, return: 0 };
                    gateStats[um].count++;
                    gateStats[um].invest += 100;
                    const rank = parseInt(r?.["着順"]);
                    if (rank === 1) {
                        gateStats[um].win++;
                        gateStats[um].return += odds * 100;
                    }
                    if (rank <= 3) {
                        gateStats[um].top3++;
                    }
                });

                const umabanDetails = Object.keys(gateStats).map(Number).sort((a, b) => a - b).map(g => ({
                    umaban: g,
                    samples: gateStats[g].count,
                    winRate: gateStats[g].count > 0 ? (gateStats[g].win / gateStats[g].count) * 100 : 0.0,
                    placeRate: gateStats[g].count > 0 ? (gateStats[g].top3 / gateStats[g].count) * 100 : 0.0,
                    recoveryRate: gateStats[g].invest > 0 ? (gateStats[g].return / gateStats[g].invest) * 100 : 0.0
                }));

                const evBins = generateDynamicEvBins(clsRows);
                
                const evStats = evBins.map(b => ({ label: b.label, count: 0, win: 0, top3: 0, invest: 0, return: 0 }));

                clsRows.forEach(r => {
                    const ev = parseFloat(r?.["最終確定期待値"]) || parseFloat(r?.["購入時期待値"]) || 0;
                    const odds = parseFloat(r?.["最終確定オッズ"]) || parseFloat(r?.["購入時オッズ"]) || 0;
                    const rank = parseInt(r?.["着順"]);

                    const binIdx = evBins.findIndex(b => ev >= b.min && ev < b.max);
                    if (binIdx !== -1) {
                        evStats[binIdx].count++;
                        evStats[binIdx].invest += 100;
                        if (rank === 1) {
                            evStats[binIdx].win++;
                            evStats[binIdx].return += odds * 100;
                        }
                        if (rank <= 3) {
                            evStats[binIdx].top3++;
                        }
                    }
                });

                const evDetails = evStats.map(s => ({
                    evBin: s.label,
                    samples: s.count,
                    winRate: s.count > 0 ? (s.win / s.count) * 100 : 0.0,
                    placeRate: s.count > 0 ? (s.top3 / s.count) * 100 : 0.0,
                    recoveryRate: s.invest > 0 ? (s.return / s.invest) * 100 : 0.0
                }));

                return {
                    cls: c?.cls || "",
                    sampleSize: c?.sample || 0,
                    winRate: c?.winRate || 0.0,
                    rentaiRate: c?.top2Rate || 0.0,
                    placeRate: c?.top3Rate || 0.0,
                    winRecoveryRate: c?.roi || 0.0,
                    umabanDetails: umabanDetails,
                    evDetails: evDetails
                };
            });

            const safeAmber0 = (amberStats && amberStats[0]) ? amberStats[0] : { races: 0, hits: 0, roi: 0 };
            const safeAmber1 = (amberStats && amberStats[1]) ? amberStats[1] : { races: 0, hits: 0, roi: 0 };

            // 評価ランク別成績
            const evaluationPerformance = [];
            const ranksList = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
            ranksList.forEach(rank => {
                const rankRows = (rowsWithRank || []).filter(r => (r?.["評価"] || "").toUpperCase().trim() === rank);
                
                const stats = RANK_EV_BINS.map(b => ({
                    evBin: b.label, count: 0, win: 0, top3: 0, invest: 0, return: 0
                }));

                rankRows.forEach(r => {
                    const ev = parseFloat(r?.["最終確定期待値"]) || parseFloat(r?.["購入時期待値"]) || 0;
                    const odds = parseFloat(r?.["最終確定オッズ"]) || parseFloat(r?.["購入時オッズ"]) || 0;
                    const pos = parseInt(r?.["着順"]);

                    const binIdx = RANK_EV_BINS.findIndex(b => ev >= b.min && ev < b.max);
                    if (binIdx !== -1) {
                        stats[binIdx].count++;
                        stats[binIdx].invest += 100;
                        if (pos === 1) {
                            stats[binIdx].win++;
                            stats[binIdx].return += odds * 100;
                        }
                        if (pos <= 3) {
                            stats[binIdx].top3++;
                        }
                    }
                });

                const evDetails = stats.map(s => ({
                    evBin: s.evBin,
                    samples: s.count,
                    winRate: s.count > 0 ? (s.win / s.count) * 100 : 0.0,
                    recoveryRate: s.invest > 0 ? (s.return / s.invest) * 100 : 0.0,
                    placeRate: s.count > 0 ? (s.top3 / s.count) * 100 : 0.0
                }));

                evaluationPerformance.push({
                    rank: rank,
                    evDetails: evDetails
                });
            });

            const jsonPayload = {
                summary: {
                    totalRaces: totalRaces,
                    overallRecoveryRate: overallRoi
                },
                evaluationPerformance: evaluationPerformance,
                recommendationPerformance: recommendationPerformance,
                densityPerformance: densityPerformance,
                amberAudit: {
                    passed: {
                        sampleSize: safeAmber0.races,
                        hitRate: safeAmber0.races > 0 ? (safeAmber0.hits / safeAmber0.races) * 100 : 0.0,
                        recoveryRate: safeAmber0.roi
                    },
                    failed: {
                        sampleSize: safeAmber1.races,
                        hitRate: safeAmber1.races > 0 ? (safeAmber1.hits / safeAmber1.races) * 100 : 0.0,
                        recoveryRate: safeAmber1.roi
                    }
                },
                oddsBinAnalysis: oddsBinAnalysis,
                classPerformance: classPerformance
            };

            const jsonString = JSON.stringify(jsonPayload, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ss_feedback_data.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showToast('JSONデータをダウンロードしました');
        } catch (e) {
            console.error("JSON生成エラー:", e);
            showToast('JSONデータの生成に失敗しました: ' + e.message);
        }
    }

    const downloadJsonBtn = document.getElementById('downloadJsonBtn');
    if (downloadJsonBtn) {
        downloadJsonBtn.addEventListener('click', generateAndDownloadJSON);
    }

    let oddsAuditChartInstance = null;
    function renderOddsAuditAnalysis(rows) {
        // 対象クラス (X, D1) のみ抽出
        const targetData = rows.filter(r => {
            const cls = (r["最終確定クラス"] || r["購入時クラス"] || "").trim();
            return cls === 'X' || cls === 'D1';
        });

        // オッズ帯の定義
        const bins = [
            { label: '10.0未満', min: 0, max: 10.0 },
            { label: '10.0〜19.9', min: 10.0, max: 20.0 },
            { label: '20.0〜29.9', min: 20.0, max: 30.0 },
            { label: '30.0〜39.9', min: 30.0, max: 40.0 },
            { label: '40.0〜49.9', min: 40.0, max: 50.0 },
            { label: '50.0以上', min: 50.0, max: 999999 }
        ];

        // 各binの集計用構造
        const stats = bins.map(b => ({
            label: b.label,
            okCount: 0, okInvest: 0, okReturn: 0,
            ngCount: 0, ngInvest: 0, ngReturn: 0
        }));

        targetData.forEach(r => {
            const odds = parseFloat(r["最終確定オッズ"]) || parseFloat(r["購入時オッズ"]) || 0;
            const isNG = r.auditStatus === 'NG';
            const isHit = parseInt(r["着順"]) === 1;

            const binIdx = bins.findIndex(b => odds >= b.min && odds < b.max);
            if (binIdx === -1) return;

            if (isNG) {
                stats[binIdx].ngCount++;
                stats[binIdx].ngInvest += 100;
                if (isHit) stats[binIdx].ngReturn += odds * 100;
            } else {
                stats[binIdx].okCount++;
                stats[binIdx].okInvest += 100;
                if (isHit) stats[binIdx].okReturn += odds * 100;
            }
        });

        // 配列化
        const labels = stats.map(s => s.label);
        const okRoi = stats.map(s => s.okInvest > 0 ? (s.okReturn / s.okInvest) * 100 : 0);
        const ngRoi = stats.map(s => s.ngInvest > 0 ? (s.ngReturn / s.ngInvest) * 100 : 0);
        const totalCounts = stats.map(s => s.okCount + s.ngCount);

        if (oddsAuditChartInstance) oddsAuditChartInstance.destroy();
        const ctx = document.getElementById('oddsAuditChart').getContext('2d');
        
        oddsAuditChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'line',
                        label: '出走頭数(件)',
                        data: totalCounts,
                        borderColor: '#94a3b8',
                        backgroundColor: '#94a3b8',
                        yAxisID: 'y1',
                        tension: 0.3,
                        pointRadius: 4,
                        order: 0
                    },
                    {
                        type: 'bar',
                        label: '監査OK 回収率(%)',
                        data: okRoi,
                        backgroundColor: 'rgba(59, 130, 246, 0.8)', // blue-500
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        type: 'bar',
                        label: '監査NG 回収率(%)',
                        data: ngRoi,
                        backgroundColor: 'rgba(239, 68, 68, 0.8)', // red-500
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { labels: { color: '#e2e8f0' } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.dataset.yAxisID === 'y') {
                                    label += context.parsed.y.toFixed(1) + '%';
                                    const stat = stats[context.dataIndex];
                                    if (context.datasetIndex === 1) { // OK ROI
                                        label += ` (n=${stat.okCount})`;
                                    } else if (context.datasetIndex === 2) { // NG ROI
                                        label += ` (n=${stat.ngCount})`;
                                    }
                                } else {
                                    label += context.parsed.y + '件';
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: '確定オッズ帯', color: '#94a3b8' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '単勝回収率 (%)', color: '#94a3b8' },
                        min: 0,
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: '出走頭数', color: '#94a3b8' },
                        min: 0,
                        ticks: { color: '#94a3b8' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    function makeTableSortable(tableEl) {
        if (!tableEl) return;
        const headers = tableEl.querySelectorAll('th');
        headers.forEach((th, idx) => {
            th.style.cursor = 'pointer';
            th.title = "クリックでソート";
            th.addEventListener('click', () => {
                const tbody = tableEl.querySelector('tbody');
                const rows = Array.from(tbody.querySelectorAll('tr'));
                const isAsc = th.classList.contains('sort-asc');
                
                headers.forEach(h => { h.classList.remove('sort-asc', 'sort-desc'); });
                th.classList.add(isAsc ? 'sort-desc' : 'sort-asc');
                
                rows.sort((a, b) => {
                    let valA = a.children[idx].textContent.trim();
                    let valB = b.children[idx].textContent.trim();
                    
                    const cleanA = valA.replace(/[%円,⚠️✅ ]/g, '');
                    const cleanB = valB.replace(/[%円,⚠️✅ ]/g, '');
                    
                    const numA = parseFloat(cleanA);
                    const numB = parseFloat(cleanB);
                    
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return isAsc ? numA - numB : numB - numA;
                    }
                    return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
                });
                
                rows.forEach(r => tbody.appendChild(r));
            });
        });
    }
    function detectOutliers(data) {
        return data.filter(r => {
            const ev = parseFloat(r["購入時期待値"]) || 0;
            const rank = parseInt(r["着順"]) || 99;
            return (ev >= 2.0 && rank >= 10) || (ev <= 0.5 && rank === 1);
        });
    }

    function renderRiskDashboard(s) {
        document.getElementById('stat-race-count').textContent = s.raceCount;
        document.getElementById('stat-overall-roi').textContent = `${s.roi.toFixed(1)}%`;
        document.getElementById('stat-mdd').textContent = `-${s.mdd.toLocaleString()}円 (${s.mddRate.toFixed(1)}%)`;
        document.getElementById('stat-avg-clv').textContent = s.avgClv.toFixed(3);
    }

    function renderClassTable(stats) {
        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>クラス</th>
                            <th>頭数</th>
                            <th>的中率</th>
                            <th>連対率</th>
                            <th>複勝率</th>
                            <th>回収率</th>
                            <th>平均EV</th>
                            <th class="text-orange-400">Kelly推薦%</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(s => `
                            <tr data-cls="${s.cls}" class="cursor-pointer hover:bg-slate-700/50 transition-colors" title="クリックで馬番別詳細を表示">
                                <td class="font-bold">${s.sample >= 30 ? '✅' : '⚠️'} ${s.cls}</td>
                                <td>${s.sample}</td>
                                <td>${s.winRate.toFixed(1)}% (${s.wins}/${s.sample})</td>
                                <td>${s.top2Rate.toFixed(1)}% (${s.top2}/${s.sample})</td>
                                <td>${s.top3Rate.toFixed(1)}% (${s.top3}/${s.sample})</td>
                                <td class="${s.roi >= 100 ? 'text-green-400 font-bold' : ''}">${s.roi.toFixed(1)}%</td>
                                <td>${s.avgEv.toFixed(3)}</td>
                                <td class="font-bold ${s.kelly > 5 ? 'text-orange-400' : ''}">${s.kelly.toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        analysisResultArea.innerHTML = html;

        // 行クリックイベントの登録
        analysisResultArea.querySelectorAll('tr[data-cls]').forEach(row => {
            row.addEventListener('click', () => {
                const cls = row.getAttribute('data-cls');
                openClassDrilldown(cls);
            });
        });
    }

    let drilldownChartInstance = null;

    function openClassDrilldown(cls) {
        // 監査NG付きクラスの場合、元のクラス名と監査ステータスで絞り込む
        const isNGClass = cls.endsWith('(NG)');
        const baseCls = isNGClass ? cls.replace('(NG)', '') : cls;

        const clsData = filteredData.filter(r => {
            const rCls = r["最終確定クラス"] || r["購入時クラス"] || "";
            if (isNGClass) {
                return rCls === baseCls && r.auditStatus === 'NG';
            } else {
                // 通常クラス: NGではないものすべて
                if (baseCls === 'X' || baseCls === 'D1') {
                    return rCls === baseCls && r.auditStatus !== 'NG';
                }
                return rCls === cls;
            }
        }).filter(r => r["着順"] && r["着順"].trim() !== "");

        if (clsData.length === 0) {
            showToast(`${cls} のデータがありません`);
            return;
        }

        // 馬番別集計（1〜18）
        const gateStats = {};
        clsData.forEach(r => {
            const um = parseInt(r["馬番"]);
            if (isNaN(um) || um < 1) return;
            if (!gateStats[um]) gateStats[um] = { count: 0, win: 0, top2: 0, top3: 0 };
            gateStats[um].count++;
            const rank = parseInt(r["着順"]);
            if (rank === 1) gateStats[um].win++;
            if (rank <= 2) gateStats[um].top2++;
            if (rank <= 3) gateStats[um].top3++;
        });

        const maxGate = Math.max(...Object.keys(gateStats).map(Number), 18);
        const labels = [];
        const counts = [];
        const winRates = [];
        const top2Rates = [];
        const top3Rates = [];
        const lowSampleFlags = [];

        for (let i = 1; i <= maxGate; i++) {
            labels.push(i.toString());
            const g = gateStats[i] || { count: 0, win: 0, top2: 0, top3: 0 };
            counts.push(g.count);
            winRates.push(g.count > 0 ? (g.win / g.count) * 100 : 0);
            top2Rates.push(g.count > 0 ? (g.top2 / g.count) * 100 : 0);
            top3Rates.push(g.count > 0 ? (g.top3 / g.count) * 100 : 0);
            lowSampleFlags.push(g.count < 5);
        }

        // EV帯別集計 (動的0.1刻み)
        const evBins = generateDynamicEvBins(clsData);
        
        const evStats = evBins.map(b => ({ label: b.label, count: 0, win: 0, top3: 0, invest: 0, return: 0 }));

        clsData.forEach(r => {
            const ev = parseFloat(r["最終確定期待値"]) || parseFloat(r["購入時期待値"]) || 0;
            const odds = parseFloat(r["最終確定オッズ"]) || parseFloat(r["購入時オッズ"]) || 0;
            const rank = parseInt(r["着順"]);

            const binIdx = evBins.findIndex(b => ev >= b.min && ev < b.max);
            if (binIdx !== -1) {
                evStats[binIdx].count++;
                evStats[binIdx].invest += 100;
                if (rank === 1) {
                    evStats[binIdx].win++;
                    evStats[binIdx].return += odds * 100;
                }
                if (rank <= 3) {
                    evStats[binIdx].top3++;
                }
            }
        });

        const evLabels = evStats.map(s => s.label);
        const evCounts = evStats.map(s => s.count);
        const evWinRates = evStats.map(s => s.count > 0 ? (s.win / s.count) * 100 : 0);
        const evPlaceRates = evStats.map(s => s.count > 0 ? (s.top3 / s.count) * 100 : 0);
        const evRecoveryRates = evStats.map(s => s.invest > 0 ? (s.return / s.invest) * 100 : 0);

        // モーダル表示
        document.getElementById('drilldownTitle').textContent = `📊 ${cls} クラス 詳細分析 (n=${clsData.length})`;
        document.getElementById('classDrilldownModal').classList.remove('hidden');

        // チャート描画
        if (drilldownChartInstance) drilldownChartInstance.destroy();
        const ctx = document.getElementById('drilldownChart').getContext('2d');
        drilldownChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: '出走回数',
                        data: counts,
                        backgroundColor: counts.map((_, i) => lowSampleFlags[i] ? 'rgba(239, 68, 68, 0.25)' : 'rgba(148, 163, 184, 0.2)'),
                        borderColor: counts.map((_, i) => lowSampleFlags[i] ? 'rgba(239, 68, 68, 0.5)' : 'rgba(148, 163, 184, 0.4)'),
                        borderWidth: 1,
                        yAxisID: 'y1',
                        order: 3
                    },
                    {
                        type: 'line',
                        label: '複勝率',
                        data: top3Rates,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: top3Rates.map((_, i) => lowSampleFlags[i] ? '#ef4444' : '#3b82f6'),
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        type: 'line',
                        label: '連対率',
                        data: top2Rates,
                        borderColor: '#a855f7',
                        backgroundColor: 'rgba(168, 85, 247, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: top2Rates.map((_, i) => lowSampleFlags[i] ? '#ef4444' : '#a855f7'),
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        type: 'line',
                        label: '勝率',
                        data: winRates,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: winRates.map((_, i) => lowSampleFlags[i] ? '#ef4444' : '#10b981'),
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#e2e8f0', usePointStyle: true } },
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const idx = items[0].dataIndex;
                                if (lowSampleFlags[idx]) return '⚠️ サンプル数不足 (n<5)';
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: '馬番', color: '#94a3b8' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '率 (%)', color: '#94a3b8' },
                        min: 0,
                        max: 100,
                        ticks: { color: '#94a3b8', callback: v => v + '%' },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: '出走回数', color: '#94a3b8' },
                        min: 0,
                        ticks: { color: '#94a3b8', stepSize: 1 },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });

        if (window.drilldownEvChartInstance) window.drilldownEvChartInstance.destroy();
        const evCtx = document.getElementById('drilldownEvChart').getContext('2d');
        window.drilldownEvChartInstance = new Chart(evCtx, {
            type: 'bar',
            data: {
                labels: evLabels,
                datasets: [
                    {
                        type: 'bar',
                        label: '出走回数',
                        data: evCounts,
                        backgroundColor: 'rgba(148, 163, 184, 0.2)',
                        borderColor: 'rgba(148, 163, 184, 0.4)',
                        borderWidth: 1,
                        yAxisID: 'y1',
                        order: 3
                    },
                    {
                        type: 'line',
                        label: '複勝率 (%)',
                        data: evPlaceRates,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#3b82f6',
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        type: 'line',
                        label: '勝率 (%)',
                        data: evWinRates,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#10b981',
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        type: 'line',
                        label: '単勝回収率 (%)',
                        data: evRecoveryRates,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#f59e0b',
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#e2e8f0', usePointStyle: true } }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'EV帯', color: '#94a3b8' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '回収率 (%)', color: '#94a3b8' },
                        min: 0,
                        ticks: { color: '#94a3b8', callback: v => v + '%' },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: '出走回数', color: '#94a3b8' },
                        min: 0,
                        ticks: { color: '#94a3b8', stepSize: 1 },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });

        // テーブル描画
        let tblHtml = `
            <table class="analysis-table w-full text-xs mt-4">
                <thead>
                    <tr>
                        <th>馬番</th><th>出走数</th><th>勝率</th><th>連対率</th><th>複勝率</th><th>1着</th><th>2着</th><th>3着</th>
                    </tr>
                </thead>
                <tbody>
        `;
        for (let i = 1; i <= maxGate; i++) {
            const g = gateStats[i] || { count: 0, win: 0, top2: 0, top3: 0 };
            if (g.count === 0) continue;
            const warnCls = g.count < 5 ? 'text-red-400' : '';
            const wr = ((g.win / g.count) * 100).toFixed(1);
            const t2r = ((g.top2 / g.count) * 100).toFixed(1);
            const t3r = ((g.top3 / g.count) * 100).toFixed(1);
            tblHtml += `
                <tr class="${warnCls}">
                    <td class="font-bold">${g.count < 5 ? '⚠️' : ''} ${i}</td>
                    <td>${g.count}</td>
                    <td>${wr}%</td>
                    <td>${t2r}%</td>
                    <td>${t3r}%</td>
                    <td>${g.win}</td>
                    <td>${g.top2 - g.win}</td>
                    <td>${g.top3 - g.top2}</td>
                </tr>
            `;
        }
        tblHtml += '</tbody></table>';
        document.getElementById('drilldownTableArea').innerHTML = tblHtml;
    }

    function renderOutliers(list) {
        if (list.length === 0) {
            outlierResultArea.innerHTML = '<p class="text-slate-500 py-4">現在、条件（EV2.0以上で大敗、またはEV0.5以下で的中）に合致する異常値はありません。</p>';
            return;
        }
        let html = `
            <table class="analysis-table w-full text-xs">
                <thead><tr><th>日付</th><th>レース名</th><th>馬名</th><th>EV</th><th>オッズ</th><th>着順</th></tr></thead>
                <tbody>
                    ${list.map(r => `
                        <tr>
                            <td>${r["日付"]}</td>
                            <td>${r["レース名"]}</td>
                            <td class="font-bold text-red-300">${r["馬名"]}</td>
                            <td>${parseFloat(r["購入時期待値"]).toFixed(2)}</td>
                            <td>${parseFloat(r["購入時オッズ"]).toFixed(1)}</td>
                            <td class="font-bold">${r["着順"]}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        outlierResultArea.innerHTML = html;
    }

    // --- Charting ---
    function drawEquityCurve(simulatedRaces) {
        const sorted = [...simulatedRaces].sort((a,b) => a.id.localeCompare(b.id));
        const labels = [];
        const expData = [];
        const actData = [];
        let cumExp = 0; let cumAct = 0;

        sorted.forEach((r, idx) => {
            r.horses.forEach(h => {
                cumExp += (parseFloat(h["最終確定期待値"]) || 0) * 100;
            });
            cumAct += r.winReturn + r.trioReturn - (r.winInvest + r.trioInvest);
            
            labels.push(`R${idx+1}`);
            expData.push(cumExp);
            actData.push(cumAct);
        });

        if (equityChartInstance) equityChartInstance.destroy();
        equityChartInstance = new Chart(document.getElementById('equityChart').getContext('2d'), {
            type: 'line',
            data: { labels, datasets: [
                { label: '期待累積収支(全馬理論)', data: expData, borderColor: '#3b82f6', tension: 0.1, pointRadius: 0 },
                { label: '実績累積収支(シミュレーション)', data: actData, borderColor: '#10b981', fill: true, backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.1, pointRadius: 0 }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { x:{display:false}, y:{grid:{color:'#334155'}, ticks:{color:'#94a3b8'}} } }
        });
    }

    let rankEvChartInstance = null;

    function initRankEvTabs(rows) {
        const tabs = document.querySelectorAll('.rank-tab-btn');
        tabs.forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => {
                document.querySelectorAll('.rank-tab-btn').forEach(b => {
                    b.classList.remove('bg-purple-600', 'text-white', 'shadow-lg');
                    b.classList.add('bg-slate-800', 'text-slate-300');
                });
                newBtn.classList.remove('bg-slate-800', 'text-slate-300');
                newBtn.classList.add('bg-purple-600', 'text-white', 'shadow-lg');
                
                const rank = newBtn.getAttribute('data-rank');
                renderRankEvAnalysis(rank, rows);
            });
        });
    }

    function renderRankEvAnalysis(rank, rows) {
        const rankRows = rows.filter(r => (r["評価"] || "").toUpperCase().trim() === rank);
        
        const stats = RANK_EV_BINS.map(b => ({
            label: b.label, count: 0, win: 0, top3: 0, invest: 0, return: 0
        }));

        rankRows.forEach(r => {
            const ev = parseFloat(r["最終確定期待値"]) || parseFloat(r["購入時期待値"]) || 0;
            const odds = parseFloat(r["最終確定オッズ"]) || parseFloat(r["購入時オッズ"]) || 0;
            const pos = parseInt(r["着順"]);

            const binIdx = RANK_EV_BINS.findIndex(b => ev >= b.min && ev < b.max);
            if (binIdx !== -1) {
                stats[binIdx].count++;
                stats[binIdx].invest += 100;
                if (pos === 1) {
                    stats[binIdx].win++;
                    stats[binIdx].return += odds * 100;
                }
                if (pos <= 3) {
                    stats[binIdx].top3++;
                }
            }
        });

        const labels = stats.map(s => s.label);
        const counts = stats.map(s => s.count);
        const placeRates = stats.map(s => s.count > 0 ? (s.top3 / s.count) * 100 : 0.0);
        const recoveryRates = stats.map(s => s.invest > 0 ? (s.return / s.invest) * 100 : 0.0);

        const ctx = document.getElementById('rankEvChart');
        if (!ctx) return;
        if (rankEvChartInstance) rankEvChartInstance.destroy();
        
        rankEvChartInstance = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'サンプル数',
                        data: counts,
                        backgroundColor: 'rgba(148, 163, 184, 0.2)',
                        borderColor: 'rgba(148, 163, 184, 0.4)',
                        borderWidth: 1,
                        yAxisID: 'y1',
                        order: 3
                    },
                    {
                        type: 'line',
                        label: '複勝率 (%)',
                        data: placeRates,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#3b82f6',
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        type: 'line',
                        label: '単勝回収率 (%)',
                        data: recoveryRates,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#f59e0b',
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#e2e8f0', usePointStyle: true } }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'EV帯', color: '#94a3b8' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '率 (%)', color: '#94a3b8' },
                        min: 0,
                        ticks: { color: '#94a3b8', callback: v => v + '%' },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'サンプル数', color: '#94a3b8' },
                        min: 0,
                        ticks: { color: '#94a3b8', stepSize: 1 },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    // --- Simulator (Trio Backtest) ---
    runSimulatorBtn.addEventListener('click', () => {
        const r1 = Array.from(document.querySelectorAll('#sim-row1-classes input:checked')).map(i => i.value);
        const r2 = Array.from(document.querySelectorAll('#sim-row2-classes input:checked')).map(i => i.value);
        const r3 = Array.from(document.querySelectorAll('#sim-row3-classes input:checked')).map(i => i.value);

        if (r1.length === 0 || r2.length === 0 || r3.length === 0) {
            alert("1〜3列目の各列に1つ以上のクラスを選択してください。");
            return;
        }

        runSimulation(r1, r2, r3);
    });

    function runSimulation(r1, r2, r3) {
        const rowsByRace = {};
        filteredData.forEach(r => { const id = getRaceId(r); if (!rowsByRace[id]) rowsByRace[id] = []; rowsByRace[id].push(r); });

        let totalBets = 0;
        let totalReturn = 0;
        let hits = 0;
        const equity = [];
        let cumBalance = 0;

        Object.keys(rowsByRace).sort().forEach(id => {
            const horses = rowsByRace[id];
            const set1 = horses.filter(h => r1.includes(h["最終確定クラス"] || h["購入時クラス"])).map(h => h["馬番"]);
            const set2 = horses.filter(h => r2.includes(h["最終確定クラス"] || h["購入時クラス"])).map(h => h["馬番"]);
            const set3 = horses.filter(h => r3.includes(h["最終確定クラス"] || h["購入時クラス"])).map(h => h["馬番"]);

            // Combinations calculation
            const combos = [];
            set1.forEach(h1 => {
                set2.forEach(h2 => {
                    if (h2 === h1) return;
                    set3.forEach(h3 => {
                        if (h3 === h1 || h3 === h2) return;
                        // Unique set representing a trio
                        const trio = [parseInt(h1), parseInt(h2), parseInt(h3)].sort((a,b) => a-b).join('-');
                        if (!combos.includes(trio)) combos.push(trio);
                    });
                });
            });

            const raceBets = combos.length;
            totalBets += raceBets;
            
            // Check Hit
            const winners = horses.filter(h => parseInt(h["着順"]) <= 3).map(h => parseInt(h["馬番"])).sort((a,b) => a-b);
            let raceReturn = 0;
            let actualTrioPayout = 0;
            horses.forEach(h => {
                const tVal = parseFloat(h["三連複払戻"]);
                if (!isNaN(tVal) && tVal > 0) actualTrioPayout = tVal;
            });

            if (winners.length >= 3) {
                const getCombinations = (arr, k) => {
                    let result = [];
                    const f = (prefix, arr) => {
                        if (prefix.length === k) { result.push(prefix); return; }
                        for (let i = 0; i < arr.length; i++) f([...prefix, arr[i]], arr.slice(i + 1));
                    };
                    f([], arr);
                    return result;
                };
                const winnerCombos = getCombinations(winners, 3);
                for (let c of winnerCombos) {
                    if (combos.includes(c.join('-'))) {
                        hits++;
                        raceReturn = actualTrioPayout;
                        totalReturn += raceReturn;
                        break;
                    }
                }
            }
            cumBalance += (raceReturn - (raceBets * 100));
            equity.push(cumBalance);
        });

        const roi = totalBets > 0 ? (totalReturn / (totalBets * 100)) * 100 : 0;
        renderSimResults(totalBets, totalReturn, hits, roi, equity);
    }

    function renderSimResults(bets, returns, hits, roi, equity) {
        simulatorResultArea.innerHTML = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div class="p-4 bg-slate-800 rounded">
                    <p class="text-xs text-slate-400">仮想投資額</p>
                    <p class="text-lg font-bold">${(bets * 100).toLocaleString()}円</p>
                </div>
                <div class="p-4 bg-slate-800 rounded">
                    <p class="text-xs text-slate-400">仮想払戻額</p>
                    <p class="text-lg font-bold text-green-400">${returns.toLocaleString()}円</p>
                </div>
                <div class="p-4 bg-slate-800 rounded">
                    <p class="text-xs text-slate-400">仮想回収率</p>
                    <p class="text-xl font-bold ${roi >= 100 ? 'text-green-400' : 'text-red-400'}">${roi.toFixed(1)}%</p>
                </div>
                <div class="p-4 bg-slate-800 rounded">
                    <p class="text-xs text-slate-400">的中数</p>
                    <p class="text-lg font-bold">${hits}件</p>
                </div>
            </div>
        `;
        simulatorResultArea.classList.remove('hidden');
        simChartContainer.classList.remove('hidden');
        drawSimChart(equity);
    }

    function drawSimChart(data) {
        if (simChartInstance) simChartInstance.destroy();
        simChartInstance = new Chart(document.getElementById('simChart').getContext('2d'), {
            type: 'line',
            data: { labels: data.map((_,i) => i), datasets: [
                { label: '仮想累積収支', data: data, borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', fill: true, tension: 0.1, pointRadius: 0 }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins:{legend:{labels:{color:'#fff'}}}, scales:{x:{display:false}, y:{grid:{color:'#334155'}, ticks:{color:'#94a3b8'}}}}
        });
    }

    // --- Markdown Export ---
    function generateUltimateMarkdown(risk, stats, recStats, outliers, simulatedRaces) {
        let md = `# SS-Analyzer Ultimate 解析レポート

`;
        md += `## 1. リスク・収支ダッシュボード（シミュレーションベース）
`;
        md += `- 全体回収率: **${risk.roi.toFixed(1)}%**
`;
        md += `- 最大ドローダウン: **-${risk.mdd.toLocaleString()}円 (${risk.mddRate.toFixed(1)}%)**
`;
        md += `- 平均CLV: **${risk.avgClv.toFixed(3)}**
`;
        md += `- 対象レース数: ${risk.raceCount} / 馬頭数: ${risk.horseCount}

`;

        md += `## 2. クラス別詳細レポート (Kelly推奨率)
`;
        md += `| クラス | サンプル | 的中率 | 連対率 | 複勝率 | 回収率 | EV | Kelly% |
|---|---|---|---|---|---|---|---|
`;
        stats.forEach(s => {
            md += `| ${s.cls} | ${s.sample} | ${s.winRate.toFixed(1)}% (${s.wins}/${s.sample}) | ${s.top2Rate.toFixed(1)}% (${s.top2}/${s.sample}) | ${s.top3Rate.toFixed(1)}% (${s.top3}/${s.sample}) | ${s.roi.toFixed(1)}% | ${s.avgEv.toFixed(3)} | **${s.kelly.toFixed(1)}%** |
`;
        });

        md += `
## 3. 推奨度別パフォーマンス（シミュレーション: SSS/SS/S/Low）
`;
        const fmtHitRateMd = (hits, total) => total > 0 ? `${(hits / total * 100).toFixed(1)}% (${hits}/${total})` : '-';
        md += `| 推奨度 | レース数 | 単勝投資 | 単勝的中率 | 単勝回収率 | 三連複投資 | 三連複的中率 | 三連複回収率 | 合算投資 | 合算回収率 |
|---|---|---|---|---|---|---|---|---|---|
`;
        recStats.forEach(s => {
            md += `| ${s.rec} | ${s.raceCount} | ${s.winInvest.toLocaleString()}円 | ${fmtHitRateMd(s.winHits, s.winBetRaces)} | ${s.winROI.toFixed(1)}% | ${s.trioInvest.toLocaleString()}円 | ${fmtHitRateMd(s.trioHits, s.trioBetRaces)} | ${s.trioROI.toFixed(1)}% | ${s.totalInvest.toLocaleString()}円 | ${s.totalROI.toFixed(1)}% |
`;
        });

        md += `
## 4. 異常値（Outlier）分析リスト
`;
        if (outliers.length > 0) {
            md += `| 日付 | レース | 馬名 | EV | 着順 |
|---|---|---|---|---|
`;
            outliers.slice(0, 10).forEach(o => {
                md += `| ${o["日付"]} | ${o["レース名"]} | ${o["馬名"]} | ${parseFloat(o["購入時期待値"]).toFixed(2)} | **${o["着順"]}** |
`;
            });
            if (outliers.length > 10) md += `*他 ${outliers.length - 10} 件の異常値を検出*
`;
        } else {
            md += `*顕著な異常値は検出されませんでした。*
`;
        }

        md += `
---
### ✨ Gemini 3 解析プロンプト
`;
        md += `上記の「リスク管理指標」「推奨度別成績」「異常値リスト」に基づき、以下の点を詳細に分析してください。
`;
        md += `1. 回収率を上げるために除外すべきクラスや推奨度、または特定の環境条件（会場・距離）は存在するか。
`;
        md += `2. 異常値リストに共通する特徴（例：特定の会場での期待値暴落、あるいはMAOフィルターの漏れ）を特定してください。
`;
        md += `3. 最大ドローダウンを 10% 以下に抑えつつ、利益を最大化するための資金配分（ケリー基準の調整案）を提案してください。

`;

        md += `---
### 🤖 システム連携用JSON（レース詳細データ）
`;
        
        const raceJsonList = (simulatedRaces || []).map(r => {
            const strikers = (r.finalWinBets || []).map(h => ({
                umaban: parseInt(h["馬番"]),
                cls: (h["最終確定クラス"] || h["購入時クラス"] || "").trim(),
                ev: parseFloat(h["最終確定期待値"]) || parseFloat(h["購入時期待値"]) || 0,
                amberPassed: h.amberPass || false,
                auditPassed: h.auditStatus !== 'NG'
            }));
            
            const allHorses = (r.horses || []).map(h => ({
                umaban: parseInt(h["馬番"]),
                score: parseFloat(h["総合スコア"]) || 0,
                winRate: parseFloat(h["予想勝率"]) || 0,
                ev: parseFloat(h["最終確定期待値"]) || parseFloat(h["購入時期待値"]) || 0,
                cls: (h["最終確定クラス"] || h["購入時クラス"] || "").trim()
            }));

            return {
                raceId: r.id,
                raceInfo: {
                    ssDensity: r.ssDensity || 0,
                    recommendation: r.rec || "Low",
                    skipJudgment: r.skipTrio ? "SKIP" : "EXECUTE"
                },
                strikers: strikers,
                allHorses: allHorses
            };
        });

        md += `\`\`\`json
${JSON.stringify(raceJsonList, null, 2)}
\`\`\`
`;

        return md;
    }
    // --- Others ---
    integrateBtn.addEventListener('click', () => {
        const sortedData = Array.from(allData.values()).sort((a, b) => {
            const dateA = a["日付"] || "Legacy";
            const dateB = b["日付"] || "Legacy";
            if (dateA !== dateB) return dateA.localeCompare(dateB);
            const rA = getRaceId(a);
            const rB = getRaceId(b);
            if (rA !== rB) return rA.localeCompare(rB);
            return parseInt(a["馬番"]) - parseInt(b["馬番"]);
        });

        // レース間に空行を挿入
        const outputRows = [];
        let lastRaceId = "";
        sortedData.forEach(row => {
            const currentRaceId = getRaceId(row);
            if (lastRaceId !== "" && lastRaceId !== currentRaceId) {
                outputRows.push(Array(EXPECTED_HEADERS.length).fill(""));
            }
            outputRows.push(EXPECTED_HEADERS.map(h => row[h] || ""));
            lastRaceId = currentRaceId;
        });

        const csvContent = Papa.unparse({ fields: EXPECTED_HEADERS, data: outputRows });
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });

        // 最新日付をファイル名に含める
        const dates = sortedData.map(d => d["日付"]).filter(d => d && d !== "Legacy").sort();
        const latestDate = dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().split('T')[0];
        const safeDate = latestDate.replace(/\//g, '-');

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `SS_Integrated_${safeDate}.csv`;
        link.click();
        showToast(`統合CSV出力完了 (最新: ${latestDate})`);
    });

    copyBtn.addEventListener('click', () => {
        geminiOutput.select();
        document.execCommand('copy');
        showToast("コピーしました");
    });

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
});
