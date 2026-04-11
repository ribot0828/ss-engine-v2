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
                        except: pass
                return odds_map
        except: pass
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
            rows = soup.select(".RaceHorseList li") or soup.select(".Odds_Table tr")
            for row in rows:
                num_elem = row.select_one(".Horse_Num") or row.select_one(".Umaban")
                odds_elem = row.select_one(".Odds_Win") or row.select_one(".Odds")
                pop_elem = row.select_one(".Popular")
                if num_elem and odds_elem:
                    try:
                        num = int(re.sub(r'\D', '', num_elem.get_text().strip()))
                        odds_txt = odds_elem.get_text().strip().replace('---.-', '0.0')
                        odds = float(odds_txt) if odds_txt else 0.0
                        pop = pop_elem.get_text().strip() if pop_elem else ""
                        odds_map[num] = {"odds": odds, "popular": pop}
                    except: pass
            return odds_map
        except: return {}

    def audit_horse_history(self, horse_id, current_grade):
        """馬の過去5走を調べ、同一グレードで1.0秒差以内の実績があるか判定"""
        if not horse_id or horse_id == "不明":
            return "-"
        
        url = f"https://db.netkeiba.com/horse/{horse_id}/"
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://db.netkeiba.com/"
            }
            res = requests.get(url, headers=headers, timeout=5)
            res.encoding = 'euc-jp'
            soup = BeautifulSoup(res.text, 'html.parser')
            
            table = soup.select_one('table.db_h_race_results') or soup.select_one('.db_h_race_results')
            if not table:
                return "NG (データ無)"
            
            rows = table.select('tbody tr')
            checked_count = 0
            for row in rows:
                if checked_count >= 5: break
                cols = row.select('td')
                if len(cols) < 19: continue
                
                race_name = cols[4].get_text().strip()
                rank = cols[11].get_text().strip()
                diff = cols[18].get_text().strip()
                
                is_same_grade = current_grade in race_name or (current_grade == "OP" and "オープン" in race_name)
                
                # Gレースの判定
                if not is_same_grade and ('G1' in current_grade or 'G2' in current_grade or 'G3' in current_grade):
                    g_match = re.search(r'G[1-3]', race_name)
                    if g_match and g_match.group(0) in current_grade:
                        is_same_grade = True

                if is_same_grade:
                    checked_count += 1
                    try:
                        val = diff.replace('+', '').replace('-', '')
                        time_diff = float(val)
                        if time_diff <= 1.0: return "合格"
                    except:
                        if rank == "1" or not diff or diff.startswith('-'): return "合格"
            
            return "不合格"
        except: return "エラー"

    def scrape_netkeiba(self, url):
        # 1. URLの正規化
        match = re.search(r'race_id=(\d+)', url)
        race_id = match.group(1) if match else None
        
        is_result_page = 'result.html' in url
        is_odds_view = 'pid=odds_view' in url

        # ヘッダーの設定
        if 'sp.netkeiba.com' in url or is_odds_view:
            headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"}
        else:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

        res = requests.get(url, headers=headers)
        res.encoding = 'euc-jp' 
        soup = BeautifulSoup(res.text, 'html.parser')

        # 2. メタデータの抽出 (統合ロジック)
        # レース名
        name_elem = (soup.select_one("h1.RaceName") or soup.select_one("h1.Race_Name") or 
                     soup.select_one(".RaceName") or soup.select_one(".Race_Name") or 
                     soup.select_one(".RaceTitle"))
        race_name = name_elem.get_text().strip() if name_elem else ""
        if (not race_name or race_name == "netkeiba") and soup.title:
            title_text = soup.title.text
            name_match = re.split(r' (オッズ|出馬表|結果|レース情報)', title_text)
            if name_match: race_name = name_match[0].strip()

        # レース番号
        num_elem = soup.select_one(".RaceNum") or soup.select_one(".Race_Num")
        race_num = num_elem.get_text().strip() if num_elem else ""

        # 開催場
        venue = ""
        venue_elem = (soup.select_one(".RaceList_DateList .Active") or 
                      soup.select_one(".RaceList_DateList .Active a") or
                      soup.select_one(".Race_Date a") or 
                      soup.select_one(".Race_Date"))
        if venue_elem:
            venue_text = venue_elem.get_text().strip()
            v_match = re.search(r'([^\d\(\)\s/]+)$', venue_text)
            if v_match: venue = v_match.group(1)
        
        if not venue and race_id:
            venue_code = race_id[4:6]
            jra_venues = {"01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京","06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉"}
            venue = jra_venues.get(venue_code, "")

        # コース情報
        course_elem = soup.select_one(".RaceData01") or soup.select_one(".Race_Name_Box") or soup.select_one(".Race_Data")
        if course_elem:
            course_text = course_elem.get_text(separator=' ').strip()
            course_text = re.sub(r'\s+', ' ', course_text)
            course_info = re.sub(r'^[0-9]+:[0-9]+\s*発走\s*/\s*', '', course_text)
            course_info = course_info.split('特集')[0].split('データベース')[0].strip()
        else:
            course_info = ""
        
        # グレード情報
        grade_elem = soup.select_one(".RaceData02") or soup.select_one(".Grade")
        raw_grade = grade_elem.get_text().strip() if grade_elem else ""
        grade_info = "不明"
        grade_match = re.search(r'(オープン|3勝クラス|2勝クラス|1勝クラス|新馬|未勝利|OP|G[1-3]|GⅠ|GⅡ|GⅢ|Jpn[1-3])', raw_grade + race_name + course_info)
        if grade_match:
            grade_info = grade_match.group(1)
        head_match = re.search(r'([0-9]+頭)', raw_grade + course_info)
        if head_match:
            grade_info += f" {head_match.group(1)}"

        date_elem = soup.select_one(".RaceList_DateBox .Active") or soup.select_one("#RaceList_DateList .Active")
        date_info = date_elem.get_text().strip() if date_elem else ""

        # 3. 馬リストの抽出 (統合・安定版)
        horses = []
        seen_umaban = set()
        
        # セレクターを統合
        rows = soup.select(".HorseList") or soup.select(".RaceHorseList li") or soup.select(".Odds_Table tr")
        
        for i, row in enumerate(rows):
            try:
                # 馬の行であることを確認（リンクの有無など）
                horse_link = row.select_one("a[href*='/horse/']")
                if not horse_link and not is_result_page and not is_odds_view: continue

                # 馬名
                if is_odds_view:
                    name_elem = row.select_one(".Horse_Name") or row.select_one("dt") or row.select_one("td.Horse_Name")
                    horse_name = name_elem.get_text().strip() if name_elem else ""
                else:
                    name_a = row.select_one("dt.Horse a") or row.select_one(".HorseName a") or row.select_one("a[href*='/horse/']")
                    if name_a:
                        horse_name = name_a.get_text().strip()
                    else:
                        name_elem = row.select_one(".HorseName") or row.select_one(".Horse_Info")
                        horse_name = name_elem.get_text().strip().split('\n')[0].strip() if name_elem else ""
                
                if not horse_name or "データがありません" in horse_name or horse_name == "netkeiba": continue

                # 馬番号
                umaban_elem = row.select_one(".Horse_Num") or row.select_one(".Umaban") or row.select_one("td.Num")
                try:
                    umaban_text = umaban_elem.get_text().strip() if umaban_elem else ""
                    umaban = int(re.sub(r'\D', '', umaban_text)) if any(d.isdigit() for d in umaban_text) else i + 1
                except: umaban = i + 1

                # 馬ID
                horse_id = "不明"
                if horse_link:
                    id_match = re.search(r'/horse/(\d+)', horse_link['href'])
                    if id_match: horse_id = id_match.group(1)

                # オッズ・人気
                if is_result_page:
                    rank_elem = row.select_one(".Result_Num") or row.select_one(".Rank")
                    placing = rank_elem.get_text().strip() if rank_elem else ""
                    odds_tds = row.select("td[class*='Odds']")
                    if len(odds_tds) >= 2:
                        popular = odds_tds[0].get_text().strip()
                        odds_text = odds_tds[1].get_text().strip()
                    else:
                        odds_elem = row.select_one(".Odds")
                        odds_text = odds_elem.get_text().strip() if odds_elem else "0.0"
                        popular = ""
                else:
                    placing = ""
                    pop_elem = row.select_one(".Popular") or row.select_one("td.Popular")
                    popular = pop_elem.get_text().strip() if pop_elem else ""
                    odds_elem = row.select_one(".Odds_Win") or row.select_one(".Odds") or row.select_one("td.Txt_R")
                    odds_text = odds_elem.get_text().strip() if odds_elem else "0.0"

                try:
                    odds = float(odds_text.replace('---.-', '0.0'))
                except: odds = 0.0

                if umaban in seen_umaban: continue
                seen_umaban.add(umaban)

                horses.append({
                    "umaban": umaban, "name": horse_name, "horse_id": horse_id,
                    "odds": odds, "popular": popular, "rank": "B",
                    "placing": placing, "audit": "-"
                })
            except: pass

        # 4. オッズ補完
        if not is_result_page and race_id:
            has_valid_odds = any(h["odds"] > 0 for h in horses)
            if not has_valid_odds:
                odds_map = self.fetch_odds_api(race_id) or self.fetch_live_odds_sp(race_id)
                for h in horses:
                    api_data = odds_map.get(h["umaban"])
                    if api_data:
                        h["odds"] = api_data["odds"]
                        h["popular"] = api_data["popular"]
        
        # 5. 監査の実行
        clean_grade = grade_info.split(' ')[0]
        for h in horses:
            h["audit"] = self.audit_horse_history(h["horse_id"], clean_grade)

        # 6. 払戻金
        payouts = {}
        for tbl in soup.select('.Payout_Detail_Table'):
            for tr in tbl.select('tr'):
                th = tr.select_one('th')
                if not th: continue
                type_name = th.get_text().strip()
                if type_name in ['単勝', 'ワイド', '3連複']:
                    tds = tr.select('td')
                    if len(tds) >= 2:
                        payouts[type_name] = tds[1].get_text().strip().replace('\n', ' ')

        # 7. 全データの返却 (不足していた項目をすべて復旧)
        return {
            "race_name": race_name,
            "venue": venue,
            "race_num": race_num,
            "course_info": course_info,
            "grade_info": grade_info,
            "date_info": date_info,
            "horses": sorted(horses, key=lambda x: x["umaban"]),
            "payouts": payouts,
            "odds_unavailable": not any(h["odds"] > 0 for h in horses)
        }
