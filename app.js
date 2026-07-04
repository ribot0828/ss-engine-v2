// SS-Engine アプリケーション オーケストレーション（DOM配線・描画）
import { analyzeRace } from './logic.js?v=5.37.0';
import { fetchRaceData } from './api.js?v=5.37.0';
import { loadHistory, getHistory, saveHistory, deleteHistory, markExported } from './history.js?v=5.37.0';
import { buildXPostText } from './xpost.js?v=5.37.0';
import { exportCsv } from './csv.js?v=5.37.0';

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
    let currentXPostText = "";

    const showError = (msg) => {
        if (!msg) {
            errorBox.style.display = 'none';
        } else {
            errorBox.textContent = msg;
            errorBox.style.display = 'block';
        }
    };

    // updateOddsBtn / autoUpdateCheck を有効状態にする共通ヘルパー
    const enableOddsControls = () => {
        updateOddsBtn.disabled = false;
        updateOddsBtn.classList.remove('cursor-not-allowed', 'bg-gray-600');
        updateOddsBtn.classList.add('bg-blue-600', 'hover:bg-blue-500');
        autoUpdateCheck.disabled = false;
    };

    const renderHistoryDropdown = (selectedUrl = "") => {
        const raceHistory = getHistory();
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

    const saveToHistory = () => {
        if (!lastFetchedUrl || currentHorses.length === 0) return;

        // ▼ 修正: 画面の入力欄から最新の値を直接取得して保存 (手動修正や頭数情報を確実に保持)
        const gradeInput = document.getElementById('raceGrade');
        const currentGradeValue = gradeInput ? gradeInput.value : savedGradeInfo;

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
        saveHistory(historyItem);
        renderHistoryDropdown(lastFetchedUrl);
    };

    historySelect.addEventListener('change', (e) => {
        const url = e.target.value;
        deleteHistoryBtn.disabled = !url;
        if (!url) return;
        const item = getHistory().find(h => h.url === url);
        if (item) {
            lastFetchedUrl = item.url;
            urlInput.value = item.url;
            document.getElementById('raceTitle').textContent = item.raceName;
            document.getElementById('raceVenue').textContent = item.venue || "";
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

            enableOddsControls();

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
            deleteHistory(url);
            renderHistoryDropdown();
        }
    });

    loadHistory();
    renderHistoryDropdown();

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
            const data = await fetchRaceData(url);

            document.getElementById('raceTitle').textContent = data.race_name || "出馬表";
            document.getElementById('raceVenue').textContent = data.venue || "";
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
            enableOddsControls();

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
            const data = await fetchRaceData(lastFetchedUrl, { errorMsg: "オッズの取得に失敗", checkDataError: false });

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

    // イベントデリゲーション: raceTableBody への1回のみのリスナー登録
    raceTableBody.addEventListener('change', (e) => {
        if (e.target.matches('.odds-input')) {
            const idx = parseInt(e.target.dataset.idx);
            currentHorses[idx].odds = parseFloat(e.target.value) || 0;
        } else if (e.target.matches('.rank-select')) {
            const idx = parseInt(e.target.dataset.idx);
            currentHorses[idx].rank = e.target.value;
        } else if (e.target.matches('.audit-checkbox')) {
            const idx = parseInt(e.target.dataset.idx);
            currentHorses[idx].passedStrikerValidation = e.target.checked;
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

        analyzeBtn.disabled = false;
    };

    analyzeBtn.addEventListener('click', () => {
        if (currentHorses.length === 0) return;

        saveToHistory();
        const result = analyzeRace(currentHorses, isGradeRace);
        renderResults(result);
    });

    const renderDiagnosis = (res) => {
        document.getElementById('resDensity').textContent = res.ssDensity.toFixed(3);
        document.getElementById('resRec').textContent = res.recommendation;
        const skipInfo = document.getElementById('resSkip');
        if (res.skipReason) {
            skipInfo.innerHTML = `<span class="text-red-400 font-bold">⚠️ SKIP: ${res.skipReason}</span>`;
        } else {
            skipInfo.innerHTML = `<span class="text-green-400">✅ 執行対象</span>`;
        }
    };

    const renderWinTargets = (res) => {
        const winList = document.getElementById('winTargets');
        winList.innerHTML = "";
        if (res.winTargets.length === 0) {
            winList.innerHTML = `<li class="text-slate-400">対象馬なし</li>`;
        } else {
            res.winTargets.forEach(h => {
                const unitStr = h.unit > 0 ? `${h.unit}U` : "0U";
                winList.innerHTML += `<li class="font-bold text-yellow-300">馬番 ${h.umaban} [${h.cls}] : 推奨 ${unitStr} / 期待値 ${h.ev.toFixed(3)} ${h.amberPassed ? "✅" : "❌"} (MAO: ${h.mao.toFixed(1)})</li>`;
            });
        }

        // Wide Targets
        const wideList = document.getElementById('wideTargets');
        wideList.innerHTML = `<li class="text-slate-400">Ver.5.29により無効化 (単勝・三連複特化)</li>`;
    };

    const renderSanrenpuku = (res) => {
        const sanList = document.getElementById('sanrenpukuTargets');
        sanList.innerHTML = "";
        if (res.skipReason || !res.sanrenpuku.axis) {
            sanList.innerHTML = `<li class="text-slate-400">購入見送り</li>`;
        } else {
            const row1 = res.sanrenpuku.axis.umaban;
            const mates = res.sanrenpuku.row2.map(h => h.umaban).join(', ');
            const combos = (res.sanrenpuku.combos || []).map(c => c.join('-'));
            sanList.innerHTML += `
               <li><strong class="text-purple-400">軸:</strong> ${row1}</li>
               <li><strong class="text-blue-400">相手:</strong> ${mates || 'なし'}</li>
               <li><strong class="text-gray-300">買い目 (${combos.length}点):</strong> ${combos.join(' / ') || 'なし'}</li>
            `;
        }
    };

    const renderMaoTable = (res) => {
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
    };

    // Copy button: 初期化時に1回だけリスナー登録（cloneNodeハックを廃止）
    const copyBtn = document.getElementById('copyXPostBtn');
    const copyStatus = document.getElementById('copyXPostStatus');
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(currentXPostText);
            copyStatus.classList.remove('hidden');
            setTimeout(() => copyStatus.classList.add('hidden'), 2000);
        } catch (e) {
            // Fallback for non-HTTPS
            const ta = document.createElement('textarea');
            ta.value = currentXPostText;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            copyStatus.classList.remove('hidden');
            setTimeout(() => copyStatus.classList.add('hidden'), 2000);
        }
    });

    const renderResults = (res) => {
        resultsPanel.style.display = 'block';

        renderDiagnosis(res);
        renderWinTargets(res);
        renderSanrenpuku(res);
        renderMaoTable(res);

        // === X Post Template Generation ===
        const raceName = document.getElementById('raceTitle').textContent.trim();
        currentXPostText = buildXPostText(raceName, res);
        document.getElementById('xPostPreview').textContent = currentXPostText;

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
            const data = await fetchRaceData(resUrl, { errorMsg: "結果の取得に失敗" });

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

        exportCsv({ raceName, venueStr: (currentVenue || "-").replace(/,/g, ''), courseInfo, gradeStr, dateStr, horses: currentHorses, lastResultData });

        // ▼ 追加: CSV出力が完了したことを履歴に記録し、UIを更新する
        if (markExported(lastFetchedUrl)) {
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
