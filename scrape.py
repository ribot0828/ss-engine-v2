from http.server import BaseHTTPRequestHandler
import urllib.parse
import json
import requests
from bs4 import BeautifulSoup
import re

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
            data = self.scrape_netkeiba(url)
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except Exception as e:
            self.wfile.write(json.dumps({"error": "Scraping failed: " + str(e)}).encode('utf-8'))
        return

    def fetch_odds_api(self, race_id):
        """netkeiba Odds APIから単勝オッズと人気を取得"""
        api_url = f"https://race.netkeiba.com/api/api_get_jra_odds.html?race_id={race_id}&type=1"
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            res = requests.get(api_url, headers=headers, timeout=5)
            data = res.json()
            if data.get("status") in ["result", "middle_now"] and data.get("data") and data["data"].get("odds"):
                odds_map = {}
                for bracket, horses in data["data"]["odds"].items():
                    for umaban_str, vals in horses.items():
                        try:
                            umaban = int(umaban_str)
                            odds = float(vals[0]) if vals[0] else 0.0
                            popular = vals[2] if len(vals) > 2 else ""
                            odds_map[umaban] = {"odds": odds, "popular": str(popular)}
                        except (ValueError, IndexError):
                            pass
                return odds_map
        except Exception:
            pass
        return {}

    def fetch_live_odds_sp(self, race_id):
        """スマホ版オッズ画面からオッズを取得（APIが空の場合のバックアップ）"""
        url = f"https://race.sp.netkeiba.com/?pid=odds_view&type=b1&race_id={race_id}"
        try:
            headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"}
            res = requests.get(url, headers=headers, timeout=5)
            res.encoding = 'euc-jp'
            soup = BeautifulSoup(res.text, 'html.parser')
            odds_map = {}
            # スマホ版のオッズリストを選択
            rows = soup.select(".RaceHorseList li")
            for row in rows:
                num_elem = row.select_one(".Horse_Num")
                odds_elem = row.select_one(".Odds_Win")
                pop_elem = row.select_one(".Popular")
                if num_elem and odds_elem:
                    try:
                        num = int(num_elem.text.strip())
                        odds_txt = odds_elem.text.strip().replace('---.-', '0.0')
                        odds = float(odds_txt) if odds_txt else 0.0
                        pop = pop_elem.text.strip() if pop_elem else ""
                        odds_map[num] = {"odds": odds, "popular": pop}
                    except:
                        pass
            return odds_map
        except Exception:
            return {}

    def audit_horse_history(self, horse_id, current_grade):
        """馬の過去5走を調べ、同一グレードで1.0秒差以内の実績があるか判定"""
        if not horse_id or horse_id == "不明":
            return "-"
        
        url = f"https://db.netkeiba.com/horse/{horse_id}/"
        try:
            # 取得確率を上げるための強力なヘッダー
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
                "Referer": "https://db.netkeiba.com/"
            }
            res = requests.get(url, headers=headers, timeout=5)
            res.encoding = 'euc-jp'
            soup = BeautifulSoup(res.text, 'html.parser')
            
            table = soup.select_one('table.db_h_race_results')
            if not table:
                # 代替セレクター
                table = soup.select_one('.db_h_race_results') or soup.find('table', class_=re.compile(r'db_h_race_results'))
            
            if not table:
                return "NG (データ無)"
            
            rows = table.select('tbody tr')
            # 過去5走をチェック
            checked_count = 0
            for row in rows:
                if checked_count >= 5: break
                cols = row.select('td')
                if len(cols) < 19: continue # 着差は18番目なので少なくとも19列必要
                
                race_name = cols[4].text.strip()
                rank = cols[11].text.strip()
                diff = cols[18].text.strip() # 着差 (0-indexで18列目)
                
                # グレード判定（簡易的なマッチング）
                # '1勝クラス' などが race_name 内に含まれるか
                is_same_grade = current_grade in race_name or (current_grade == "OP" and "オープン" in race_name)
                
                # Gレースの正規化 (G1/G2/G3)
                if not is_same_grade and ('G1' in current_grade or 'G2' in current_grade or 'G3' in current_grade):
                    g_match = re.search(r'G[1-3]', race_name)
                    if g_match and g_match.group(0) in current_grade:
                        is_same_grade = True

                if is_same_grade:
                    checked_count += 1
                    try:
                        # 着差が数値の場合
                        val = diff.replace('+', '').replace('-', '')
                        time_diff = float(val)
                        if time_diff <= 1.0:
                            return "合格"
                    except ValueError:
                        # 1着などの場合
                        if rank == "1" or not diff or diff.startswith('-'):
                            return "合格"
            
            return "不合格"
        except Exception as e:
            return f"エラー: {str(e)[:10]}"

    def scrape_netkeiba(self, url):
        # URLの正規化とタイプ判別
        match = re.search(r'race_id=(\d+)', url)
        race_id = None
        if match:
            race_id = match.group(1)
        
        is_result_page = 'result.html' in url
        is_odds_view = 'pid=odds_view' in url

        # ヘッダーの設定（モバイル版URLの場合はiPhoneを模倣）
        if 'sp.netkeiba.com' in url or is_odds_view:
            headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"}
        else:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

        res = requests.get(url, headers=headers)
        res.encoding = 'euc-jp' 
        soup = BeautifulSoup(res.text, 'html.parser')

        # 1. メタデータの抽出
        if is_odds_view:
            # オッズ画面専用のメタ抽出（クラス名の表記ゆれに対応）
            race_name_elem = soup.select_one("h1.Race_Name") or soup.select_one("h1.RaceName") or soup.select_one(".Race_Name") or soup.select_one(".RaceName")
            race_name = race_name_elem.text.strip() if race_name_elem else ""
            
            # レース名が取れない場合のタイトル補完
            if not race_name and soup.title:
                title_parts = soup.title.text.split(' オッズ')
                if title_parts: race_name = title_parts[0].strip()

            race_num_elem = soup.select_one(".RaceNum") or soup.select_one(".Race_Num")
            race_num = race_num_elem.text.strip() if race_num_elem else ""

            venue = ""
            venue_elem = soup.select_one(".Race_Date a") or soup.select_one(".Race_Date") or soup.select_one(".Race_Name_Box .Date")
            if venue_elem:
                venue_text = venue_elem.get_text().strip()
                v_match = re.search(r'([^\d\(\)\s/]+)$', venue_text)
                if v_match: venue = v_match.group(1)
            
            # コース情報の抽出
            course_info_elem = soup.select_one(".RaceData01") or soup.select_one(".Race_Name_Box") or soup.select_one(".Race_Data")
            if course_info_elem:
                course_info = course_info_elem.get_text().strip().replace('\n', ' ')
                # 余分なテキスト（特集など）を除去
                course_info = course_info.split('特集')[0].split('データベース')[0].strip()
            else:
                course_info = ""
            
            grade_info = "不明"
            # レース名やコース情報からグレードを推測
            grade_match = re.search(r'(オープン|3勝クラス|2勝クラス|1勝クラス|新馬|未勝利|OP|G[1-3]|GⅠ|GⅡ|GⅢ)', race_name + course_info)
            if grade_match:
                grade_info = grade_match.group(1)
            
            date_info = "" 
        else:
            # 通常（出馬表/結果）のメタ抽出
            race_name_elem = soup.select_one(".RaceName")
            race_name = race_name_elem.text.strip() if race_name_elem else "不明なレース"

            race_num_elem = soup.select_one(".RaceNum") or soup.select_one(".Race_Num")
            race_num = race_num_elem.text.strip() if race_num_elem else ""

            venue = ""
            venue_elem = soup.select_one(".RaceList_DateList .Active") or soup.select_one(".Race_Date")
            if venue_elem:
                venue = venue_elem.get_text().strip()
                v_match = re.search(r'([^\d\(\)\s/]+)$', venue)
                if v_match: venue = v_match.group(1)
            
            course_info_elem = soup.select_one(".RaceData01")
            if course_info_elem:
                course_text = course_info_elem.text.strip().replace('\n', ' ')
                course_info = re.sub(r'^[0-9]+:[0-9]+\s*発走\s*/\s*', '', course_text)
            else:
                course_info = ""
            
            grade_elem = soup.select_one(".RaceData02")
            raw_grade = grade_elem.text.replace('\n', ' ').strip() if grade_elem else ""
            grade_info = "不明"
            if raw_grade:
                match_grade = re.search(r'(オープン|3勝クラス|2勝クラス|1勝クラス|新馬|未勝利|OP|G1|G2|G3|GⅠ|GⅡ|GⅢ|Jpn1|Jpn2|Jpn3)', raw_grade)
                if match_grade: grade_info = match_grade.group(1)
                
                grade_icon = soup.select_one('.Icon_GradeType') or soup.find(class_=lambda x: x and 'Icon_GradeType' in x)
                if grade_icon:
                    classes = grade_icon.get('class', [])
                    if 'Icon_GradeType1' in classes: grade_info = 'G1'
                    elif 'Icon_GradeType2' in classes: grade_info = 'G2'
                    elif 'Icon_GradeType3' in classes: grade_info = 'G3'
                
                match_head = re.search(r'([0-9]+頭)', raw_grade)
                if match_head: grade_info += f" {match_head.group(1)}"

            date_elem = soup.select_one(".RaceList_DateBox .Active") or soup.select_one("#RaceList_DateList .Active")
            date_info = date_elem.text.strip() if date_elem else ""

        if not venue and race_id:
            venue_code = race_id[4:6]
            jra_venues = {"01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京","06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉"}
            venue = jra_venues.get(venue_code, "")

        # 2. 馬リストの抽出
        horses = []
        seen_umaban = set()

        if is_odds_view:
            # オッズ画面構造
            rows = soup.select(".RaceHorseList li") or soup.select(".Odds_Table tr")
            for i, row in enumerate(rows):
                try:
                    num_elem = row.select_one(".Horse_Num") or row.select_one("td[class^='Waku']")
                    name_elem = row.select_one(".Horse_Name") or row.select_one("dt") or row.select_one("td.Horse_Name")
                    if not name_elem: continue
                    
                    # 馬名のみを取得
                    name = name_elem.get_text().strip()
                    if "データがありません" in name: continue

                    try:
                        umaban_text = num_elem.get_text().strip() if num_elem else ""
                        umaban = int(umaban_text) if umaban_text.isdigit() else i + 1
                    except:
                        umaban = i + 1
                    
                    odds_elem = row.select_one(".Odds_Win") or row.select_one(".Odds")
                    odds_txt = odds_elem.get_text().strip().replace('---.-', '0.0') if odds_elem else "0.0"
                    pop_elem = row.select_one(".Popular")
                    popular = pop_elem.get_text().strip() if pop_elem else ""

                    horse_id = "不明"
                    horse_link = name_elem.select_one("a") or row.select_one("a[href*='/horse/']")
                    if horse_link:
                        id_match = re.search(r'/horse/(\d+)', horse_link['href'])
                        if id_match: horse_id = id_match.group(1)

                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)

                    horses.append({
                        "umaban": umaban, "name": name, "horse_id": horse_id,
                        "odds": float(odds_txt or 0), "popular": popular,
                        "rank": "B", "placing": "", "audit": "-"
                    })
                except: pass
        else:
            # 通常（出馬表/結果）構造
            rows = soup.select(".HorseList")
            for i, row in enumerate(rows):
                try:
                    horse_link = row.select_one("a[href*='/horse/']")
                    if not horse_link and not is_result_page: continue

                    placing = ""
                    popular = ""
                    horse_id = "不明"
                    if horse_link:
                        id_match = re.search(r'/horse/(\d+)', horse_link['href'])
                        if id_match: horse_id = id_match.group(1)

                    if is_result_page:
                        # 結果ページ
                        rank_elem = row.select_one("td.Result_Num") or row.select_one("td[class*='Result_Num']") or row.select_one("td.Rank")
                        placing = rank_elem.text.strip() if rank_elem else ""
                        umaban_elem = row.select_one("td.Num.Txt_C") or row.select_one("td[class*='Num']")
                        if not umaban_elem: continue
                        try: umaban = int(umaban_elem.text.strip())
                        except ValueError: continue
                        horse_name_elem = row.select_one(".Horse_Info")
                        horse_name = horse_name_elem.text.strip() if horse_name_elem else "不明"
                        # 結果ページは通常馬名に年齢は混ざらない
                    else:
                        # 出馬表ページ
                        umaban_elem = row.select_one("td[class^='Umaban']") or row.select_one("td.Umaban")
                        if umaban_elem:
                            # PC版
                            try: umaban = int(umaban_elem.text.strip())
                            except ValueError: continue
                            horse_name_elem = row.select_one(".HorseName a") or row.select_one(".HorseName")
                            horse_name = horse_name_elem.text.strip() if horse_name_elem else "不明"
                        else:
                            # SP版
                            horse_info_td = row.select_one("td.Horse_Info") or row.select_one("td.HorseName")
                            if horse_info_td:
                                # 馬名だけを取得するために inner <a> などを優先
                                name_a = horse_info_td.select_one("dt.Horse a") or horse_info_td.select_one("a[href*='/horse/']")
                                if name_a:
                                    horse_name = name_a.get_text().strip()
                                else:
                                    # フォールバック
                                    horse_name = horse_info_td.get_text().strip().split('\n')[0].strip()
                                
                                umaban_txt = row.select_one(".Horse_Num") or row.select_one("td:nth-of-type(1)")
                                try: umaban = int(umaban_txt.text.strip())
                                except: umaban = i + 1
                            else: continue

                        opts = row.select("td.Popular") or row.select("td.Txt_C.Popular")
                        popular = opts[0].text.strip() if opts else ""
                        odds_elem = row.select_one("td.Txt_R span") or row.select_one("td.Popular span") or row.select_one("td.Odds span") or row.select_one("td.Txt_R.Popular")
                        odds_text = odds_elem.text.strip() if odds_elem else "0.0"
                    
                    try:
                        odds = float(odds_text.replace('---.-', '0.0'))
                    except ValueError: odds = 0.0

                    if popular in ['**', '---.-', '-', '']: popular = ''
                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)

                    horses.append({
                        "umaban": umaban, "name": horse_name, "horse_id": horse_id,
                        "odds": odds, "popular": popular, "rank": "B",
                        "placing": placing, "audit": "-"
                    })
                except Exception: pass

        # 3. オッズ補完（出馬表の場合のみ）
        if not is_result_page and not is_odds_view and race_id:
            has_valid_odds = any(h["odds"] > 0 for h in horses)
            if not has_valid_odds:
                odds_map = self.fetch_odds_api(race_id) or self.fetch_live_odds_sp(race_id)
                for h in horses:
                    api_data = odds_map.get(h["umaban"])
                    if api_data:
                        h["odds"] = api_data["odds"]
                        h["popular"] = api_data["popular"]
        
        # 4. 監査の実行
        clean_grade = grade_info.split(' ')[0]
        for h in horses:
            h["audit"] = self.audit_horse_history(h["horse_id"], clean_grade)

        payouts = {}
        for tbl in soup.select('.Payout_Detail_Table'):
            for tr in tbl.select('tr'):
                th = tr.select_one('th')
                if not th: continue
                type_name = th.text.strip()
                if type_name in ['単勝', 'ワイド', '3連複']:
                    tds = tr.select('td')
                    if len(tds) >= 2:
                        payouts[type_name] = tds[1].text.strip().replace('\n', ' ')

        return {
            "race_name": race_name,
            "venue": venue,
            "race_num": race_num,
            "course_info": course_info,
            "grade_info": grade_info,
            "date_info": date_info,
            "horses": horses,
            "payouts": payouts,
            "odds_unavailable": not any(h["odds"] > 0 for h in horses)
        }

