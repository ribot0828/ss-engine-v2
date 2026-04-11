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
        # 1. URLの正規化（スマホ版URLをPC版に強制変換して解析精度を上げる）
        match = re.search(r'race_id=(\d+)', url)
        race_id = match.group(1) if match else None
        
        # 結果ページかどうかの判定 (スマホ版のpid判定も追加)
        is_result = 'result.html' in url or 'pid=race_result' in url
        
        if race_id:
            page_type = 'result' if is_result else 'shutuba'
            # 常にPC版のURLに変換して取得する
            url = f"https://race.netkeiba.com/race/{page_type}.html?race_id={race_id}"

        # 常にPC版のUser-Agentを使用
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

        res = requests.get(url, headers=headers)
        res.encoding = 'euc-jp'
        soup = BeautifulSoup(res.text, 'html.parser')

        # 2. メタ情報の抽出（セレクタを補強）
        name_elem = (soup.select_one(".RaceName") or soup.select_one(".Race_Name") or 
                     soup.select_one("h1.RaceName") or soup.select_one(".RaceTitle"))
        race_name = name_elem.get_text().strip() if name_elem else ""

        # コース詳細
        course_elem = soup.select_one(".RaceData01") or soup.select_one(".Race_Name_Box") or soup.select_one(".RaceData02")
        course_info = ""
        if course_elem:
            t = course_elem.get_text(separator=' ').strip()
            t = re.sub(r'\s+', ' ', t)
            # 不要な文字列を除去
            course_info = re.sub(r'^[0-9]+:[0-9]+\s*発走\s*/\s*', '', t).split('特集')[0].strip()

        # グレード情報の抽出
        grade_info = "不明"
        grade_icon = soup.select_one('.Icon_GradeType')
        if grade_icon:
            grade_info = grade_icon.get_text().strip()
        else:
            gm = re.search(r'(オープン|3勝クラス|2勝クラス|1勝クラス|新馬|未勝利|OP|G[1-3]|GⅠ|GⅡ|GⅢ)', race_name + course_info)
            if gm: grade_info = gm.group(1)

        # 頭数の抽出補完
        head_match = re.search(r'([0-9]+頭)', soup.text)
        if head_match and "頭" not in grade_info:
            grade_info += f" {head_match.group(1)}"

        # 3. 馬リストの抽出（PC版セレクタに一本化）
        horses = []
        seen_umaban = set()

        if is_result:
            # 確定データの抽出強化
            table = soup.select_one(".ResultTable") or soup.select_one("#All_Result_Table") or soup.select_one("table[summary='全着順']")
            if table:
                rows = table.select("tr")
                for row in rows:
                    cols = row.select("td")
                    if len(cols) < 10: continue
                    try:
                        placing_elem = row.select_one(".Rank") or cols[0]
                        placing = placing_elem.get_text().strip()
                        
                        umaban_elem = row.select_one(".Num") or cols[2]
                        umaban = int(re.sub(r'\D', '', umaban_elem.get_text().strip()))
                        
                        name_a = row.select_one("a[href*='/horse/']")
                        name = name_a.get_text().strip() if name_a else "不明"
                        hid = re.search(r'/horse/(\d+)', name_a['href']).group(1) if name_a else "不明"
                        
                        pop_elem = row.select_one(".Popular") or cols[9]
                        pop = pop_elem.get_text().strip() if pop_elem else ""
                        
                        odds_elem = row.select_one(".Odds") or cols[10]
                        odds_txt = odds_elem.get_text().strip().replace(',', '').replace('---.-', '0.0') if odds_elem else "0.0"
                        odds = float(odds_txt) if odds_txt else 0.0

                        if umaban in seen_umaban: continue
                        seen_umaban.add(umaban)
                        horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": pop, "rank": "B", "placing": placing, "audit": "-"})
                    except: pass
        else:
            # 出馬表ページ
            rows = soup.select(".HorseList")
            for row in rows:
                try:
                    num_e = row.select_one("td[class^='Umaban']") or row.select_one(".Umaban") or row.select_one(".Horse_Num")
                    if not num_e: continue
                    umaban = int(re.sub(r'\D', '', num_e.get_text().strip()))
                    name_a = row.select_one(".HorseName a") or row.select_one("a[href*='/horse/']")
                    name = name_a.get_text().strip()
                    hid = re.search(r'/horse/(\d+)', name_a['href']).group(1)
                    odds_e = row.select_one(".Odds") or row.select_one("td.Txt_R")
                    odds = float(odds_e.get_text().strip().replace('---.-', '0.0')) if odds_e else 0.0
                    pop_e = row.select_one(".Popular") or row.select_one("td.Popular")
                    pop = pop_e.get_text().strip() if pop_e else ""
                    
                    if umaban in seen_umaban: continue
                    seen_umaban.add(umaban)
                    horses.append({"umaban": umaban, "name": name, "horse_id": hid, "odds": odds, "popular": pop, "rank": "B", "placing": "", "audit": "-"})
                except: pass

        # 琥珀監査の実行
        cg = grade_info.split(' ')[0]
        for h in horses: h["audit"] = self.audit_horse_history(h["horse_id"], cg)

        # 払戻金
        payouts = {}
        pay_box = soup.select_one(".ResultRefund") or soup.select_one(".Payout_Detail_Table") or soup.select_one(".Payout_Table")
        if pay_box:
            for tr in pay_box.select('tr'):
                th = tr.select_one('th')
                if th:
                    tn = th.get_text().strip()
                    if tn in ['単勝', 'ワイド', '3連複']:
                        tds = tr.select('td')
                        if len(tds) >= 2: payouts[tn] = tds[1].get_text(separator=' ').strip().replace('\n', ' ')

        return {
            "race_name": race_name, "course_info": course_info, "grade_info": grade_info,
            "horses": sorted(horses, key=lambda x: x["umaban"]), "payouts": payouts,
            "date_info": datetime.now().strftime("%Y-%m-%d")
        }
