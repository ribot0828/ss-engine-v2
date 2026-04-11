import { analyzeRace } from './logic.js';

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
        const existingIdx = raceHistory.findIndex(h => h.url === lastFetchedUrl);
        const historyItem = {
            url: lastFetchedUrl,
            raceName: document.getElementById('raceTitle').textContent,
            venue: currentVenue || "",
            raceNum: currentRaceNum || "",
            courseInfo: document.getElementById('raceCourse').textContent,
            gradeInfo: savedGradeInfo,
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
            isGradeRace = data.race_name ? data.race_name.includes('G1') || data.race_name.includes('G2') || data.race_name.includes('G3') : false;
            
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
                <td class="px-4 py-2 border-b border-slate-700 text-center">${horse.umaban}</td>
                <td class="px-4 py-2 border-b border-slate-700 font-bold">${horse.name}</td>
                <td class="px-4 py-2 border-b border-slate-700 text-right">
                    <input type="number" step="0.1" class="bg-slate-800 text-white w-20 px-2 py-1 rounded odds-input border border-slate-600" data-idx="${idx}" value="${horse.odds}">
                </td>
                <td class="px-4 py-2 border-b border-slate-700 text-center">
                    <select class="bg-slate-800 text-white px-2 py-1 rounded rank-select border border-slate-600" data-idx="${idx}">
                        ${['S','A','B','C','D','E','F'].map(r => `<option value="${r}" ${horse.rank === r ? 'selected' : ''}>${r}</option>`).join('')}
                    </select>
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
                winList.innerHTML += `<li class="font-bold text-yellow-300">馬番 ${h.umaban} [${h.cls}] : 期待値 ${h.ev.toFixed(3)} ${h.amberPassed ? "✅" : "❌"} (MAO: ${h.mao.toFixed(1)})</li>`;
            });
        }

        // 3. Wide Targets
        const wideList = document.getElementById('wideTargets');
        wideList.innerHTML = "";
        if (res.skipReason || res.wideTargets.length === 0) {
            wideList.innerHTML = `<li class="text-slate-400">購入見送り (単勝のみ執行)</li>`;
        } else {
            res.wideTargets.forEach(w => {
                 wideList.innerHTML += `<li>軸: ${w.axis.umaban} [${w.axis.cls}] - 相手: ${w.opp.umaban} [${w.opp.cls}]</li>`;
            });
        }

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
            tr.innerHTML = `
                <td class="px-2 py-1 border-b border-slate-700">${h.umaban}</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.cls || '-'}</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.ev.toFixed(3)}</td>
                <td class="px-2 py-1 border-b border-slate-700">${(h.winRate*100).toFixed(1)}%</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.mao === 999 ? '-' : h.mao.toFixed(1)}</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.odds.toFixed(1)}</td>
                <td class="px-2 py-1 border-b border-slate-700">${h.amberPassed ? '✅' : '❌'}</td>
                <td class="px-2 py-1 border-b border-slate-700 text-xs">${h.audit || '-'}</td>
            `;
            maoBody.appendChild(tr);
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
            if (data.grade_info) savedGradeInfo = data.grade_info;

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
                 if (h.finalOdds && h.finalOdds > 0) h.odds = h.finalOdds;
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
        const gradeStr = savedGradeInfo.replace(/,/g, '');
        
        let dateStr = savedDateInfo ? savedDateInfo.replace(/,/g, '').trim() : new Date().toISOString().split('T')[0];

        const getPay = (key) => {
            if (lastResultData && lastResultData.payouts && lastResultData.payouts[key]) {
                return lastResultData.payouts[key].replace(/,/g, '').trim();
            }
            return "-";
        };
        const tanshoPay = getPay('単勝');
        const widePay = getPay('ワイド').replace(/円/g, "円 ");
        const sanrenPay = getPay('3連複');

        let csvContent = '\uFEFF';
        csvContent += "日付,レース名,コース詳細,グレード・頭数,馬番,馬名,購入時人気,購入時オッズ,評価,購入時期待値,購入時クラス,最終確定人気,最終確定オッズ,最終確定期待値,最終確定クラス,着順,MAO,実行フラグ,単勝払戻,ワイド払戻,三連複払戻\r\n";

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
                 h.finalPopular || "-",
                 (h.finalOdds && h.finalOdds > 0) ? h.finalOdds.toFixed(1) : "-",
                 (h.finalEv !== undefined && h.finalEv !== "-") ? h.finalEv.toFixed(3) : "-",
                 h.finalCls || "-",
                 h.placing || "-",
                 (h.mao !== undefined && h.mao !== 999) ? h.mao.toFixed(1) : "-",
                 h.amberPassed ? "○" : "×",
                 tanshoPay, widePay, sanrenPay
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

});
