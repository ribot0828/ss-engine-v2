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
            data = self.scrape_netkeiba(url)
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except Exception as e:
            self.wfile.write(json.dumps({"error": "Scraping failed: " + str(e)}).encode('utf-8'))
        return

    def fetch_odds_api(self, race_id):
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
                        odds_map[num] = {"odds": float(odds_txt), "popular": pop_elem.get_text().strip() if pop_elem else ""}
                    except: pass
            return odds_map
        except: return {}

    def audit_horse_history(self, horse_id, current_grade):
        if not horse_id or horse_id == "不明": return "-"
        url = f"https://db.netkeiba.com/horse/{horse_id}/"
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            res = requests.get(url, headers=headers, timeout=5)
            res.encoding = 'euc-jp'
            soup = BeautifulSoup(res.text, 'html.parser')
            table = soup.select_one('table.db_h_race_results')
            if not table: return "NG (データ無)"
            rows = table.select('tbody tr')
            checked = 0
            for row in rows:
                if checked >= 5: break
                cols = row.select('td')
                if len(cols) < 19: continue
                race_name = cols[4].get_text().strip()
                rank = cols[11].get_text().strip()
                diff = cols[18].get_text().strip()
                is_same = current_grade in race_name or (current_grade == "OP" and "オープン" in race_name)
                if not is_same and 'G' in current_grade:
                    m = re.search(r'G[1-3]', race_name)
                    if m and m.group(0) in current_grade: is_same = True
                if is_same:
                    checked += 1
                    try:
                        val = float(diff.replace('+', '').replace('-', ''))
                        if val <= 1.0: return "合格"
                    except:
                        if rank == "1" or not diff or diff.startswith('-'): return "合格"
            return "不合格"
        except: return "エラー"

    def scrape_netkeiba(self, url):
        match = re.search(r'race_id=(\d+)', url)
        race_id = match.group(1) if match else None
        is_result = 'result.html' in url

        if 'sp.netkeiba.com' in url:
            headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"}
        else:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

        res = requests.get(url, headers=headers)
        res.encoding = 'euc-jp'
        soup = BeautifulSoup(res.text, 'html.parser')

        # 1. メタ情報の抽出
        # レース名
        name_elem = (soup.select_one(".RaceName") or soup.select_one(".Race_Name") or 
                          soup.select_one("h1.RaceName") or soup.select_one(".RaceTitle"))
        race_name = name_elem.get_text().strip() if name_elem else ""
        if (not race_name or race_name == "netkeiba") and soup.title:
            title = soup.title.text
            parts = re.split(r' (オッズ|出馬表|結果|レース情報)', title)
            if parts: race_name = parts[0].strip()

        # R数
        num_elem = soup.select_one(".RaceNum") or soup.select_one(".Race_Num")
        race_num = num_elem.get_text().strip() if num_elem else ""

        # 開催場
        venue = ""
        venue_elem = (soup.select_one(".RaceList_DateList .Active") or 
                      soup.select_one(".Race_Date a") or 
                      soup.select_one(".RaceList_DateList .Active a"))
        if venue_elem:
            venue_text = venue_elem.get_text().strip()
            v_match = re.search(r'([^\d\(\)\s/]+)$', venue_text)
            if v_match: venue = v_match.group(1)
        if not venue and race_id:
            vc = race_id[4:6]
            jra = {"01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京","06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉"}
            venue = jra.get(vc, "")

        # 日付の抽出 (CSV用)
        date_info = ""
        date_elem = soup.select_one(".RaceList_DateBox .Active") or soup.select_one("#RaceList_DateList .Active")
        if date_elem:
            date_info = date_elem.get_text().strip()
        if not date_info and race_id:
            year = race_id[:4]
            # IDから日付推測は難しいが、現在の表示情報から補完
            now = datetime.now()
            date_info = now.strftime("%Y-%m-%d")

        # コース詳細
        course_elem = soup.select_one(".RaceData01") or soup.select_one(".Race_Name_Box")
        course_info = ""
        if course_elem:
            t = course_elem.get_text(separator=' ').strip()
            t = re.sub(r'\s+', ' ', t)
            course_info = re.sub(r'^[0-9]+:[0-9]+\s*発走\s*/\s*', '', t).split('特集')[0].strip()

        # グレード・頭数 (統合)
        grade_info = "不明"
        grad_txt_elem = soup.select_one(".RaceData02") or soup.select_one(".Grade")
        rg_text = grad_txt_elem.get_text().strip() if grad_txt_elem else ""
        
        # アイコンからグレード取得
        grade_icon = soup.select_one('.Icon_GradeType') or soup.find(class_=lambda x: x and 'Icon_GradeType' in x)
        if grade_icon:
            grade_info = grade_icon.get_text().strip() # G1, G2, G3等
        else:
            gm = re.search(r'(オープン|3勝クラス|2勝クラス|1勝クラス|新馬|未勝利|OP|G[1-3]|GⅠ|GⅡ|GⅢ)', rg_text + race_name + course_info)
            if gm: grade_info = gm.group(1)
        
        # 頭数の追加
        head_match = re.search(r'([0-9]+頭)', rg_text + course_info)
        if head_match:
            grade_info += f" {head_match.group(1)}"

        # 2. 馬リストの抽出
        horses = []
        seen_umaban = set()

        if is_result:
            # 結果ページ (PC版)
            table = soup.select_one(".ResultTable")
            if table:
                rows = table.select("tr")
                for i, row in enumerate(rows):
                    cols = row.select("td")
                    if len(cols) < 10: continue
                    try:
                        placing = cols[0].text.strip()
                        umaban = int(cols[2].text.strip())
                        name_a = cols[3].select_one('a')
                        name = name_a.get_text().strip() if name_a else cols[3].text.strip()
                        hid = re.search(r'/horse/(\d+)', name_a['href']).group(1) if name_a else "不明"
                        pop = cols[9].text.strip()
                        odds_txt = cols[10].text.strip().replace('---.-', '0.0')
                        odds = float(odds_txt) if odds_txt else 0.0

                        if umaban in seen_umaban: continue
                        seen_umaban.add(umaban)
                        horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": pop, "rank": "B", "placing": placing, "audit": "-"})
                    except: pass
            else:
                # スマホ版結果ページ
                rows = soup.select(".HorseList")
                for i, row in enumerate(rows):
                    try:
                        rank_e = row.select_one(".Result_Num") or row.select_one(".Rank")
                        if not rank_e: continue
                        placing = rank_e.get_text().strip()
                        num_e = row.select_one(".Umaban") or row.select_one(".Num")
                        umaban = int(re.sub(r'\D', '', num_e.get_text().strip()))
                        name_a = row.select_one("a[href*='/horse/']")
                        name = name_a.get_text().strip() if name_a else "不明"
                        hid = re.search(r'/horse/(\d+)', name_a['href']).group(1) if name_a else "不明"
                        
                        # SP版結果オッズ (軽量版では取れない場合があるためAPI補完に回る)
                        horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": 0.0, "popular": "", "rank": "B", "placing": placing, "audit": "-"})
                    except: pass
        else:
            # 出馬表ページ
            rows = soup.select(".HorseList")
            for i, row in enumerate(rows):
                try:
                    name_a = row.select_one(".HorseName a") or row.select_one("dt.Horse a") or row.select_one("a[href*='/horse/']")
                    if not name_a: continue
                    name = name_a.get_text().strip()
                    hid = re.search(r'/horse/(\d+)', name_a['href']).group(1)
                    num_e = row.select_one("td[class^='Umaban']") or row.select_one(".Horse_Num") or row.select_one(".Umaban")
                    umaban = int(re.sub(r'\D', '', num_e.get_text().strip()))
                    pop_e = row.select_one("td.Popular") or row.select_one(".Popular")
                    pop = pop_e.get_text().strip() if pop_e else ""
                    odd_e = row.select_one("td.Txt_R span") or row.select_one(".Odds")
                    odds = float(odd_e.get_text().strip().replace('---.-', '0.0')) if odd_e else 0.0
                    
                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)
                    horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": pop, "rank": "B", "placing": "", "audit": "-"})
                except: pass

        # 3. オッズ補完
        if race_id:
            # 出馬表でオッズが0、またはSP版結果でオッズが0の場合に実行
            has_missing_odds = any(h["odds"] == 0 for h in horses)
            if has_missing_odds:
                om = self.fetch_odds_api(race_id) or self.fetch_live_odds_sp(race_id)
                for h in horses:
                    if h["umaban"] in om:
                        # 0.0の場合だけ上書き、または確定オッズ取得時
                        if h["odds"] == 0:
                            h["odds"] = om[h["umaban"]]["odds"]
                            h["popular"] = om[h["umaban"]]["popular"]
        
        # 4. 監査
        cg = grade_info.split(' ')[0]
        for h in horses: h["audit"] = self.audit_horse_history(h["horse_id"], cg)

        # 5. 払戻金
        payouts = {}
        pay_tables = soup.select('.Payout_Detail_Table') or soup.select('.Payout_Table')
        for tbl in pay_tables:
            for tr in tbl.select('tr'):
                th = tr.select_one('th')
                if not th: continue
                tn = th.get_text().strip()
                if tn in ['単勝', 'ワイド', '3連複']:
                    tds = tr.select('td')
                    if len(tds) >= 2:
                        payouts[tn] = tds[1].get_text(separator=' ').strip().replace('\n', ' ')

        return {
            "race_name": race_name, "venue": venue, "race_num": race_num,
            "course_info": course_info, "grade_info": grade_info, "date_info": date_info,
            "horses": sorted(horses, key=lambda x: x["umaban"]), "payouts": payouts,
            "odds_unavailable": not any(h["odds"] > 0 for h in horses)
        }
