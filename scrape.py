from http.server import BaseHTTPRequestHandler
import urllib.parse
import json
import requests
from bs4 import BeautifulSoup
import re
from datetime import datetime

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query_components = urllib.parse.parse_qs(parsed_path.query)
        url = query_components.get('url', [None])[0]
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if not url:
            self.wfile.write(json.dumps({"error": "URL is required"}).encode('utf-8'))
            return

        try:
            if 'jra.jp' in url or 'jra.go.jp' in url:
                data = self.scrape_jra(url)
            else:
                data = self.scrape_netkeiba(url)
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except Exception as e:
            self.wfile.write(json.dumps({"error": "Scraping failed: " + str(e)}).encode('utf-8'))
        return

    def scrape_jra(self, url):
        # SP版に正規化 (PC版 www.jra.go.jp は403を返すため)
        url = url.replace('www.jra.go.jp', 'sp.jra.jp').replace('http://', 'https://')
        if 'sp.jra.jp' not in url:
            url = re.sub(r'https?://[^/]*jra[^/]*/', 'https://sp.jra.jp/', url)

        headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"}
        res = requests.get(url, headers=headers, timeout=15)
        text = res.content.decode('cp932', errors='replace')
        soup = BeautifulSoup(text, 'html.parser')

        # 1. レース名
        race_name_el = soup.find('span', class_='race_name')
        race_name = race_name_el.get_text().strip() if race_name_el else ""

        # 2. 日付 + 会場 (div.cell.date = "2026年6月27日（土曜） 2回福島1日")
        date_info = ""
        venue = ""
        date_cell = soup.find('div', class_='cell')
        for div in soup.find_all('div', class_='cell'):
            t = div.get_text().strip()
            dm = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', t)
            if dm:
                date_info = f"{dm.group(1)}-{dm.group(2).zfill(2)}-{dm.group(3).zfill(2)}"
                vm = re.search(r'\d+回(\S+)\d+日', t)
                if vm:
                    venue = vm.group(1)
                break

        if not date_info:
            date_info = datetime.now().strftime("%Y-%m-%d")

        # 3. コース情報 (div.cell.course = "コース：1,800 メートル （芝・右）")
        course_info = ""
        course_cell = soup.find('div', class_='course')
        if not course_cell:
            for div in soup.find_all('div'):
                if 'コース' in (div.get_text() or '') and 'メートル' in (div.get_text() or ''):
                    course_cell = div
                    break
        if course_cell:
            ct = re.sub(r'\s+', ' ', course_cell.get_text(separator=' ')).strip()
            ct = ct.replace('コース：', '').replace('コース ：', '').strip()
            dist_m = re.search(r'([\d,]+)\s*メートル', ct)
            detail_m = re.search(r'[（(]([^）)]+)[）)]', ct)
            if dist_m and detail_m:
                dist = dist_m.group(1).replace(',', '')
                course_info = f"{dist}m {detail_m.group(1)}"
            elif dist_m:
                course_info = f"{dist_m.group(1).replace(',', '')}m"
            else:
                course_info = ct

        # 4. レース番号 (div.btn_race_select = "2回福島1日 7R")
        race_num = ""
        race_sel = soup.find('div', class_='btn_race_select')
        if race_sel:
            nm = re.search(r'(\d+)R', race_sel.get_text())
            if nm:
                race_num = nm.group(1) + "R"

        # 5. グレード (レース条件ブロックのみ探索。ナビメニューの「GⅠ」を拾わないようにする)
        grade_info = ""
        grade_pattern = r'(GⅠ|GⅡ|GⅢ|G[1-3]|Jpn[1-3]|Jpn[ⅠⅡⅢ]|(?<![a-zA-Z])L(?![a-zA-Z])|OP|オープン|[1-3]勝クラス|[1-3]勝ク(?!ラス)|未勝利|新馬)'
        # 探索対象: レース名 → h2 → div.type(条件ブロック) → div.cell(class属性)
        type_div = soup.find('div', class_='type')
        class_cell = soup.find('div', class_='cell')
        search_sources = [
            race_name,
            soup.find('h2').get_text() if soup.find('h2') else "",
            type_div.get_text() if type_div else "",
        ]
        # div.cell の中に「勝クラス」等を含むものを探す
        for div in soup.find_all('div', class_='cell'):
            ct = div.get_text().strip()
            if re.search(r'(勝クラス|勝ク|OP|オープン|新馬|未勝利)', ct):
                search_sources.append(ct)
                break
        for search_text in search_sources:
            grade_match = re.search(grade_pattern, search_text, re.IGNORECASE)
            if grade_match:
                grade_info = grade_match.group(1)
                grade_info = grade_info.replace('Ⅰ', '1').replace('Ⅱ', '2').replace('Ⅲ', '3').replace('オープン', 'OP')
                if grade_info.endswith('勝ク'):
                    grade_info = grade_info + 'ラス'
                if grade_info not in ('OP', 'L') and not grade_info[0].isdigit():
                    grade_info = grade_info.upper()
                break
        if not grade_info:
            grade_info = "一般"

        # 6. 馬リスト (Table: class=s_table, narrow-xyなし = モバイル用簡易テーブル)
        #    Col0: div.num=馬番, div.horse=馬名
        #    Col1: div.odds=オッズ
        horses = []
        seen_umaban = set()

        tbl = None
        for t in soup.find_all('table', class_='s_table'):
            if 'narrow-xy' not in (t.get('class') or []):
                tbl = t
                break

        if tbl:
            for row in tbl.find_all('tr')[1:]:
                cols = row.find_all('td')
                if len(cols) < 2:
                    continue
                try:
                    num_div = cols[0].find('div', class_='num')
                    horse_div = cols[0].find('div', class_='horse')
                    odds_div = cols[1].find('div', class_='odds')

                    if not num_div:
                        continue
                    umaban_txt = re.sub(r'\D', '', num_div.get_text().strip())
                    if not umaban_txt:
                        continue
                    umaban = int(umaban_txt)
                    name = horse_div.get_text().strip() if horse_div else "不明"

                    odds = 0.0
                    if odds_div:
                        odds_txt = odds_div.get_text().strip().replace(',', '')
                        try:
                            odds = float(odds_txt)
                        except ValueError:
                            odds = 0.0

                    if umaban in seen_umaban:
                        continue
                    seen_umaban.add(umaban)
                    horses.append({
                        "umaban": umaban, "name": name, "horse_id": "",
                        "odds": odds, "popular": "", "rank": "B",
                        "placing": "", "audit": "-"
                    })
                except Exception:
                    pass

        # ページがレースページでない場合(JRAトップに飛ばされた等)
        if not horses and not race_name:
            return {
                "error": "JRAの出馬表が見つかりませんでした。URLを確認してください。",
                "race_name": "", "venue": "", "race_num": "",
                "course_info": "", "grade_info": "", "date_info": date_info,
                "horses": [], "payouts": {}, "odds_unavailable": True
            }

        # フォールバック: s_tableが空なら narrow-xy s_table (Table 3) を試行
        if not horses:
            for t in soup.find_all('table', class_='s_table'):
                if 'narrow-xy' in (t.get('class') or []):
                    tbl = t
                    break
            if tbl:
                for row in tbl.find_all('tr')[1:]:
                    cols = row.find_all('td')
                    if len(cols) < 4:
                        continue
                    try:
                        umaban = int(re.sub(r'\D', '', cols[1].get_text().strip()))
                        name_raw = cols[2].get_text(separator='|').strip()
                        name = name_raw.split('|')[0].strip()

                        odds_raw = cols[3].get_text().strip()
                        odds_m = re.search(r'[\d.]+', odds_raw.replace(',', ''))
                        odds = float(odds_m.group(0)) if odds_m else 0.0

                        pop = ""
                        pop_m = re.search(r'[(（](\d+)\s*番人気', odds_raw)
                        if pop_m:
                            pop = pop_m.group(1)

                        if umaban in seen_umaban:
                            continue
                        seen_umaban.add(umaban)
                        horses.append({
                            "umaban": umaban, "name": name, "horse_id": "",
                            "odds": odds, "popular": pop, "rank": "B",
                            "placing": "", "audit": "-"
                        })
                    except Exception:
                        pass

        # 7. 近走監査 (D評価1.0秒ルール)
        #    Table 3 (narrow-xy s_table) の過去レース列から
        #    同クラス＆着差≤1.0秒のレースがあれば passedStrikerValidation=True
        JRA_TRACKS = {"札幌", "函館", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"}

        def normalize_class(c):
            c = re.sub(r'^[牝牡]', '', c.strip())
            c = re.sub(r'勝クラス|勝ク', '勝', c)
            return c

        current_cls_norm = normalize_class(grade_info) if grade_info else ""
        detail_tbl = None
        for t in soup.find_all('table', class_='s_table'):
            if 'narrow-xy' in (t.get('class') or []):
                detail_tbl = t
                break

        if detail_tbl and current_cls_norm:
            for row in detail_tbl.find_all('tr')[1:]:
                cols = row.find_all('td')
                if len(cols) < 6:
                    continue
                try:
                    umaban = int(re.sub(r'\D', '', cols[1].get_text().strip()))
                except (ValueError, IndexError):
                    continue

                horse = next((h for h in horses if h['umaban'] == umaban), None)
                if not horse:
                    continue

                passed = False
                # 過去レース列: cols[6]〜cols[9] (前走〜4走前、最大5走だがJRAは4走まで)
                for ci in range(6, min(10, len(cols))):
                    col = cols[ci]
                    time_span = col.find('span', class_='time')
                    if not time_span:
                        continue

                    rc_div = col.find('div', class_='rc')
                    rc_text = rc_div.get_text().strip() if rc_div else ""
                    if not any(t in rc_text for t in JRA_TRACKS):
                        continue

                    past_cls_raw = ""
                    r_class_div = col.find('div', class_='r_class')
                    if r_class_div and r_class_div.get_text().strip():
                        past_cls_raw = r_class_div.get_text().strip()
                    else:
                        race_line_div = col.find('div', class_='race_line')
                        if race_line_div:
                            rl_match = re.search(r'([1-3]勝ク(?:ラス)?|未勝利|新馬|OP|オープン|GⅠ|GⅡ|GⅢ|G[1-3])', race_line_div.get_text())
                            if rl_match:
                                past_cls_raw = rl_match.group(1)

                    if not past_cls_raw:
                        continue
                    if normalize_class(past_cls_raw) != current_cls_norm:
                        continue

                    margin_m = re.search(r'[(（]([\d.]+)[)）]', time_span.get_text())
                    if margin_m:
                        margin = float(margin_m.group(1))
                        if margin <= 1.0:
                            passed = True
                            break

                horse['passedStrikerValidation'] = passed

        return {
            "race_name": race_name, "venue": venue, "race_num": race_num,
            "course_info": course_info, "grade_info": grade_info,
            "date_info": date_info,
            "horses": sorted(horses, key=lambda x: x["umaban"]),
            "payouts": {},
            "odds_unavailable": not any(h["odds"] > 0 for h in horses)
        }

    def scrape_netkeiba(self, url):
        # 1. URLの正規化 (スマホ版をPC版に強制変換)
        match = re.search(r'race_id=(\d+)', url)
        race_id = match.group(1) if match else None
        is_result = 'result.html' in url or 'pid=race_result' in url
        
        if race_id:
            page_type = 'result' if is_result else 'shutuba'
            url = f"https://race.netkeiba.com/race/{page_type}.html?race_id={race_id}"

        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        res = requests.get(url, headers=headers)
        # netkeibaはページ・時期によりUTF-8/EUC-JPが混在するため、エンコーディングを
        # ハードコードせずバイト列から自動判定する（UTF-8移行による文字化け対策）
        res.encoding = res.apparent_encoding or res.encoding
        soup = BeautifulSoup(res.text, 'html.parser')

        # 2. メタ情報の抽出
        name_elem = soup.select_one(".RaceName") or soup.select_one(".Race_Name") or soup.select_one("h1.RaceName")
        race_name = name_elem.get_text().strip() if name_elem else ""

        # ---- 日付の確実な取得 ----
        date_info = ""
        if soup.title:
            title_text = soup.title.get_text()
            date_match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', title_text)
            if date_match:
                date_info = f"{date_match.group(1)}-{date_match.group(2).zfill(2)}-{date_match.group(3).zfill(2)}"
        
        if not date_info:
            date_info = datetime.now().strftime("%Y-%m-%d")
        # ------------------------

        course_elem = soup.select_one(".RaceData01") or soup.select_one(".Race_Name_Box")
        course_info = ""
        if course_elem:
            t = course_elem.get_text(separator=' ').strip()
            t = re.sub(r'\s+', ' ', t)
            course_info = re.sub(r'^[0-9]+:[0-9]+\s*発走\s*/\s*', '', t).split('特集')[0].strip()

        grade_info = ""
        # 1. 優先アプローチ: <title>タグから抽出 (SEOフォーマットのため最も信頼性が高い)
        if soup.title and soup.title.string:
            title_text = soup.title.string
            # ローマ数字（Ⅰ, Ⅱ, Ⅲ）および単独のL（境界チェック付）に対応した正規表現
            grade_match = re.search(r'(G[1-3]|G[ⅠⅡⅢ]|Jpn[1-3]|Jpn[ⅠⅡⅢ]|(?<![a-zA-Z])L(?![a-zA-Z])|OP|オープン|[1-3]勝クラス|未勝利|新馬)', title_text, re.IGNORECASE)
            if grade_match:
                grade_info = grade_match.group(1).upper()
                # ローマ数字をアラビア数字に変換
                grade_info = grade_info.replace('Ⅰ', '1').replace('Ⅱ', '2').replace('Ⅲ', '3').replace('オープン', 'OP')
        
        # 2. セカンドアプローチ: タイトルにない場合のみ、特定の詳細ブロックを検索
        if not grade_info:
            race_data_block = soup.find('div', class_='RaceData01') or soup.find('div', class_='RaceList_Item02')
            if race_data_block:
                block_text = race_data_block.get_text()
                # 単独のL（境界チェック付）にも対応した正規表現
                grade_match = re.search(r'(G[1-3]|G[ⅠⅡⅢ]|Jpn[1-3]|Jpn[ⅠⅡⅢ]|(?<![a-zA-Z])L(?![a-zA-Z])|OP|オープン|[1-3]勝クラス|未勝利|新馬)', block_text, re.IGNORECASE)
                if grade_match:
                    grade_info = grade_match.group(1).upper()
                    grade_info = grade_info.replace('Ⅰ', '1').replace('Ⅱ', '2').replace('Ⅲ', '3').replace('オープン', 'OP')
        
        if not grade_info:
            grade_info = "一般"

        # 3. 馬リストの抽出
        horses = []
        seen_umaban = set()

        if is_result:
            table = soup.select_one(".ResultTable") or soup.select_one("table[summary='全着順']")
            if table:
                # 1. ヘッダーから列のインデックスを動的に取得
                header_elems = table.select("th")
                headers = [th.get_text().strip() for th in header_elems]
                umaban_idx = 2
                pop_idx = 9
                odds_idx = 10
                
                for i, h in enumerate(headers):
                    if '馬番' in h: umaban_idx = i
                    elif '人気' in h: pop_idx = i
                    elif '単勝' in h: odds_idx = i

                # 2. 取得したインデックスを使って安全にデータを抽出
                for row in table.select("tr"):
                    cols = row.select("td")
                    if len(cols) <= max(umaban_idx, pop_idx, odds_idx): continue
                    try:
                        umaban_txt = cols[umaban_idx].get_text().strip()
                        umaban = int(re.sub(r'\D', '', umaban_txt))
                        
                        name_a = row.select_one("a[href*='/horse/']")
                        name = name_a.get_text().strip().replace('\n', ' ') if name_a else "不明"
                        hid = re.search(r'/horse/(\d+)', name_a['href']).group(1) if name_a else "不明"
                        
                        # 改行をスペースに置換してCSV破壊を防ぐ
                        pop = cols[pop_idx].get_text().strip().replace('\n', ' ')
                        odds_txt = cols[odds_idx].get_text().strip().replace(',', '').replace('---.-', '0.0').replace('\n', ' ')
                        
                        try:
                            odds = float(odds_txt)
                        except ValueError:
                            odds = 0.0

                        if umaban in seen_umaban: continue
                        seen_umaban.add(umaban)
                        horses.append({
                            "umaban": umaban, "name": name, "horse_id": hid, 
                            "odds": odds, "popular": pop, "rank": "B", 
                            "placing": cols[0].get_text().strip().replace('\n', ' '), "audit": "-"
                        })
                    except Exception as e:
                        pass
        else:
            for row in soup.select(".HorseList"):
                try:
                    num_e = row.select_one("td[class^='Umaban']") or row.select_one(".Umaban") or row.select_one(".Horse_Num")
                    if not num_e: continue
                    umaban = int(re.sub(r'\D', '', num_e.get_text().strip()))
                    name_a = row.select_one(".HorseName a") or row.select_one("a[href*='/horse/']")
                    name = name_a.get_text().strip()
                    hid = re.search(r'/horse/(\d+)', name_a['href']).group(1)
                    odds_e = row.select_one(".Odds") or row.select_one("td.Txt_R")
                    odds = float(odds_e.get_text().strip().replace('---.-', '0.0')) if odds_e else 0.0
                    
                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)
                    horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": "", "rank": "B", "placing": "", "audit": "-"})
                except: pass

        # 4. 近走監査はアプリ側の手動チェック（passedStrikerValidation）で行うため、
        #    サーバー側の自動監査（馬1頭ごとのnetkeiba直列アクセス）は廃止。
        #    "audit" 列は各馬のデフォルト値 "-" のまま返す。

        # 5. 払戻金の取得
        payouts = {}
        for tbl in (soup.select('.Payout_Detail_Table') or soup.select('.Payout_Table')):
            for tr in tbl.select('tr'):
                th = tr.select_one('th')
                if not th: continue
                tn = th.get_text().strip()
                tds = tr.select('td')
                if len(tds) >= 2:
                    # 組み合わせの抽出 (tds[0])
                    raw_nums = re.findall(r'\b\d+\b', tds[0].get_text(separator=' '))
                    nums = [n for n in raw_nums if n.isdigit()]
                    
                    # 金額の抽出 (tds[1])
                    payout_html = str(tds[1])
                    payout_html = re.sub(r'<br\s*/?>', '|', payout_html)
                    payout_soup = BeautifulSoup(payout_html, 'html.parser')
                    payout_text = payout_soup.get_text(separator='|')
                    amounts = []
                    for x in payout_text.split('|'):
                        clean_str = re.sub(r'[^\d]', '', x)
                        if clean_str:
                            amounts.append(int(clean_str))
                            
                    # ペアの作成（金額の件数で馬番を分割・ハイフン結合）
                    pairs = []
                    if amounts and nums:
                        chunk_size = len(nums) // len(amounts)
                        if chunk_size > 0:
                            for i in range(len(amounts)):
                                combo = "-".join(nums[i * chunk_size : (i + 1) * chunk_size])
                                pairs.append({"combo": combo, "amount": amounts[i]})
                    
                    # 万が一パースできなかった場合のフォールバック
                    if not pairs and len(tds) >= 2:
                         fallback_val = tds[1].get_text(separator=' ').strip().replace('\n', ' ')
                         # 文字列のままでは不整合なので、数値だけ抽出しておく（将来の互換性のため）
                         fallback_num = int(re.sub(r'[^\d]', '', fallback_val)) if re.sub(r'[^\d]', '', fallback_val) else 0
                         pairs = [{"combo": "-", "amount": fallback_num}]

                    if '単勝' in tn: payouts['単勝'] = pairs
                    elif 'ワイド' in tn: payouts['ワイド'] = pairs
                    elif '馬連' in tn: payouts['馬連'] = pairs
                    elif '3連複' in tn or '３連複' in tn: payouts['3連複'] = pairs
                    elif '3連単' in tn or '３連単' in tn: payouts['3連単'] = pairs

        return {
            "race_name": race_name, "venue": "", "race_num": "",
            "course_info": course_info, "grade_info": grade_info, 
            "date_info": date_info,
            "horses": sorted(horses, key=lambda x: x["umaban"]), 
            "payouts": payouts,
            "odds_unavailable": not any(h["odds"] > 0 for h in horses)
        }
