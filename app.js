import { analyzeRace } from './logic.js?v=5.30.0';

document.addEventListener('DOMContentLoaded', () => {
    const fetchBtn = document.getElementById('fetchBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const urlInput = document.getElementById('urlInput');
    const updateOddsBtn = document.getElementById('updateOddsBtn');
    const autoUpdateCheck = document.getElementById('autoUpdateCheck');
    const updateStatusText = document.getElementById('updateStatusText');
    const errorBox = document.getElementById('errorBox');
    const raceTableBody = document.querySelector('#raceTable tbody');
    const resultsPanel = document.getElementById('resultsPanel');
    const historySelect = document.getElementById('historySelect');
    const deleteHistoryBtn = document.getElementById('deleteHistoryBtn');
    const resultUrlInput = document.getElementById('resultUrlInput');
    const mergeResultBtn = document.getElementById('mergeResultBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const resultStatusText = document.getElementById('resultStatusText');

    let currentHorses = [];
    let savedGradeInfo = "";
    let savedDateInfo = "";
    let lastResultData = null;
    let isGradeRace = false; 
    let lastFetchedUrl = "";
    let currentVenue = "";
    let currentRaceNum = "";
    let autoUpdateInterval = null;

    const showError = (msg) => {
        if (!msg) {
            errorBox.style.display = 'none';
        } else {
            errorBox.textContent = msg;
            errorBox.style.display = 'block';
        }
    };

    let raceHistory = [];
    const MAX_HISTORY = 20;

    const loadHistoryFromStorage = () => {
        try {
            const saved = localStorage.getItem('ss_engine_history');
            if (saved) {
                raceHistory = JSON.parse(saved);
            }
        } catch(e) {}
        renderHistoryDropdown();
    };

    const saveToHistory = () => {
        if (!lastFetchedUrl || currentHorses.length === 0) return;
        
        // ▼ 修正: 画面の入力欄から最新の値を直接取得して保存 (手動修正や頭数情報を確実に保持)
        const gradeInput = document.getElementById('raceGrade');
        const currentGradeValue = gradeInput ? gradeInput.value : savedGradeInfo;
        
        const existingIdx = raceHistory.findIndex(h => h.url === lastFetchedUrl);
        const historyItem = {
            url: lastFetchedUrl,
            raceName: document.getElementById('raceTitle').textContent,
            venue: currentVenue || "",
            raceNum: currentRaceNum || "",
            courseInfo: document.getElementById('raceCourse').textContent,
            gradeInfo: currentGradeValue,
            dateInfo: savedDateInfo,
            horses: JSON.parse(JSON.stringify(currentHorses)),
            timestamp: new Date().getTime(),
            isGradeRace: isGradeRace
        };
        if (existingIdx >= 0) {
            raceHistory[existingIdx] = historyItem;
        } else {
            raceHistory.unshift(historyItem);
            if (raceHistory.length > MAX_HISTORY) raceHistory.pop();
        }
        localStorage.setItem('ss_engine_history', JSON.stringify(raceHistory));
        renderHistoryDropdown(lastFetchedUrl);
    };

    const renderHistoryDropdown = (selectedUrl = "") => {
        if (raceHistory.length === 0) {
            historySelect.innerHTML = '<option value="">-- 過去の履歴がありません --</option>';
            deleteHistoryBtn.disabled = true;
            return;
        }
        historySelect.innerHTML = '<option value="">-- 新規取得 (現在の出馬表) --</option>';
        raceHistory.forEach(h => {
            const dateStr = new Date(h.timestamp).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const prefix = (h.venue || h.raceNum) ? `[${h.venue || ''}${h.raceNum || ''}] ` : "";
            const title = h.raceName ? (h.raceName.length > 20 ? h.raceName.substring(0,20)+"..." : h.raceName) : "不明なレース";
            const opt = document.createElement('option');
            opt.value = h.url;
            
            // ▼ 追加: 出力済みフラグの確認とマークの付与
            const statusMark = h.isExported ? "✅ [出力済] " : "";
            opt.textContent = `${statusMark}${prefix}${title} (${dateStr})`;
            
            historySelect.appendChild(opt);
        });
        if (selectedUrl) historySelect.value = selectedUrl;
        deleteHistoryBtn.disabled = !historySelect.value;
    };

    historySelect.addEventListener('change', (e) => {
        const url = e.target.value;
        deleteHistoryBtn.disabled = !url;
        if (!url) return;
        const item = raceHistory.find(h => h.url === url);
        if (item) {
            lastFetchedUrl = item.url;
            urlInput.value = item.url;
            document.getElementById('raceTitle').textContent = item.raceName;
            document.getElementById('raceCourse').textContent = item.courseInfo;
            currentHorses = JSON.parse(JSON.stringify(item.horses));
            isGradeRace = item.isGradeRace || false;
            
            savedGradeInfo = item.gradeInfo || "";
            savedDateInfo = item.dateInfo || "";
            
            // ▼ 修正: 保存されたグレード情報をUIの入力欄に正しく復元
            const gradeInput = document.getElementById('raceGrade');
            if (gradeInput) {
                gradeInput.value = savedGradeInfo;
            }
            
            updateOddsBtn.disabled = false;
            updateOddsBtn.classList.remove('cursor-not-allowed', 'bg-gray-600');
            updateOddsBtn.classList.add('bg-blue-600', 'hover:bg-blue-500');
            autoUpdateCheck.disabled = false;
            
            currentVenue = item.venue || "";
            currentRaceNum = item.raceNum || "";
            
            renderTable();
            resultsPanel.style.display = 'none';
        }
    });

    deleteHistoryBtn.addEventListener('click', () => {
        const url = historySelect.value;
        if (!url) return;
        if (confirm("現在選択されている履歴を削除しますか？")) {
            raceHistory = raceHistory.filter(h => h.url !== url);
            localStorage.setItem('ss_engine_history', JSON.stringify(raceHistory));
            renderHistoryDropdown();
        }
    });

    loadHistoryFromStorage();

    fetchBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showError("URLを入力してください");
            return;
        }

        showError("");
        fetchBtn.disabled = true;
        fetchBtn.textContent = "取得中...";

        try {
            const res = await fetch(`/api/index?url=${encodeURIComponent(url)}`);
            if (!res.ok) throw new Error(`データの取得に失敗しました (エラーコード: ${res.status})`);
            const data = await res.json();
            
            if (data.error) throw new Error(data.error);

            document.getElementById('raceTitle').textContent = data.race_name || "出馬表";
            document.getElementById('raceCourse').textContent = data.course_info || "";
            
            savedGradeInfo = data.grade_info || "";
            savedDateInfo = data.date_info || "";
            
            currentVenue = data.venue || "";
            currentRaceNum = data.race_num || "";
            
            currentHorses = data.horses.sort((a,b) => a.umaban - b.umaban);
            
            // フェールセーフ: odds と rank の型を保証
            currentHorses.forEach(h => {
                h.odds = parseFloat(h.odds) || 0;
                if (!h.rank) h.rank = 'B';
            });
            
            isGradeRace = data.race_name ? data.race_name.includes('G1') || data.race_name.includes('G2') || data.race_name.includes('G3') : false;
            
            // ▼ 刷新: タイトル等から精査された正確なグレードと頭数を結合してUIへ同期
            const gradePref = data.grade_info ? data.grade_info.trim() + " " : "";
            const headcount = currentHorses.length;
            const combinedValue = `${gradePref}${headcount}頭`.trim();
            
            const gradeInput = document.getElementById('raceGrade');
            if (gradeInput) {
                gradeInput.value = combinedValue;
            }
            
            lastFetchedUrl = url;
            updateOddsBtn.disabled = false;
            updateOddsBtn.classList.remove('cursor-not-allowed', 'bg-gray-600');
            updateOddsBtn.classList.add('bg-blue-600', 'hover:bg-blue-500');
            autoUpdateCheck.disabled = false;
            
            if (data.odds_unavailable) {
                showError("⚠️ 馬名を取得しました。オッズはまだ発売されていません。発売後に「オッズ更新」ボタンを押してください。");
            }
            
            renderTable();
        } catch (err) {
            showError(err.message);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.textContent = "出馬表を取得";
        }
    });

    const refreshOdds = async () => {
        if (!lastFetchedUrl) return;
        
        updateOddsBtn.disabled = true;
        updateStatusText.textContent = "更新中...";
        
        try {
            const res = await fetch(`/api/index?url=${encodeURIComponent(lastFetchedUrl)}`);
            if (!res.ok) throw new Error("オッズの取得に失敗");
            const data = await res.json();
            
            let updatedCount = 0;
            data.horses.forEach(newHorse => {
                const h = currentHorses.find(x => x.umaban === newHorse.umaban);
                if (h && h.odds !== newHorse.odds) {
                    h.odds = newHorse.odds;
                    updatedCount++;
                }
            });
            
            renderTable();
            if (updatedCount > 0) {
               updateStatusText.textContent = `更新完了 (${updatedCount}頭のオッズ変動)`;
               setTimeout(() => { updateStatusText.textContent = ""; }, 3000);
               
               // 自動的に再解析を実行
               if (!analyzeBtn.disabled) {
                   analyzeBtn.click();
               }
            } else {
               updateStatusText.textContent = "変動なし";
               setTimeout(() => { updateStatusText.textContent = ""; }, 3000);
            }
        } catch (err) {
            console.error(err);
            updateStatusText.textContent = "更新エラー";
        } finally {
            updateOddsBtn.disabled = false;
        }
    };

    updateOddsBtn.addEventListener('click', refreshOdds);

    autoUpdateCheck.addEventListener('change', (e) => {
        if (e.target.checked) {
            updateStatusText.textContent = "自動更新ON";
            autoUpdateInterval = setInterval(refreshOdds, 60000); // 60秒
        } else {
            updateStatusText.textContent = "";
            if (autoUpdateInterval) clearInterval(autoUpdateInterval);
            autoUpdateInterval = null;
        }
    });

    const renderTable = () => {
        raceTableBody.innerHTML = "";
        currentHorses.forEach((horse, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-2 py-1 border-b border-slate-700 text-center text-sm">${horse.umaban}</td>
                <td class="px-2 py-1 border-b border-slate-700 text-center">
                    <select class="bg-slate-800 text-white px-1 py-1 rounded rank-select border border-slate-600 text-sm w-12" data-idx="${idx}">
                        ${['S','A','B','C','D','E','F'].map(r => `<option value="${r}" ${horse.rank === r ? 'selected' : ''}>${r}</option>`).join('')}
                    </select>
                </td>
                <td class="px-2 py-1 border-b border-slate-700 horse-name font-bold text-sm">${horse.name}</td>
                <td class="px-2 py-1 border-b border-slate-700 text-right">
                    <input type="number" step="0.1" class="bg-slate-800 text-white w-16 px-1 py-1 rounded odds-input border border-slate-600 text-sm" data-idx="${idx}" value="${horse.odds}">
                </td>
                <td class="px-2 py-1 border-b border-slate-700 text-center">
                    <input type="checkbox" class="audit-checkbox w-4 h-4 text-blue-600 bg-slate-800 border-slate-600 rounded" data-idx="${idx}" ${horse.passedStrikerValidation ? 'checked' : ''}>
                </td>
            `;
            raceTableBody.appendChild(tr);
        });

        // Event listeners for inputs
        document.querySelectorAll('.odds-input').forEach(el => {
            el.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                currentHorses[idx].odds = parseFloat(e.target.value) || 0;
            });
        });

        document.querySelectorAll('.rank-select').forEach(el => {
            el.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                currentHorses[idx].rank = e.target.value;
            });
        });
        
        document.querySelectorAll('.audit-checkbox').forEach(el => {
            el.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                currentHorses[idx].passedStrikerValidation = e.target.checked;
            });
        });
        
        analyzeBtn.disabled = false;
    };

    analyzeBtn.addEventListener('click', () => {
        if (currentHorses.length === 0) return;
        
        saveToHistory();
        const result = analyzeRace(currentHorses, isGradeRace);
        renderResults(result);
    });

    const renderResults = (res) => {
        resultsPanel.style.display = 'block';
        
        // 1. Diagnosis
        document.getElementById('resDensity').textContent = res.ssDensity.toFixed(3);
        document.getElementById('resRec').textContent = res.recommendation;
        const skipInfo = document.getElementById('resSkip');
        if (res.skipReason) {
            skipInfo.innerHTML = `<span class="text-red-400 font-bold">⚠️ SKIP: ${res.skipReason}</span>`;
        } else {
            skipInfo.innerHTML = `<span class="text-green-400">✅ 執行対象</span>`;
        }

        // 2. Win Targets
        const winList = document.getElementById('winTargets');
        winList.innerHTML = "";
        if (res.winTargets.length === 0) {
            winList.innerHTML = `<li class="text-slate-400">対象馬なし</li>`;
        } else {
            res.winTargets.forEach(h => {
                let recLevel = 'Low';
                if (res.recommendation.includes('SSS')) recLevel = 'SSS';
                else if (res.recommendation.includes('SS')) recLevel = 'SS';
                else if (res.recommendation.includes('(S)')) recLevel = 'S';

                let units = 0;
                if (h.cls === 'A3') {
                    if (recLevel === 'SSS') units = 6;
                    else if (recLevel === 'SS') units = 5;
                    else if (recLevel === 'S') units = 3;
                    else units = 1; // Low
                } else if (h.cls === 'B2') {
                    if (recLevel === 'SSS') units = 4;
                    else if (recLevel === 'SS') units = 3;
                    else if (recLevel === 'S') units = 2;
                    else units = 1; // Low
                } else if (['A2', 'B1', 'D1', 'B3', 'X'].includes(h.cls)) {
                    if (recLevel === 'SSS' || recLevel === 'SS') units = 2;
                    else units = 1; // S, Low
                }
                
                let unitStr = units > 0 ? `${units}U` : "0U";
                winList.innerHTML += `<li class="font-bold text-yellow-300">馬番 ${h.umaban} [${h.cls}] : 推奨 ${unitStr} / 期待値 ${h.ev.toFixed(3)} ${h.amberPassed ? "✅" : "❌"} (MAO: ${h.mao.toFixed(1)})</li>`;
            });
        }

        // 3. Wide Targets
        const wideList = document.getElementById('wideTargets');
        wideList.innerHTML = `<li class="text-slate-400">Ver.5.29により無効化 (単勝・三連複特化)</li>`;

        // 4. Sanrenpuku
        const sanList = document.getElementById('sanrenpukuTargets');
        sanList.innerHTML = "";
        if (res.skipReason || !res.sanrenpuku.axis) {
            sanList.innerHTML = `<li class="text-slate-400">購入見送り</li>`;
        } else {
            const row1 = res.sanrenpuku.axis.umaban;
            const row2 = res.sanrenpuku.row2.map(h => h.umaban).join(', ');
            const row3 = res.sanrenpuku.row3.map(h => h.umaban).join(', ');
            sanList.innerHTML += `
               <li><strong class="text-purple-400">1列目 (軸):</strong> ${row1}</li>
               <li><strong class="text-blue-400">2列目 (相手):</strong> ${row2 || 'なし'}</li>
               <li><strong class="text-gray-300">3列目 (網):</strong> ${row3 || 'なし'}</li>
            `;
        }

        // MAO & Amber Audit Details table
        const maoBody = document.querySelector('#maoTable tbody');
        maoBody.innerHTML = "";
        
        // ソート: 優先順位わかりやすく馬番順
        let sortedHorses = [...res.horses].sort((a,b)=> a.umaban - b.umaban);
        sortedHorses.forEach(h => {
            const tr = document.createElement('tr');
            
            // Phase 4.5: X/D1 で未監査の馬をハイライト
            const needsAudit = (h.cls === 'X' || h.cls === 'D1') && !h.passedStrikerValidation;
            if (needsAudit) {
                tr.classList.add('audit-alert');
            }
            
            tr.innerHTML = `
                <td class="px-2 py-1 border-b border-slate-700">${h.umaban}</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.cls || '-'}${needsAudit ? ' ⚠️' : ''}</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.ev.toFixed(3)}</td>
                <td class="px-2 py-1 border-b border-slate-700">${(h.winRate*100).toFixed(1)}%</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.mao === 999 ? '-' : h.mao.toFixed(1)}</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.odds.toFixed(1)}</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.amberPassed ? '✅' : '❌'}</td>
                <td class="px-2 py-1 border-b border-slate-700 text-xs">${h.audit || '-'}</td>
            `;
            maoBody.appendChild(tr);
        });

        // === X Post Template Generation ===
        const raceName = document.getElementById('raceTitle').textContent.trim();
        const rec = res.recommendation;

        // クラス別実績データ（SS-Analyzer検証結果ハードコード）
        const CLASS_STATS = {
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

        let xLines = [];
        xLines.push(`SS-ENGINE 出力 ▪ ${raceName}`);
        xLines.push(`推奨度 ${rec}`);
        xLines.push('');

        // 単勝セクション
        if (res.winTargets.length > 0) {
            xLines.push('━━ 単勝 ━━');
            res.winTargets.forEach(h => {
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
        if (!res.skipReason && res.sanrenpuku.axis) {
            xLines.push('');
            xLines.push('━━ 軸（複勝）━━');
            const ax = res.sanrenpuku.axis;
            xLines.push(`${ax.umaban} ${ax.name} [${ax.cls}]`);
            const st = CLASS_STATS[ax.cls];
            if (st) {
                xLines.push(`  class[${ax.cls}] n=${st.n} 勝率${st.winRate} 複勝率${st.placeRate}`);
            }
        }

        xLines.push('');
        xLines.push('#競馬 #SS_ENGINE');

        const xPostText = xLines.join('\n');
        document.getElementById('xPostPreview').textContent = xPostText;

        // Copy button handler
        const copyBtn = document.getElementById('copyXPostBtn');
        const copyStatus = document.getElementById('copyXPostStatus');
        
        // Remove old listener by cloning
        const newCopyBtn = copyBtn.cloneNode(true);
        copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
        
        newCopyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(xPostText);
                copyStatus.classList.remove('hidden');
                setTimeout(() => copyStatus.classList.add('hidden'), 2000);
            } catch (e) {
                // Fallback for non-HTTPS
                const ta = document.createElement('textarea');
                ta.value = xPostText;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                copyStatus.classList.remove('hidden');
                setTimeout(() => copyStatus.classList.add('hidden'), 2000);
            }
        });

        resultsPanel.scrollIntoView({ behavior: 'smooth' });
    };

    // Dummy data loading capability embedded for local testing
    window.loadDummyData = () => {
        urlInput.value = "dummy";
        currentHorses = [
            {umaban:1, name:"A", odds:2.5, rank:"S"},
            {umaban:2, name:"B", odds:5.0, rank:"A"},
            {umaban:3, name:"C", odds:10.0, rank:"C"},
            {umaban:4, name:"D", odds:30.0, rank:"D"},
            {umaban:5, name:"E", odds:100.0, rank:"F"},
            {umaban:6, name:"F", odds:4.0, rank:"B"},
            {umaban:7, name:"G", odds:4.0, rank:"B"},
            {umaban:8, name:"H", odds:4.0, rank:"B"},
            {umaban:9, name:"I", odds:4.0, rank:"B"},
            {umaban:10, name:"J", odds:4.0, rank:"B"},
            {umaban:11, name:"K", odds:4.0, rank:"B"},
            {umaban:12, name:"L", odds:4.0, rank:"B"}
        ];
        renderTable();
    };
    // Merge Result Data
    mergeResultBtn.addEventListener('click', async () => {
        const resUrl = resultUrlInput.value.trim();
        if (!resUrl) return;

        mergeResultBtn.disabled = true;
        mergeResultBtn.textContent = "取得中...";
        resultStatusText.textContent = "";

        try {
            const res = await fetch(`/api/index?url=${encodeURIComponent(resUrl)}`);
            if (!res.ok) throw new Error("結果の取得に失敗");
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (data.course_info) {
                const courseLabel = document.getElementById('raceCourse');
                if (courseLabel.textContent === "" || courseLabel.textContent.includes("不明")) {
                    courseLabel.textContent = data.course_info;
                }
            }
            if (data.date_info) savedDateInfo = data.date_info;
            
            // ▼ 修正: グレードと頭数をUIに強制セット（同期）
            let finalGrade = "";
            if (data.grade_info && data.grade_info !== "一般" && data.grade_info.trim() !== "") {
                savedGradeInfo = data.grade_info; // 内部変数も更新
                finalGrade = data.grade_info.trim() + " ";
            } else if (savedGradeInfo) {
                // 結果URLから取れなかった場合は既存の変数を維持
                finalGrade = savedGradeInfo.trim() + " ";
            }

            const gradeInput = document.getElementById('raceGrade');
            if (gradeInput) {
                // 画面のボックスを「G1 18頭」のように上書きする
                gradeInput.value = `${finalGrade}${currentHorses.length}頭`.trim();
            }

            let mergedCount = 0;
            data.horses.forEach(resHorse => {
                const target = currentHorses.find(h => h.umaban === resHorse.umaban);
                if (target) {
                    target.placing = resHorse.placing || "";
                    target.finalOdds = parseFloat(resHorse.odds) || 0;
                    target.finalPopular = resHorse.popular || "";
                    mergedCount++;
                }
            });

            // 確定オッズベースで最終解析を実行
            let tempHorses = JSON.parse(JSON.stringify(currentHorses));
            tempHorses.forEach(h => {
                 if (h.finalOdds !== undefined) {
                     h.odds = parseFloat(h.finalOdds) || 0;
                 }
            });
            const tempRes = analyzeRace(tempHorses, isGradeRace);
            
            currentHorses.forEach(h => {
                 const fh = tempRes.horses.find(x => x.umaban === h.umaban);
                 if (fh) {
                     h.finalEv = fh.ev;
                     h.finalCls = fh.cls;
                 }
            });

            lastResultData = data;
            resultStatusText.textContent = `✅ ${mergedCount}頭の結果を合体し、最終解析を完了しました！`;
            setTimeout(()=> { resultStatusText.textContent = ""; }, 5000);
            saveToHistory();

        } catch (err) {
            resultStatusText.textContent = `❌ ${err.message}`;
        } finally {
            mergeResultBtn.disabled = false;
            mergeResultBtn.textContent = "着順を合体する";
        }
    });

    // CSV Download
    exportCsvBtn.addEventListener('click', () => {
        if (!lastFetchedUrl || currentHorses.length === 0) return;
        
        if (!currentHorses[0].cls) {
             analyzeBtn.click();
        }

        const raceName = document.getElementById('raceTitle').textContent.replace(/,/g, '');
        const courseInfo = document.getElementById('raceCourse').textContent.replace(/,/g, '');
        
        // ▼ 修正: UIの値が空だった場合のフォールバックを強化
        const gradeValueForCsv = document.getElementById('raceGrade').value.trim();
        const gradeStr = (gradeValueForCsv || `${currentHorses.length}頭`).replace(/,/g, '');
        
        let dateStr = savedDateInfo ? savedDateInfo.replace(/,/g, '').trim() : new Date().toISOString().split('T')[0];

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
        csvContent += "日付,レース名,コース詳細,グレード・頭数,馬番,馬名,購入時人気,購入時オッズ,評価,購入時期待値,購入時クラス,近走監査,最終確定人気,最終確定オッズ,最終確定期待値,最終確定クラス,着順,MAO,実行フラグ,単勝払戻,ワイド払戻,馬連払戻,三連複払戻,三連単払戻\r\n";

        // ▼ 追加: CSVを破壊する文字（改行、カンマ）をスペースに置換する関数
        const sanitize = (val) => {
            if (val === null || val === undefined) return "-";
            return String(val).replace(/[\r\n,]/g, ' ').trim();
        };

        currentHorses.sort((a,b) => a.umaban - b.umaban).forEach(h => {
             const rawRow = [
                 dateStr, raceName, courseInfo, gradeStr, h.umaban, h.name,
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
                 tanshoPay, widePay, umarenPay, sanrenPay, sanrentanPay
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

        // ▼ 追加: CSV出力が完了したことを履歴に記録し、UIを更新する
        const existingIdx = raceHistory.findIndex(h => h.url === lastFetchedUrl);
        if (existingIdx >= 0) {
            raceHistory[existingIdx].isExported = true;
            localStorage.setItem('ss_engine_history', JSON.stringify(raceHistory));
            renderHistoryDropdown(lastFetchedUrl);
        }
    });

    // JRA Odds Batch Input Logic (Revised: Search-based Matching)
    document.getElementById('applyJraOddsBtn').addEventListener('click', () => {
        const rawText = document.getElementById('jraOddsInput').value;
        if (!rawText) return;

        // JRAのコピペは改行が多いため、一旦すべての改行をスペースに置換して1本の長い文字列にする
        const cleanText = rawText.replace(/\n/g, ' ').replace(/\s+/g, ' ');
        
        let count = 0;

        // アプリ内の馬リスト1頭ずつに対して、テキスト内からオッズを探す
        currentHorses.forEach(horse => {
            const hName = String(horse.name || horse.馬名 || '').trim();
            if (!hName) return;

            // 馬名の直後にある「数値.数値」のパターンを検索する正規表現
            // 例: "フェスティバルヒル 20.0" や "フェスティバルヒル20.0" に対応
            const escapedName = hName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 記号対策
            const regex = new RegExp(escapedName + "[^0-9.]*([0-9]+\\.[0-9]+)");
            
            const match = cleanText.match(regex);
            
            if (match) {
                const odds = parseFloat(match[1]);
                if (!isNaN(odds)) {
                    horse.odds = odds;
                    count++;
                }
            }
        });

        if (count > 0) {
            renderTable(); // 画面を更新し、手動入力のinput欄にも数値を反映させる
            alert(`${count}頭のオッズを反映しました。スマホ版でも動作を確認してください。`);
        } else {
            alert("オッズが見つかりませんでした。馬名が一致しているか、または単勝オッズが表示されているか確認してください。");
        }
    });

});
