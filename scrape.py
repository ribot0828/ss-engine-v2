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

    def audit_horse_history(self, horse_id, current_grade):
        """馬の過去5走を調べ、実績があるか判定 (Amber Audit)"""
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
        # 10:30時点の安定したロジック (出馬表・結果に特化)
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

        # レース名・メタデータ取得
        name_elem = (soup.select_one(".RaceName") or soup.select_one(".Race_Name") or 
                     soup.select_one("h1.RaceName") or soup.select_one(".RaceTitle"))
        race_name = name_elem.get_text().strip() if name_elem else ""
        if (not race_name or race_name == "netkeiba") and soup.title:
            race_name = soup.title.text.split(' | ')[0].split(' 出馬表')[0].split(' 結果')[0].strip()

        num_elem = soup.select_one(".RaceNum") or soup.select_one(".Race_Num")
        race_num = num_elem.get_text().strip() if num_elem else ""

        venue = ""
        v_elem = soup.select_one(".RaceList_DateList .Active") or soup.select_one(".Race_Date a") or soup.select_one(".Race_Date")
        if v_elem:
            v_text = v_elem.get_text().strip()
            v_match = re.search(r'([^\d\(\)\s/]+)$', v_text)
            if v_match: venue = v_match.group(1)

        course_elem = soup.select_one(".RaceData01") or soup.select_one(".Race_Name_Box")
        course_info = ""
        if course_elem:
            t = course_elem.get_text(separator=' ').strip()
            course_main = re.sub(r'\s+', ' ', t).split('特集')[0].strip()
            course_info = re.sub(r'^[0-9]+:[0-9]+\s*発走\s*/\s*', '', course_main)

        grade_info = "不明"
        grad_e = soup.select_one(".RaceData02") or soup.select_one(".Grade")
        rg = grad_e.get_text().strip() if grad_e else ""
        gm = re.search(r'(オープン|3勝クラス|2勝クラス|1勝クラス|新馬|未勝利|OP|G[1-3]|GⅠ|GⅡ|GⅢ)', rg + race_name + course_info)
        if gm: grade_info = gm.group(1)
        
        # 頭数取得
        head_match = re.search(r'([0-9]+頭)', rg + course_info)
        if head_match: grade_info += f" {head_match.group(1)}"

        # 馬リスト解析
        horses = []
        seen_umaban = set()

        if is_result:
            # レース結果ページ
            rows = soup.select(".ResultTable tr") or soup.select(".HorseList")
            for i, row in enumerate(rows):
                try:
                    cols = row.select('td')
                    if len(cols) >= 10: # PC
                        placing = cols[0].text.strip()
                        umaban = int(cols[2].text.strip())
                        name_a = cols[3].select_one('a')
                        name = name_a.get_text().strip()
                        hid = re.search(r'/horse/(\d+)', name_a['href']).group(1)
                        pop = cols[9].text.strip()
                        odds = float(cols[10].text.strip().replace('---.-', '0.0'))
                    else: # SP
                        placing = (row.select_one(".Result_Num") or row.select_one(".Rank")).get_text().strip()
                        umaban = int(re.sub(r'\D', '', (row.select_one(".Umaban") or row.select_one(".Num")).get_text().strip()))
                        name_a = row.select_one("a[href*='/horse/']")
                        name = name_a.get_text().strip()
                        hid = re.search(r'/horse/(\d+)', name_a['href']).group(1)
                        pop = ""
                        odds = 0.0
                    
                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)
                    horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": pop, "rank": "B", "placing": placing, "audit": "-"})
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
                    umaban_elem = row.select_one("td[class^='Umaban']") or row.select_one(".Horse_Num")
                    umaban = int(re.sub(r'\D', '', umaban_elem.get_text().strip()))
                    pop = (row.select_one("td.Popular") or row.select_one(".Popular")).get_text().strip() if row.select_one("td.Popular") or row.select_one(".Popular") else ""
                    odds_e = row.select_one("td.Txt_R span") or row.select_one(".Odds")
                    odds = float(odds_e.get_text().strip().replace('---.-', '0.0')) if odds_e else 0.0
                    
                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)
                    horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": pop, "rank": "B", "placing": "", "audit": "-"})
                except: pass

        # 監査の実行
        cg = grade_info.split(' ')[0]
        for h in horses: h["audit"] = self.audit_horse_history(h["horse_id"], cg)

        # 払戻金
        payouts = {}
        for tbl in soup.select('.Payout_Detail_Table') or soup.find_all(class_='Payout_Table'):
            for tr in tbl.select('tr'):
                th = tr.select_one('th')
                if th and th.get_text().strip() in ['単勝', 'ワイド', '3連複']:
                    tds = tr.select('td')
                    if len(tds) >= 2: payouts[th.get_text().strip()] = tds[1].get_text(separator=' ').strip().replace('\n', ' ')

        return {
            "race_name": race_name, "venue": venue, "race_num": race_num,
            "course_info": course_info, "grade_info": grade_info, "date_info": "2026-04-11",
            "horses": sorted(horses, key=lambda x: x["umaban"]), "payouts": payouts,
            "odds_unavailable": not any(h["odds"] > 0 for h in horses)
        }
