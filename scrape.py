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

    def fetch_live_odds_sp(self, race_id):
        """SP Odds View (Mobile headers are stable for live data)"""
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
        """Amber Audit logic (checks past 5 races)"""
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
        # 1. URL Analysis
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

        # 2. Definitive Metadata Extraction
        # Race Name & Grade (Verified Selectors)
        name_elem = soup.select_one("h1.RaceName") or soup.select_one(".RaceName")
        race_name = ""
        grade_info = ""
        
        if name_elem:
            # Extract Grade from Icon class (Verified GI/GII/GIII behavior)
            grade_icon = name_elem.select_one(".Icon_GradeType")
            if grade_icon:
                classes = grade_icon.get('class', [])
                for cl in classes:
                    if cl.endswith('1'): grade_info = "G1"
                    elif cl.endswith('2'): grade_info = "G2"
                    elif cl.endswith('3'): grade_info = "G3"
            
            # Clean Race Name (remove the icon tag and extra spaces)
            for tag in name_elem.find_all('span'): tag.decompose()
            race_name = name_elem.get_text().strip()
            
        if not race_name and soup.title:
            title = soup.title.text
            parts = re.split(r' (オッズ|出馬表|結果|レース情報)', title)
            if parts: race_name = parts[0].strip()

        # Grade fallback (regex)
        if not grade_info:
            gm = re.search(r'(オープン|3勝クラス|2勝クラス|1勝クラス|新馬|未勝利|OP|G[1-3]|GⅠ|GⅡ|GⅢ)', race_name)
            if gm: grade_info = gm.group(1)

        # Race Info (Venue, Num, Date, Headcount)
        num_elem = soup.select_one(".RaceNum") or soup.select_one(".Race_Num")
        race_num = num_elem.get_text().strip() if num_elem else ""

        venue = ""
        venue_elem = soup.select_one(".RaceList_DateList .Active") or soup.select_one(".Race_Date a")
        if venue_elem:
            v_match = re.search(r'([^\d\(\)\s/]+)$', venue_elem.get_text().strip())
            if v_match: venue = v_match.group(1)
        if not venue and race_id:
            jra = {"01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京","06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉"}
            venue = jra.get(race_id[4:6], "")

        # Headcount extracted from RaceData01
        data01 = soup.select_one(".RaceData01")
        course_info = ""
        if data01:
            t = data01.get_text(separator=' ').strip()
            course_info = re.sub(r'\s+', ' ', t).split('特集')[0].strip()
            head_match = re.search(r'([0-9]+頭)', t)
            if head_match:
                grade_info += f" {head_match.group(1)}"

        date_info = ""
        date_sel = soup.select_one(".RaceList_DateBox .Active") or soup.select_one("#RaceList_DateList .Active")
        if date_sel: date_info = date_sel.get_text().strip()
        if not date_info and race_id: date_info = datetime.now().strftime("%Y-%m-%d")

        # 3. Definitive Horse Table Extraction
        horses = []
        seen_umaban = set()

        if is_result:
            # Result Table (Verified Selector: #All_Result_Table)
            target_table = soup.select_one("#All_Result_Table")
            if target_table:
                rows = target_table.find_all("tr")
                for i, row in enumerate(rows):
                    cols = row.select("td")
                    if len(cols) < 11: continue # Skip headers or malformed rows
                    try:
                        placing = cols[0].get_text().strip()
                        umaban = int(cols[2].get_text().strip())
                        name_a = cols[3].select_one('a')
                        name = name_a.get_text().strip() if name_a else cols[3].get_text().strip()
                        hid = re.search(r'/horse/(\d+)', name_a['href']).group(1) if name_a else "不明"
                        # Verified Indices: Index 9 = Popularity, Index 10 = Odds
                        pop = cols[9].get_text().strip()
                        odds_txt = cols[10].get_text().strip().replace('---.-', '0.0')
                        odds = float(odds_txt) if odds_txt else 0.0

                        if umaban in seen_umaban: continue
                        seen_umaban.add(umaban)
                        horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": pop, "rank": "B", "placing": placing, "audit": "-"})
                    except: pass
        else:
            # Shutuba Page
            rows = soup.select(".HorseList")
            for i, row in enumerate(rows):
                try:
                    name_a = row.select_one(".HorseName a") or row.select_one("dt.Horse a") or row.select_one("a[href*='/horse/']")
                    if not name_a: continue
                    name = name_a.get_text().strip()
                    hid = re.search(r'/horse/(\d+)', name_a['href']).group(1)
                    num_e = row.select_one("td[class^='Umaban']") or row.select_one(".Horse_Num")
                    umaban = int(re.sub(r'\D', '', num_e.get_text().strip()))
                    pop_e = row.select_one("td.Popular") or row.select_one(".Popular")
                    pop = pop_e.get_text().strip() if pop_e else ""
                    odd_e = row.select_one("td.Txt_R span") or row.select_one(".Odds")
                    odds = float(odd_e.get_text().strip().replace('---.-', '0.0')) if odd_e else 0.0
                    
                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)
                    horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": pop, "rank": "B", "placing": "", "audit": "-"})
                except: pass

        # 4. Odds Completion & Audit
        if not is_result and race_id:
            if not any(h["odds"] > 0 for h in horses):
                om = self.fetch_live_odds_sp(race_id)
                for h in horses:
                    if h["umaban"] in om:
                        h["odds"] = om[h["umaban"]]["odds"]
                        h["popular"] = om[h["umaban"]]["popular"]
        
        cg = grade_info.split(' ')[0]
        for h in horses: h["audit"] = self.audit_horse_history(h["horse_id"], cg)

        # 5. Payouts (Verified Selectors)
        payouts = {}
        pay_box = soup.select_one(".ResultRefund") or soup.select_one(".Payout_Detail_Table")
        if pay_box:
            for tr in pay_box.select('tr'):
                th = tr.select_one('th')
                if th:
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
